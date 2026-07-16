"""
おうちネット Hub - Web層 (Flask)
===============================
静的フロントエンドの配信と JSON API を提供する。
ローカル保存データは暗号化、レスポンスにはセキュリティヘッダを付与する。
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, request, send_from_directory

from . import core
from .crypto import Cipher
from .store import ProfileStore, SpeedHistoryStore

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")

# リクエストボディの上限（DoS/巨大ペイロード対策）。速度計測は応答なので影響しない。
MAX_CONTENT_LENGTH = 256 * 1024  # 256KB


def create_app(data_dir: str | None = None, cipher: Cipher | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

    data_dir = data_dir or DEFAULT_DATA_DIR
    os.makedirs(data_dir, exist_ok=True)
    if cipher is None:
        cipher = Cipher.from_key_file(os.path.join(data_dir, ".secret.key"))

    profiles = ProfileStore(os.path.join(data_dir, "profiles.enc"), cipher)
    history = SpeedHistoryStore(os.path.join(data_dir, "speed_history.enc"), cipher)
    app.config["PROFILES"] = profiles
    app.config["HISTORY"] = history

    # -- セキュリティヘッダ -------------------------------------------
    @app.after_request
    def security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'"
        )
        # APIレスポンスは秘密情報を含むためキャッシュ禁止
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # -- 静的ファイル --------------------------------------------------
    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/static/<path:filename>")
    def static_files(filename):
        # send_from_directory は STATIC_DIR 外への相対パス脱出を防ぐ
        return send_from_directory(STATIC_DIR, filename)

    # -- PWA（インストール可能にする） --------------------------------
    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(
            STATIC_DIR, "manifest.webmanifest",
            mimetype="application/manifest+json",
        )

    @app.get("/sw.js")
    def service_worker():
        # ルート配下をスコープにするため /sw.js で配信する
        resp = send_from_directory(STATIC_DIR, "sw.js", mimetype="text/javascript")
        resp.headers["Service-Worker-Allowed"] = "/"
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    # -- ヘルスチェック ------------------------------------------------
    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "app": "おうちネット Hub"})

    # -- QR生成 --------------------------------------------------------
    @app.post("/api/qr")
    def make_qr():
        data = request.get_json(silent=True) or {}
        try:
            result = core.wifi_qr_svg(
                ssid=data.get("ssid", ""),
                password=data.get("password", ""),
                security=data.get("security", "WPA"),
                hidden=bool(data.get("hidden", False)),
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(result)

    # -- プロファイル CRUD --------------------------------------------
    @app.get("/api/profiles")
    def list_profiles():
        return jsonify(profiles.list())

    @app.post("/api/profiles")
    def create_profile():
        data = request.get_json(silent=True) or {}
        try:
            item = profiles.add(data)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(item), 201

    @app.get("/api/profiles/<pid>")
    def get_profile(pid):
        item = profiles.get(pid)
        if item is None:
            return jsonify({"error": "見つかりません"}), 404
        return jsonify(item)

    @app.put("/api/profiles/<pid>")
    def update_profile(pid):
        data = request.get_json(silent=True) or {}
        try:
            item = profiles.update(pid, data)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if item is None:
            return jsonify({"error": "見つかりません"}), 404
        return jsonify(item)

    @app.delete("/api/profiles/<pid>")
    def delete_profile(pid):
        if not profiles.delete(pid):
            return jsonify({"error": "見つかりません"}), 404
        return jsonify({"deleted": pid})

    @app.post("/api/profiles/import")
    def import_profiles():
        # バックアップJSONからの一括読み込み。全件検証してから追加する。
        data = request.get_json(silent=True) or {}
        items = data.get("profiles")
        if not isinstance(items, list) or not items:
            return jsonify({"error": "profiles の配列を指定してください"}), 400
        if len(items) > 50:
            return jsonify({"error": "一度に読み込めるのは50件までです"}), 400
        cleaned = []
        for idx, item in enumerate(items):
            try:
                cleaned.append(core.validate_profile(item))
            except ValueError as e:
                return jsonify({"error": f"{idx + 1}件目: {e}"}), 400
        added = [profiles.add(c) for c in cleaned]
        return jsonify({"imported": len(added)}), 201

    # -- パスワード ----------------------------------------------------
    @app.post("/api/password/analyze")
    def analyze_password():
        data = request.get_json(silent=True) or {}
        return jsonify(core.password_strength(data.get("password", "")))

    @app.get("/api/password/generate")
    def gen_password():
        def flag(name, default):
            v = request.args.get(name)
            if v is None:
                return default
            return v.lower() in ("1", "true", "yes", "on")

        try:
            if request.args.get("mode", "random") == "phrase":
                # 覚えやすい「ことばフレーズ」モード
                words = int(request.args.get("words", 3))
                pw = core.generate_passphrase(words)
            else:
                length = int(request.args.get("length", 16))
                pw = core.generate_password(
                    length,
                    use_upper=flag("upper", True),
                    use_lower=flag("lower", True),
                    use_digits=flag("digits", True),
                    use_symbols=flag("symbols", True),
                    avoid_ambiguous=flag("avoid_ambiguous", True),
                )
        except (ValueError, TypeError) as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"password": pw, "strength": core.password_strength(pw)})

    # -- 速度テスト ----------------------------------------------------
    @app.get("/api/speedtest/ping")
    def ping():
        return jsonify({"pong": True})

    @app.get("/api/speedtest/payload")
    def speed_payload():
        try:
            size = int(request.args.get("bytes", 1_000_000))
        except (ValueError, TypeError):
            size = 1_000_000
        size = max(1, min(size, 25_000_000))  # 上限25MB
        blob = os.urandom(size)
        return app.response_class(
            blob,
            mimetype="application/octet-stream",
            headers={"Cache-Control": "no-store", "Content-Length": str(size)},
        )

    @app.post("/api/speedtest/upload")
    def speed_upload():
        # アップロード速度計測用。受信バイト数を返すだけ（本体は破棄）。
        data = request.get_data()
        return jsonify({"received": len(data)})

    # -- 速度テスト履歴（暗号化保存） ---------------------------------
    @app.get("/api/speedtest/history")
    def list_history():
        return jsonify(history.list())

    @app.post("/api/speedtest/history")
    def add_history():
        data = request.get_json(silent=True) or {}
        try:
            item = history.add(data)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(item), 201

    @app.delete("/api/speedtest/history")
    def clear_history():
        history.clear()
        return jsonify({"cleared": True})

    # -- データ使用量シミュレーター ------------------------------------
    @app.post("/api/data-usage")
    def data_usage():
        data = request.get_json(silent=True) or {}
        try:
            result = core.estimate_data_usage(
                data.get("activities", {}),
                days=data.get("days", 30),
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(result)

    return app


app = create_app()
