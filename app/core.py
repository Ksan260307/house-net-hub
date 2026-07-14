"""
おうちネット Hub - コアロジック層
=================================
フレームワーク非依存の純粋関数群。
Web層(server.py)とテストの両方から利用する。

含む機能:
- WiFi QR用ペイロード文字列の生成 (WIFI: スキーム)
- QRコードSVG生成 (segno)
- パスワード強度診断
- 安全なパスワード生成
- 入力バリデーション
"""

from __future__ import annotations

import math
import re
import secrets
import string

import segno

# WiFiのセキュリティ種別として許可する値
VALID_SECURITY = ("WPA", "WEP", "nopass")

# QR SVGの内部ドット色 / 背景色のデフォルト（くすみカラーに合わせる）
DEFAULT_DARK = "#4a4038"
DEFAULT_LIGHT = "#f4efe9"


# ---------------------------------------------------------------------------
# WiFi ペイロード
# ---------------------------------------------------------------------------
def _escape_wifi(value: str) -> str:
    r"""WIFI:スキームで特別な意味を持つ文字 ( \ ; , : " ) をエスケープする。"""
    if value is None:
        return ""
    out = []
    for ch in str(value):
        if ch in ("\\", ";", ",", ":", '"'):
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def build_wifi_payload(
    ssid: str,
    password: str = "",
    security: str = "WPA",
    hidden: bool = False,
) -> str:
    """
    WiFi接続用のQRペイロード文字列を組み立てる。
    例: WIFI:T:WPA;S:MyHome;P:secret123;H:false;;

    security が "nopass" の場合はパスワードを含めない。
    """
    security = (security or "WPA").strip()
    if security not in VALID_SECURITY:
        raise ValueError(f"security は {VALID_SECURITY} のいずれかである必要があります: {security!r}")

    if not ssid or not str(ssid).strip():
        raise ValueError("SSID は必須です")

    parts = [f"T:{security}", f"S:{_escape_wifi(ssid)}"]
    if security != "nopass":
        parts.append(f"P:{_escape_wifi(password)}")
    parts.append("H:true" if hidden else "H:false")

    return "WIFI:" + ";".join(parts) + ";;"


# ---------------------------------------------------------------------------
# QR SVG 生成
# ---------------------------------------------------------------------------
def qr_svg(
    data: str,
    *,
    dark: str = DEFAULT_DARK,
    light: str = DEFAULT_LIGHT,
    scale: int = 8,
    border: int = 2,
    error: str = "m",
) -> str:
    """
    任意データからQRコードのSVG文字列を生成する。
    レスポンシブに拡大縮小できるよう width/height 属性は付けない。
    """
    if data is None or data == "":
        raise ValueError("QR化するデータが空です")
    qr = segno.make(data, error=error)
    import io

    buf = io.BytesIO()  # segno のSVGライターはバイト列を書き込む
    qr.save(
        buf,
        kind="svg",
        scale=scale,
        border=border,
        dark=dark,
        light=light,
        omitsize=True,          # width/height を省略 → CSSで拡縮可能
        svgclass="qr-svg",
        xmldecl=False,
        svgns=True,
    )
    return buf.getvalue().decode("utf-8")


def wifi_qr_svg(ssid, password="", security="WPA", hidden=False, **kwargs) -> dict:
    """WiFi情報からペイロードとQR SVGをまとめて返す便利関数。"""
    payload = build_wifi_payload(ssid, password, security, hidden)
    svg = qr_svg(payload, **kwargs)
    return {"payload": payload, "svg": svg}


# ---------------------------------------------------------------------------
# パスワード強度診断
# ---------------------------------------------------------------------------
# ざっくり避けたい定番パスワード（部分一致で減点）
_COMMON_PATTERNS = (
    "password", "passw0rd", "123456", "qwerty", "abc123", "iloveyou",
    "admin", "welcome", "letmein", "monkey", "dragon", "111111", "000000",
)

