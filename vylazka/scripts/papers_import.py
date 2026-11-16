#!/usr/bin/env python3
"""Листы «бумаги» из фотографий партнёра: вырезки складываются в слои 720×1280 для игры.

Запуск:  python3 -I scripts/papers_import.py <папка с исходными снимками> [--pylib <папка>] [--check <лист.jpg>]

Исходные снимки в репозиторий не кладутся; в папке они должны называться p2.jpg … p8.jpg — в том
порядке, в каком партнёр их прислал 15.11.2026 (p1 — стена чемоданов: она в игре объёмная, картинка не
нужна; p7 не используется вовсе). Что откуда вырезано и почему часть кадра не взята — assets/papers/README.md.

Координаты вырезок — в долях исходного кадра (x0, y0, x1, y1), чтобы не зависеть от его размера.
Раскладка слоя — в пикселях слоя; те же числа стоят в src/world/papers.ts (PAPER_LIST).

Лица. У слоёв портретов (faces_*) в альфа-канале лежит маска лиц: 255 — лица нет, 128 — середина лица.
По ней шейдер размывает вблизи только лицо, а одежда, поза и фон студии остаются (в игре «лица не
сохранились»). Лица ищет OpenCV (каскады Хаара, локально, снимки никуда не отправляются):
    pip install --target <папка> "opencv-python-headless<5"      # в сборках 5.x каскадов нет
и передать эту папку через --pylib. Крупные лица размечены вручную (FACES_BY_HAND): их нельзя пропустить,
а на листе крупных карточек каскад находит больше мнимых лиц, чем настоящих.

Затёртое. Имён и марок в игре нет: штамп ателье под крупным портретом, обращение в рукописном письме и
обрывок автомобильной марки закрашены (CLONE, SOFTEN). Мелкие оттиски ателье на паспарту остались в
файлах слоёв, но в игре не читаются: издали они меньше точки экрана, а вблизи лист портретов размыт.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 1280
QUALITY = 80

# слой → список (исходник, вырезка в долях кадра, место в слое x, y, w, h)
LAYERS = {
    'faces_a': [('p2', (0, 0, 1, 1), (0, 0, 720, 1280))],
    'faces_b': [('p5', (0, 0, 1, 1), (0, 0, 720, 1280))],
    'faces_c': [('p8', (0, 0, 1, 1), (0, 0, 720, 1280))],
    # Деньги и облигации: левая часть кадра; правее — купюры, которые ещё в ходу, и снимок моряков.
    'money': [('p3', (0, 0.505, 0.4929, 1), (0, 0, 720, 1280))],
    # Городские деньги: без верхней четверти кадра (марки оккупационных властей и военные снимки).
    'notgeld': [('p6', (0, 0.2725, 1, 1), (0, 0, 720, 930))],
    # Лента акций и облигаций: правый край кадра.
    'bonds': [('p4', (0.5933, 0, 1, 1), (0, 0, 293, 1280))],
    # Карта: до рамки листа — без полей с масштабом и названием издательства.
    'map_union': [('p3', (0, 0, 0.580, 0.466), (0, 0, 720, 1027))],
}

# Слои портретов: у них маска лиц в альфа-канале.
FACE_LAYERS = ('faces_a', 'faces_b', 'faces_c')

# Крупные лица, отмеченные вручную: слой → (cx, cy, rx, ry) в пикселях слоя.
FACES_BY_HAND = {
    'faces_a': [(498, 556, 84, 112)],
    'faces_b': [(8, 185, 34, 48), (708, 150, 22, 28), (700, 725, 26, 34)],
    'faces_c': [(346, 604, 46, 60), (292, 50, 22, 27), (373, 18, 22, 27), (666, 569, 19, 23), (373, 1131, 40, 44), (707, 1138, 28, 38), (7, 597, 30, 60), (14, 1159, 24, 30)],
}

# Закрасить соседней бумагой: слой → (x0, y0, x1, y1 — что закрыть; dx, dy — откуда взять заплату).
CLONE = {
    # Штамп ателье под портретом в круглой рамке: фамилия фотографа и город.
    'faces_c': [((182, 940, 324, 976), (0, -42))],
}

# Размыть до нечитаемости: слой → (x0, y0, x1, y1, радиус).
SOFTEN = {
    # Рукописное письмо с обращением по имени; обрывок автомобильной марки на борту грузовика.
    'faces_a': [((636, 968, 720, 1064), 2.6), ((444, 1030, 496, 1058), 3.0)],
}

# Части слоёв, которые в игре висят отдельно, в рамах (id, слой, x, y, w, h) — для проверочного листа.
PARTS = [
    ('face_big', 'faces_a', 289, 356, 412, 545),
    ('face_round', 'faces_c', 161, 395, 373, 583),
    ('face_pair', 'faces_c', 163, 0, 377, 387),
    ('bond_a', 'bonds', 0, 0, 293, 384),
    ('bond_b', 'bonds', 0, 390, 293, 189),
    ('bond_c', 'bonds', 0, 694, 293, 260),
    ('bond_d', 'bonds', 0, 960, 187, 150),
    ('bond_e', 'bonds', 0, 1117, 219, 163),
]


# Во сколько раз увеличить слой перед поиском лиц и какой наибольший размер лица брать (px слоя): на
# стене мелких карточек лица мельче, чем берёт каскад; крупнее заданного каскад находит только мнимые.
FACE_SEARCH = {'faces_a': (3, 46), 'faces_b': (2, 60)}


def find_faces(name: str, layer: Image.Image, cv2, np) -> list:
    """Лица на слое: (cx, cy, rx, ry) в пикселях слоя. Слой, которого нет в FACE_SEARCH, размечен только вручную."""
    if name not in FACE_SEARCH:
        return []
    k, largest = FACE_SEARCH[name]
    big = layer.resize((layer.width * k, layer.height * k), Image.LANCZOS)
    gray = cv2.equalizeHist(cv2.cvtColor(np.asarray(big), cv2.COLOR_RGB2GRAY))
    found = []
    root = cv2.data.haarcascades
    for cname, neighbours in (('haarcascade_frontalface_default.xml', 4), ('haarcascade_frontalface_alt.xml', 2), ('haarcascade_frontalface_alt2.xml', 2), ('haarcascade_profileface.xml', 4)):
        cascade = cv2.CascadeClassifier(root + cname)
        views = [(gray, False)] + ([(cv2.flip(gray, 1), True)] if 'profile' in cname else [])
        for img, flipped in views:
            for x, y, w, h in cascade.detectMultiScale(img, scaleFactor=1.05, minNeighbors=neighbours, minSize=(22, 22), maxSize=(largest * k, largest * k)):
                if flipped:
                    x = img.shape[1] - x - w
                # Рамка каскада — от бровей до подбородка; лицо с волосами чуть выше и уже.
                found.append(((x + w / 2) / k, (y + h * 0.46) / k, w * 0.56 / k, h * 0.7 / k))
    return found


def face_mask(size, faces) -> Image.Image:
    """Маска лиц: 255 — лицо, 0 — нет; края мягкие."""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    for cx, cy, rx, ry in faces:
        draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    soft = mask.filter(ImageFilter.GaussianBlur(3))
    # Мягкий край не должен съедать само лицо: внутри эллипса маска остаётся полной.
    return Image.composite(mask, soft, mask.point(lambda v: 255 if v > 200 else 0))


def patch(layer: Image.Image, name: str) -> None:
    for (x0, y0, x1, y1), (dx, dy) in CLONE.get(name, []):
        src = layer.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy))
        feather = Image.new('L', src.size, 0)
        ImageDraw.Draw(feather).rectangle((4, 4, src.width - 5, src.height - 5), fill=255)
        layer.paste(src, (x0, y0), feather.filter(ImageFilter.GaussianBlur(3)))
    for (x0, y0, x1, y1), radius in SOFTEN.get(name, []):
        box = layer.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius))
        feather = Image.new('L', box.size, 0)
        ImageDraw.Draw(feather).rectangle((3, 3, box.width - 4, box.height - 4), fill=255)
        layer.paste(box, (x0, y0), feather.filter(ImageFilter.GaussianBlur(2)))


def build(src: Path, cv2=None, np=None) -> tuple:
    layers, masks = {}, {}
    for name, pieces in LAYERS.items():
        layer = None
        for photo, (x0, y0, x1, y1), (lx, ly, lw, lh) in pieces:
            im = Image.open(src / f'{photo}.jpg').convert('RGB')
            crop = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
            crop = crop.resize((lw, lh), Image.LANCZOS)
            if layer is None:
                # Пустые поля слоя — средним цветом первой вырезки: на уменьшенных копиях края не темнеют.
                layer = Image.new('RGB', (W, H), crop.resize((1, 1), Image.BOX).getpixel((0, 0)))
            layer.paste(crop, (lx, ly))
        if name in FACE_LAYERS:
            # Лица ищем до заплат: заплаты их не трогают, а размытое письмо каскад примет за что угодно.
            faces = find_faces(name, layer, cv2, np) + FACES_BY_HAND.get(name, [])
            masks[name] = face_mask(layer.size, faces)
            print(f'{name}: лиц отмечено {len(faces)}')
        patch(layer, name)
        layers[name] = layer
    return layers, masks


def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    if '--pylib' in args:
        sys.path.insert(0, args[args.index('--pylib') + 1])
    try:
        import cv2
        import numpy as np
    except ImportError as err:
        raise SystemExit(f'нужен OpenCV с каскадами Хаара (см. начало файла): {err}')
    if not hasattr(cv2, 'CascadeClassifier'):
        raise SystemExit('в этой сборке OpenCV нет каскадов Хаара: нужна версия ниже 5')
    src = Path(args[0])
    layers, masks = build(src, cv2, np)
    dst = Path(__file__).resolve().parent.parent / 'assets' / 'papers'
    dst.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, layer in layers.items():
        path = dst / f'{name}.webp'
        out = layer
        if name in masks:
            # Альфа: 255 — лица нет, 128 — середина лица. Ниже 128 не опускается: canvas хранит цвет
            # умноженным на альфу, и при малой альфе цвет под маской потерял бы точность.
            out = layer.convert('RGBA')
            out.putalpha(masks[name].point(lambda v: 255 - round(v * 127 / 255)))
        out.save(path, 'WEBP', quality=QUALITY, method=6)
        total += path.stat().st_size
        print(f'{name}.webp  {path.stat().st_size // 1024} КБ')
    print(f'всего {total // 1024} КБ, слоёв {len(layers)}')
    if '--check' in args:
        # Проверочный лист: все слои в ряд; части в рамах обведены, лица залиты красным.
        sheet = Image.new('RGB', (len(layers) * (W + 10) + 10, H + 20), (20, 20, 20))
        for i, (name, layer) in enumerate(layers.items()):
            pic = layer.copy()
            if name in masks:
                pic = Image.composite(Image.new('RGB', pic.size, (255, 40, 40)), pic, masks[name].point(lambda v: v * 150 // 255))
            d = ImageDraw.Draw(pic)
            for pid, lname, x, y, w, h in PARTS:
                if lname == name:
                    d.rectangle((x, y, x + w - 1, y + h - 1), outline=(60, 160, 255), width=3)
                    d.text((x + 6, y + 4), pid, fill=(60, 160, 255))
            sheet.paste(pic, (10 + i * (W + 10), 10))
        sheet.save(args[args.index('--check') + 1], quality=85)


if __name__ == '__main__':
    main()
