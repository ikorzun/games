#!/usr/bin/env python3
"""Больной сон на бумаге: снимки на стены, обрывки на пол, наклейки и смазанный портрет (партнёр 19.11).

Запуск:  python3 -I scripts/papers_dream.py <папка с картинками> [--check <лист.jpg>]

Картинки сгенерированы GPT Image по промптам из assets/papers/dream_prompts.md: снимки — заново 21.11, «как с iPhone 4»,
через ключ OpenAI партнёра; наклейки, обрывки и портрет — 19.11, через Higgsfield. В репозиторий исходники не кладутся. В папке они должны называться так:
    stickers_1.png, stickers_2.png          два листа наклеек, по 4 × 3 квадратика на белом;
    dream_<id>.png или <id>.png              снимки (id — из DREAM_PRINTS в src/world/papers.ts без «dream_»);
    scrap_<id>.png                           обрывки на прозрачном фоне;
    portrait.png                             портрет женщины в тёмном платье со смазанным лицом.

Что получается (слои 720 × 1280, как у остальной бумаги; раскладка — та же, что в src/world/papers.ts):
    stickers.webp   23 картинки наклеек 180 × 180 сеткой по 4 (палец с красной ниткой не взят: читается
                    как неприличный жест);
    dream_a.webp    12 снимков 240 × 320 сеткой 3 × 4, у каждого светлое поле, как у отпечатка;
    dream_b.webp    ещё два снимка сверху и четыре обрывка ниже, по 360 × 400; вокруг обрывков слой
                    прозрачный — шейдер не рисует прозрачное, и обрывок лежит на полу по рваному краю;
    faces_a.webp    в нём заменяется большой портрет (тот же прямоугольник, что face_big), а маска лиц
                    там снимается: лицо уже смазано на самой картинке, размывать его ещё раз не нужно.

Запускать после scripts/papers_import.py: тот пересобирает faces_a из снимка партнёра заново.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from print_look import old_photo, print_look  # noqa: E402

W, H = 720, 1280
QUALITY = 82
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'papers'

STICKER_CELL = 180
# Лист 2, второй ряд, третий: палец с красной ниткой — издали читается как неприличный жест.
STICKER_SKIP = {('stickers_2', 6)}

DREAM_W, DREAM_H = 240, 320
# Поле отпечатка, px слоя (8 из 240 — у снимка в 24 см около 8 мм), и его цвет — старая фотобумага.
DREAM_EDGE = 8
DREAM_PAPER = (226, 221, 208)
# Снимки тёмные — ночь, зима, лампа: тени поднимаются кривой, иначе на стене при свете места это тёмные прямоугольники, где
# видна одна лампа. С кадрами «как с iPhone 4» (партнёр 21.11, 21:29) кривая мягче — 0,85 вместо 0,7: вспышка уже высвечивает
# ближнее, а крутая кривая вытаскивает цветной шум тёмных кадров (куратор, V-58).
DREAM_GAMMA = 0.85
# Цвет приглушён, как у остальной бумаги («приглушённый цвет с одним тёплым пятном», design.md §34): у телефонных кадров он
# вдвое сочнее, и на стене рядом с карточками они выглядели бы чужими.
DREAM_SATURATION = 0.72
# Какая часть снимка идёт в отпечаток (доли кадра x, y, w, h): у мелкой детали — ближе к ней, иначе на 24 см она не читается
# (куратор, V-58: ртуть за шкалой, две вмятины, фигура в чайнике, пустой циферблат). Остальные — середина 3 : 4.
DREAM_CROP = {
    'thermo': (0.0, 0.2, 0.82, 0.73),
    'bed': (0.1, 0.0, 0.84, 0.75),
    'kettle': (0.3, 0.22, 0.7, 0.62),
    'clock': (0.38, 0.28, 0.58, 0.52),
}
DREAM_A = ['thermo', 'window', 'phone', 'iron', 'milk', 'bed', 'corridor', 'frost', 'clock', 'ticket', 'drawing', 'xray']
DREAM_B = [('stairs', 0, 0), ('kettle', 240, 0)]

SCRAP_W, SCRAP_H = 360, 400
SCRAPS = [('photo', 0, 320), ('plan', 360, 320), ('calendar', 0, 720), ('ecg', 360, 720)]

# Большой портрет в faces_a: тот же прямоугольник, что face_big в src/world/papers.ts.
PORTRAIT = (289, 356, 412, 545)
# Полоса у края прямоугольника, где маска лиц остаётся прежней: там край соседних карточек.
PORTRAIT_KEEP = 10


def find(src: Path, *names: str) -> Path:
    for n in names:
        p = src / f'{n}.png'
        if p.exists():
            return p
    sys.exit(f'нет картинки: {names[0]}.png в {src}')


def runs(mask: np.ndarray, least: int) -> list[tuple[int, int]]:
    """Отрезки подряд идущих True длиной не меньше least: [начало, конец)."""
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= least:
                out.append((start, i))
            start = None
    return out


def sticker_tiles(path: Path) -> list[Image.Image]:
    """Квадратики листа наклеек по белым промежуткам: столбец или строка почти целиком белые — промежуток."""
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    white = (a > 232).all(axis=2)
    cols = runs(white.mean(axis=0) < 0.9, 60)
    rows = runs(white.mean(axis=1) < 0.9, 60)
    if len(cols) != 4 or len(rows) != 3:
        sys.exit(f'{path.name}: ждали сетку 4 × 3, нашли {len(cols)} × {len(rows)}')
    tiles = []
    for y0, y1 in rows:
        for x0, x1 in cols:
            # Край квадратика сглажен в белое — поджать на 4 px; потом середина квадратом.
            x0, y0b, x1, y1b = x0 + 4, y0 + 4, x1 - 4, y1 - 4
            side = min(x1 - x0, y1b - y0b)
            cx, cy = (x0 + x1) // 2, (y0b + y1b) // 2
            box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
            tiles.append(im.crop(box).resize((STICKER_CELL, STICKER_CELL), Image.LANCZOS))
    return tiles


def layer_stickers(src: Path) -> Image.Image:
    out = Image.new('RGBA', (W, H), (196, 187, 164, 255))
    tiles = []
    for name in ('stickers_1', 'stickers_2'):
        for i, t in enumerate(sticker_tiles(find(src, name))):
            if (name, i) not in STICKER_SKIP:
                tiles.append(t)
    if len(tiles) != 23:
        sys.exit(f'наклеек {len(tiles)}, а в игре их 23 (STICKER_TILES в src/world/papers.ts)')
    for t, tile in enumerate(tiles):
        out.paste(tile, ((t % 4) * STICKER_CELL, (t // 4) * STICKER_CELL))
    return out


def print_card(path: Path, key: str = '') -> Image.Image:
    """Снимок как отпечаток: картинка 3 : 4 (по середине или по DREAM_CROP), вокруг — поле старой фотобумаги."""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    crop = DREAM_CROP.get(key)
    if crop:
        x, y, cw, ch = crop
        box = (round(x * w), round(y * h), round((x + cw) * w), round((y + ch) * h))
        im = im.crop(box)
        w, h = im.size
    if w / h > 3 / 4:
        cw = round(h * 3 / 4)
        im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    else:
        ch = round(w * 4 / 3)
        im = im.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
    im = ImageEnhance.Color(im).enhance(DREAM_SATURATION)
    lut = [round(255 * (v / 255) ** DREAM_GAMMA) for v in range(256)]
    im = im.resize((DREAM_W - 2 * DREAM_EDGE, DREAM_H - 2 * DREAM_EDGE), Image.LANCZOS).point(lut * 3)
    card = Image.new('RGB', (DREAM_W, DREAM_H), DREAM_PAPER)
    card.paste(im, (DREAM_EDGE, DREAM_EDGE))
    return card


def scrap_photo(path: Path, src: Path) -> Image.Image:
    """Обрывок фотографии — из того же снимка «как с iPhone 4», что висит на стене (рука на замёрзшем стекле): прежняя картинка
    нейросети снимала его другим «аппаратом» (куратор, V-58). Форма обрывка и рваный край с волокнами бумаги — прежние."""
    old = Image.open(path).convert('RGBA')
    a = old.split()[3]
    ys, xs = np.nonzero(np.asarray(a) > 8)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    frost = Image.open(find(src, 'dream_frost', 'frost')).convert('RGB')
    fw, fh = frost.size
    # Середина снимка с ладонью — в рамку обрывка.
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    k = max(bw / fw, bh / (fh * 0.7))
    sw, sh = round(fw * k), round(fh * k)
    shot = frost.resize((sw, sh), Image.LANCZOS)
    ox, oy = (sw - bw) // 2, round(sh * 0.15)
    rgb = Image.new('RGB', old.size, (0, 0, 0))
    rgb.paste(shot.crop((ox, oy, ox + bw, oy + bh)), (x0, y0))
    rgb = ImageEnhance.Color(rgb).enhance(DREAM_SATURATION)
    lut = [round(255 * (v / 255) ** DREAM_GAMMA) for v in range(256)]
    rgb = rgb.point(lut * 3)
    # Рваный край (полоса у прозрачного) — прежний: там волокна бумаги.
    inner = a.filter(ImageFilter.MinFilter(15))
    band = np.asarray(a).astype(np.int16) - np.asarray(inner).astype(np.int16) > 40
    out = np.asarray(rgb).copy()
    out[band] = np.asarray(old.convert('RGB'))[band]
    im = Image.fromarray(out).convert('RGBA')
    im.putalpha(a)
    return im


def scrap_cell(path: Path, src: Path | None = None) -> Image.Image:
    """Обрывок по его непрозрачной части — в клетку 360 × 400 с полем 4 px, с сохранением пропорций."""
    if src is not None and path.stem == 'scrap_photo':
        im = scrap_photo(path, src)
    else:
        # Бумажки (план, листок календаря, лента ЭКГ) — с настоящей печатью и зерном бумаги, без гладкости нейросети.
        im = print_look(Image.open(path).convert('RGBA'), 'paper', seed=len(path.stem))
    a = np.asarray(im)[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    if len(xs) == 0:
        sys.exit(f'{path.name}: картинка целиком прозрачная')
    im = im.crop((max(0, xs.min() - 2), max(0, ys.min() - 2), min(im.width, xs.max() + 3), min(im.height, ys.max() + 3)))
    k = min((SCRAP_W - 8) / im.width, (SCRAP_H - 8) / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    cell = Image.new('RGBA', (SCRAP_W, SCRAP_H), (0, 0, 0, 0))
    cell.paste(im, ((SCRAP_W - im.width) // 2, (SCRAP_H - im.height) // 2))
    return cell


def layer_dream_a(src: Path) -> Image.Image:
    out = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    for i, n in enumerate(DREAM_A):
        out.paste(print_card(find(src, f'dream_{n}', n), n), ((i % 3) * DREAM_W, (i // 3) * DREAM_H))
    return out


def layer_dream_b(src: Path) -> Image.Image:
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for n, x, y in DREAM_B:
        out.paste(print_card(find(src, f'dream_{n}', n), n).convert('RGBA'), (x, y))
    for n, x, y in SCRAPS:
        out.paste(scrap_cell(find(src, f'scrap_{n}'), src), (x, y))
    return out


def patch_portrait(src: Path) -> Image.Image:
    """faces_a с новым большим портретом; маска лиц в его прямоугольнике снята (кроме полосы у края)."""
    layer = Image.open(OUT / 'faces_a.webp').convert('RGBA')
    x, y, w, h = PORTRAIT
    # Старый отпечаток: серебряное зерно, мягкость, пыль — не гладкая картинка нейросети (квиз 21.11, ночь).
    por = old_photo(Image.open(find(src, 'portrait')).convert('RGB')).resize((w, h), Image.LANCZOS)
    rgb = layer.convert('RGB')
    rgb.paste(por, (x, y))
    alpha = np.asarray(layer.split()[3]).copy()
    k = PORTRAIT_KEEP
    alpha[y + k:y + h - k, x + k:x + w - k] = 255
    out = rgb.convert('RGBA')
    out.putalpha(Image.fromarray(alpha))
    return out


def save(im: Image.Image, name: str) -> None:
    path = OUT / f'{name}.webp'
    # alpha_quality 100: альфа без потерь (у faces_a это маска лиц, у dream_b — рваный край обрывков).
    if im.mode == 'RGBA' and np.asarray(im)[:, :, 3].min() == 255:
        im = im.convert('RGB')
    # Наклейки печатные — с растром и сдвигом красок, мелочи много; 72 держит их в бюджете ядра сборки.
    im.save(path, 'WEBP', quality=72 if name == 'stickers' else QUALITY, method=6, alpha_quality=100)
    print(f'{path.relative_to(OUT.parent.parent)}  {path.stat().st_size // 1024} КБ')


def check_sheet(layers: dict[str, Image.Image], dest: Path) -> None:
    """Проверочный лист: слои рядом, прозрачное — клеткой."""
    s = 360
    sheet = Image.new('RGB', (s * len(layers), round(s * H / W) + 20), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(layers.items()):
        small = im.convert('RGBA').resize((s, round(s * H / W)), Image.LANCZOS)
        bg = Image.new('RGBA', small.size, (120, 120, 120, 255))
        cd = ImageDraw.Draw(bg)
        for yy in range(0, small.height, 12):
            for xx in range(0, small.width, 12):
                if (xx // 12 + yy // 12) % 2:
                    cd.rectangle((xx, yy, xx + 11, yy + 11), fill=(90, 90, 90, 255))
        bg.alpha_composite(small if name != 'faces_a' else small.convert('RGB').convert('RGBA'))
        sheet.paste(bg.convert('RGB'), (i * s, 20))
        d.text((i * s + 6, 4), name, fill=(240, 240, 240))
    sheet.save(dest, quality=88)
    print(f'проверочный лист: {dest}')


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0].startswith('-'):
        sys.exit(__doc__)
    src = Path(args[0])
    layers = {
        'stickers': layer_stickers(src),
        'dream_a': layer_dream_a(src),
        'dream_b': layer_dream_b(src),
        'faces_a': patch_portrait(src),
    }
    for name, im in layers.items():
        save(im, name)
    if '--check' in args:
        check_sheet(layers, Path(args[args.index('--check') + 1]))


if __name__ == '__main__':
    main()