_STRENGTH_LABELS = ("とても弱い", "弱い", "普通", "強い", "とても強い")


def _char_pool_size(pw: str) -> int:
    pool = 0
    if re.search(r"[a-z]", pw):
        pool += 26
    if re.search(r"[A-Z]", pw):
        pool += 26
    if re.search(r"[0-9]", pw):
        pool += 10
    if re.search(r"[^A-Za-z0-9]", pw):
        pool += 33  # 記号ざっくり
    return pool


def password_strength(pw: str) -> dict:
    """
    パスワード強度を 0(とても弱い)〜4(とても強い) で評価し、
    推定エントロピー(bit)と改善アドバイスを返す。
    """
    pw = pw or ""
    length = len(pw)

    if length == 0:
        return {
            "score": 0,
            "label": _STRENGTH_LABELS[0],
            "entropy_bits": 0.0,
            "length": 0,
            "feedback": ["パスワードを入力してください"],
        }

    pool = _char_pool_size(pw)
    entropy = length * math.log2(pool) if pool > 0 else 0.0

    feedback: list[str] = []
    lowered = pw.lower()

    # 定番パターンによる大幅減点
    penalized = False
    for common in _COMMON_PATTERNS:
        if common in lowered:
            entropy *= 0.4
            feedback.append("よくある文字列が含まれています")
            penalized = True
            break

    # 同一文字の連続 / 単一文字種による減点
    if re.fullmatch(r"(.)\1*", pw):
        entropy *= 0.3
        feedback.append("同じ文字の繰り返しは危険です")

    # 助言
    if length < 12:
        feedback.append("12文字以上を推奨します")
    if not re.search(r"[A-Z]", pw):
        feedback.append("大文字を含めるとより安全です")
    if not re.search(r"[0-9]", pw):
        feedback.append("数字を含めるとより安全です")
    if not re.search(r"[^A-Za-z0-9]", pw):
        feedback.append("記号を含めるとより安全です")

    # エントロピーからスコアを決定
    if entropy < 28:
        score = 0
    elif entropy < 40:
        score = 1
    elif entropy < 60:
        score = 2
    elif entropy < 90:
        score = 3
    else:
        score = 4

    if penalized and score > 1:
        score = 1

    if not feedback:
        feedback.append("十分に強力なパスワードです")

    return {
        "score": score,
        "label": _STRENGTH_LABELS[score],
        "entropy_bits": round(entropy, 1),
        "length": length,
        "feedback": feedback,
    }


# ---------------------------------------------------------------------------
# 安全なパスワード生成
# ---------------------------------------------------------------------------
# 紛らわしい文字 (0/O, 1/l/I など) は既定で除外
_AMBIGUOUS = set("0O1lI|`'\"{}[]()/\\")


def generate_password(
    length: int = 16,
    *,
    use_upper: bool = True,
    use_lower: bool = True,
    use_digits: bool = True,
    use_symbols: bool = True,
    avoid_ambiguous: bool = True,
) -> str:
    """
    secrets を用いた暗号学的に安全なパスワードを生成する。
    選択した各文字種を最低1文字含むことを保証する。
    """
    length = int(length)
    if length < 4:
        raise ValueError("length は 4 以上を指定してください")
    if length > 128:
        raise ValueError("length は 128 以下を指定してください")

    pools: list[str] = []
    if use_lower:
        pools.append(string.ascii_lowercase)
    if use_upper:
        pools.append(string.ascii_uppercase)
    if use_digits:
        pools.append(string.digits)
    if use_symbols:
        pools.append("!@#$%^&*-_=+?")

    if not pools:
        raise ValueError("少なくとも1種類の文字種を有効にしてください")

    if avoid_ambiguous:
        pools = ["".join(c for c in p if c not in _AMBIGUOUS) for p in pools]
        pools = [p for p in pools if p]

    all_chars = "".join(pools)

    # 各文字種から最低1文字を確保
    chars = [secrets.choice(p) for p in pools]
    while len(chars) < length:
        chars.append(secrets.choice(all_chars))

    # フィッシャー–イェーツで安全にシャッフル
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]

    return "".join(chars[:length])


