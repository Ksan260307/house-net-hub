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
      const msg = (body && body.error) || "エラーが発生しました";
      throw new Error(msg);
    }
    return body;
  }

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

  function currentWifiInput() {
    return {
      ssid: $("#ssid").value.trim(),
      password: $("#password").value,
      security: $("#security").value,
      hidden: $("#hidden").checked,
      show_password: $("#show-password").checked,
    };
  }

  const updateQR = debounce(async function () {
    const input = currentWifiInput();
    const errEl = $("#wifi-error");
    errEl.hidden = true;

    if (!input.ssid) {
      $("#qr-stage").innerHTML =
        '<div class="qr-placeholder" id="qr-placeholder">SSIDを入力するとQRが表示されます</div>';
      $("#qr-caption").hidden = true;
      $("#guest-mode-btn").disabled = true;
      $("#download-qr-btn").disabled = true;
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
      $("#guest-mode-btn").disabled = false;
      $("#download-qr-btn").disabled = false;
    } catch (e) {
      errEl.textContent = e.message;
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
      try {
        await api("api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.ssid,
            ssid: input.ssid,
            password: input.password,
            security: input.security,
            hidden: input.hidden,
            show_password: input.show_password,
          }),
        });
        toast("プロファイルに保存しました");
        loadProfiles();
      } catch (e) {
        toast(e.message);
      }
    });

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

    $("#guest-mode-btn").addEventListener("click", () => openGuest(lastQR));
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
      const items = await api("api/profiles");
      list.innerHTML = "";
      if (!items.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      items.forEach((p) => list.appendChild(renderProfile(p)));
    } catch (e) {
      // 起動時の自動読み込み。バックエンド未接続（静的配信）でも静かに無視。
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

    const delBtn = document.createElement("button");
    delBtn.className = "btn-ghost";
    delBtn.title = "削除";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => deleteProfile(p));

    actions.appendChild(showBtn);
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
      await api("api/profiles/" + p.id, { method: "DELETE" });
      toast("削除しました");
      loadProfiles();
    } catch (e) {
      toast(e.message);
    }
  }

  function initProfiles() {
    $("#refresh-profiles").addEventListener("click", loadProfiles);
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

    $("#gen-btn").addEventListener("click", async () => {
      const params = new URLSearchParams({
        length: $("#gen-length").value,
        upper: $("#opt-upper").checked,
        lower: $("#opt-lower").checked,
        digits: $("#opt-digits").checked,
        symbols: $("#opt-symbols").checked,
        avoid_ambiguous: $("#opt-ambig").checked,
      });
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
  async function measurePing(rounds = 4) {
    let total = 0;
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      await fetch("api/speedtest/ping?_=" + Date.now(), { cache: "no-store" });
      total += performance.now() - t0;
    }
    return total / rounds;
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
        $("#ping-value").textContent = ping.toFixed(0) + " ms";

        // ウォームアップ後、本計測（2MB）
        await measureDownload(200000);
        const r = await measureDownload(4000000);

        valEl.textContent = r.mbps.toFixed(1);
        $("#bytes-value").textContent = (r.bytes / 1e6).toFixed(1) + " MB";
        $("#speed-note").textContent =
          "※このサーバー（ローカル）との実効速度です。回線速度とは異なる場合があります。";

        // 履歴を暗号化保存して再描画
        try {
          await api("api/speedtest/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mbps: r.mbps, ping_ms: ping }),
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
        bar.title = r.mbps.toFixed(1) + " Mbps / " + r.ping_ms.toFixed(0) + " ms";
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

  // ---- 初期化 -------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initWifi();
    initGuest();
    initProfiles();
    initPassword();
    initSpeed();
    initHistory();
    initDiagnose();
    initUsage();
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
