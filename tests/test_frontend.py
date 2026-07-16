"""フロントエンド E2E テスト（Playwright + Chromium）。実ブラウザで全機能を検証する。"""

import pytest

pytestmark = pytest.mark.frontend


def test_page_loads(page, live_server):
    page.goto(live_server)
    assert "おうちネット Hub" in page.title()
    assert page.locator(".brand-text h1").inner_text() == "おうちネット Hub"


def test_wifi_qr_generates(page, live_server):
    page.goto(live_server)
    page.fill("#ssid", "MyHome_5G")
    page.fill("#password", "secret12345")
    # デバウンス後にQRのSVGが出現
    page.wait_for_selector("#qr-stage svg.qr-svg", timeout=5000)
    assert page.locator("#qr-stage svg").count() == 1
    assert page.locator("#qr-ssid-label").inner_text() == "MyHome_5G"
    assert page.is_enabled("#guest-mode-btn")


def test_guest_fullscreen_hides_password_by_default(page, live_server):
    page.goto(live_server)
    page.fill("#ssid", "GuestNet")
    page.fill("#password", "welcome123")
    page.wait_for_selector("#qr-stage svg.qr-svg", timeout=5000)
    page.click("#guest-mode-btn")
    overlay = page.locator("#guest-overlay")
    assert overlay.is_visible()
    assert page.locator("#guest-ssid").inner_text() == "GuestNet"
    assert page.locator("#guest-qr svg").count() == 1
    # 既定ではパスワードは表示されない
    assert page.locator("#guest-pw").is_hidden()
    # Escキーで閉じる
    page.keyboard.press("Escape")
    assert page.locator("#guest-overlay").is_hidden()


def test_guest_shows_password_when_opted_in(page, live_server):
    page.goto(live_server)
    page.fill("#ssid", "GuestNet")
    page.fill("#password", "welcome123")
    page.check("#show-password")  # オプションを有効化
    page.wait_for_selector("#qr-stage svg.qr-svg", timeout=5000)
    page.click("#guest-mode-btn")
    pw = page.locator("#guest-pw")
    assert pw.is_visible()
    assert "welcome123" in pw.inner_text()


def test_save_and_list_profile(page, live_server):
    page.goto(live_server)
    unique = "TestProfile_" + str(id(page))[-5:]
    page.fill("#ssid", unique)
    page.fill("#password", "pw12345678")
    page.click("#save-profile-btn")
    page.wait_for_selector("#toast.show", timeout=3000)
    # プロファイルタブへ
    page.click('.tab[data-tab="profiles"]')
    page.wait_for_selector(".profile-item", timeout=3000)
    names = page.locator(".profile-name").all_inner_texts()
    assert any(unique in n for n in names)


def test_password_strength_meter(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="password"]')
    page.fill("#analyze-input", "G7!kQ9#vLm2$xZ4w")
    page.wait_for_selector("#meter-bar.s4", timeout=3000)
    assert page.locator("#meter-label").inner_text() == "とても強い"


def test_password_generate(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="password"]')
    page.click("#gen-btn")
    page.wait_for_selector("#gen-result:not([hidden])", timeout=3000)
    out = page.locator("#gen-output").inner_text()
    assert len(out) == 16


def test_password_generate_respects_length_slider(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="password"]')
    page.eval_on_selector("#gen-length", "el => { el.value = 28; el.dispatchEvent(new Event('input')); }")
    assert page.locator("#len-label").inner_text() == "28"
    page.click("#gen-btn")
    page.wait_for_selector("#gen-result:not([hidden])", timeout=3000)
    assert len(page.locator("#gen-output").inner_text()) == 28


def test_speed_test_runs_and_records_history(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="speed"]')
    page.click("#speed-btn")
    # 計測完了後、数値が表示されボタンが再度有効になる
    page.wait_for_function(
        "() => { const v = document.querySelector('#speed-value').textContent;"
        " return v && v !== '--' && v !== '…'; }",
        timeout=15000,
    )
    val = page.locator("#speed-value").inner_text()
    assert float(val) > 0
    assert "ms" in page.locator("#ping-value").inner_text()
    # 履歴バーが1本以上表示される（暗号化保存された結果の描画）
    page.wait_for_selector(".hist-bar", timeout=5000)
    assert page.locator(".hist-bar").count() >= 1


