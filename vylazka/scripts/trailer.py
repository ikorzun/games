#!/usr/bin/env python3
"""Собрать ролик о сути игры из кадров e2e/trailer.mjs: подписи, название, mp4.

    node e2e/trailer.mjs record        # кадры в e2e/out/trailer и marks.json
    python3 scripts/trailer.py [куда.mp4]

Нужны Pillow и ffmpeg. Подписи — голосом игры, по-английски: так она говорит с игроком.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'e2e', 'out', 'trailer')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'e2e', 'out', 'untitled_session_15s.mp4')
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
FPS = 30
# Зерно облака точек сжимается плохо: при 19 ролик весит 40 МБ, при 27 — около 9, на глаз разница мала.
CRF = '27'
INK = (236, 232, 218)

# Подпись появляется с отметки из marks.json (со сдвигом в кадрах) и держится до следующей подписи.
CAPTIONS = [
    ('on', 0, 'the light holds the place together.'),
    ('touch', -14, 'nothing here can be touched.'),
    ('off', 0, 'light off. light on. it comes back. not the same.'),
    ('office', 0, 'stand still, and the place lets go.'),
    ('yellow', 0, 'what the place forgot, a screen still shows.'),
]
TITLE = 'UNTITLED SESSION'
TAGLINE = ['a walk through a memory', 'that exists while you light it']


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def main():
    with open(os.path.join(SRC, 'marks.json'), encoding='utf-8') as f:
        m = json.load(f)
    first = Image.open(os.path.join(SRC, '0000.png'))
    w, h = first.size
    k = w / 960
    cap = font(MONO, round(20 * k))
    big = font(BOLD, round(42 * k))
    small = font(MONO, round(19 * k))
    cuts = [(m[name] + shift, text) for name, shift, text in CAPTIONS]
    title, end = m['title'], m['end']
    tmp = tempfile.mkdtemp(prefix='trailer_')
    try:
        for i in range(end):
            im = Image.open(os.path.join(SRC, f'{i:04d}.png')).convert('RGB')
            d = ImageDraw.Draw(im, 'RGBA')
            if cuts[0][0] <= i < title:
                start, text = [c for c in cuts if i >= c[0]][-1]
                nxt = min([c[0] for c in cuts if c[0] > start] + [title])
                # Подпись проступает за шесть кадров после склейки и гаснет за четыре перед следующей.
                a = min(1.0, (i - start + 1) / 6, (nxt - i) / 4)
                tw = d.textlength(text, font=cap)
                x, y = (w - tw) / 2, h - round(64 * k)
                pad = round(9 * k)
                d.rectangle([x - pad * 1.6, y - pad * 0.7, x + tw + pad * 1.6, y + round(26 * k) + pad * 0.5], fill=(0, 0, 0, int(150 * a)))
                d.text((x, y), text, font=cap, fill=INK + (int(255 * a),))
            elif i >= title:
                # Название — поверх живого кадра: он темнеет, экран слева продолжает светиться.
                t = (i - title) / max(1, end - title - 1)
                a = min(1.0, (i - title) / 10)
                im = Image.blend(im, Image.new('RGB', (w, h), (0, 0, 0)), 0.45 * a)
                d = ImageDraw.Draw(im, 'RGBA')
                cx = w * 0.69
                tw = d.textlength(TITLE, font=big)
                d.text((cx - tw / 2, h / 2 - round(52 * k)), TITLE, font=big, fill=INK + (int(255 * a),))
                for j, line in enumerate(TAGLINE):
                    lw = d.textlength(line, font=small)
                    d.text((cx - lw / 2, h / 2 + round(14 * k) + j * round(27 * k)), line, font=small, fill=(176, 172, 160, int(255 * a)))
                # Последние кадры уходят в чёрное.
                out = max(0.0, (t - 0.86) / 0.14)
                if out > 0:
                    im = Image.blend(im, Image.new('RGB', (w, h), (0, 0, 0)), out)
            im.save(os.path.join(tmp, f'{i:04d}.png'))
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', CRF, '-preset', 'slow', '-movflags', '+faststart', OUT],
            check=True,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'{OUT}: {end} кадров, {end / FPS:.1f} с, {os.path.getsize(OUT) / 1e6:.2f} МБ, {w}×{h}')


if __name__ == '__main__':
    main()
