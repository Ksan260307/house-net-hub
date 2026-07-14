"""
アプリアイコン生成スクリプト（PWA / iPadホーム画面用）
=====================================================
くすみカラーのシグナルバー（📶）アイコンを生成する。
    python tools/make_icons.py
"""

import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "icons")
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size, rounded=True, pad_ratio=0.0):
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景（ダスティサージュの縦グラデーション）
    top, bot = (154, 168, 143), (120, 134, 108)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bot, y / S))

    # 角丸マスク
    if rounded:
        mask = Image.new("L", (S, S), 0)
        md = ImageDraw.Draw(mask)
        r = int(S * 0.22)
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
        img.putalpha(mask)

    # シグナルバー（白、4本の上り階段）
    bar_w = int(S * 0.12)
    gap = int(S * 0.055)
    base_y = int(S * 0.72)
    x = int(S * 0.24)
    heights = [0.16, 0.28, 0.40, 0.52]
    white = (255, 253, 248, 255)
    for h in heights:
        top_y = int(base_y - S * h)
        d.rounded_rectangle([x, top_y, x + bar_w, base_y], radius=int(bar_w * 0.3), fill=white)
        x += bar_w + gap

    # 小さな太陽（右上のアクセント）
    d.ellipse([int(S * 0.70), int(S * 0.16), int(S * 0.82), int(S * 0.28)], fill=(251, 231, 166, 255))

    if pad_ratio > 0:
        # maskable用に安全余白を確保（内容を中央に縮小）
        inner = int(S * (1 - pad_ratio))
        small = img.resize((inner, inner), Image.LANCZOS)
        bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d2 = ImageDraw.Draw(bg)
        for y in range(S):
            d2.line([(0, y), (S, y)], fill=lerp(top, bot, y / S) + (255,))
        if rounded:
            bg.putalpha(mask)
        off = (S - inner) // 2
        bg.alpha_composite(small, (off, off))
        img = bg

    return img.resize((size, size), Image.LANCZOS)


def make_opaque(size):
    img = make_icon(size, rounded=False)
    bg = Image.new("RGB", (size, size), (127, 142, 108))
    bg.paste(img, (0, 0), img)
    return bg


make_icon(192).save(os.path.join(OUT, "icon-192.png"))
make_icon(512).save(os.path.join(OUT, "icon-512.png"))
make_icon(512, pad_ratio=0.2).save(os.path.join(OUT, "icon-maskable-512.png"))
make_opaque(180).save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written to", OUT)
for f in sorted(os.listdir(OUT)):
    print(" -", f)
