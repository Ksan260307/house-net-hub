"""共有フィクスチャ。バックエンド用の test_client と、E2E用のライブサーバー+ブラウザ。"""

import os
import socket
import sys
import threading
import time

import pytest
import requests

# プロジェクトルートを import パスに追加
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.crypto import Cipher  # noqa: E402
from app.server import create_app  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402


# --------------------------------------------------------------------------
# バックエンド（HTTPを介さない test_client）
# --------------------------------------------------------------------------
@pytest.fixture
def data_dir(tmp_path):
    return str(tmp_path)


@pytest.fixture
def cipher():
    """テスト用に毎回新しい鍵で作る暗号化ヘルパー。"""
    return Cipher(Fernet.generate_key())


@pytest.fixture
def app(data_dir):
    return create_app(data_dir)


@pytest.fixture
def client(app):
    return app.test_client()


# --------------------------------------------------------------------------
# フロントエンド（実サーバー + Playwright/Chromium）
# --------------------------------------------------------------------------
def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def live_server(tmp_path_factory):
    from werkzeug.serving import make_server

    data = str(tmp_path_factory.mktemp("live"))
    app = create_app(data)
    port = _free_port()
    server = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    base = f"http://127.0.0.1:{port}"
    # 起動待ち
    for _ in range(50):
        try:
            if requests.get(base + "/api/health", timeout=1).ok:
                break
        except requests.RequestException:
            time.sleep(0.1)
    else:
        raise RuntimeError("ライブサーバーが起動しませんでした")

    yield base
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    context = browser.new_context(viewport={"width": 1200, "height": 900})
    pg = context.new_page()
    yield pg
    context.close()
