#!/usr/bin/env python3
"""Режет лист из кадров в сетке (светлые поля между кадрами) на отдельные кадры.

  python3 tools/cut_grid.py лист.png 3 3 img/cast c0101,c0102,…

Кадры идут слева направо, сверху вниз; имён столько же, сколько клеток. Нужен Pillow.
Если сетка на листе не та, скрипт останавливается и ничего не пишет.
"""
import sys
from PIL import Image


def spans(profile, limit, min_len):
    """Отрезки, где среднее по строке или столбцу темнее поля листа."""
    res, start = [], None
    for i, v in enumerate(profile + [255]):
        dark = v < limit
        if dark and start is None:
            start = i
        if not dark and start is not None:
            if i - start >= min_len:
                res.append((start, i))
            start = None
    return res


def main():
    src, cols, rows, out, names = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5].split(',')
    im = Image.open(src).convert('RGB')
    w, h = im.size
    grey = im.convert('L')
    board = grey.getpixel((3, 3))                              # поле листа — его левый верхний угол
    limit = board - 14
    col_profile = list(grey.resize((w, 1), Image.BOX).tobytes())
    xs = spans(col_profile, limit, w // (cols * 3))
    row_profile = list(grey.resize((1, h), Image.BOX).tobytes())
    ys = spans(row_profile, limit, h // (rows * 3))
    if len(xs) != cols or len(ys) != rows or len(names) != cols * rows:
        sys.exit(f'сетка не {cols}×{rows}: столбцов {len(xs)}, строк {len(ys)}, имён {len(names)}')
    n = 0
    for (y0, y1) in ys:
        for (x0, x1) in xs:
            frame = im.crop((x0 + 4, y0 + 4, x1 - 4, y1 - 4))      # без рамки кадра
            frame.save(f'{out}/{names[n]}.webp', 'WEBP', quality=86, method=6)
            print(names[n], frame.size)
            n += 1


if __name__ == '__main__':
    main()
