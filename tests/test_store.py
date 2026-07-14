"""永続化層（暗号化ストア）のテスト。"""

import os

import pytest

from app.store import ProfileStore, SpeedHistoryStore


@pytest.fixture
def store(tmp_path, cipher):
    return ProfileStore(str(tmp_path / "profiles.enc"), cipher)


@pytest.fixture
def history(tmp_path, cipher):
    return SpeedHistoryStore(str(tmp_path / "history.enc"), cipher)


# ---- ProfileStore ----------------------------------------------------
def test_starts_empty(store):
    assert store.list() == []


def test_add_and_get(store):
    item = store.add({"ssid": "Home", "password": "pw12345"})
    assert item["id"]
    assert item["ssid"] == "Home"
    assert item["show_password"] is False  # 既定は非表示
    assert store.get(item["id"])["ssid"] == "Home"


def test_add_invalid_raises(store):
    with pytest.raises(ValueError):
        store.add({"password": "no ssid"})


def test_list_returns_all(store):
    store.add({"ssid": "A", "password": "pw12345"})
    store.add({"ssid": "B", "password": "pw12345"})
    assert len(store.list()) == 2


def test_update(store):
    item = store.add({"ssid": "Home", "password": "pw12345"})
    updated = store.update(item["id"], {"ssid": "Home2", "password": "pw67890", "name": "自宅"})
    assert updated["ssid"] == "Home2"
    assert updated["name"] == "自宅"
    assert updated["updated_at"] >= item["created_at"]


def test_update_missing_returns_none(store):
    assert store.update("nope", {"ssid": "X", "password": "pw12345"}) is None


def test_delete(store):
    item = store.add({"ssid": "Home", "password": "pw12345"})
    assert store.delete(item["id"]) is True
    assert store.get(item["id"]) is None


def test_delete_missing_returns_false(store):
    assert store.delete("nope") is False


def test_persistence_across_instances(tmp_path, cipher):
    path = str(tmp_path / "p.enc")
    s1 = ProfileStore(path, cipher)
    s1.add({"ssid": "Persist", "password": "pw12345"})
    s2 = ProfileStore(path, cipher)
    assert len(s2.list()) == 1
    assert s2.list()[0]["ssid"] == "Persist"


def test_clear(store):
    store.add({"ssid": "A", "password": "pw12345"})
    store.clear()
    assert store.list() == []


def test_file_created_on_init(tmp_path, cipher):
    path = str(tmp_path / "sub" / "profiles.enc")
    ProfileStore(path, cipher)
    assert os.path.exists(path)


# ---- SpeedHistoryStore ----------------------------------------------
def test_history_add_and_list(history):
    history.add({"mbps": 88.5, "ping_ms": 12.3})
    items = history.list()
    assert len(items) == 1
    assert items[0]["mbps"] == 88.5
    assert items[0]["ping_ms"] == 12.3
    assert "at" in items[0]


def test_history_newest_first(history):
    history.add({"mbps": 10, "ping_ms": 5})
    history.add({"mbps": 20, "ping_ms": 6})
    assert history.list()[0]["mbps"] == 20


def test_history_trims_to_max(history):
    for i in range(60):
        history.add({"mbps": i, "ping_ms": 1})
    assert len(history.list()) == SpeedHistoryStore.MAX_ENTRIES


def test_history_rejects_invalid(history):
    with pytest.raises(ValueError):
        history.add({"mbps": "abc", "ping_ms": 1})
    with pytest.raises(ValueError):
        history.add({"mbps": -5, "ping_ms": 1})
