/* =========================================================
   おうちネット Hub — おえかき3D（子供向け 街づくりミニゲーム）
   描いた絵を立体化し、マリオRPG風アイソメトリックの海岸に
   置いていく。たくさん置くほど街に育つ。

   おえかき: ふで／ぬりつぶし／けしゴム、Undo/Redo、
             したがきガイド、12色+自由カラー、リアルタイム3Dプレビュー
   ステージ: ズーム／パン／ピンチ、フルスクリーン、効果音、
             ワドル歩行・スカッシュ&ストレッチ・砂ぼこり・雲・鳥
   保存:     ブラウザにローカル保存し、次回自動読み込み
   依存ライブラリなし（CSP: default-src 'self' でも動作）。
   ========================================================= */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // バックバッファ（低解像度レトロ質感）
  const BUF_W = 384, BUF_H = 256;
  // アイソメトリック投影
  const TILE_W = 22, TILE_H = 11;
  const WORLD_W = 26, WORLD_D = 14;          // 横長の広い街
  const SLAB_H = 12;
  const SKY_Y = 26;
  const SPRITE_MAX = 28;                      // 生成スプライトの最大辺

  const MIN_ZOOM = 0.4, MAX_ZOOM = 2.2, DEF_ZOOM = 0.75;
  const MAX_CREATURES = 60;
  const MAX_UNDO = 16;
  const STORE_KEY = "ouchi.kids.town.v1";
  const MUTE_KEY = "ouchi.kids.muted";

  const COLORS = [
    "#e0483f", "#f2903b", "#f6d24a", "#7ac74f", "#3fa9c9", "#5566c9",
    "#c85fa8", "#f4a9b8", "#7bd0c4", "#8a5a3c", "#2f2f38", "#ffffff",
  ];
  const OUTLINE_COLOR = "#4a3a2c";

  // ---- 状態 ----------------------------------------------------------
  let drawCanvas, dctx, guideCanvas, gctx, previewCanvas, pctx;
  let sceneCanvas, sctx, sceneFrame;
  let color = COLORS[0], brush = 12, tool = "brush";   // brush | fill | eraser
  let drawing = false, lastPt = null;
  let guide = "none";
  let seaGrad = null, skyGrad = null;

  const undoStack = [], redoStack = [];
  let previewSprite = null, previewShade = null;

  const creatures = [];
  const props = [];
  const particles = [];
  const clouds = [];
  const birds = [];
  let birdTimer = 6;
  let stipple = [];
  let zoom = DEF_ZOOM, camX = 0, camY = 0;
  let rafId = null, lastT = 0, timeSec = 0;
  let selected = null;
  let pointerDown = null;     // なかまドラッグ
  let panState = null;        // 画面パン
  let pinch = null;           // ピンチズーム
  const activePtrs = new Map();

  // 世界の中心（画面中心合わせの基準）
  const CX = (WORLD_W / 2 - WORLD_D / 2) * (TILE_W / 2);
  const CY = (WORLD_W / 2 + WORLD_D / 2) * (TILE_H / 2);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function mkCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  // ---- 効果音（Web Audio 合成、外部ファイル不要） --------------------
  let audioCtx = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* noop */ }

  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    } catch (e) { /* noop */ }
  }

  function beep(f0, f1, dur, type, vol) {
    if (muted) return;
    try {
      ensureAudio();
      if (!audioCtx) return;
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(Math.max(30, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* noop */ }
  }
  const sfx = {
    spawn: () => beep(330, 720, 0.18, "triangle", 0.14),
    jump:  () => beep(190, 540, 0.15, "sine", 0.12),
    land:  () => beep(150, 70, 0.1, "sine", 0.1),
    bye:   () => beep(520, 130, 0.25, "sawtooth", 0.06),
    grab:  () => beep(380, 460, 0.06, "square", 0.05),
    draw:  () => beep(520, 620, 0.05, "triangle", 0.04),
  };

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch (e) { /* noop */ }
    const btn = $("#kids-mute");
    if (btn) btn.textContent = muted ? "🔇" : "🔊";
  }

  // ---- アイソメトリック投影（ズーム＋カメラパン込み） -----------------
  function iso(wx, wz) {
    const ex = (wx - wz) * (TILE_W / 2);
    const ey = (wx + wz) * (TILE_H / 2);
    return {
      x: BUF_W / 2 + (ex - CX) * zoom - camX,
      y: BUF_H / 2 + (ey - CY) * zoom - camY,
    };
  }
  function unproject(px, py) {
    const ex = (px - BUF_W / 2 + camX) / zoom + CX;
    const ey = (py - BUF_H / 2 + camY) / zoom + CY;
    const wx = (ex / (TILE_W / 2) + ey / (TILE_H / 2)) / 2;
    const wz = (ey / (TILE_H / 2) - ex / (TILE_W / 2)) / 2;
    return { bx: clamp(wx, 0, WORLD_W), by: clamp(wz, 0, WORLD_D) };
  }
  function project(bx, by) { const p = iso(bx, by); return { sx: p.x, feetY: p.y }; }
  function depthKey(bx, by) { return bx + by; }

  function clampCam() {
    const halfW = (WORLD_W + WORLD_D) * (TILE_W / 2) / 2 * zoom;
    const halfH = ((WORLD_W + WORLD_D) * (TILE_H / 2) / 2 + SLAB_H) * zoom;
    const maxX = Math.max(0, halfW - BUF_W / 2 + 30);
    const maxY = Math.max(0, halfH - BUF_H / 2 + 40);
    camX = clamp(camX, -maxX, maxX);
    camY = clamp(camY, -maxY, maxY);
  }
  function setZoom(z) {
    zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    clampCam();
    const el = $("#zoom-label");
    if (el) el.textContent = Math.round(zoom * 100) + "%";
  }

  // ---- サブタブ切替 ---------------------------------------------------
  function switchSub(name) {
    $$(".kidsub").forEach((b) => b.classList.toggle("is-active", b.dataset.kidsub === name));
    $$(".kids-sub").forEach((p) => p.classList.toggle("is-active", p.id === "kidsub-" + name));
  }

  // ---- Undo / Redo ----------------------------------------------------
  function pushUndo() {
    try {
      undoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack.length = 0;
      updateUndoButtons();
    } catch (e) { /* noop */ }
  }
  function doUndo() {
    if (!undoStack.length) return;
    try {
      redoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
      dctx.putImageData(undoStack.pop(), 0, 0);
      updateUndoButtons();
      updatePreview();
    } catch (e) { /* noop */ }
  }
  function doRedo() {
    if (!redoStack.length) return;
    try {
      undoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
      dctx.putImageData(redoStack.pop(), 0, 0);
      updateUndoButtons();
      updatePreview();
    } catch (e) { /* noop */ }
  }
  function updateUndoButtons() {
    const u = $("#undo-btn"), r = $("#redo-btn");
    if (u) u.disabled = undoStack.length === 0;
    if (r) r.disabled = redoStack.length === 0;
  }

  // ---- ツール ---------------------------------------------------------
  function setTool(name) {
    tool = name;
    $$(".tool-btn[data-tool]").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tool === name));
  }

  // ---- おえかきキャンバス ---------------------------------------------
  function setupDrawing() {
    dctx = drawCanvas.getContext("2d", { willReadFrequently: true });
    dctx.lineCap = "round";
    dctx.lineJoin = "round";
    clearDrawing();
    const toXY = (e) => {
      const r = drawCanvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (drawCanvas.width / r.width),
        y: (e.clientY - r.top) * (drawCanvas.height / r.height),
      };
    };
    drawCanvas.addEventListener("pointerdown", (e) => {
      ensureAudio();
      const p = toXY(e);
      pushUndo();
      if (tool === "fill") {
        floodFill(Math.round(p.x), Math.round(p.y), color);
        updatePreview();
        sfx.draw();
        return;
      }
      drawing = true; lastPt = p; strokeTo(p);
      drawCanvas.setPointerCapture(e.pointerId);
    });
    drawCanvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = toXY(e); strokeLine(lastPt, p); lastPt = p;
    });
    const end = () => {
      if (drawing) updatePreview();
      drawing = false; lastPt = null;
    };
    drawCanvas.addEventListener("pointerup", end);
    drawCanvas.addEventListener("pointercancel", end);
  }
  function applyBrush() {
    if (tool === "eraser") {
      dctx.globalCompositeOperation = "destination-out";
      dctx.strokeStyle = dctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      dctx.globalCompositeOperation = "source-over";
      dctx.strokeStyle = dctx.fillStyle = color;
    }
    dctx.lineWidth = brush;
  }
  function strokeTo(p) { applyBrush(); dctx.beginPath(); dctx.arc(p.x, p.y, brush / 2, 0, Math.PI * 2); dctx.fill(); }
  function strokeLine(a, b) { applyBrush(); dctx.beginPath(); dctx.moveTo(a.x, a.y); dctx.lineTo(b.x, b.y); dctx.stroke(); }
  function clearDrawing() {
    dctx.save();
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    dctx.restore();
  }

  // ---- 塗りつぶし（フラッドフィル） -----------------------------------
  function hexRGB(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function floodFill(sx, sy, fillHex) {
    const w = drawCanvas.width, h = drawCanvas.height;
    sx = clamp(sx, 0, w - 1); sy = clamp(sy, 0, h - 1);
    const img = dctx.getImageData(0, 0, w, h);
    const d = img.data;
    const si = (sy * w + sx) * 4;
    const tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
    const [fr, fg, fb] = hexRGB(fillHex);
    if (tr === fr && tg === fg && tb === fb && ta === 255) return;
    const TOL = 190;   // 4チャンネル合計の許容差（アンチエイリアス縁を跨げる程度）
    const visited = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const pi = stack.pop();
      const i4 = pi * 4;
      const diff = Math.abs(d[i4] - tr) + Math.abs(d[i4 + 1] - tg) +
                   Math.abs(d[i4 + 2] - tb) + Math.abs(d[i4 + 3] - ta);
      if (diff > TOL) continue;
      d[i4] = fr; d[i4 + 1] = fg; d[i4 + 2] = fb; d[i4 + 3] = 255;
      const x = pi % w, y = (pi / w) | 0;
      if (x > 0 && !visited[pi - 1]) { visited[pi - 1] = 1; stack.push(pi - 1); }
      if (x < w - 1 && !visited[pi + 1]) { visited[pi + 1] = 1; stack.push(pi + 1); }
      if (y > 0 && !visited[pi - w]) { visited[pi - w] = 1; stack.push(pi - w); }
      if (y < h - 1 && !visited[pi + w]) { visited[pi + w] = 1; stack.push(pi + w); }
    }
    dctx.putImageData(img, 0, 0);
  }

  // ---- したがきガイド（別レイヤー、完成品には写らない） ---------------
  function drawGuide(name) {
    guide = name;
    gctx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    if (name === "none") return;
    gctx.save();
    gctx.strokeStyle = "rgba(74,66,59,0.26)";
    gctx.lineWidth = 3;
    gctx.setLineDash([8, 7]);
    gctx.lineCap = "round";
    const ell = (x, y, rx, ry) => { gctx.beginPath(); gctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); gctx.stroke(); };
    const circ = (x, y, r) => ell(x, y, r, r);
    const poly = (pts, close) => {
      gctx.beginPath();
      pts.forEach((p, i) => (i ? gctx.lineTo(p[0], p[1]) : gctx.moveTo(p[0], p[1])));
      if (close) gctx.closePath();
      gctx.stroke();
    };
    if (name === "fish") {
      ell(145, 150, 82, 52);
      poly([[220, 150], [278, 108], [278, 192]], true);
      circ(102, 134, 7);
      poly([[125, 108], [150, 88], [172, 106]], false);   // 背びれ
    } else if (name === "crab") {
      ell(160, 168, 72, 48);
      circ(112, 92, 20); circ(208, 92, 20);               // ハサミ
      poly([[122, 108], [138, 130]], false);
      poly([[198, 108], [182, 130]], false);
      for (let i = 0; i < 3; i++) {                        // あし
        poly([[92 - i * 4, 150 + i * 22], [120, 162 + i * 14]], false);
        poly([[228 + i * 4, 150 + i * 22], [200, 162 + i * 14]], false);
      }
      circ(140, 152, 6); circ(180, 152, 6);
    } else if (name === "house") {
      poly([[88, 132], [232, 132], [232, 252], [88, 252]], true);
      poly([[72, 132], [160, 58], [248, 132]], true);
      poly([[142, 252], [142, 192], [178, 192], [178, 252]], false);
      poly([[104, 152], [132, 152], [132, 178], [104, 178]], true);
      poly([[188, 152], [216, 152], [216, 178], [188, 178]], true);
    } else if (name === "bird") {
      circ(118, 108, 27);
      ell(172, 165, 62, 40);
      poly([[91, 104], [70, 112], [91, 120]], true);      // くちばし
      ell(178, 150, 30, 16);                               // はね
      poly([[152, 205], [148, 232]], false);
      poly([[184, 205], [188, 232]], false);
      circ(112, 100, 5);
    }
    gctx.restore();
  }

  // ---- UI（パレット・筆・ボタン） -------------------------------------
  function buildPalette() {
    const pal = $("#palette");
    COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " is-active" : "");
      b.style.background = c;
      b.type = "button";
      b.setAttribute("aria-label", "いろ " + (i + 1));
      b.addEventListener("click", () => {
        color = c;
        setTool("brush");
        $$(".swatch").forEach((s) => s.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      pal.appendChild(b);
    });
    // 自由カラー（ネイティブのカラーピッカー）
    const custom = $("#custom-color");
    if (custom) {
      custom.addEventListener("input", () => {
        color = custom.value;
        setTool("brush");
        $$(".swatch").forEach((s) => s.classList.remove("is-active"));
      });
    }
  }

  function bindControls() {
    $$(".kidsub").forEach((b) => b.addEventListener("click", () => switchSub(b.dataset.kidsub)));

    $$(".tool-btn[data-tool]").forEach((b) =>
      b.addEventListener("click", () => setTool(b.dataset.tool)));
    $("#undo-btn").addEventListener("click", doUndo);
    $("#redo-btn").addEventListener("click", doRedo);

    $$(".brush-btn[data-size]").forEach((b) => {
      b.addEventListener("click", () => {
        brush = parseInt(b.dataset.size, 10);
        if (tool === "fill") setTool("brush");
        $$(".brush-btn[data-size]").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
      });
    });

    $$(".guide-btn").forEach((b) => {
      b.addEventListener("click", () => {
        drawGuide(b.dataset.guide);
        $$(".guide-btn").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
      });
    });

    $("#kids-clear-draw").addEventListener("click", () => {
      pushUndo();
      clearDrawing();
      updatePreview();
    });
    $("#kids-spawn").addEventListener("click", spawnFromDrawing);
    $("#kids-clear-scene").addEventListener("click", () => {
      creatures.length = 0;
      setSelected(null);
      updateCount();
      saveTown();
    });
    $("#kids-jump").addEventListener("click", () => { if (selected) { doJump(selected); sfx.jump(); } });
    $("#kids-delete").addEventListener("click", deleteSelected);
    $("#kids-edit").addEventListener("click", editSelected);

    $("#kids-zoom-in").addEventListener("click", () => setZoom(zoom * 1.25));
    $("#kids-zoom-out").addEventListener("click", () => setZoom(zoom / 1.25));
    sceneCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    $("#kids-fullscreen").addEventListener("click", toggleFullscreen);
    $("#kids-mute").addEventListener("click", () => { ensureAudio(); setMuted(!muted); });

    setupSceneInput();
  }

  function toggleFullscreen() {
    const on = sceneFrame.classList.toggle("fs");
    document.body.classList.toggle("kids-fs-open", on);
    try {
      let p;
      if (on && sceneFrame.requestFullscreen) p = sceneFrame.requestFullscreen();
      else if (!on && document.fullscreenElement && document.exitFullscreen) p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* noop */ }
  }

  // ---- スプライト生成（トリム→縮小→アウトライン） ---------------------
  function trimBBox() {
    const { width: w, height: h } = drawCanvas;
    const data = dctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x; if (y < y0) y0 = y;
          if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function silhouette(sp, col) {
    const c = mkCanvas(sp.width, sp.height);
    const cx = c.getContext("2d");
    cx.drawImage(sp, 0, 0);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = col;
    cx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // 1pxのダークアウトラインを付けて視認性を上げる（3Dのパキッと感）
  function withOutline(sp) {
    const c = mkCanvas(sp.width + 2, sp.height + 2);
    const cx = c.getContext("2d");
    const sil = silhouette(sp, OUTLINE_COLOR);
    const offs = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
    for (const o of offs) cx.drawImage(sil, o[0], o[1]);
    cx.drawImage(sp, 1, 1);
    return c;
  }

  function makeShade(sprite) {
    const c = mkCanvas(sprite.width, sprite.height);
    const cx = c.getContext("2d");
    cx.drawImage(sprite, 0, 0);
    cx.globalCompositeOperation = "source-atop";
    cx.fillStyle = "rgba(20,20,45,0.55)";
    cx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function buildSprite(maxDim) {
    const bb = trimBBox();
    if (!bb) return null;
    const scale = Math.min(1, maxDim / Math.max(bb.w, bb.h));
    const sw = Math.max(1, Math.round(bb.w * scale));
    const sh = Math.max(1, Math.round(bb.h * scale));
    const raw = mkCanvas(sw, sh);
    raw.getContext("2d").drawImage(drawCanvas, bb.x0, bb.y0, bb.w, bb.h, 0, 0, sw, sh);
    return withOutline(raw);
  }

  function snapshotSource() {
    const c = mkCanvas(drawCanvas.width, drawCanvas.height);
    c.getContext("2d").drawImage(drawCanvas, 0, 0);
    return c;
  }

  // ---- リアルタイム3Dプレビュー ---------------------------------------
  function updatePreview() {
    const sp = buildSprite(52);
    previewSprite = sp;
    previewShade = sp ? makeShade(sp) : null;
  }

  function renderPreview() {
    if (!pctx) return;
    const W = previewCanvas.width, H = previewCanvas.height;
    pctx.clearRect(0, 0, W, H);
    // ミニ砂地
    pctx.fillStyle = "rgba(230,207,148,0.95)";
    pctx.beginPath();
    pctx.ellipse(W / 2, H - 13, 44, 10, 0, 0, Math.PI * 2);
    pctx.fill();
    if (!previewSprite) {
      pctx.fillStyle = "rgba(138,125,112,0.75)";
      pctx.font = "11px sans-serif";
      pctx.textAlign = "center";
      pctx.fillText("かくとここに3Dででるよ", W / 2, H / 2 - 6);
      return;
    }
    const dw = previewSprite.width, dh = previewSprite.height;
    const bob = Math.sin(timeSec * 4) * 2.2;
    const rot = Math.sin(timeSec * 4) * 0.06;
    const fy = H - 15;
    pctx.fillStyle = "rgba(40,30,10,0.25)";
    pctx.beginPath();
    pctx.ellipse(W / 2, fy, dw * 0.42, dw * 0.15, 0, 0, Math.PI * 2);
    pctx.fill();
    drawStacked(pctx, previewSprite, previewShade, W / 2, fy - bob, dw, dh,
      1, rot, 1, 1, 5, 0.6, 0.85);
  }

  // ---- なかま管理 ------------------------------------------------------
  function spawnFromDrawing() {
    const sprite = buildSprite(SPRITE_MAX);
    if (!sprite) { if (window.toast) window.toast("なにか描いてね！"); return; }
    spawnCreature(sprite, snapshotSource());
    saveTown();
    sfx.spawn();
    if (window.toast) window.toast("街のなかまがふえたよ！");
    pushUndo();
    clearDrawing();
    updatePreview();
    switchSub("stage");
  }

  function spreadPosition() {
    let best = null, bestDist = -1;
    for (let i = 0; i < 16; i++) {
      const p = { bx: rand(1, WORLD_W - 1), by: rand(1, WORLD_D - 1) };
      let mind = Infinity;
      for (const c of creatures) mind = Math.min(mind, Math.hypot(p.bx - c.bx, p.by - c.by));
      if (mind > bestDist) { bestDist = mind; best = p; }
    }
    return best;
  }

  function makeCreature(sprite, source, opts) {
    opts = opts || {};
    return {
      sprite, shade: makeShade(sprite), source,
      sw: sprite.width, sh: sprite.height,
      bx: opts.bx != null ? opts.bx : 0, by: opts.by != null ? opts.by : 0,
      facing: opts.facing || (Math.random() < 0.5 ? 1 : -1),
      phase: rand(0, Math.PI * 2), bobSpeed: rand(4, 7), speed: rand(0.8, 1.7),
      jumpZ: 0, jumpV: 0, squash: 0, spawnT: 0, rest: 0,
    };
  }

  function spawnCreature(sprite, source) {
    if (creatures.length >= MAX_CREATURES) creatures.shift();
    const pos = spreadPosition();
    const cr = makeCreature(sprite, source, { bx: pos.bx, by: pos.by });
    pickTarget(cr);
    creatures.push(cr);
    puff(cr.bx, cr.by, 10);
    updateCount();
    return cr;
  }

  function pickTarget(cr) {
    cr.tx = rand(0.8, WORLD_W - 0.8);
    cr.ty = rand(0.8, WORLD_D - 0.8);
    if (Math.random() < 0.45) cr.rest = rand(0.6, 2.2);   // ときどき休憩
  }
  function doJump(cr) { if (cr.jumpZ <= 0.01) cr.jumpV = 62; }

  function setSelected(cr) {
    selected = cr;
    const box = $("#kids-actions");
    if (cr) box.removeAttribute("hidden"); else box.setAttribute("hidden", "");
  }
  function deleteSelected() {
    if (!selected) return;
    const i = creatures.indexOf(selected);
    if (i >= 0) {
      puff(selected.bx, selected.by, 12);
      creatures.splice(i, 1);
    }
    setSelected(null);
    updateCount();
    saveTown();
    sfx.bye();
    if (window.toast) window.toast("ばいばい！");
  }
  function editSelected() {
    if (!selected) return;
    pushUndo();
    clearDrawing();
    if (selected.source) dctx.drawImage(selected.source, 0, 0);
    const i = creatures.indexOf(selected);
    if (i >= 0) creatures.splice(i, 1);
    setSelected(null);
    updateCount();
    saveTown();
    updatePreview();
    switchSub("draw");
    if (window.toast) window.toast("なおしてね。できたら3Dにする！");
  }

  function townRank(n) {
    if (n >= 15) return "🌆 だいとかい";
    if (n >= 10) return "🏙️ にぎやかなまち";
    if (n >= 6) return "🏘️ まち";
    if (n >= 3) return "🛖 むら";
    return null;
  }
  function updateCount() {
    const el = $("#kids-count");
    if (!el) return;
    if (!creatures.length) {
      el.textContent = "なかまはまだいないよ。おえかきしてね！";
      return;
    }
    const rank = townRank(creatures.length);
    el.textContent = "なかま: " + creatures.length + "ひき" +
      (rank ? "（" + rank + "）" : "（多いほど街に！）");
  }

  // ---- ローカル保存／読み込み -----------------------------------------
  function saveTown() {
    try {
      const data = creatures.map((c) => ({
        sprite: c.sprite.toDataURL("image/png"),
        source: c.source ? c.source.toDataURL("image/png") : null,
        bx: c.bx, by: c.by, facing: c.facing,
      }));
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* 容量超過などは無視 */ }
  }
  function loadTown() {
    let raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    arr.forEach((rec) => {
      const img = new Image();
      img.onload = () => {
        const sp = mkCanvas(img.width, img.height);
        sp.getContext("2d").drawImage(img, 0, 0);
        const cr = makeCreature(sp, null, { bx: rec.bx, by: rec.by, facing: rec.facing });
        cr.spawnT = 1;   // 復元時はポップイン省略
        pickTarget(cr);
        creatures.push(cr);
        updateCount();
        if (rec.source) {
          const si = new Image();
          si.onload = () => {
            const sc = mkCanvas(si.width, si.height);
            sc.getContext("2d").drawImage(si, 0, 0);
            cr.source = sc;
          };
          si.src = rec.source;
        }
      };
      img.src = rec.sprite;
    });
  }

  // ---- パーティクル（砂ぼこり） ---------------------------------------
  function puff(bx, by, n) {
    for (let i = 0; i < (n || 8); i++) {
      particles.push({
        bx: bx + rand(-0.25, 0.25), by: by + rand(-0.25, 0.25),
        vx: rand(-0.9, 0.9), vy: rand(-0.5, 0.5),
        z: rand(1, 5), vz: rand(8, 26),
        life: rand(0.3, 0.6), maxLife: 0.6,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.bx += p.vx * dt; p.by += p.vy * dt;
      p.z += p.vz * dt; p.vz -= 60 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function renderParticles() {
    for (const p of particles) {
      const pos = iso(p.bx, p.by);
      const a = Math.max(0, p.life / p.maxLife);
      sctx.fillStyle = "rgba(226,206,160," + (0.7 * a).toFixed(2) + ")";
      sctx.beginPath();
      sctx.arc(pos.x, pos.y - p.z * zoom, (1.2 + (1 - a) * 2.6) * zoom, 0, Math.PI * 2);
      sctx.fill();
    }
  }

  // ---- 雲・鳥（空の生命感） -------------------------------------------
  function initSky() {
    clouds.length = 0;
    for (let i = 0; i < 3; i++) {
      clouds.push({ x: rand(0, BUF_W), y: rand(4, 20), s: rand(0.7, 1.25), v: rand(3, 8) });
    }
  }
  function updateSky(dt) {
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > BUF_W + 70) c.x = -70;
    }
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birds.push({ x: -18, y: rand(6, 26), v: rand(22, 38), f: rand(6, 10) });
      birdTimer = rand(7, 14);
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      birds[i].x += birds[i].v * dt;
      if (birds[i].x > BUF_W + 24) birds.splice(i, 1);
    }
  }
  function renderSky() {
    for (const c of clouds) {
      sctx.fillStyle = "rgba(255,255,255,0.85)";
      sctx.beginPath();
      sctx.ellipse(c.x, c.y + 6, 22 * c.s, 8 * c.s, 0, 0, Math.PI * 2);
      sctx.ellipse(c.x - 13 * c.s, c.y + 8, 12 * c.s, 6 * c.s, 0, 0, Math.PI * 2);
      sctx.ellipse(c.x + 14 * c.s, c.y + 8, 13 * c.s, 6 * c.s, 0, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.strokeStyle = "rgba(60,60,70,0.7)";
    sctx.lineWidth = 1.4;
    for (const b of birds) {
      const w = Math.sin(timeSec * b.f) * 3.4;
      sctx.beginPath();
      sctx.moveTo(b.x - 5, b.y - w);
      sctx.quadraticCurveTo(b.x, b.y + 2, b.x, b.y);
      sctx.quadraticCurveTo(b.x, b.y + 2, b.x + 5, b.y - w);
      sctx.stroke();
    }
  }

  // ---- ステージ描画 ----------------------------------------------------
  function fillPoly(pts, style) {
    sctx.fillStyle = style;
    sctx.beginPath();
    pts.forEach((p, i) => (i ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
    sctx.closePath();
    sctx.fill();
  }

  function drawGround() {
    sctx.fillStyle = seaGrad; sctx.fillRect(0, 0, BUF_W, BUF_H);
    sctx.fillStyle = skyGrad; sctx.fillRect(0, 0, BUF_W, SKY_Y);
    sctx.fillStyle = "#fbe7a6";
    sctx.beginPath(); sctx.arc(BUF_W - 40, 16, 12, 0, Math.PI * 2); sctx.fill();
    renderSky();

    const T = iso(0, 0), R = iso(WORLD_W, 0), B = iso(WORLD_W, WORLD_D), L = iso(0, WORLD_D);
    const th = SLAB_H * zoom;
    fillPoly([L, B, { x: B.x, y: B.y + th }, { x: L.x, y: L.y + th }], "#c8a86a");
    fillPoly([B, R, { x: R.x, y: R.y + th }, { x: B.x, y: B.y + th }], "#b7975a");
    const g = sctx.createLinearGradient(0, T.y, 0, B.y);
    g.addColorStop(0, "#f3e6c2"); g.addColorStop(1, "#e6cf94");
    fillPoly([T, R, B, L], g);

    sctx.strokeStyle = "rgba(190,165,110,0.35)";
    sctx.lineWidth = 1;
    for (let i = 0; i <= WORLD_W; i++) {
      const a = iso(i, 0), b = iso(i, WORLD_D);
      sctx.beginPath(); sctx.moveTo(a.x, a.y); sctx.lineTo(b.x, b.y); sctx.stroke();
    }
    for (let j = 0; j <= WORLD_D; j++) {
      const a = iso(0, j), b = iso(WORLD_W, j);
      sctx.beginPath(); sctx.moveTo(a.x, a.y); sctx.lineTo(b.x, b.y); sctx.stroke();
    }
    for (const s of stipple) {
      const p = iso(s.wx, s.wz);
      sctx.fillStyle = s.c;
      sctx.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
  }

  function drawShoreFoam() {
    sctx.strokeStyle = "rgba(255,255,255,0.7)";
    sctx.lineWidth = 2;
    for (const edge of [[iso(0, 0), iso(WORLD_W, 0)], [iso(0, 0), iso(0, WORLD_D)]]) {
      sctx.beginPath();
      for (let t = 0; t <= 1.001; t += 0.04) {
        const x = lerp(edge[0].x, edge[1].x, t);
        const y = lerp(edge[0].y, edge[1].y, t) + Math.sin(t * 30 + timeSec * 4) * 1.4;
        t === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
      }
      sctx.stroke();
    }
  }

  // ---- 小物 ------------------------------------------------------------
  function drawProp(pr) {
    const { x: sx, y: sy } = iso(pr.bx, pr.by);
    const z = zoom;
    switch (pr.kind) {
      case "palm": {
        const h = 42 * z;
        sctx.strokeStyle = "#9c6b3f"; sctx.lineWidth = Math.max(2, 5 * z);
        sctx.beginPath(); sctx.moveTo(sx, sy);
        sctx.quadraticCurveTo(sx - 6 * z, sy - h * 0.6, sx - 3 * z, sy - h); sctx.stroke();
        sctx.fillStyle = "#4f9d54";
        for (let a = 0; a < 6; a++) {
          const ang = (Math.PI * 2 / 6) * a + 0.3;
          sctx.beginPath();
          sctx.ellipse(sx - 3 * z + Math.cos(ang) * 12 * z, sy - h + Math.sin(ang) * 7 * z,
            13 * z, 5 * z, ang, 0, Math.PI * 2);
          sctx.fill();
        }
        break;
      }
      case "rock": {
        sctx.fillStyle = "#9a958c";
        sctx.beginPath(); sctx.ellipse(sx, sy - 5 * z, 12 * z, 9 * z, 0, 0, Math.PI * 2); sctx.fill();
        break;
      }
      case "star": {
        sctx.fillStyle = "#e58b5a";
        sctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const ang = (Math.PI / 5) * i - Math.PI / 2;
          const rr = (i % 2 === 0 ? 6 : 2.6) * z;
          const x = sx + Math.cos(ang) * rr, y = sy - 2 * z + Math.sin(ang) * rr * 0.7;
          i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
        }
        sctx.closePath(); sctx.fill();
        break;
      }
    }
  }

  // ---- なかま描画（スタック＋ワドル＋スカッシュ） ----------------------
  // 積層描画の共通ヘルパー。rot=回転, sqx/sqy=スカッシュ, stepY=層の高さ, leanX=層の傾き
  function drawStacked(ctx, sp, sh, x, feetY, dw, dh, facing, rot, sqx, sqy, layers, leanX, stepY) {
    ctx.save();
    ctx.translate(x, feetY);
    ctx.rotate(rot);
    ctx.scale(facing < 0 ? -sqx : sqx, sqy);
    for (let i = layers; i >= 1; i--) {
      ctx.drawImage(sh, -dw / 2 + leanX * i, -dh - i * stepY, dw, dh);
    }
    ctx.drawImage(sp, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function drawCreature(cr, isSel) {
    const z = zoom;
    const { sx, feetY } = project(cr.bx, cr.by);
    let dw = cr.sw * z, dh = cr.sh * z;

    // ポップイン（スポーン演出）
    if (cr.spawnT < 1) {
      const pop = Math.max(0.05, easeOutBack(cr.spawnT));
      dw *= pop; dh *= pop;
    }

    const moving = cr.rest <= 0 && !cr.grabbed && cr.jumpZ <= 0.01;
    const bob = Math.sin(cr.phase) * (moving ? 2.4 : 0.9) * z;
    const y = feetY - bob - cr.jumpZ * z;

    // スカッシュ&ストレッチ
    let sqx = 1, sqy = 1;
    if (cr.jumpZ > 0.5) { sqy = 1.07; sqx = 0.94; }
    if (cr.squash > 0) {
      sqy = 1 - 0.22 * cr.squash;
      sqx = 1 + 0.24 * cr.squash;
    }
    // ワドル（歩行の左右ゆれ）／つかまれ中はプルプル
    let rot = 0;
    if (cr.grabbed) rot = Math.sin(timeSec * 22) * 0.05;
    else if (moving) rot = Math.sin(cr.phase) * 0.085;

    // 影（ジャンプ中は小さく）
    const shk = 1 - Math.min(0.6, cr.jumpZ / 60);
    sctx.fillStyle = "rgba(40,30,10,0.25)";
    sctx.beginPath();
    sctx.ellipse(sx, feetY, dw * 0.44 * shk, dw * 0.17 * shk, 0, 0, Math.PI * 2);
    sctx.fill();

    if (isSel) {
      sctx.strokeStyle = "rgba(246,210,74,0.95)";
      sctx.lineWidth = 2;
      sctx.beginPath();
      sctx.ellipse(sx, feetY, dw * 0.5 + 2, dw * 0.22 + 2, 0, 0, Math.PI * 2);
      sctx.stroke();
    }

    drawStacked(sctx, cr.sprite, cr.shade, sx, y, dw, dh,
      cr.facing, rot, sqx, sqy, 4, 0.5 * z, 0.85 * z);
  }

  function creatureBox(cr) {
    const z = zoom;
    const { sx, feetY } = project(cr.bx, cr.by);
    const dw = cr.sw * z, dh = cr.sh * z;
    const y = feetY - Math.sin(cr.phase) * 2.4 * z - cr.jumpZ * z;
    // 小さいなかまでもタップしやすいよう最小ヒット幅を確保
    const padX = Math.max(0, (18 - dw) / 2);
    const padY = Math.max(0, (18 - dh) / 2);
    return { x0: sx - dw / 2 - padX, y0: y - dh - padY, x1: sx + dw / 2 + padX, y1: y + padY };
  }

  function hitTest(px, py) {
    const ordered = creatures.slice().sort((a, b) => depthKey(b.bx, b.by) - depthKey(a.bx, a.by));
    for (const cr of ordered) {
      const b = creatureBox(cr);
      if (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) return cr;
    }
    return null;
  }

  // ---- 更新 ------------------------------------------------------------
  function update(dt) {
    timeSec += dt;
    updateSky(dt);
    updateParticles(dt);

    for (const cr of creatures) {
      if (cr.spawnT < 1) cr.spawnT = Math.min(1, cr.spawnT + dt * 2.6);
      if (cr.squash > 0) cr.squash = Math.max(0, cr.squash - dt * 5);

      // ジャンプ物理＋着地検出
      if (cr.jumpV !== 0 || cr.jumpZ > 0) {
        const wasUp = cr.jumpZ > 0;
        cr.jumpZ += cr.jumpV * dt;
        cr.jumpV -= 180 * dt;
        if (cr.jumpZ <= 0) {
          cr.jumpZ = 0; cr.jumpV = 0;
          if (wasUp) {          // 着地！
            cr.squash = 1;
            puff(cr.bx, cr.by, 6);
            sfx.land();
          }
        }
      }
      if (cr.grabbed) { cr.phase += dt * cr.bobSpeed; continue; }

      // 休憩 or 移動
      if (cr.rest > 0) {
        cr.rest -= dt;
        cr.phase += dt * cr.bobSpeed * 0.4;
      } else {
        const dx = cr.tx - cr.bx, dy = cr.ty - cr.by;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.3) pickTarget(cr);
        else {
          const step = cr.speed * dt;
          cr.bx += (dx / dist) * step;
          cr.by += (dy / dist) * step;
          if (Math.abs(dx - dy) > 0.001) cr.facing = (dx - dy) > 0 ? 1 : -1;
        }
        cr.phase += dt * cr.bobSpeed;
      }

      // 分散（かたまり防止）
      for (const o of creatures) {
        if (o === cr) continue;
        const ox = cr.bx - o.bx, oy = cr.by - o.by;
        const d = Math.hypot(ox, oy);
        if (d > 0.0001 && d < 0.9) {
          const push = (0.9 - d) * 1.1 * dt / d;
          cr.bx += ox * push;
          cr.by += oy * push;
        }
      }
      cr.bx = clamp(cr.bx, 0.5, WORLD_W - 0.5);
      cr.by = clamp(cr.by, 0.5, WORLD_D - 0.5);
    }
  }

  function render() {
    drawGround();
    drawShoreFoam();
    const drawList = [];
    for (const pr of props) drawList.push({ d: depthKey(pr.bx, pr.by), pr });
    for (const cr of creatures) drawList.push({ d: depthKey(cr.bx, cr.by), cr });
    drawList.sort((a, b) => a.d - b.d);
    for (const it of drawList) {
      if (it.pr) drawProp(it.pr);
      else drawCreature(it.cr, it.cr === selected);
    }
    renderParticles();
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    update(dt);
    render();
    renderPreview();
    rafId = requestAnimationFrame(loop);
  }

  // ---- シーン操作（タップ／ドラッグ／パン／ピンチ） --------------------
  function toScene(e) {
    const r = sceneCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (BUF_W / r.width),
      y: (e.clientY - r.top) * (BUF_H / r.height),
    };
  }

  function setupSceneInput() {
    sceneCanvas.addEventListener("pointerdown", (e) => {
      ensureAudio();
      const p = toScene(e);
      activePtrs.set(e.pointerId, p);
      try { sceneCanvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

      if (activePtrs.size === 2) {
        // 2本指 → ピンチ開始（進行中のドラッグ／パンは中止）
        if (pointerDown && pointerDown.cr) pointerDown.cr.grabbed = false;
        pointerDown = null;
        panState = null;
        const pts = Array.from(activePtrs.values());
        pinch = {
          d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
          z0: zoom,
          cx0: (pts[0].x + pts[1].x) / 2, cy0: (pts[0].y + pts[1].y) / 2,
          camX0: camX, camY0: camY,
        };
        return;
      }

      const cr = hitTest(p.x, p.y);
      if (cr) {
        pointerDown = { cr, sx: p.x, sy: p.y, moved: false, grabbing: false };
        e.preventDefault();
      } else {
        // 空き地 → パン開始（動かなければタップ＝選択解除）
        panState = { sx: p.x, sy: p.y, camX0: camX, camY0: camY, moved: false };
      }
    });

    sceneCanvas.addEventListener("pointermove", (e) => {
      if (!activePtrs.has(e.pointerId)) return;
      const p = toScene(e);
      activePtrs.set(e.pointerId, p);

      if (pinch && activePtrs.size >= 2) {
        const pts = Array.from(activePtrs.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        setZoom(pinch.z0 * (d / pinch.d0));
        camX = pinch.camX0 - (cx - pinch.cx0);
        camY = pinch.camY0 - (cy - pinch.cy0);
        clampCam();
        return;
      }

      if (pointerDown) {
        if (!pointerDown.moved &&
            Math.hypot(p.x - pointerDown.sx, p.y - pointerDown.sy) > 4) {
          pointerDown.moved = true;
          pointerDown.grabbing = true;
          pointerDown.cr.grabbed = true;
          setSelected(pointerDown.cr);
          sfx.grab();
        }
        if (pointerDown.grabbing) {
          const w = unproject(p.x, p.y);
          pointerDown.cr.bx = w.bx;
          pointerDown.cr.by = w.by;
        }
        return;
      }

      if (panState) {
        if (!panState.moved &&
            Math.hypot(p.x - panState.sx, p.y - panState.sy) > 4) {
          panState.moved = true;
        }
        if (panState.moved) {
          camX = panState.camX0 - (p.x - panState.sx);
          camY = panState.camY0 - (p.y - panState.sy);
          clampCam();
        }
      }
    });

    const up = (e) => {
      activePtrs.delete(e.pointerId);
      if (pinch && activePtrs.size < 2) pinch = null;
      if (pointerDown) {
        const cr = pointerDown.cr;
        if (pointerDown.grabbing) {
          cr.grabbed = false;
          pickTarget(cr);
          saveTown();
        } else {
          setSelected(cr);
          doJump(cr);
          sfx.jump();
        }
        pointerDown = null;
        return;
      }
      if (panState) {
        if (!panState.moved) setSelected(null);
        panState = null;
      }
    };
    sceneCanvas.addEventListener("pointerup", up);
    sceneCanvas.addEventListener("pointercancel", up);
  }

  // ---- 初期化 ----------------------------------------------------------
  function init() {
    drawCanvas = $("#draw-canvas");
    guideCanvas = $("#guide-canvas");
    previewCanvas = $("#preview-canvas");
    sceneCanvas = $("#scene-canvas");
    sceneFrame = $("#scene-frame");
    if (!drawCanvas || !sceneCanvas) return;

    gctx = guideCanvas.getContext("2d");
    pctx = previewCanvas.getContext("2d");
    pctx.imageSmoothingEnabled = false;
    sctx = sceneCanvas.getContext("2d");
    sctx.imageSmoothingEnabled = false;

    seaGrad = sctx.createLinearGradient(0, 0, 0, BUF_H);
    seaGrad.addColorStop(0, "#2f7ba0"); seaGrad.addColorStop(1, "#66b6d4");
    skyGrad = sctx.createLinearGradient(0, 0, 0, SKY_Y);
    skyGrad.addColorStop(0, "#cdeaf3"); skyGrad.addColorStop(1, "#bfe0ec");

    stipple = [];
    for (let i = 0; i < 1300; i++) {
      stipple.push({
        wx: Math.random() * WORLD_W, wz: Math.random() * WORLD_D,
        c: Math.random() < 0.5 ? "rgba(198,172,112,0.55)" : "rgba(255,247,214,0.5)",
      });
    }
    props.length = 0;
    props.push({ kind: "palm", bx: 1.4, by: 1.6 });
    props.push({ kind: "palm", bx: WORLD_W - 1.6, by: WORLD_D - 1.4 });
    props.push({ kind: "palm", bx: WORLD_W - 2.0, by: 1.5 });
    props.push({ kind: "rock", bx: 1.7, by: WORLD_D - 1.6 });
    props.push({ kind: "star", bx: WORLD_W / 2, by: WORLD_D - 1.0 });

    setupDrawing();
    buildPalette();
    bindControls();
    initSky();
    setZoom(DEF_ZOOM);
    setMuted(muted);
    drawGuide("none");
    updateUndoButtons();
    updatePreview();
    loadTown();

    lastT = performance.now();
    rafId = requestAnimationFrame(loop);

    // テスト用フック
    window.KidsTest = {
      count: () => creatures.length,
      running: () => rafId !== null,
      paintTest: () => {
        setTool("brush");
        color = COLORS[3]; brush = 20;
        pushUndo();
        strokeTo({ x: 160, y: 150 });
        strokeLine({ x: 130, y: 120 }, { x: 190, y: 180 });
        strokeLine({ x: 190, y: 120 }, { x: 130, y: 180 });
        updatePreview();
      },
      spawn: spawnFromDrawing,
      spawnMany: (n) => { for (let i = 0; i < n; i++) { window.KidsTest.paintTest(); spawnFromDrawing(); } },
      clearScene: () => { creatures.length = 0; setSelected(null); updateCount(); saveTown(); },
      step: (sec) => { for (let t = 0; t < sec; t += 0.016) update(0.016); },
      minPairDist: () => {
        let m = Infinity;
        for (let i = 0; i < creatures.length; i++)
          for (let j = i + 1; j < creatures.length; j++)
            m = Math.min(m, Math.hypot(creatures[i].bx - creatures[j].bx, creatures[i].by - creatures[j].by));
        return creatures.length < 2 ? Infinity : m;
      },
      screenCenter: (i) => {
        const cr = creatures[i]; if (!cr) return null;
        const b = creatureBox(cr);
        return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
      },
      bufSize: () => ({ w: BUF_W, h: BUF_H }),
      pinCenter: (i) => {
        const c = creatures[i];
        if (c) {
          c.bx = WORLD_W / 2; c.by = WORLD_D / 2;
          c.grabbed = true; c.jumpZ = 0; c.jumpV = 0; c.phase = 0; c.spawnT = 1;
        }
      },
      isJumping: (i) => (creatures[i] ? creatures[i].jumpZ > 0.5 || creatures[i].jumpV > 0 : false),
      pos: (i) => (creatures[i] ? { bx: creatures[i].bx, by: creatures[i].by } : null),
      selectedIndex: () => creatures.indexOf(selected),
      subActive: () => ($(".kids-sub.is-active") || {}).id || null,
      drawHasInk: () => !!trimBBox(),
      getZoom: () => zoom,
      setZoom: (z) => setZoom(z),
      isFullscreen: () => sceneFrame.classList.contains("fs"),
      storageLen: () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]").length; } catch (e) { return -1; } },
      world: () => ({ w: WORLD_W, d: WORLD_D, spriteMax: SPRITE_MAX }),
      // 新機能のフック
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      getTool: () => tool,
      pixelAt: (x, y) => Array.from(dctx.getImageData(x, y, 1, 1).data),
      guideActive: () => guide,
      guideHasInk: () => {
        const d = gctx.getImageData(0, 0, guideCanvas.width, guideCanvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        return false;
      },
      previewReady: () => previewSprite !== null,
      getCamera: () => ({ x: camX, y: camY }),
      isMuted: () => muted,
      particleCount: () => particles.length,
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();
