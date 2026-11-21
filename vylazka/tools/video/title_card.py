"""Заставка видео: название собирается из точек (1,6 с), стоит, затем гаснет. Кадры 1280 × 720 PNG, 30 к/с.

Запуск: python3 -I tools/video/title_card.py <папка кадров> <DMMono-300.ttf>
Шрифт — DM Mono Light, как название на заставке игры: src/ui/fonts/DMMono-300-latin.woff2, в ttf переводит fontTools
(TTFont(woff2); flavor = None; save).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
font_path = sys.argv[2]
W, H = 1280, 720
INK = np.array([236, 228, 214], np.float32)
size = 76
font = ImageFont.truetype(font_path, size)
track = round(size * 0.12)
lines = ['UNTITLED', 'SESSION']
mask = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(mask)
widths = [sum(font.getlength(c) for c in l) + track * (len(l) - 1) for l in lines]
lh = round(size * 1.1)
y0 = H // 2 - lh
for i, l in enumerate(lines):
    x = (W - widths[i]) / 2
    for c in l:
        d.text((x, y0 + i * lh), c, font=font, fill=255)
        x += font.getlength(c) + track
m = np.asarray(mask).astype(np.float32) / 255
ys, xs = np.nonzero(m > 0.5)
rng = np.random.default_rng(7)
n = len(xs)
# Точки: цель — пиксель буквы; старт — смещение в сторону и вниз, как пыль, которую подняло светом.
pick = rng.random(n) < 0.35
tx, ty = xs[pick].astype(np.float32), ys[pick].astype(np.float32)
k = len(tx)
ang = rng.uniform(0, 2 * np.pi, k)
dist = rng.gamma(2.0, 40, k)
sx, sy = tx + np.cos(ang) * dist, ty + np.sin(ang) * dist * 0.6 + rng.uniform(0, 60, k)
delay = rng.uniform(0, 0.55, k)
glow = np.asarray(mask.filter(ImageFilter.GaussianBlur(14))).astype(np.float32) / 255

FPS = 30
ASSEMBLE, HOLD, FADE = 48, 75, 24
frames = ASSEMBLE + HOLD + FADE
for f in range(frames):
    img = np.zeros((H, W, 3), np.float32)
    if f < ASSEMBLE:
        t = f / ASSEMBLE
        u = np.clip((t - delay) / (1 - delay.max() + 1e-6), 0, 1)
        e = 1 - (1 - u) ** 3
        px = sx + (tx - sx) * e
        py = sy + (ty - sy) * e
        a = np.clip(u * 1.4, 0, 1)
        acc = np.zeros((H, W), np.float32)
        ix, iy = np.round(px).astype(int), np.round(py).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        np.add.at(acc, (iy[ok], ix[ok]), a[ok])
        acc = np.clip(acc, 0, 1)
        # Под конец сборки буквы проступают целиком.
        solid = np.clip((t - 0.7) / 0.3, 0, 1) ** 2
        lum = np.maximum(acc, m * solid)
        g = glow * 0.25 * t
    else:
        lum = m
        g = glow * 0.25
        if f >= ASSEMBLE + HOLD:
            q = 1 - (f - ASSEMBLE - HOLD) / FADE
            lum = m * q
            g = glow * 0.25 * q
    img += lum[:, :, None] * INK[None, None, :]
    img += g[:, :, None] * np.array([255, 200, 150], np.float32)[None, None, :]
    # Зерно камеры — как во всём видео.
    img += rng.normal(0, 3.0, (H, W, 1))
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out / f'{f:04d}.png')
print('frames', frames)
