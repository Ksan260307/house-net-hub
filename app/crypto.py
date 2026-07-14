"""
おうちネット Hub - 暗号化ユーティリティ
=====================================
ローカル保存データ（プロファイル・速度履歴）を保存時に暗号化する。

- 対称鍵暗号 Fernet(AES-128-CBC + HMAC-SHA256) を使用。
- 鍵はマシンローカルの鍵ファイルに保存し、初回に自動生成する。
  鍵ファイルは .gitignore 対象。閲覧権限も可能な範囲で本人のみに制限する。
"""

from __future__ import annotations

import os
import stat

from cryptography.fernet import Fernet, InvalidToken

# 復号失敗を呼び出し側で扱いやすいよう再エクスポート
DecryptionError = InvalidToken


def get_or_create_key(key_path: str) -> bytes:
    """
    鍵ファイルから鍵を読み込む。無ければ生成して保存する。
    戻り値は Fernet 用の base64 鍵（bytes）。
    """
    os.makedirs(os.path.dirname(os.path.abspath(key_path)), exist_ok=True)
    if os.path.exists(key_path):
        with open(key_path, "rb") as f:
            key = f.read().strip()
            if key:
                return key

    key = Fernet.generate_key()
    # 0600 相当（本人のみ読み書き）で書き込む。Windowsでは限定的だが害はない。
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, key)
    finally:
        os.close(fd)
    try:
        os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return key


class Cipher:
    """Fernet をラップした薄い暗号化ヘルパー。"""

    def __init__(self, key: bytes):
        self._fernet = Fernet(key)

    @classmethod
    def from_key_file(cls, key_path: str) -> "Cipher":
        return cls(get_or_create_key(key_path))

    def encrypt(self, data: bytes) -> bytes:
        return self._fernet.encrypt(data)

    def decrypt(self, token: bytes) -> bytes:
        return self._fernet.decrypt(token)