# ---------------------------------------------------------------------------
# バリデーション
# ---------------------------------------------------------------------------
def validate_profile(data: dict) -> dict:
    """
    プロファイル入力を検証し、正規化した辞書を返す。
    不正な場合は ValueError を送出する。
    """
    if not isinstance(data, dict):
        raise ValueError("不正な形式です")

    name = str(data.get("name", "")).strip()
    ssid = str(data.get("ssid", "")).strip()
    password = str(data.get("password", ""))
    security = str(data.get("security", "WPA")).strip() or "WPA"
    hidden = bool(data.get("hidden", False))
    is_guest = bool(data.get("is_guest", False))
    # 来客用フルスクリーンにパスワードを表示するか（既定: 非表示）
    show_password = bool(data.get("show_password", False))
    note = str(data.get("note", "")).strip()

    if not ssid:
        raise ValueError("SSID は必須です")
    if len(ssid) > 32:
        raise ValueError("SSID は32文字以内で入力してください")
    if security not in VALID_SECURITY:
        raise ValueError(f"security は {VALID_SECURITY} のいずれかです")
    if security != "nopass" and not password:
        raise ValueError("パスワードを入力してください（パスワード無しの場合は種別をnopassに）")
    if len(password) > 63:
        raise ValueError("パスワードは63文字以内で入力してください")
    if not name:
        name = ssid  # 名称未入力ならSSIDを流用
    if len(name) > 40:
        raise ValueError("プロファイル名は40文字以内で入力してください")
    if len(note) > 200:
        raise ValueError("メモは200文字以内で入力してください")

    return {
        "name": name,
        "ssid": ssid,
        "password": password,
        "security": security,
        "hidden": hidden,
        "is_guest": is_guest,
        "show_password": show_password,
        "note": note,
    }


# ---------------------------------------------------------------------------
# データ使用量シミュレーター
# ---------------------------------------------------------------------------
# 各アクティビティの目安消費量（GB / 時間）
DATA_RATES_GB_PER_HOUR = {
    "video_sd": 0.7,     # 動画（標準画質）
    "video_hd": 3.0,     # 動画（高画質HD）
    "video_4k": 7.0,     # 動画（4K）
    "video_call": 1.6,   # ビデオ通話
    "music": 0.15,       # 音楽ストリーミング
    "browsing": 0.06,    # Web閲覧・SNS
    "gaming": 0.08,      # オンラインゲーム（対戦通信）
}


def estimate_data_usage(activities: dict, days: int = 30) -> dict:
    """
    アクティビティごとの「1日あたりの利用時間」からデータ使用量の目安を算出する。
    activities 例: {"video_hd": 2, "music": 1, ...}（単位: 時間/日）
    """
    try:
        days = int(days)
    except (TypeError, ValueError):
        raise ValueError("days は整数で指定してください")
    if days <= 0 or days > 366:
        raise ValueError("days は 1〜366 で指定してください")

    breakdown = {}
    per_day = 0.0
    for key, hours in (activities or {}).items():
        rate = DATA_RATES_GB_PER_HOUR.get(key)
        if rate is None:
            continue
        try:
            h = float(hours)
        except (TypeError, ValueError):
            raise ValueError(f"{key} の時間は数値で指定してください")
        if h < 0:
            raise ValueError("利用時間に負の値は指定できません")
        if h > 24:
            raise ValueError("1日の利用時間は24時間以内で指定してください")
        gb = rate * h
        breakdown[key] = round(gb, 2)
        per_day += gb

    return {
        "per_day_gb": round(per_day, 2),
        "per_month_gb": round(per_day * days, 1),
        "days": days,
        "breakdown": breakdown,
    }
