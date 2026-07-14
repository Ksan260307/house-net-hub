/* =========================================================
   おうちネット Hub — おえかき3D（子供向け 街づくりミニゲーム）
   描いた絵を「それっぽく立体化」し、スーパーマリオRPG風の
   アイソメトリック（斜め見下ろし・奥行き）の広い海岸に置いていく。
   たくさん置くほど街に。ズーム／フルスクリーン／ローカル保存対応。
   - タップでジャンプ／ドラッグで移動／なおす／ばいばい
   - 描いた作品はブラウザにローカル保存し、次回自動で読み込み
   依存ライブラリなし（CSP: default-src 'self' でも動作）。
   ========================================================= */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 広めのバックバッファ（低解像度レトロ質感）
  const BUF_W = 384, BUF_H = 256;
  // アイソメトリック投影
  const TILE_W = 22, TILE_H = 11;
  const WORLD_W = 26, WORLD_D = 14;         // 横長の広い街
  const SLAB_H = 12;
  const SKY_Y = 26;
  const SPRITE_MAX = 28;                     // 生成スプライトの最大辺（小さめ＝街っぽく）

  const MIN_ZOOM = 0.4, MAX_ZOOM = 2.0, DEF_ZOOM = 0.75;
  const MAX_CREATURES = 60;
  const STORE_KEY = "ouchi.kids.town.v1";

  const COLORS = [
    "#e0483f", "#f2903b", "#f6d24a", "#7ac74f", "#3fa9c9",
    "#5566c9", "#c85fa8", "#8a5a3c", "#2f2f38", "#ffffff",
  ];

  // 描画状態
  let drawCanvas, dctx;
  let sceneCanvas, sctx, sceneFrame;
  let color = COLORS[0], brush = 12, erasing = false;
  let drawing = false, lastPt = null;
  let seaGrad = null, skyGrad = null;

  // ゲーム状態
  const creatures = [];
  const props = [];
  let stipple = [];
  let zoom = DEF_ZOOM;
  let rafId = null, lastT = 0, timeSec = 0;
  let selected = null;
  let pointerDown = null;

  // 世界の中心（画面中心に合わせるための基準）
  const CX = (WORLD_W / 2 - WORLD_D / 2) * (TILE_W / 2);
  const CY = (WORLD_W / 2 + WORLD_D / 2) * (TILE_H / 2);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- アイソメトリック投影（ズーム込み） ---------------------------
  function iso(wx, wz) {
    const ex = (wx - wz) * (TILE_W / 2);
    const ey = (wx + wz) * (TILE_H / 2);
    return { x: BUF_W / 2 + (ex - CX) * zoom, y: BUF_H / 2 + (ey - CY) * zoom };
  }
  function unproject(px, py) {
    const ex = (px - BUF_W / 2) / zoom + CX;
    const ey = (py - BUF_H / 2) / zoom + CY;
    const wx = (ex / (TILE_W / 2) + ey / (TILE_H / 2)) / 2;
    const wz = (ey / (TILE_H / 2) - ex / (TILE_W / 2)) / 2;
    return { bx: clamp(wx, 0, WORLD_W), by: clamp(wz, 0, WORLD_D) };
  }
  function project(bx, by) { const p = iso(bx, by); return { sx: p.x, feetY: p.y }; }
  function depthKey(bx, by) { return bx + by; }

  // ---- サブタブ切替 -------------------------------------------------
  function switchSub(name) {
    $$(".kidsub").forEach((b) => b.classList.toggle("is-active", b.dataset.kidsub === name));
    $$(".kids-sub").forEach((p) => p.classList.toggle("is-active", p.id === "kidsub-" + name));
  }

  // ---- おえかきキャンバス -------------------------------------------
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
      drawing = true; lastPt = toXY(e); strokeTo(lastPt);
      drawCanvas.setPointerCapture(e.pointerId);
    });
    drawCanvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = toXY(e); strokeLine(lastPt, p); lastPt = p;
    });
    const end = () => { drawing = false; lastPt = null; };
    drawCanvas.addEventListener("pointerup", end);
    drawCanvas.addEventListener("pointercancel", end);
  }
  function applyBrush() {
    if (erasing) {
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

  // ---- UI -----------------------------------------------------------
  function buildPalette() {
    const pal = $("#palette");
    COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " is-active" : "");
      b.style.background = c; b.type = "button";
      b.setAttribute("aria-label", "いろ " + (i + 1));
      b.addEventListener("click", () => {
        erasing = false; color = c;
        $("#eraser-btn").classList.remove("is-active");
        $$(".swatch").forEach((s) => s.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      pal.appendChild(b);
    });
  }

  function bindControls() {
    $$(".kidsub").forEach((b) => b.addEventListener("click", () => switchSub(b.dataset.kidsub)));
    $$(".brush-btn[data-size]").forEach((b) => {
      b.addEventListener("click", () => {
        brush = parseInt(b.dataset.size, 10); erasing = false;
        $("#eraser-btn").classList.remove("is-active");
        $$(".brush-btn[data-size]").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
      });
    });
    $("#eraser-btn").addEventListener("click", () => {
      erasing = !erasing;
      $("#eraser-btn").classList.toggle("is-active", erasing);
    });
    $("#kids-clear-draw").addEventListener("click", clearDrawing);
    $("#kids-spawn").addEventListener("click", spawnFromDrawing);
    $("#kids-clear-scene").addEventListener("click", () => {
      creatures.length = 0; setSelected(null); updateCount(); saveTown();
    });
    $("#kids-jump").addEventListener("click", () => { if (selected) doJump(selected); });
    $("#kids-delete").addEventListener("click", deleteSelected);
    $("#kids-edit").addEventListener("click", editSelected);

    // ズーム
    $("#kids-zoom-in").addEventListener("click", () => setZoom(zoom * 1.25));
    $("#kids-zoom-out").addEventListener("click", () => setZoom(zoom / 1.25));
    sceneCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    // フルスクリーン
    $("#kids-fullscreen").addEventListener("click", toggleFullscreen);

    setupSceneInput();
  }

  function setZoom(z) {
    zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const el = $("#zoom-label");
    if (el) el.textContent = Math.round(zoom * 100) + "%";
  }

  function toggleFullscreen() {
    const on = sceneFrame.classList.toggle("fs");
    document.body.classList.toggle("kids-fs-open", on);
    // 対応環境ではネイティブのフルスクリーンも試みる（非対応でもCSSで動作）
    try {
      let p;
      if (on && sceneFrame.requestFullscreen) p = sceneFrame.requestFullscreen();
      else if (!on && document.fullscreenElement && document.exitFullscreen) p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* noop */ }
  }

  // ---- 立体化（絵→なかま） ------------------------------------------
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
  function makeShade(sprite) {
    const c = document.createElement("canvas");
    c.width = sprite.width; c.height = sprite.height;
    const cx = c.getContext("2d");
    cx.drawImage(sprite, 0, 0);
    cx.globalCompositeOperation = "source-atop";
    cx.fillStyle = "rgba(20,20,45,0.5)";
    cx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function snapshotSource() {
    const c = document.createElement("canvas");
    c.width = drawCanvas.width; c.height = drawCanvas.height;
    c.getContext("2d").drawImage(drawCanvas, 0, 0);
    return c;
  }

  function spawnFromDrawing() {
    const bb = trimBBox();
    if (!bb) { if (window.toast) window.toast("なにか描いてね！"); return; }
    const scale = Math.min(1, SPRITE_MAX / Math.max(bb.w, bb.h));
    const sw = Math.max(1, Math.round(bb.w * scale));
    const sh = Math.max(1, Math.round(bb.h * scale));
    const sprite = document.createElement("canvas");
    sprite.width = sw; sprite.height = sh;
    sprite.getContext("2d").drawImage(drawCanvas, bb.x0, bb.y0, bb.w, bb.h, 0, 0, sw, sh);
    spawnCreature(sprite, snapshotSource());
    saveTown();
    if (window.toast) window.toast("街のなかまがふえたよ！");
    clearDrawing();
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
      phase: rand(0, Math.PI * 2), bobSpeed: rand(4, 7), speed: rand(0.9, 1.8),
      jumpZ: 0, jumpV: 0,
    };
  }

  function spawnCreature(sprite, source) {
    if (creatures.length >= MAX_CREATURES) creatures.shift();
    const pos = spreadPosition();
    const cr = makeCreature(sprite, source, { bx: pos.bx, by: pos.by });
    pickTarget(cr);
    creatures.push(cr);
    updateCount();
    return cr;
  }

  function pickTarget(cr) {
    cr.tx = rand(0.8, WORLD_W - 0.8);
    cr.ty = rand(0.8, WORLD_D - 0.8);
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
    if (i >= 0) creatures.splice(i, 1);
    setSelected(null); updateCount(); saveTown();
    if (window.toast) window.toast("ばいばい！");
  }
  function editSelected() {
    if (!selected) return;
    clearDrawing();
    if (selected.source) dctx.drawImage(selected.source, 0, 0);
    const i = creatures.indexOf(selected);
    if (i >= 0) creatures.splice(i, 1);
    setSelected(null); updateCount(); saveTown();
    switchSub("draw");
    if (window.toast) window.toast("なおしてね。できたら3Dにする！");
  }
  function updateCount() {
    const el = $("#kids-count");
    if (!el) return;
    el.textContent = creatures.length
      ? "なかま: " + creatures.length + "ひき（多いほど街に！）"
      : "なかまはまだいないよ。おえかきしてね！";
  }

  // ---- ローカル保存／読み込み ---------------------------------------
  function saveTown() {
    try {
      const data = creatures.map((c) => ({
        sprite: c.sprite.toDataURL("image/png"),
        source: c.source ? c.source.toDataURL("image/png") : null,
        bx: c.bx, by: c.by, facing: c.facing,
      }));
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* 容量超過などは無視（保存は補助機能） */ }
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
        const sp = document.createElement("canvas");
        sp.width = img.width; sp.height = img.height;
        sp.getContext("2d").drawImage(img, 0, 0);
        const cr = makeCreature(sp, null, { bx: rec.bx, by: rec.by, facing: rec.facing });
        pickTarget(cr);
        creatures.push(cr);
        updateCount();
        if (rec.source) {
          const si = new Image();
          si.onload = () => {
            const sc = document.createElement("canvas");
            sc.width = si.width; sc.height = si.height;
            sc.getContext("2d").drawImage(si, 0, 0);
            cr.source = sc;
          };
          si.src = rec.source;
        }
      };
      img.src = rec.sprite;
    });
  }

  // ---- ステージ描画（毎フレーム、ズーム反映） -----------------------
  function fillPoly(pts, style) {
    sctx.fillStyle = style;
    sctx.beginPath();
    pts.forEach((p, i) => (i ? sctx.lineTo(p.x, p.y) : sctx.moveTo(p.x, p.y)));
    sctx.closePath(); sctx.fill();
  }

  function drawGround() {
    // 海（全面）＋空＋太陽
    sctx.fillStyle = seaGrad; sctx.fillRect(0, 0, BUF_W, BUF_H);
    sctx.fillStyle = skyGrad; sctx.fillRect(0, 0, BUF_W, SKY_Y);
    sctx.fillStyle = "#fbe7a6";
    sctx.beginPath(); sctx.arc(BUF_W - 40, 16, 12, 0, Math.PI * 2); sctx.fill();

    const T = iso(0, 0), R = iso(WORLD_W, 0), B = iso(WORLD_W, WORLD_D), L = iso(0, WORLD_D);
    const th = SLAB_H * zoom;
    // 側面（厚み）
    fillPoly([L, B, { x: B.x, y: B.y + th }, { x: L.x, y: L.y + th }], "#c8a86a");
    fillPoly([B, R, { x: R.x, y: R.y + th }, { x: B.x, y: B.y + th }], "#b7975a");
    // 上面
    const g = sctx.createLinearGradient(0, T.y, 0, B.y);
    g.addColorStop(0, "#f3e6c2"); g.addColorStop(1, "#e6cf94");
    fillPoly([T, R, B, L], g);
    // タイル格子
    sctx.strokeStyle = "rgba(190,165,110,0.35)"; sctx.lineWidth = 1;
    for (let i = 0; i <= WORLD_W; i += 1) {
      const a = iso(i, 0), b = iso(i, WORLD_D);
      sctx.beginPath(); sctx.moveTo(a.x, a.y); sctx.lineTo(b.x, b.y); sctx.stroke();
    }
    for (let j = 0; j <= WORLD_D; j += 1) {
      const a = iso(0, j), b = iso(WORLD_W, j);
      sctx.beginPath(); sctx.moveTo(a.x, a.y); sctx.lineTo(b.x, b.y); sctx.stroke();
    }
    // 砂のスティップル
    for (const s of stipple) {
      const p = iso(s.wx, s.wz);
      sctx.fillStyle = s.c;
      sctx.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
  }

  function drawShoreFoam() {
    sctx.strokeStyle = "rgba(255,255,255,0.7)"; sctx.lineWidth = 2;
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

  // ---- 小物 ---------------------------------------------------------
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
          sctx.ellipse(sx - 3 * z + Math.cos(ang) * 12 * z, sy - h + Math.sin(ang) * 7 * z, 13 * z, 5 * z, ang, 0, Math.PI * 2);
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

  // ---- なかま描画 ---------------------------------------------------
  function drawImgBottom(img, cx, feetY, dw, dh, facing) {
    sctx.save();
    sctx.translate(cx, feetY);
    if (facing < 0) sctx.scale(-1, 1);
    sctx.drawImage(img, -dw / 2, -dh, dw, dh);
    sctx.restore();
  }
  function drawCreature(cr, isSel) {
    const z = zoom;
    const { sx, feetY } = project(cr.bx, cr.by);
    const dw = cr.sw * z, dh = cr.sh * z;
    const bob = Math.sin(cr.phase) * 2.4 * z;
    const y = feetY - bob - cr.jumpZ * z;
    const shk = 1 - Math.min(0.6, cr.jumpZ / 60);
    sctx.fillStyle = "rgba(40,30,10,0.25)";
    sctx.beginPath();
    sctx.ellipse(sx, feetY, dw * 0.44 * shk, dw * 0.17 * shk, 0, 0, Math.PI * 2); sctx.fill();
    if (isSel) {
      sctx.strokeStyle = "rgba(246,210,74,0.95)"; sctx.lineWidth = 2;
      sctx.beginPath(); sctx.ellipse(sx, feetY, dw * 0.5 + 2, dw * 0.22 + 2, 0, 0, Math.PI * 2); sctx.stroke();
    }
    const layers = 4;
    const lean = cr.facing * 0.5 * z;
    for (let i = layers; i >= 1; i--) {
      drawImgBottom(cr.shade, sx + lean * i, y - i * 0.85 * z, dw, dh, cr.facing);
    }
    drawImgBottom(cr.sprite, sx, y, dw, dh, cr.facing);
  }
  function creatureBox(cr) {
    const z = zoom;
    const { sx, feetY } = project(cr.bx, cr.by);
    const dw = cr.sw * z, dh = cr.sh * z;
    const y = feetY - Math.sin(cr.phase) * 2.4 * z - cr.jumpZ * z;
    return { x0: sx - dw / 2, y0: y - dh, x1: sx + dw / 2, y1: y };
  }
  function hitTest(px, py) {
    const ordered = creatures.slice().sort((a, b) => depthKey(b.bx, b.by) - depthKey(a.bx, a.by));
    for (const cr of ordered) {
      const b = creatureBox(cr);
      if (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) return cr;
    }
    return null;
  }

  // ---- 更新 ---------------------------------------------------------
  function update(dt) {
    timeSec += dt;
    for (const cr of creatures) {
      if (cr.jumpV !== 0 || cr.jumpZ > 0) {
        cr.jumpZ += cr.jumpV * dt; cr.jumpV -= 180 * dt;
        if (cr.jumpZ <= 0) { cr.jumpZ = 0; cr.jumpV = 0; }
      }
      if (cr.grabbed) { cr.phase += dt * cr.bobSpeed; continue; }
      const dx = cr.tx - cr.bx, dy = cr.ty - cr.by;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.3) pickTarget(cr);
      else {
        const step = cr.speed * dt;
        cr.bx += (dx / dist) * step; cr.by += (dy / dist) * step;
        if (Math.abs(dx - dy) > 0.001) cr.facing = (dx - dy) > 0 ? 1 : -1;
      }
      for (const o of creatures) {
        if (o === cr) continue;
        const ox = cr.bx - o.bx, oy = cr.by - o.by;
        const d = Math.hypot(ox, oy);
        if (d > 0.0001 && d < 0.9) {
          const push = (0.9 - d) * 1.1 * dt / d;
          cr.bx += ox * push; cr.by += oy * push;
        }
      }
      cr.bx = clamp(cr.bx, 0.5, WORLD_W - 0.5);
      cr.by = clamp(cr.by, 0.5, WORLD_D - 0.5);
      cr.phase += dt * cr.bobSpeed;
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
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    update(dt); render();
    rafId = requestAnimationFrame(loop);
  }

  // ---- シーン操作 ---------------------------------------------------
  function toScene(e) {
    const r = sceneCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (BUF_W / r.width),
      y: (e.clientY - r.top) * (BUF_H / r.height),
    };
  }
  function setupSceneInput() {
    sceneCanvas.addEventListener("pointerdown", (e) => {
      const p = toScene(e);
      const cr = hitTest(p.x, p.y);
      if (cr) {
        pointerDown = { cr, sx: p.x, sy: p.y, moved: false, grabbing: false };
        sceneCanvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else setSelected(null);
    });
    sceneCanvas.addEventListener("pointermove", (e) => {
      if (!pointerDown) return;
      const p = toScene(e);
      if (!pointerDown.moved && Math.hypot(p.x - pointerDown.sx, p.y - pointerDown.sy) > 4) {
        pointerDown.moved = true; pointerDown.grabbing = true;
        pointerDown.cr.grabbed = true; setSelected(pointerDown.cr);
      }
      if (pointerDown.grabbing) {
        const w = unproject(p.x, p.y);
        pointerDown.cr.bx = w.bx; pointerDown.cr.by = w.by;
      }
    });
    const up = () => {
      if (!pointerDown) return;
      const cr = pointerDown.cr;
      if (pointerDown.grabbing) { cr.grabbed = false; pickTarget(cr); saveTown(); }
      else { setSelected(cr); doJump(cr); }
      pointerDown = null;
    };
    sceneCanvas.addEventListener("pointerup", up);
    sceneCanvas.addEventListener("pointercancel", up);
  }

  // ---- 初期化 -------------------------------------------------------
  function init() {
    drawCanvas = $("#draw-canvas");
    sceneCanvas = $("#scene-canvas");
    sceneFrame = $("#scene-frame");
    if (!drawCanvas || !sceneCanvas) return;

    sctx = sceneCanvas.getContext("2d");
    sctx.imageSmoothingEnabled = false;

    seaGrad = sctx.createLinearGradient(0, 0, 0, BUF_H);
    seaGrad.addColorStop(0, "#2f7ba0"); seaGrad.addColorStop(1, "#66b6d4");
    skyGrad = sctx.createLinearGradient(0, 0, 0, SKY_Y);
    skyGrad.addColorStop(0, "#cdeaf3"); skyGrad.addColorStop(1, "#bfe0ec");

    // 砂のスティップルと小物（世界座標で固定）
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
    setZoom(DEF_ZOOM);
    loadTown();

    lastT = performance.now();
    rafId = requestAnimationFrame(loop);

    window.KidsTest = {
      count: () => creatures.length,
      running: () => rafId !== null,
      paintTest: () => {
        color = COLORS[3]; brush = 20; erasing = false;
        strokeTo({ x: 160, y: 150 });
        strokeLine({ x: 130, y: 120 }, { x: 190, y: 180 });
        strokeLine({ x: 190, y: 120 }, { x: 130, y: 180 });
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
      pinCenter: (i) => { const c = creatures[i]; if (c) { c.bx = WORLD_W / 2; c.by = WORLD_D / 2; c.grabbed = true; c.jumpZ = 0; c.jumpV = 0; c.phase = 0; } },
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
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();
