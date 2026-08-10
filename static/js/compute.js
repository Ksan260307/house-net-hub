/* =========================================================
   おうちネット Hub — クライアント側計算モジュール
   サーバー(core.py)と同等の処理をブラウザ内で実行し、
   バックエンドが無くても（オフライン/PWA/静的配信）動作させる。
   - WiFiペイロード生成／QRコードSVG生成（vendor/qrcode.js を利用）
   - パスワード強度診断／安全なパスワード・ことばフレーズ生成
   - データ使用量シミュレーション
   すべてローカル完結・外部通信なし（CSP: default-src 'self' 準拠）。
   ========================================================= */
(function () {
  "use strict";

  const VALID_SECURITY = ["WPA", "WEP", "nopass"];
  const DARK = "#4a4038", LIGHT = "#f4efe9";

  // ---- WiFi ペイロード ------------------------------------------------
  function escapeWifi(value) {
    value = value == null ? "" : String(value);
    let out = "";
    for (const ch of value) {
      out += (ch === "\\" || ch === ";" || ch === "," || ch === ":" || ch === '"')
        ? "\\" + ch : ch;
    }
    return out;
  }

  function buildWifiPayload(ssid, password, security, hidden) {
    security = (security || "WPA").trim();
    if (VALID_SECURITY.indexOf(security) < 0) throw new Error("セキュリティ種別が不正です");
    if (!ssid || !String(ssid).trim()) throw new Error("SSID は必須です");
    const parts = ["T:" + security, "S:" + escapeWifi(ssid)];
    if (security !== "nopass") parts.push("P:" + escapeWifi(password || ""));
    parts.push(hidden ? "H:true" : "H:false");
    return "WIFI:" + parts.join(";") + ";;";
  }

  // ---- QRコード SVG ---------------------------------------------------
  // UTF-8バイトを1文字=1バイトのLatin1文字列に（qrcode-generatorのByteモード用）
  function utf8Latin1(str) {
    const bytes = new TextEncoder().encode(str);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function qrSvg(data, opts) {
    opts = opts || {};
    if (!data) throw new Error("QR化するデータが空です");
    if (typeof window.qrcode !== "function") throw new Error("QRライブラリが読み込まれていません");
    const dark = opts.dark || DARK, light = opts.light || LIGHT;
    const border = opts.border == null ? 2 : opts.border;
    const qr = window.qrcode(0, opts.error || "M");   // typeNumber 0 = 自動選択
    qr.addData(utf8Latin1(data), "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const size = count + border * 2;
    let rects = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) rects += '<rect x="' + (c + border) + '" y="' + (r + border) + '" width="1" height="1"/>';
      }
    }
    // width/height を付けずレスポンシブに（バックエンドのSVGと同じ体裁）
    return '<svg class="qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="' + light +
      '"/><g fill="' + dark + '">' + rects + "</g></svg>";
  }

  function wifiQrSvg(ssid, password, security, hidden, opts) {
    const payload = buildWifiPayload(ssid, password, security, hidden);
    return { payload: payload, svg: qrSvg(payload, opts) };
  }

  // ---- パスワード強度診断（core.py と同等） --------------------------
  const COMMON_PATTERNS = [
    "password", "passw0rd", "123456", "qwerty", "abc123", "iloveyou",
    "admin", "welcome", "letmein", "monkey", "dragon", "111111", "000000",
  ];
  const STRENGTH_LABELS = ["とても弱い", "弱い", "普通", "強い", "とても強い"];

  function charPoolSize(pw) {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    return pool;
  }

  function passwordStrength(pw) {
    pw = pw || "";
    const length = pw.length;
    if (length === 0) {
      return { score: 0, label: STRENGTH_LABELS[0], entropy_bits: 0.0, length: 0,
        feedback: ["パスワードを入力してください"] };
    }
    const pool = charPoolSize(pw);
    let entropy = pool > 0 ? length * Math.log2(pool) : 0.0;
    const feedback = [];
    const lowered = pw.toLowerCase();

    let penalized = false;
    for (const common of COMMON_PATTERNS) {
      if (lowered.indexOf(common) !== -1) {
        entropy *= 0.4; feedback.push("よくある文字列が含まれています"); penalized = true; break;
      }
    }
    if (/^(.)\1*$/.test(pw)) { entropy *= 0.3; feedback.push("同じ文字の繰り返しは危険です"); }
    if (length < 12) feedback.push("12文字以上を推奨します");
    if (!/[A-Z]/.test(pw)) feedback.push("大文字を含めるとより安全です");
    if (!/[0-9]/.test(pw)) feedback.push("数字を含めるとより安全です");
    if (!/[^A-Za-z0-9]/.test(pw)) feedback.push("記号を含めるとより安全です");

    let score;
    if (entropy < 28) score = 0;
    else if (entropy < 40) score = 1;
    else if (entropy < 60) score = 2;
    else if (entropy < 90) score = 3;
    else score = 4;
    if (penalized && score > 1) score = 1;
    if (!feedback.length) feedback.push("十分に強力なパスワードです");

    return { score: score, label: STRENGTH_LABELS[score],
      entropy_bits: Math.round(entropy * 10) / 10, length: length, feedback: feedback };
  }

  // ---- 安全な乱数（crypto） -----------------------------------------
  function randbelow(n) {
    // 偏りのない範囲乱数
    const max = Math.floor(0xffffffff / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= max);
    return x % n;
  }
  function choice(str) { return str[randbelow(str.length)]; }

  const AMBIGUOUS = new Set("0O1lI|`'\"{}[]()/\\".split(""));
  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const DIGITS = "0123456789";
  const SYMBOLS = "!@#$%^&*-_=+?";

  function generatePassword(opts) {
    opts = opts || {};
    const length = parseInt(opts.length == null ? 16 : opts.length, 10);
    if (isNaN(length) || length < 4) throw new Error("length は 4 以上を指定してください");
    if (length > 128) throw new Error("length は 128 以下を指定してください");
    const useUpper = opts.upper !== false, useLower = opts.lower !== false;
    const useDigits = opts.digits !== false, useSymbols = opts.symbols !== false;
    const avoid = opts.avoid_ambiguous !== false;

    let pools = [];
    if (useLower) pools.push(LOWER);
    if (useUpper) pools.push(UPPER);
    if (useDigits) pools.push(DIGITS);
    if (useSymbols) pools.push(SYMBOLS);
    if (!pools.length) throw new Error("少なくとも1種類の文字種を有効にしてください");
    if (avoid) {
      pools = pools.map((p) => p.split("").filter((c) => !AMBIGUOUS.has(c)).join(""))
        .filter((p) => p.length);
    }
    const all = pools.join("");
    const chars = pools.map((p) => choice(p));          // 各文字種から最低1文字
    while (chars.length < length) chars.push(choice(all));
    // フィッシャー–イェーツでシャッフル
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randbelow(i + 1);
      const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
    }
    return chars.slice(0, length).join("");
  }

  // ---- 覚えやすいパスフレーズ（core.py と同等） ----------------------
  const PASSPHRASE_WORDS = [
    "sakura", "yama", "umi", "sora", "hoshi", "tsuki", "kaze", "mori",
    "kawa", "yuki", "hana", "tori", "neko", "inu", "kumo", "niji",
    "hikari", "midori", "aoi", "akane", "matsu", "take", "ume", "momo",
    "suzume", "koto", "fuji", "nami", "shio", "kai", "asahi", "yume",
  ];
  function generatePassphrase(words, separator) {
    words = parseInt(words == null ? 3 : words, 10);
    separator = separator || "-";
    if (words < 2 || words > 6) throw new Error("words は 2〜6 で指定してください");
    const parts = [];
    for (let i = 0; i < words; i++) parts.push(choice(PASSPHRASE_WORDS));
    const number = String(randbelow(900) + 100);
    parts.splice(randbelow(parts.length + 1), 0, number);
    return parts.join(separator);
  }

  // ---- データ使用量シミュレーション（core.py と同等） ----------------
  const DATA_RATES = {
    video_sd: 0.7, video_hd: 3.0, video_4k: 7.0, video_call: 1.6,
    music: 0.15, browsing: 0.06, gaming: 0.08,
  };
  function estimateDataUsage(activities, days) {
    days = parseInt(days == null ? 30 : days, 10);
    if (isNaN(days) || days <= 0 || days > 366) throw new Error("days は 1〜366 で指定してください");
    const breakdown = {};
    let perDay = 0;
    Object.keys(activities || {}).forEach((key) => {
      const rate = DATA_RATES[key];
      if (rate == null) return;
      const h = parseFloat(activities[key]);
      if (isNaN(h)) throw new Error(key + " の時間は数値で指定してください");
      if (h < 0) throw new Error("利用時間に負の値は指定できません");
      if (h > 24) throw new Error("1日の利用時間は24時間以内で指定してください");
      const gb = rate * h;
      breakdown[key] = Math.round(gb * 100) / 100;
      perDay += gb;
    });
    return {
      per_day_gb: Math.round(perDay * 100) / 100,
      per_month_gb: Math.round(perDay * days * 10) / 10,
      days: days, breakdown: breakdown,
    };
  }

  window.Compute = {
    buildWifiPayload: buildWifiPayload,
    qrSvg: qrSvg,
    wifiQrSvg: wifiQrSvg,
    passwordStrength: passwordStrength,
    generatePassword: generatePassword,
    generatePassphrase: generatePassphrase,
    estimateDataUsage: estimateDataUsage,
  };
})();
