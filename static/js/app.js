/* =========================================================
   おうちネット Hub — フロントエンド制御
   ========================================================= */
(function () {
  "use strict";

  // ---- 汎用ヘルパー -------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  async function api(path, options) {
    const res = await fetch(path, options);
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      // 具体的なエラー（バリデーション等）はそのまま、それ以外は状況を明示
      const msg = (body && body.error) || ("サーバーエラー (HTTP " + res.status + ")");
      throw new Error(msg);
    }
    return body;
  }

  const JSON_HEADERS = { "Content-Type": "application/json" };

  // ---- プロファイルストア（バックエンド優先・ローカル保存フォールバック） ----
  // Flaskサーバーがあれば暗号化バックエンドを使い、無い場合（PWA/静的配信/
  // サーバー未到達）はこの端末のブラウザ内(localStorage)に保存する。
  const PROFILE_LS_KEY = "ouchi.profiles.v1";
  const VALID_SECURITY = ["WPA", "WEP", "nopass"];
  let backendAvailable = null;   // null=未判定 / true / false

  async function detectBackend() {
    try {
      const res = await fetch("api/health", { cache: "no-store" });
      backendAvailable = res.ok &&
        (res.headers.get("content-type") || "").includes("application/json");
    } catch (e) {
      backendAvailable = false;
    }
    return backendAvailable;
  }
  async function ensureBackendKnown() {
    if (backendAvailable === null) await detectBackend();
    return backendAvailable;
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(PROFILE_LS_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function lsWrite(arr) {
    try { localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }
  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return "id" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
  }

  // バックエンドの validate_profile と同等のクライアント側検証
  function validateProfile(data) {
    const ssid = String(data.ssid == null ? "" : data.ssid).trim();
    const password = String(data.password == null ? "" : data.password);
    let name = String(data.name == null ? "" : data.name).trim();
    const security = String(data.security || "WPA").trim() || "WPA";
    if (!ssid) throw new Error("SSID は必須です");
    if (ssid.length > 32) throw new Error("SSID は32文字以内で入力してください");
    if (VALID_SECURITY.indexOf(security) < 0) throw new Error("セキュリティ種別が不正です");
    if (security !== "nopass" && !password) throw new Error("パスワードを入力してください");
    if (password.length > 63) throw new Error("パスワードは63文字以内で入力してください");
    if (!name) name = ssid;
    if (name.length > 40) throw new Error("プロファイル名は40文字以内で入力してください");
    return {
      name: name, ssid: ssid, password: password, security: security,
      hidden: !!data.hidden, is_guest: !!data.is_guest,
      show_password: !!data.show_password, note: String(data.note || "").trim(),
    };
  }

  const profileStore = {
    async list() {
      if (await ensureBackendKnown()) return api("api/profiles");
      return lsRead();
    },
    async add(payload) {
      if (await ensureBackendKnown()) {
        return api("api/profiles", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
      }
      const clean = validateProfile(payload);   // 先に検証（不正なら例外）
      const now = Date.now() / 1000;
      const item = Object.assign({ id: genId() }, clean, { created_at: now, updated_at: now });
      const arr = lsRead(); arr.push(item);
      if (!lsWrite(arr)) throw new Error("この端末に保存できませんでした（空き容量をご確認ください）");
      return item;
    },
    async update(id, payload) {
      if (await ensureBackendKnown()) {
        return api("api/profiles/" + id, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) });
      }
      const clean = validateProfile(payload);
      const arr = lsRead();
      const i = arr.findIndex((p) => p.id === id);
      if (i < 0) throw new Error("見つかりません");
      arr[i] = Object.assign(arr[i], clean, { updated_at: Date.now() / 1000 });
      lsWrite(arr);
      return arr[i];
    },
    async remove(id) {
      if (await ensureBackendKnown()) return api("api/profiles/" + id, { method: "DELETE" });
      lsWrite(lsRead().filter((p) => p.id !== id));
      return { deleted: id };
    },
    async importMany(profiles) {
      if (await ensureBackendKnown()) {
        return api("api/profiles/import", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ profiles: profiles }) });
      }
      if (!Array.isArray(profiles) || !profiles.length) throw new Error("読み込めるプロファイルがありません");
      if (profiles.length > 50) throw new Error("一度に読み込めるのは50件までです");
      const now = Date.now() / 1000;
      const cleaned = profiles.map((p, idx) => {
        try { return validateProfile(p); }
        catch (e) { throw new Error((idx + 1) + "件目: " + e.message); }
      });
      const arr = lsRead();
      cleaned.forEach((c) => arr.push(Object.assign({ id: genId() }, c, { created_at: now, updated_at: now })));
      lsWrite(arr);
      return { imported: cleaned.length };
    },
    usingLocal() { return backendAvailable === false; },
  };
  window.__profileStore = profileStore;   // テスト用

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => (el.hidden = true), 300);
    }, 2400);
  }
  window.toast = toast;  // 他モジュール（kids.js）からも利用

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ---- タブ切替 -----------------------------------------------------
  function initTabs() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab;
        $$(".tab").forEach((t) => {
          const active = t === tab;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        $$(".panel").forEach((p) => {
          p.classList.toggle("is-active", p.id === "panel-" + name);
        });
      });
    });
  }

  // ---- WiFi QR ------------------------------------------------------
  let lastQR = { svg: "", payload: "", ssid: "", password: "", security: "WPA" };
  let editingProfile = null;   // 編集中のプロファイル（null=新規）

  function currentWifiInput() {
    return {
      ssid: $("#ssid").value.trim(),
      password: $("#password").value,
      security: $("#security").value,
      hidden: $("#hidden").checked,
      show_password: $("#show-password").checked,
      is_guest: $("#is-guest").checked,
    };
  }

  function setQRButtons(enabled) {
    ["guest-mode-btn", "download-qr-btn", "download-png-btn", "print-qr-btn"]
      .forEach((id) => { $("#" + id).disabled = !enabled; });
  }

  const updateQR = debounce(async function () {
    const input = currentWifiInput();
    const errEl = $("#wifi-error");
    errEl.hidden = true;

    if (!input.ssid) {
      $("#qr-stage").innerHTML =
        '<div class="qr-placeholder" id="qr-placeholder">SSIDを入力するとQRが表示されます</div>';
      $("#qr-caption").hidden = true;
      setQRButtons(false);
      return;
    }
    try {
      const result = await api("api/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      lastQR = Object.assign({}, input, result);
      $("#qr-stage").innerHTML = result.svg;
      $("#qr-ssid-label").textContent = input.ssid;
      $("#qr-caption").hidden = false;
      setQRButtons(true);
    } catch (e) {
      // QR生成はサーバー機能。未接続時はプロファイル保存は可能な旨を案内。
      errEl.textContent = (backendAvailable === false)
        ? "QRコードの生成にはサーバー接続が必要です（この端末ではプロファイル保存のみ利用できます）"
        : e.message;
      errEl.hidden = false;
    }
  }, 250);

  function initWifi() {
    ["ssid", "password", "security", "hidden", "show-password"].forEach((id) => {
      $("#" + id).addEventListener("input", updateQR);
      $("#" + id).addEventListener("change", updateQR);
    });

    $("#toggle-pw").addEventListener("click", () => {
      const inp = $("#password");
      inp.type = inp.type === "password" ? "text" : "password";
    });

    // パスワード表示オプションは来客画面のみに影響。即時に反映する。
    $("#show-password").addEventListener("change", () => {
      lastQR.show_password = $("#show-password").checked;
    });

    $("#save-profile-btn").addEventListener("click", async () => {
      const input = currentWifiInput();
      if (!input.ssid) {
        toast("SSIDを入力してください");
        return;
      }
      const payload = {
        name: input.ssid,
        ssid: input.ssid,
        password: input.password,
        security: input.security,
        hidden: input.hidden,
        show_password: input.show_password,
        is_guest: input.is_guest,
      };
      try {
        if (editingProfile) {
          await profileStore.update(editingProfile.id, payload);
          toast("プロファイルを更新しました");
          cancelEdit();
        } else {
          await profileStore.add(payload);
          toast(profileStore.usingLocal()
            ? "この端末に保存しました"
            : "プロファイルに保存しました");
        }
        loadProfiles();
      } catch (e) {
        toast(e.message);
      }
    });

    $("#edit-cancel-btn").addEventListener("click", cancelEdit);

    $("#download-qr-btn").addEventListener("click", () => {
      if (!lastQR.svg) return;
      const blob = new Blob([lastQR.svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (lastQR.ssid || "wifi") + "-qr.svg";
      a.click();
      URL.revokeObjectURL(url);
    });

    // PNG保存（SVG→canvas経由。印刷や共有に便利）
    // CSPの img-src は 'self' と data: のみ許可のため、data: URLで読み込む
    $("#download-png-btn").addEventListener("click", () => {
      if (!lastQR.svg) return;
      const svgStr = lastQR.svg.replace("<svg", '<svg width="512" height="512"');
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 512; c.height = 512;
        c.getContext("2d").drawImage(img, 0, 0, 512, 512);
        c.toBlob((b) => {
          if (!b) { toast("PNGを作成できませんでした"); return; }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = (lastQR.ssid || "wifi") + "-qr.png";
          a.click();
          URL.revokeObjectURL(a.href);
        }, "image/png");
      };
      img.onerror = () => toast("PNGを作成できませんでした");
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    });

    // 来客用の紙カードを印刷
    $("#print-qr-btn").addEventListener("click", () => {
      if (!lastQR.svg) return;
      $("#print-qr").innerHTML = lastQR.svg;
      $("#print-ssid").textContent = lastQR.ssid;
      const pw = $("#print-pass");
      if (lastQR.show_password && lastQR.security !== "nopass" && lastQR.password) {
        pw.textContent = "パスワード: " + lastQR.password;
        pw.hidden = false;
      } else {
        pw.hidden = true;
      }
      window.print();
    });

    $("#guest-mode-btn").addEventListener("click", () => openGuest(lastQR));
  }

  // ---- プロファイル編集モード ----------------------------------------
  function startEdit(p) {
    editingProfile = p;
    $("#ssid").value = p.ssid;
    $("#password").value = p.password || "";
    $("#security").value = p.security;
    $("#hidden").checked = !!p.hidden;
    $("#show-password").checked = !!p.show_password;
    $("#is-guest").checked = !!p.is_guest;
    $("#edit-banner-text").textContent = "「" + p.name + "」を編集中";
    $("#edit-banner").hidden = false;
    $("#save-profile-btn").textContent = "💾 更新する";
    const wifiTab = $('.tab[data-tab="wifi"]');
    if (wifiTab) wifiTab.click();
    updateQR();
  }

  function cancelEdit() {
    editingProfile = null;
    $("#edit-banner").hidden = true;
    $("#save-profile-btn").textContent = "＋ プロファイルに保存";
  }

  // ---- 来客用フルスクリーン ----------------------------------------
  function openGuest(data) {
    if (!data.svg) return;
    $("#guest-ssid").textContent = data.ssid;
    $("#guest-qr").innerHTML = data.svg;
    // パスワードは既定で非表示。show_password が有効な場合のみ表示する。
    if (data.show_password && data.security !== "nopass" && data.password) {
      $("#guest-pw").textContent = "パスワード: " + data.password;
      $("#guest-pw").hidden = false;
    } else {
      $("#guest-pw").hidden = true;
    }
    $("#guest-overlay").hidden = false;
  }
  function initGuest() {
    $("#guest-close").addEventListener("click", () => {
      $("#guest-overlay").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $("#guest-overlay").hidden = true;
    });
  }

  // ---- プロファイル -------------------------------------------------
  async function loadProfiles() {
    const list = $("#profile-list");
    const empty = $("#profiles-empty");
    try {
      const items = await profileStore.list();
      list.innerHTML = "";
      if (!items.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      items.forEach((p) => list.appendChild(renderProfile(p)));
    } catch (e) {
      console.warn("プロファイル読み込み不可:", e.message);
    }
  }

  function renderProfile(p) {
    const li = document.createElement("li");
    li.className = "profile-item";
    li.dataset.id = p.id;

    const badge = document.createElement("div");
    badge.className = "profile-badge " + (p.is_guest ? "guest" : "home");
    badge.textContent = p.is_guest ? "🌿" : "🏠";

    const body = document.createElement("div");
    body.className = "profile-body";
    const name = document.createElement("div");
    name.className = "profile-name";
    name.textContent = p.name;
    if (p.is_guest) {
      const tag = document.createElement("span");
      tag.className = "profile-tag";
      tag.textContent = "来客用";
      name.appendChild(tag);
    }
    const meta = document.createElement("div");
    meta.className = "profile-meta";
    meta.textContent = "SSID: " + p.ssid + " · " + p.security;
    body.appendChild(name);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "profile-actions";

    const showBtn = document.createElement("button");
    showBtn.className = "btn-ghost";
    showBtn.title = "来客用表示";
    showBtn.textContent = "🖥";
    showBtn.addEventListener("click", () => showProfileGuest(p));

    const editBtn = document.createElement("button");
    editBtn.className = "btn-ghost";
    editBtn.title = "編集";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => startEdit(p));

    const delBtn = document.createElement("button");
    delBtn.className = "btn-ghost";
    delBtn.title = "削除";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => deleteProfile(p));

    actions.appendChild(showBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(badge);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  async function showProfileGuest(p) {
    try {
      const result = await api("api/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssid: p.ssid,
          password: p.password,
          security: p.security,
          hidden: p.hidden,
        }),
      });
      openGuest(Object.assign({}, p, result));
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteProfile(p) {
    if (!confirm("「" + p.name + "」を削除しますか？")) return;
    try {
      await profileStore.remove(p.id);
      if (editingProfile && editingProfile.id === p.id) cancelEdit();
      toast("削除しました");
      loadProfiles();
    } catch (e) {
      toast(e.message);
    }
  }

  function initProfiles() {
    $("#refresh-profiles").addEventListener("click", loadProfiles);

    // バックアップ書き出し（JSONファイル）
    $("#export-profiles").addEventListener("click", async () => {
      try {
        const items = await profileStore.list();
        if (!items.length) { toast("書き出すプロファイルがありません"); return; }
        const data = { app: "ouchi-net-hub", version: 1, profiles: items };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ouchi-net-profiles.json";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("書き出しました（パスワードを含むので保管に注意）");
      } catch (e) {
        toast(e.message);
      }
    });

    // バックアップ読み込み
    $("#import-profiles").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";                     // 同じファイルを再選択できるように
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const profiles = Array.isArray(data) ? data : data.profiles;
        const r = await profileStore.importMany(profiles);
        toast(r.imported + "件のプロファイルを読み込みました");
        loadProfiles();
      } catch (err) {
        toast("読み込めませんでした: " + err.message);
      }
    });
  }

  // ---- パスワード ---------------------------------------------------
  const analyze = debounce(async function (val) {
    const bar = $("#meter-bar");
    if (!val) {
      bar.className = "meter-bar";
      $("#meter-label").textContent = "—";
      $("#meter-entropy").textContent = "";
      $("#feedback-list").innerHTML = "";
      return;
    }
    try {
      const r = await api("api/password/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: val }),
      });
      bar.className = "meter-bar s" + r.score;
      $("#meter-label").textContent = r.label;
      $("#meter-entropy").textContent = "約 " + r.entropy_bits + " bit";
      const ul = $("#feedback-list");
      ul.innerHTML = "";
      (r.feedback || []).forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f;
        ul.appendChild(li);
      });
    } catch (e) {
      toast(e.message);
    }
  }, 200);

  function initPassword() {
    $("#analyze-input").addEventListener("input", (e) => analyze(e.target.value));
    $("#toggle-analyze").addEventListener("click", () => {
      const inp = $("#analyze-input");
      inp.type = inp.type === "password" ? "text" : "password";
    });

    const lenInput = $("#gen-length");
    lenInput.addEventListener("input", () => {
      $("#len-label").textContent = lenInput.value;
    });

    // 生成モード切替（ランダム / ことばフレーズ）
    const currentMode = () =>
      (document.querySelector('input[name="gen-mode"]:checked') || {}).value || "random";
    $$('input[name="gen-mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        const phrase = currentMode() === "phrase";
        $("#random-opts").hidden = phrase;
        $("#phrase-opts").hidden = !phrase;
      });
    });

    $("#gen-btn").addEventListener("click", async () => {
      let params;
      if (currentMode() === "phrase") {
        params = new URLSearchParams({ mode: "phrase", words: $("#phrase-words").value });
      } else {
        params = new URLSearchParams({
          length: $("#gen-length").value,
          upper: $("#opt-upper").checked,
          lower: $("#opt-lower").checked,
          digits: $("#opt-digits").checked,
          symbols: $("#opt-symbols").checked,
          avoid_ambiguous: $("#opt-ambig").checked,
        });
      }
      try {
        const r = await api("api/password/generate?" + params.toString());
        $("#gen-output").textContent = r.password;
        $("#gen-result").hidden = false;
      } catch (e) {
        toast(e.message);
      }
    });

    $("#copy-gen").addEventListener("click", async () => {
      const text = $("#gen-output").textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast("コピーしました");
      } catch (e) {
        toast("コピーできませんでした");
      }
    });
  }

  // ---- 速度テスト ---------------------------------------------------
  async function measurePing(rounds = 5) {
    const times = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      await fetch("api/speedtest/ping?_=" + Date.now(), { cache: "no-store" });
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // ジッター＝各計測の平均からのぶれの平均
    const jitter = times.reduce((a, b) => a + Math.abs(b - avg), 0) / times.length;
    return { avg, jitter };
  }

  async function measureDownload(bytes) {
    const t0 = performance.now();
    const res = await fetch("api/speedtest/payload?bytes=" + bytes + "&_=" + Date.now(), {
      cache: "no-store",
    });
    const buf = await res.arrayBuffer();
    const seconds = (performance.now() - t0) / 1000;
    const bits = buf.byteLength * 8;
    const mbps = bits / seconds / 1e6;
    return { mbps, bytes: buf.byteLength, seconds };
  }

  // 上り計測: サーバーの受信上限(256KB)未満のチャンクを連続POSTする
  async function measureUpload(chunkBytes, count) {
    const chunk = new Uint8Array(chunkBytes);
    for (let i = 0; i < chunk.length; i += 65536) {
      crypto.getRandomValues(chunk.subarray(i, Math.min(i + 65536, chunk.length)));
    }
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      await fetch("api/speedtest/upload?_=" + Date.now(), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      });
    }
    const seconds = (performance.now() - t0) / 1000;
    return (chunkBytes * count * 8) / seconds / 1e6;
  }

  function initSpeed() {
    $("#speed-btn").addEventListener("click", async () => {
      const btn = $("#speed-btn");
      const valEl = $("#speed-value");
      btn.disabled = true;
      valEl.textContent = "…";
      valEl.classList.add("speed-value--running");
      $("#speed-note").textContent = "計測中です。しばらくお待ちください…";
      try {
        const ping = await measurePing();
        $("#ping-value").textContent = ping.avg.toFixed(0) + " ms";
        $("#jitter-value").textContent = ping.jitter.toFixed(1) + " ms";

        // ウォームアップ後、下り本計測（4MB）→ 上り計測（200KB×5）
        await measureDownload(200000);
        const r = await measureDownload(4000000);
        const upMbps = await measureUpload(200000, 5);

        valEl.textContent = r.mbps.toFixed(1);
        $("#upload-value").textContent = upMbps.toFixed(1) + " Mbps";
        $("#bytes-value").textContent = (r.bytes / 1e6).toFixed(1) + " MB";
        $("#speed-note").textContent =
          "※このサーバー（ローカル）との実効速度です。回線速度とは異なる場合があります。";

        // 履歴を暗号化保存して再描画
        try {
          await api("api/speedtest/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mbps: r.mbps, ping_ms: ping.avg, up_mbps: upMbps }),
          });
          loadHistory();
        } catch (_) { /* 履歴保存失敗は致命的でない */ }
      } catch (e) {
        valEl.textContent = "--";
        $("#speed-note").textContent = "計測に失敗しました: " + e.message;
      } finally {
        valEl.classList.remove("speed-value--running");
        btn.disabled = false;
      }
    });
  }

  // ---- 速度テスト履歴 ------------------------------------------------
  async function loadHistory() {
    const chart = $("#history-chart");
    const empty = $("#history-empty");
    try {
      const items = await api("api/speedtest/history");
      chart.innerHTML = "";
      if (!items.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      // 新しい順で来るので、古い→新しいに並べ替えて左から表示
      const rows = items.slice().reverse();
      const max = Math.max.apply(null, rows.map((r) => r.mbps)) || 1;
      rows.forEach((r) => {
        const bar = document.createElement("div");
        bar.className = "hist-bar";
        bar.style.height = Math.max(6, (r.mbps / max) * 100) + "%";
        const when = new Date(r.at * 1000).toLocaleString("ja-JP",
          { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
        bar.title = "↓" + r.mbps.toFixed(1) + " Mbps" +
          (r.up_mbps != null ? " / ↑" + r.up_mbps.toFixed(1) + " Mbps" : "") +
          " / ping " + r.ping_ms.toFixed(0) + " ms\n" + when;
        const val = document.createElement("span");
        val.className = "hist-val";
        val.textContent = r.mbps.toFixed(0);
        bar.appendChild(val);
        chart.appendChild(bar);
      });
    } catch (e) {
      console.warn("履歴読み込み不可:", e.message);
    }
  }

  function initHistory() {
    $("#clear-history").addEventListener("click", async () => {
      if (!confirm("計測履歴をすべて消去しますか？")) return;
      try {
        await api("api/speedtest/history", { method: "DELETE" });
        loadHistory();
        toast("履歴を消去しました");
      } catch (e) {
        toast(e.message);
      }
    });
  }

  // ---- かんたんネット診断（トラブルシューティング） -----------------
  const DIAG = {
    start: {
      q: "どのような状態ですか？",
      options: [
        { label: "Wi-Fiに接続できない", next: "no_connect" },
        { label: "接続できるが遅い・不安定", next: "slow" },
        { label: "特定の機器だけつながらない", next: "one_device" },
        { label: "特定のサイトやアプリだけ見られない", solution: "sol_site" },
      ],
    },
    no_connect: {
      q: "ルーターのランプは点灯していますか？",
      options: [
        { label: "点灯していない・消えている", solution: "sol_power" },
        { label: "点灯している", solution: "sol_reconnect" },
      ],
    },
    slow: {
      q: "遅いのはどの時間帯ですか？",
      options: [
        { label: "夜など特定の時間帯", solution: "sol_congestion" },
        { label: "常に遅い", solution: "sol_placement" },
      ],
    },
    one_device: {
      q: "その機器で機内モードはオフになっていますか？",
      options: [
        { label: "オフ（＝Wi-Fi有効）になっている", solution: "sol_forget" },
        { label: "わからない・オンだった", solution: "sol_airplane" },
      ],
    },
    // --- 解決策 ---
    sol_power: { solution: true, title: "電源を確認しましょう",
      steps: ["ルーターの電源プラグを挿し直します", "電源ボタンがあればオンにします", "2〜3分待ってランプの点灯を確認します", "改善しない場合は回線事業者へ連絡を"] },
    sol_reconnect: { solution: true, title: "接続をやり直しましょう",
      steps: ["端末のWi-Fiを一度オフ→オンにします", "SSIDを選び直し、パスワードを再入力します", "ルーターを再起動します（電源を10秒切る）", "本アプリのQRコードから再接続も便利です"] },
    sol_congestion: { solution: true, title: "回線の混雑が考えられます",
      steps: ["混雑しやすい時間帯を避けてみます", "5GHz帯のSSIDに接続してみます", "大きなダウンロードは時間帯をずらします", "頻発する場合はプラン見直しも検討を"] },
    sol_placement: { solution: true, title: "設置場所を見直しましょう",
      steps: ["ルーターを部屋の中央・高い位置へ", "電子レンジや金属から離します", "ルーターを再起動します", "速度テストで改善を確認しましょう"] },
    sol_forget: { solution: true, title: "ネットワークを登録し直しましょう",
      steps: ["端末でこのネットワークを一度「削除／忘れる」", "本アプリのQRコードで再接続します", "OSを最新に更新します", "改善しなければ端末を再起動します"] },
    sol_airplane: { solution: true, title: "機内モードをオフにしましょう",
      steps: ["端末の機内モードをオフにします", "Wi-Fiをオンにします", "SSIDを選んで接続します", "それでも不可ならパスワードを再確認"] },
    sol_site: { solution: true, title: "サイト・アプリ側を確認しましょう",
      steps: ["別のブラウザやシークレットモードで開いてみます", "サービス側の障害情報（公式SNSなど）を確認します", "端末を再起動してDNSキャッシュをリフレッシュします", "改善しなければ時間をおいて再度アクセスを"] },
  };

  function renderDiag(nodeKey) {
    const node = DIAG[nodeKey];
    const stage = $("#diag-stage");
    stage.innerHTML = "";
    $("#diag-restart").hidden = nodeKey === "start";

    if (node.solution) {
      const box = document.createElement("div");
      box.className = "diag-solution";
      const h = document.createElement("h3");
      h.textContent = "💡 " + node.title;
      box.appendChild(h);
      const ol = document.createElement("ol");
      node.steps.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = s;
        ol.appendChild(li);
      });
      box.appendChild(ol);
      stage.appendChild(box);
      return;
    }

    const q = document.createElement("p");
    q.className = "diag-q";
    q.textContent = node.q;
    stage.appendChild(q);
    node.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "btn-secondary diag-opt";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => renderDiag(opt.next || opt.solution));
      stage.appendChild(btn);
    });
  }

  function initDiagnose() {
    $("#diag-restart").addEventListener("click", () => renderDiag("start"));
    renderDiag("start");
  }

  // ---- データ使用量シミュレーター -----------------------------------
  const calcUsage = debounce(async function () {
    const activities = {};
    $$("#usage-inputs .usage-row").forEach((row) => {
      const v = parseFloat(row.querySelector("input").value);
      activities[row.dataset.key] = isNaN(v) ? 0 : v;
    });
    const days = parseInt($("#usage-days").value, 10);
    try {
      const r = await api("api/data-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activities: activities, days: days }),
      });
      $("#usage-month").textContent = r.per_month_gb;
      $("#usage-day").textContent = r.per_day_gb;
      const labels = {
        video_hd: "📺 動画(HD)", video_4k: "🎬 動画(4K)", video_call: "📞 ビデオ通話",
        music: "🎵 音楽", browsing: "🌐 Web・SNS", gaming: "🎮 ゲーム",
      };
      const ul = $("#usage-breakdown");
      ul.innerHTML = "";
      Object.keys(r.breakdown).forEach((k) => {
        if (r.breakdown[k] <= 0) return;
        const li = document.createElement("li");
        li.innerHTML = "<span>" + (labels[k] || k) + "</span><b>" +
          (r.breakdown[k] * r.days).toFixed(1) + " GB</b>";
        ul.appendChild(li);
      });
    } catch (e) {
      $("#usage-month").textContent = "--";
    }
  }, 200);

  function initUsage() {
    $$("#usage-inputs input").forEach((inp) => inp.addEventListener("input", calcUsage));
    const days = $("#usage-days");
    days.addEventListener("input", () => {
      $("#usage-days-label").textContent = days.value;
      calcUsage();
    });
    calcUsage();
  }

  // ---- テーマ（ダークモード） ----------------------------------------
  const THEME_KEY = "ouchi.theme";

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = $("#theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  function initTheme() {
    let theme = null;
    try { theme = localStorage.getItem(THEME_KEY); } catch (e) { /* noop */ }
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark" : "light";
    }
    applyTheme(theme);
    $("#theme-toggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* noop */ }
    });
  }

  // ---- オンライン状態表示 ----------------------------------------------
  function initNetStatus() {
    const update = () => {
      const on = navigator.onLine;
      $("#net-status").classList.toggle("online", on);
      $("#net-label").textContent = on ? "オンライン" : "オフライン";
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  // ---- 初期化 -------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initNetStatus();
    initTabs();
    initWifi();
    initGuest();
    initProfiles();
    initPassword();
    initSpeed();
    initHistory();
    initDiagnose();
    initUsage();
    // バックエンドの有無を先に判定してからプロファイルを読み込む
    await detectBackend();
    loadProfiles();
    loadHistory();
  });

  // ---- PWA: Service Worker 登録（インストール／オフライン対応） -------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      // 相対パスで登録（Flaskルート／GitHub Pagesサブパス両対応）
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
