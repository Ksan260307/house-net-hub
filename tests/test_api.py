"""HTTP API のテスト（Flask test_client）。"""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "おうちネット Hub" in r.data.decode("utf-8")


def test_static_css_served(client):
    r = client.get("/static/css/styles.css")
    assert r.status_code == 200


def test_client_compute_assets_served(client):
    # オフライン動作に必要なクライアント側資産が配信されている
    for path in ("/static/js/vendor/qrcode.js", "/static/js/compute.js"):
        r = client.get(path)
        assert r.status_code == 200
        assert "javascript" in r.headers.get("Content-Type", "")


def test_index_references_client_compute(client):
    html = client.get("/").data.decode("utf-8")
    assert "static/js/vendor/qrcode.js" in html
    assert "static/js/compute.js" in html


# ---- PWA -------------------------------------------------------------
def test_manifest_served(client):
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    assert "application/manifest+json" in r.headers.get("Content-Type", "")
    data = r.get_json()
    assert data["name"] == "おうちネット Hub"
    assert data["display"] == "standalone"
    assert len(data["icons"]) >= 2


def test_service_worker_served(client):
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.headers.get("Content-Type", "")
    assert r.headers.get("Service-Worker-Allowed") == "/"
    assert b"addEventListener" in r.data


def test_pwa_icons_served(client):
    for name in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
        r = client.get(f"/static/icons/{name}")
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("image/")


def test_index_links_manifest_and_icon(client):
    html = client.get("/").data.decode("utf-8")
    assert 'rel="manifest"' in html
    assert "apple-touch-icon" in html
    assert 'name="theme-color"' in html


# ---- QR --------------------------------------------------------------
def test_qr_ok(client):
    r = client.post("/api/qr", json={"ssid": "Home", "password": "pw12345", "security": "WPA"})
    assert r.status_code == 200
    data = r.get_json()
    assert data["payload"].startswith("WIFI:")
    assert "<svg" in data["svg"]


def test_qr_missing_ssid(client):
    r = client.post("/api/qr", json={"ssid": "", "password": "x"})
    assert r.status_code == 400
    assert "error" in r.get_json()


# ---- プロファイル CRUD ----------------------------------------------
def test_profile_crud_flow(client):
    # 初期は空
    assert client.get("/api/profiles").get_json() == []

    # 作成
    r = client.post("/api/profiles", json={"ssid": "Home", "password": "pw12345", "name": "自宅"})
    assert r.status_code == 201
    pid = r.get_json()["id"]

    # 取得
    r = client.get(f"/api/profiles/{pid}")
    assert r.status_code == 200
    assert r.get_json()["name"] == "自宅"

    # 一覧
    assert len(client.get("/api/profiles").get_json()) == 1

    # 更新
    r = client.put(f"/api/profiles/{pid}", json={"ssid": "Home", "password": "pw12345",
                                                 "name": "自宅WiFi", "is_guest": True})
    assert r.status_code == 200
    assert r.get_json()["name"] == "自宅WiFi"
    assert r.get_json()["is_guest"] is True

    # 削除
    assert client.delete(f"/api/profiles/{pid}").status_code == 200
    assert client.get("/api/profiles").get_json() == []


def test_profile_create_invalid(client):
    r = client.post("/api/profiles", json={"password": "no ssid"})
    assert r.status_code == 400


def test_profile_get_missing(client):
    assert client.get("/api/profiles/nope").status_code == 404


def test_profile_delete_missing(client):
    assert client.delete("/api/profiles/nope").status_code == 404


# ---- パスワード ------------------------------------------------------
def test_password_analyze(client):
    r = client.post("/api/password/analyze", json={"password": "G7!kQ9#vLm2$xZ4w"})
    assert r.status_code == 200
    assert r.get_json()["score"] == 4


def test_password_generate(client):
    r = client.get("/api/password/generate?length=18")
    assert r.status_code == 200
    data = r.get_json()
    assert len(data["password"]) == 18
    assert data["strength"]["score"] >= 3


def test_password_generate_invalid(client):
    r = client.get("/api/password/generate?length=2")
    assert r.status_code == 400


def test_password_generate_flags(client):
    r = client.get("/api/password/generate?length=12&symbols=false&upper=false&lower=false&digits=true")
    assert r.status_code == 200
    assert r.get_json()["password"].isdigit()


