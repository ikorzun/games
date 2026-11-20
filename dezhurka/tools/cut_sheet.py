#!/usr/bin/env python3
"""Режет лист-«опознание» (сетка 2×4, белые просветы между кадрами) на кадры для режима «фото».

  python3 tools/cut_sheet.py img/draft/sheet.webp img/draft

Порядок кадров на листе слева направо, сверху вниз: c01…c07, последний — пустой вестибюль (lobby).
Нужен Pillow. Если модель нарисовала не сетку 2×4, скрипт останавливается и ничего не пишет.
"""
import sys
from PIL import Image

NAMES = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'lobby']


def spans(n, is_white):
    """Отрезки не-белых строк или столбцов длиннее 40 px."""
    res, start = [], None
    for i in range(n):
        white = is_white(i)
        if not white and start is None:
            start = i
        if white and start is not None:
            res.append((start, i))
            start = None
    if start is not None:
        res.append((start, n))
    return [s for s in res if s[1] - s[0] > 40]


def main(src, out):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    cols = spans(w, lambda x: sum(1 for y in range(0, h, 4) if min(px[x, y]) > 232) / (h / 4) > 0.9)
    rows = spans(h, lambda y: sum(1 for x in range(0, w, 4) if min(px[x, y]) > 232) / (w / 4) > 0.9)
    if len(cols) != 2 or len(rows) != 4:
        sys.exit(f'сетка не 2×4: столбцов {len(cols)}, строк {len(rows)}')
    k = 0
    for y0, y1 in rows:
        for x0, x1 in cols:
            cell = im.crop((x0 + 1, y0 + 1, x1 - 1, y1 - 1))
            cell.save(f'{out}/{NAMES[k]}.webp', 'WEBP', quality=82, method=6)
            print(NAMES[k], cell.size)
            k += 1


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
