#!/usr/bin/env python3
"""Карточка обрывка метаслоя в записи: держать её на экране и медленно наехать на неё.

Карточка — DOM поверх игры, живёт по настоящему времени страницы (держится 4–8 с), а запись идёт по кадру за несколько секунд:
в записанном ролике она мелькает в паре кадров. Скрипт берёт кадр, где она видна целиком, и накладывает её прямоугольник на
следующие кадры (4,5 с и полсекунды угасания), а затем медленно наезжает на неё камерой (×1,5) — чтобы строку читали и с телефона.

Запуск:  python3 -I tools/video/hold_card.py <папка сцены> <папка результата> <кадр с карточкой> <кадр без неё>
"""
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HOLD, FADE = 135, 15
ZOOM, ZOOM_FROM, ZOOM_TO = 1.5, -7, 133

src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
shown, before = int(sys.argv[3]), int(sys.argv[4])
if out_dir.exists():
    shutil.rmtree(out_dir)
shutil.copytree(src_dir, out_dir)

card_im = Image.open(src_dir / f'{shown:04d}.png').convert('RGB')
card = np.asarray(card_im).astype(np.float32)
g = np.asarray(card_im.convert('L')).astype(np.float32)
# Карточка — тёмный прямоугольник на светлом лимбо, в средней части кадра.
win = g[150:500, 350:950]
ys, xs = np.nonzero(win < 70)
x0, x1, y0, y1 = xs.min() + 350, xs.max() + 350, ys.min() + 150, ys.max() + 150
m = Image.new('L', card_im.size, 0)
ImageDraw.Draw(m).rounded_rectangle((x0 - 2, y0 - 2, x1 + 2, y1 + 2), radius=12, fill=255)
ma = np.asarray(m.filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
start = shown - 2
frames = sorted(out_dir.glob('*.png'))
for p in frames:
    i = int(p.stem)
    k = i - start
    if k < ZOOM_FROM:
        continue
    im = Image.open(p).convert('RGB')
    if 0 <= k < HOLD + FADE:
        fr = np.asarray(im).astype(np.float32)
        a = ma * (1.0 if k < HOLD else max(0.0, 1 - (k - HOLD + 1) / FADE))
        im = Image.fromarray(np.clip(fr * (1 - a[:, :, None]) + card * a[:, :, None], 0, 255).astype(np.uint8))
    t = min(1.0, max(0.0, (k - ZOOM_FROM) / (ZOOM_TO - ZOOM_FROM)))
    e = t * t * (3 - 2 * t)
    z = 1 + (ZOOM - 1) * e
    w, h = im.width / z, im.height / z
    bx = min(max(0, cx - w / 2), im.width - w)
    by = min(max(0, cy - h / 2), im.height - h)
    im.resize(im.size, Image.LANCZOS, box=(bx, by, bx + w, by + h)).save(p)
print(f'карточка {x0}–{x1} × {y0}–{y1}, держится с кадра {start}')
