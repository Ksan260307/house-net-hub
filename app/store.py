"""
おうちネット Hub - 永続化層（暗号化対応）
=======================================
ネットワークプロファイル・速度テスト履歴を、暗号化した状態で
ローカルのバイナリファイルに保存する軽量ストア。

- 保存内容は Cipher(Fernet) で暗号化 → 平文はディスクに残らない。
- 一時ファイル→リネームでアトミックに書き込み、破損を防ぐ。
- 単純なロックでスレッドセーフ。
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from typing import Optional

from . import core
from .crypto import Cipher, DecryptionError


class EncryptedListStore:
    """暗号化された「辞書のリスト」を1ファイルで永続化する基底クラス。"""

    def __init__(self, path: str, cipher: Cipher):
        self.path = path
        self._cipher = cipher
        self._lock = threading.RLock()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        if not os.path.exists(path):
            self._write_all([])

    # -- 低レベル I/O ------------------------------------------------------
    def _read_all(self) -> list[dict]:
        try:
            with open(self.path, "rb") as f:
                token = f.read()
            if not token:
                return []
            raw = self._cipher.decrypt(token)
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, list) else []
        except (FileNotFoundError, DecryptionError, json.JSONDecodeError, ValueError):
            # 復号失敗・破損時は空として扱う（データ改ざん・鍵不一致の検出点）
            return []

    def _write_all(self, items: list[dict]) -> None:
        payload = json.dumps(items, ensure_ascii=False).encode("utf-8")
        token = self._cipher.encrypt(payload)
        d = os.path.dirname(os.path.abspath(self.path))
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(token)
            os.replace(tmp, self.path)
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise

    def list(self) -> list[dict]:
        with self._lock:
            return self._read_all()

    def clear(self) -> None:
        with self._lock:
            self._write_all([])


class ProfileStore(EncryptedListStore):
    """ネットワークプロファイルの CRUD ストア。"""

    def get(self, profile_id: str) -> Optional[dict]:
        with self._lock:
            for item in self._read_all():
                if item.get("id") == profile_id:
                    return item
        return None

    def add(self, data: dict) -> dict:
        clean = core.validate_profile(data)
        now = time.time()
        item = {
            "id": uuid.uuid4().hex,
            **clean,
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            items = self._read_all()
            items.append(item)
            self._write_all(items)
        return item

    def update(self, profile_id: str, data: dict) -> Optional[dict]:
        clean = core.validate_profile(data)
        with self._lock:
            items = self._read_all()
            for idx, item in enumerate(items):
                if item.get("id") == profile_id:
                    item.update(clean)
                    item["updated_at"] = time.time()
                    items[idx] = item
                    self._write_all(items)
                    return item
        return None

    def delete(self, profile_id: str) -> bool:
        with self._lock:
            items = self._read_all()
            new_items = [i for i in items if i.get("id") != profile_id]
            if len(new_items) == len(items):
                return False
            self._write_all(new_items)
            return True


class SpeedHistoryStore(EncryptedListStore):
    """速度テスト結果の履歴ストア（新しい順・最大件数でトリミング）。"""

    MAX_ENTRIES = 50

    def add(self, record: dict) -> dict:
        try:
            mbps = float(record.get("mbps"))
            ping_ms = float(record.get("ping_ms"))
        except (TypeError, ValueError):
            raise ValueError("mbps と ping_ms は数値で指定してください")
        if mbps < 0 or ping_ms < 0:
            raise ValueError("負の値は指定できません")
        if mbps > 100000 or ping_ms > 600000:
            raise ValueError("値が大きすぎます")

        item = {
            "id": uuid.uuid4().hex,
            "mbps": round(mbps, 2),
            "ping_ms": round(ping_ms, 1),
            "at": time.time(),
        }
        # 上り速度は任意（旧クライアントとの互換のためオプション扱い）
        up = record.get("up_mbps")
        if up is not None:
            try:
                up = float(up)
            except (TypeError, ValueError):
                raise ValueError("up_mbps は数値で指定してください")
            if up < 0 or up > 100000:
                raise ValueError("up_mbps の値が不正です")
            item["up_mbps"] = round(up, 2)
        with self._lock:
            items = self._read_all()
            items.insert(0, item)
            del items[self.MAX_ENTRIES:]
            self._write_all(items)
        return item
