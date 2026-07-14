"""コアロジックの単体テスト。"""

import math

import pytest

from app import core


# ---- WiFi ペイロード -------------------------------------------------
def test_wifi_payload_basic():
    p = core.build_wifi_payload("MyHome", "secret123", "WPA", False)
    assert p == "WIFI:T:WPA;S:MyHome;P:secret123;H:false;;"


def test_wifi_payload_hidden():
    p = core.build_wifi_payload("MyHome", "pw", "WPA", True)
    assert "H:true" in p


def test_wifi_payload_nopass_omits_password():
    p = core.build_wifi_payload("Cafe", "ignored", "nopass", False)
    assert "P:" not in p
    assert "T:nopass" in p


def test_wifi_payload_escapes_special_chars():
    p = core.build_wifi_payload('Net;work', 'pa:ss"w,d\\x', "WPA")
    # 特殊文字がバックスラッシュでエスケープされている
    assert "Net\\;work" in p
    assert 'pa\\:ss\\"w\\,d\\\\x' in p


def test_wifi_payload_empty_ssid_raises():
    with pytest.raises(ValueError):
        core.build_wifi_payload("", "pw")


def test_wifi_payload_invalid_security_raises():
    with pytest.raises(ValueError):
        core.build_wifi_payload("SSID", "pw", "WPA3-ENTERPRISE")


# ---- QR SVG ----------------------------------------------------------
def test_qr_svg_returns_svg():
    svg = core.qr_svg("hello world")
    assert "<svg" in svg
    assert "qr-svg" in svg


def test_qr_svg_empty_raises():
    with pytest.raises(ValueError):
        core.qr_svg("")


def test_wifi_qr_svg_bundle():
    r = core.wifi_qr_svg("Home", "pw12345", "WPA")
    assert set(r.keys()) == {"payload", "svg"}
    assert r["payload"].startswith("WIFI:")
    assert "<svg" in r["svg"]


# ---- パスワード強度 --------------------------------------------------
def test_strength_empty():
    r = core.password_strength("")
    assert r["score"] == 0
    assert r["entropy_bits"] == 0.0


def test_strength_common_password_is_weak():
    r = core.password_strength("password")
    assert r["score"] <= 1
    assert any("よくある" in f for f in r["feedback"])


def test_strength_strong_password():
    r = core.password_strength("G7!kQ9#vLm2$xZ4w")
    assert r["score"] == 4
    assert r["entropy_bits"] > 90


def test_strength_entropy_grows_with_length():
    short = core.password_strength("aB3!xY")
    long = core.password_strength("aB3!xY" * 4)
    assert long["entropy_bits"] > short["entropy_bits"]


def test_strength_repeated_chars_penalized():
    r = core.password_strength("aaaaaaaaaaaa")
    assert r["score"] <= 1


# ---- パスワード生成 --------------------------------------------------
def test_generate_length_and_types():
    pw = core.generate_password(20)
    assert len(pw) == 20
    assert any(c.islower() for c in pw)
    assert any(c.isupper() for c in pw)
    assert any(c.isdigit() for c in pw)


def test_generate_avoids_ambiguous():
    for _ in range(20):
        pw = core.generate_password(24, avoid_ambiguous=True)
        assert not (set(pw) & core._AMBIGUOUS)


def test_generate_only_digits():
    pw = core.generate_password(10, use_upper=False, use_lower=False,
                                use_symbols=False, use_digits=True)
    assert pw.isdigit()


def test_generate_too_short_raises():
    with pytest.raises(ValueError):
        core.generate_password(3)


def test_generate_no_charset_raises():
    with pytest.raises(ValueError):
        core.generate_password(12, use_upper=False, use_lower=False,
                               use_digits=False, use_symbols=False)


def test_generate_is_random():
    a = core.generate_password(24)
    b = core.generate_password(24)
    assert a != b


# ---- バリデーション --------------------------------------------------
def test_validate_profile_ok():
    out = core.validate_profile({"ssid": "Home", "password": "pw12345"})
    assert out["ssid"] == "Home"
    assert out["name"] == "Home"  # 名称未指定はSSID流用
    assert out["security"] == "WPA"


def test_validate_profile_missing_ssid():
    with pytest.raises(ValueError):
        core.validate_profile({"password": "x"})


def test_validate_profile_nopass_without_password_ok():
    out = core.validate_profile({"ssid": "Open", "security": "nopass"})
    assert out["security"] == "nopass"


def test_validate_profile_wpa_requires_password():
    with pytest.raises(ValueError):
        core.validate_profile({"ssid": "Home", "security": "WPA", "password": ""})


def test_validate_profile_ssid_too_long():
    with pytest.raises(ValueError):
        core.validate_profile({"ssid": "x" * 33, "password": "pw"})


def test_validate_profile_show_password_default_off():
    out = core.validate_profile({"ssid": "Home", "password": "pw12345"})
    assert out["show_password"] is False


def test_validate_profile_show_password_opt_in():
    out = core.validate_profile({"ssid": "Home", "password": "pw12345", "show_password": True})
    assert out["show_password"] is True


# ---- データ使用量シミュレーター --------------------------------------
def test_data_usage_basic():
    r = core.estimate_data_usage({"video_hd": 2, "music": 1}, days=30)
    # 3.0*2 + 0.15*1 = 6.15 GB/日
    assert r["per_day_gb"] == 6.15
    assert r["per_month_gb"] == round(6.15 * 30, 1)
    assert r["breakdown"]["video_hd"] == 6.0


def test_data_usage_unknown_activity_ignored():
    r = core.estimate_data_usage({"unknown": 5, "music": 2})
    assert "unknown" not in r["breakdown"]
    assert r["breakdown"]["music"] == 0.3


def test_data_usage_empty():
    r = core.estimate_data_usage({})
    assert r["per_day_gb"] == 0.0
    assert r["per_month_gb"] == 0.0


def test_data_usage_rejects_negative():
    with pytest.raises(ValueError):
        core.estimate_data_usage({"video_hd": -1})


def test_data_usage_rejects_over_24h():
    with pytest.raises(ValueError):
        core.estimate_data_usage({"video_hd": 25})


def test_data_usage_rejects_bad_days():
    with pytest.raises(ValueError):
        core.estimate_data_usage({"music": 1}, days=0)