def test_password_generate_phrase_mode(client):
    r = client.get("/api/password/generate?mode=phrase&words=3")
    assert r.status_code == 200
    pw = r.get_json()["password"]
    assert pw.count("-") == 3               # 単語3 + 数字1 = 区切り3つ
    assert r.get_json()["strength"]["score"] >= 2


def test_password_generate_phrase_invalid_words(client):
    r = client.get("/api/password/generate?mode=phrase&words=99")
    assert r.status_code == 400


# ---- 速度テスト ------------------------------------------------------
def test_speedtest_ping(client):
    r = client.get("/api/speedtest/ping")
    assert r.status_code == 200
    assert r.get_json()["pong"] is True


def test_speedtest_payload_size(client):
    r = client.get("/api/speedtest/payload?bytes=50000")
    assert r.status_code == 200
    assert len(r.data) == 50000
    assert r.mimetype == "application/octet-stream"


def test_speedtest_payload_capped(client):
    r = client.get("/api/speedtest/payload?bytes=999999999")
    assert len(r.data) == 25_000_000  # 上限にクランプ


# ---- アップロード速度計測 --------------------------------------------
def test_speedtest_upload(client):
    r = client.post("/api/speedtest/upload", data=b"x" * 50000,
                    content_type="application/octet-stream")
    assert r.status_code == 200
    assert r.get_json()["received"] == 50000


# ---- プロファイル一括インポート ---------------------------------------
def test_profiles_import(client):
    r = client.post("/api/profiles/import", json={"profiles": [
        {"ssid": "ImpA", "password": "pw12345"},
        {"ssid": "ImpB", "password": "pw12345", "is_guest": True},
    ]})
    assert r.status_code == 201
    assert r.get_json()["imported"] == 2
    items = client.get("/api/profiles").get_json()
    assert len(items) == 2
    assert any(i["is_guest"] for i in items)


def test_profiles_import_invalid_entry(client):
    r = client.post("/api/profiles/import", json={"profiles": [
        {"ssid": "OK", "password": "pw12345"},
        {"password": "no-ssid"},
    ]})
    assert r.status_code == 400
    assert "2件目" in r.get_json()["error"]
    # 全件検証してから追加するので、1件目も追加されていない
    assert client.get("/api/profiles").get_json() == []


def test_profiles_import_empty(client):
    assert client.post("/api/profiles/import", json={"profiles": []}).status_code == 400
    assert client.post("/api/profiles/import", json={}).status_code == 400


# ---- 速度テスト履歴 --------------------------------------------------
def test_history_crud(client):
    assert client.get("/api/speedtest/history").get_json() == []

    r = client.post("/api/speedtest/history", json={"mbps": 95.4, "ping_ms": 8.2})
    assert r.status_code == 201
    assert r.get_json()["mbps"] == 95.4

    items = client.get("/api/speedtest/history").get_json()
    assert len(items) == 1

    assert client.delete("/api/speedtest/history").status_code == 200
    assert client.get("/api/speedtest/history").get_json() == []


def test_history_invalid(client):
    r = client.post("/api/speedtest/history", json={"mbps": "x", "ping_ms": 1})
    assert r.status_code == 400


def test_history_accepts_upload_speed(client):
    r = client.post("/api/speedtest/history",
                    json={"mbps": 80.1, "ping_ms": 9.5, "up_mbps": 42.5})
    assert r.status_code == 201
    assert r.get_json()["up_mbps"] == 42.5
    # 旧形式（up_mbpsなし）も引き続き受け付ける
    r2 = client.post("/api/speedtest/history", json={"mbps": 50, "ping_ms": 10})
    assert r2.status_code == 201
    assert "up_mbps" not in r2.get_json()


# ---- プロファイル show_password ------------------------------------
def test_profile_show_password_flag(client):
    r = client.post("/api/profiles", json={"ssid": "Home", "password": "pw12345",
                                           "show_password": True})
    assert r.status_code == 201
    assert r.get_json()["show_password"] is True


# ---- データ使用量シミュレーター --------------------------------------
def test_data_usage_endpoint(client):
    r = client.post("/api/data-usage", json={"activities": {"video_hd": 2}, "days": 30})
    assert r.status_code == 200
    assert r.get_json()["per_day_gb"] == 6.0


def test_data_usage_endpoint_invalid(client):
    r = client.post("/api/data-usage", json={"activities": {"video_hd": 99}})
    assert r.status_code == 400
