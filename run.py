"""
おうちネット Hub 起動スクリプト
=============================
    python run.py
その後ブラウザで http://127.0.0.1:5000 を開く。
"""

from app.server import create_app

if __name__ == "__main__":
    app = create_app()
    port = 5000
    print("=" * 48)
    print("  おうちネット Hub  起動中 …")
    print(f"  → http://127.0.0.1:{port}")
    print("  停止するには Ctrl+C")
    print("=" * 48)
    app.run(host="127.0.0.1", port=port, debug=False)