def test_diagnose_wizard(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="diagnose"]')
    assert page.locator(".diag-q").count() == 1
    # start → no_connect → sol_power
    page.get_by_role("button", name="Wi-Fiに接続できない").click()
    page.get_by_role("button", name="点灯していない・消えている").click()
    page.wait_for_selector(".diag-solution", timeout=3000)
    assert "電源" in page.locator(".diag-solution h3").inner_text()
    # 最初からやり直せる
    page.click("#diag-restart")
    assert page.locator(".diag-q").count() == 1


def test_data_usage_calculator(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="usage"]')
    # 初期表示で自動計算され、正の数が出る
    page.wait_for_function(
        "() => { const v = document.querySelector('#usage-month').textContent;"
        " return v && v !== '--' && parseFloat(v) > 0; }",
        timeout=3000,
    )
    before = float(page.locator("#usage-month").inner_text())
    # 4K動画の時間を増やすと使用量が増える
    inp = page.locator('.usage-row[data-key="video_4k"] input')
    inp.fill("3")
    page.wait_for_function(
        "(b) => parseFloat(document.querySelector('#usage-month').textContent) > b",
        arg=before, timeout=3000,
    )
    assert float(page.locator("#usage-month").inner_text()) > before


def test_kids_subtabs_split(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    # おえかき・ステージがサブタブに分かれている
    assert page.locator(".kidsub").count() == 2
    assert page.locator("#kidsub-draw").is_visible()
    assert page.locator("#kidsub-stage").is_hidden()
    assert page.locator(".palette .swatch").count() >= 10
    # 新ツール群が揃っている
    assert page.locator('.tool-btn[data-tool="brush"]').is_visible()
    assert page.locator("#tool-fill").is_visible()
    assert page.locator("#eraser-btn").is_visible()
    assert page.locator("#undo-btn").count() == 1
    assert page.locator("#custom-color").count() == 1
    assert page.evaluate("() => window.KidsTest.running()") is True

    # ステージサブタブへ切替
    page.click('.kidsub[data-kidsub="stage"]')
    assert page.locator("#kidsub-stage").is_visible()
    assert page.locator("#scene-canvas").is_visible()
    # ステージ選択（海岸）が存在
    assert page.locator('.stage-btn[data-stage="beach"]').is_visible()


def test_kids_draw_spawns_and_switches_to_stage(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => window.KidsTest.clearScene()")

    # 何も描かずに3D化 → 増えない
    page.click("#kids-spawn")
    assert page.evaluate("() => window.KidsTest.count()") == 0

    # 絵を描いて3D化 → 1匹生まれ、自動でステージへ切り替わる
    page.evaluate("() => window.KidsTest.paintTest()")
    page.click("#kids-spawn")
    assert page.evaluate("() => window.KidsTest.count()") == 1
    assert page.evaluate("() => window.KidsTest.subActive()") == "kidsub-stage"


def test_kids_scene_animates(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.paintTest(); window.KidsTest.spawn(); }")
    snap1 = page.evaluate("() => document.querySelector('#scene-canvas').toDataURL()")
    page.wait_for_timeout(600)
    snap2 = page.evaluate("() => document.querySelector('#scene-canvas').toDataURL()")
    assert snap1 != snap2


def test_kids_creatures_are_distributed(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.spawnMany(6); }")
    # 少しシミュレーションを進めても、かたまらず分散している
    page.evaluate("() => window.KidsTest.step(2.0)")
    assert page.evaluate("() => window.KidsTest.count()") == 6
    # 最近接ペアでも一定以上離れている（分散の担保）
    assert page.evaluate("() => window.KidsTest.minPairDist()") > 0.12


def test_kids_tap_makes_creature_jump(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.paintTest(); window.KidsTest.spawn(); window.KidsTest.pinCenter(0); }")
    box = page.locator("#scene-canvas").bounding_box()
    buf = page.evaluate("() => window.KidsTest.bufSize()")
    center = page.evaluate("() => window.KidsTest.screenCenter(0)")
    cx = box["x"] + center["x"] / buf["w"] * box["width"]
    cy = box["y"] + center["y"] / buf["h"] * box["height"]
    page.mouse.click(cx, cy)
    # タップで選択され、ジャンプする
    assert page.evaluate("() => window.KidsTest.selectedIndex()") == 0
    assert page.evaluate("() => window.KidsTest.isJumping(0)") is True
    assert page.locator("#kids-actions").is_visible()


def test_kids_drag_moves_creature(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.paintTest(); window.KidsTest.spawn(); window.KidsTest.pinCenter(0); }")
    box = page.locator("#scene-canvas").bounding_box()
    buf = page.evaluate("() => window.KidsTest.bufSize()")
    center = page.evaluate("() => window.KidsTest.screenCenter(0)")
    before = page.evaluate("() => window.KidsTest.pos(0)")
    cx = box["x"] + center["x"] / buf["w"] * box["width"]
    cy = box["y"] + center["y"] / buf["h"] * box["height"]
    # つかんで別の場所へドラッグ
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.7, steps=6)
    page.mouse.up()
    after = page.evaluate("() => window.KidsTest.pos(0)")
    assert abs(after["bx"] - before["bx"]) > 0.05 or abs(after["by"] - before["by"]) > 0.05


def test_kids_edit_and_delete(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.paintTest(); window.KidsTest.spawn(); window.KidsTest.pinCenter(0); }")

    # 選択して「なおす」→ おえかきタブへ戻り、絵が復元される
    box = page.locator("#scene-canvas").bounding_box()
    buf = page.evaluate("() => window.KidsTest.bufSize()")
    center = page.evaluate("() => window.KidsTest.screenCenter(0)")
    page.mouse.click(box["x"] + center["x"] / buf["w"] * box["width"],
                     box["y"] + center["y"] / buf["h"] * box["height"])
    page.click("#kids-edit")
    assert page.evaluate("() => window.KidsTest.subActive()") == "kidsub-draw"
    assert page.evaluate("() => window.KidsTest.count()") == 0
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is True

    # 再度3D化して、今度は削除する
    page.click("#kids-spawn")
    assert page.evaluate("() => window.KidsTest.count()") == 1
    page.evaluate("() => window.KidsTest.pinCenter(0)")
    box = page.locator("#scene-canvas").bounding_box()
    buf = page.evaluate("() => window.KidsTest.bufSize()")
    center = page.evaluate("() => window.KidsTest.screenCenter(0)")
    page.mouse.click(box["x"] + center["x"] / buf["w"] * box["width"],
                     box["y"] + center["y"] / buf["h"] * box["height"])
    page.click("#kids-delete")
    assert page.evaluate("() => window.KidsTest.count()") == 0
    assert page.locator("#kids-actions").is_hidden()


def test_kids_wide_rectangular_world_and_small_sprites(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    w = page.evaluate("() => window.KidsTest.world()")
    # 横長（正方形でない）で広い、スプライトは小さめ
    assert w["w"] != w["d"]
    assert w["w"] >= 20
    assert w["spriteMax"] <= 32
    # バッファも広がっている
    buf = page.evaluate("() => window.KidsTest.bufSize()")
    assert buf["w"] > buf["h"]


def test_kids_zoom_controls(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click('.kidsub[data-kidsub="stage"]')
    z0 = page.evaluate("() => window.KidsTest.getZoom()")
    page.click("#kids-zoom-in")
    z1 = page.evaluate("() => window.KidsTest.getZoom()")
    assert z1 > z0
    page.click("#kids-zoom-out")
    page.click("#kids-zoom-out")
    z2 = page.evaluate("() => window.KidsTest.getZoom()")
    assert z2 < z1
    assert "%" in page.locator("#zoom-label").inner_text()


def test_kids_fullscreen_toggle(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click('.kidsub[data-kidsub="stage"]')
    assert page.evaluate("() => window.KidsTest.isFullscreen()") is False
    page.click("#kids-fullscreen")
    assert page.evaluate("() => window.KidsTest.isFullscreen()") is True
    assert page.locator("#scene-frame").evaluate("el => el.classList.contains('fs')") is True
    page.click("#kids-fullscreen")
    assert page.evaluate("() => window.KidsTest.isFullscreen()") is False


def test_kids_town_persists_across_reload(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.spawnMany(3); }")
    assert page.evaluate("() => window.KidsTest.count()") == 3
    assert page.evaluate("() => window.KidsTest.storageLen()") == 3

    # リロードしてもローカル保存から街が復元される
    page.reload()
    page.wait_for_function("() => window.KidsTest && window.KidsTest.count() === 3", timeout=5000)
    assert page.evaluate("() => window.KidsTest.count()") == 3

    # みんなバイバイで保存もクリアされる
    page.click('.tab[data-tab="kids"]')
    page.click('.kidsub[data-kidsub="stage"]')
    page.click("#kids-clear-scene")
    assert page.evaluate("() => window.KidsTest.storageLen()") == 0


def test_kids_undo_redo(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click("#kids-clear-draw")
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is False
    # 描く → Undoで消える → Redoで戻る
    page.evaluate("() => window.KidsTest.paintTest()")
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is True
    assert page.evaluate("() => window.KidsTest.canUndo()") is True
    page.click("#undo-btn")
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is False
    assert page.evaluate("() => window.KidsTest.canRedo()") is True
    page.click("#redo-btn")
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is True


def test_kids_fill_tool(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click("#kids-clear-draw")
    page.click("#tool-fill")
    assert page.evaluate("() => window.KidsTest.getTool()") == "fill"
    # キャンバス中央をクリック → 透明地が塗りつぶされる（既定色は赤系）
    page.click("#draw-canvas")
    px = page.evaluate("() => window.KidsTest.pixelAt(160, 150)")
    assert px[3] > 200          # 不透明になった
    assert px[0] > 150          # 赤成分
    # 色スウォッチを押すとふでに戻る
    page.locator(".palette .swatch").nth(3).click()
    assert page.evaluate("() => window.KidsTest.getTool()") == "brush"


def test_kids_guide_templates(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    assert page.evaluate("() => window.KidsTest.guideActive()") == "none"
    assert page.evaluate("() => window.KidsTest.guideHasInk()") is False
    page.click('.guide-btn[data-guide="fish"]')
    assert page.evaluate("() => window.KidsTest.guideActive()") == "fish"
    assert page.evaluate("() => window.KidsTest.guideHasInk()") is True
    # ガイドは完成品（描画レイヤー）には写らない
    assert page.evaluate("() => window.KidsTest.drawHasInk()") is False
    page.click('.guide-btn[data-guide="none"]')
    assert page.evaluate("() => window.KidsTest.guideHasInk()") is False


def test_kids_3d_preview(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click("#kids-clear-draw")
    assert page.evaluate("() => window.KidsTest.previewReady()") is False
    page.evaluate("() => window.KidsTest.paintTest()")
    assert page.evaluate("() => window.KidsTest.previewReady()") is True
    # プレビューはアニメーションしている（フレーム間で変化）
    s1 = page.evaluate("() => document.querySelector('#preview-canvas').toDataURL()")
    page.wait_for_timeout(400)
    s2 = page.evaluate("() => document.querySelector('#preview-canvas').toDataURL()")
    assert s1 != s2


def test_kids_pan_scroll(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click('.kidsub[data-kidsub="stage"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.setZoom(2.0); }")
    cam0 = page.evaluate("() => window.KidsTest.getCamera()")
    box = page.locator("#scene-canvas").bounding_box()
    # なにもない所（上部の海）をドラッグ → 視点が動く
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.15)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.55, steps=6)
    page.mouse.up()
    cam1 = page.evaluate("() => window.KidsTest.getCamera()")
    assert abs(cam1["x"] - cam0["x"]) > 5 or abs(cam1["y"] - cam0["y"]) > 5
    page.evaluate("() => window.KidsTest.setZoom(0.75)")


def test_kids_mute_toggle(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.click('.kidsub[data-kidsub="stage"]')
    initial = page.evaluate("() => window.KidsTest.isMuted()")
    page.click("#kids-mute")
    assert page.evaluate("() => window.KidsTest.isMuted()") is (not initial)
    page.click("#kids-mute")
    assert page.evaluate("() => window.KidsTest.isMuted()") is initial


def test_kids_town_rank_grows(page, live_server):
    page.goto(live_server)
    page.click('.tab[data-tab="kids"]')
    page.evaluate("() => { window.KidsTest.clearScene(); window.KidsTest.spawnMany(6); }")
    text = page.locator("#kids-count").inner_text()
    assert "6ひき" in text
    assert "まち" in text
    page.evaluate("() => window.KidsTest.clearScene()")


def test_tab_navigation(page, live_server):
    page.goto(live_server)
    for tab, panel in [("profiles", "panel-profiles"), ("password", "panel-password"),
                       ("speed", "panel-speed"), ("diagnose", "panel-diagnose"),
                       ("usage", "panel-usage"), ("kids", "panel-kids"), ("wifi", "panel-wifi")]:
        page.click(f'.tab[data-tab="{tab}"]')
        assert page.locator(f"#{panel}").is_visible()
