"""セキュリティ系テスト：暗号化保存・ヘッダ・入力制限・パストラバーサル。"""

import json
import os

import pytest

from app.crypto import Cipher, get_or_create_key
from app.store import ProfileStore


# ---- 保存データの暗号化（at rest） ----------------------------------
def test_password_not_stored_in_plaintext(client, data_dir):
    secret_pw = "SuperSecret_ABC123!"
    r = client.post("/api/profiles", json={"ssid": "SecretNet", "password": secret_pw})
    assert r.status_code == 201

    enc_file = os.path.join(data_dir, "profiles.enc")
    assert os.path.exists(enc_file)
    raw = open(enc_file, "rb").read()

    # 平文のパスワード／SSIDがそのままディスクに残っていないこと
    assert secret_pw.encode("utf-8") not in raw
    assert b"SecretNet" not in raw
    # 復号前の内容はJSONとして読めない（＝暗号化されている）
    with pytest.raises(Exception):
        json.loads(raw.decode("utf-8", errors="ignore"))


def test_encrypted_roundtrip(tmp_path, cipher):
    path = str(tmp_path / "p.enc")
    s = ProfileStore(path, cipher)
    s.add({"ssid": "Home", "password": "roundtrip123"})
    # 同じ鍵なら復号できる
    assert ProfileStore(path, cipher).list()[0]["password"] == "roundtrip123"


def test_wrong_key_cannot_read(tmp_path):
    from cryptography.fernet import Fernet

    path = str(tmp_path / "p.enc")
    ProfileStore(path, Cipher(Fernet.generate_key())).add(
        {"ssid": "Home", "password": "pw12345"}
    )
    # 別の鍵では復号できず、空として扱われる（改ざん／鍵不一致の安全側動作）
    other = ProfileStore(path, Cipher(Fernet.generate_key()))
    assert other.list() == []


def test_tampered_file_treated_as_empty(tmp_path, cipher):
    path = str(tmp_path / "p.enc")
    s = ProfileStore(path, cipher)
    s.add({"ssid": "Home", "password": "pw12345"})
    with open(path, "wb") as f:
        f.write(b"garbage-not-a-valid-token")
    assert ProfileStore(path, cipher).list() == []


def test_keyfile_is_generated_and_distinct(tmp_path):
    key_path = str(tmp_path / ".secret.key")
    k1 = get_or_create_key(key_path)
    assert os.path.exists(key_path)
    # 既存鍵は再利用される
    assert get_or_create_key(key_path) == k1
    # 生成のたびに異なる鍵になる
    assert get_or_create_key(str(tmp_path / "other.key")) != k1


# ---- セキュリティヘッダ ---------------------------------------------
@pytest.mark.parametrize("path", ["/", "/api/health", "/static/css/styles.css"])
def test_security_headers_present(client, path):
    r = client.get(path)
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert "default-src 'self'" in r.headers.get("Content-Security-Policy", "")
    assert r.headers.get("Referrer-Policy") == "no-referrer"


def test_api_responses_are_no_store(client):
    r = client.get("/api/profiles")
    assert r.headers.get("Cache-Control") == "no-store"


def test_index_has_no_inline_styles(client):
    # 厳格なCSP(default-src 'self')ではインラインstyleがブロックされるため禁止
    html = client.get("/").data.decode("utf-8")
    assert "style=" not in html
    assert "<style" not in html


# ---- パストラバーサル ------------------------------------------------
@pytest.mark.parametrize("evil", [
    "/static/../app/core.py",
    "/static/..%2f..%2fapp%2fserver.py",
    "/static/....//app/core.py",
    "/static/../data/.secret.key",
])
def test_path_traversal_blocked(client, evil):
    r = client.get(evil)
    assert r.status_code in (301, 308, 400, 403, 404)
    # サーバー側ソースが漏えいしていないこと
    assert b"def create_app" not in r.data
    assert b"Fernet" not in r.data


def test_legitimate_static_still_served(client):
    assert client.get("/static/js/app.js").status_code == 200


# ---- リクエストサイズ制限（DoS対策） --------------------------------
def test_oversized_request_rejected(client):
    big = "x" * (300 * 1024)  # 300KB > 256KB上限
    r = client.post("/api/profiles", data=big, content_type="application/json")
    assert r.status_code == 413


# ---- 入力バリデーションによる堅牢性 ---------------------------------
def test_malicious_ssid_does_not_break_api(client):
    payload = {"ssid": '<script>alert(1)</script>', "password": "pw12345"}
    r = client.post("/api/qr", json=payload)
    assert r.status_code == 200
    # レスポンスはJSONで、スクリプトはデータとして安全に格納される
    assert r.mimetype == "application/json"
    assert r.get_json()["payload"].startswith("WIFI:")
