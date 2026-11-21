#!/usr/bin/env python3
"""Настоящая печать вместо гладкой картинки нейросети (партнёр 21.11, квиз: переделать «всё, и плакаты тоже» — после «картинки в
воспоминаниях сейчас слишком нейронные»).

Нейросеть рисует плакат и наклейку как рендер: плавные тени, идеально ровная краска, контур и заливка совпадают до пикселя. Плакат
1975 года и дешёвая наклейка 1990-х выглядят иначе: четыре краски растром под разными углами, заливка сдвинута относительно контура
на миллиметр-два, краска ложится неровно и выгорает, сквозь неё видна бумага. Этот модуль делает с готовой картинкой то, что
делала типография, — надписи и рисунок остаются буква в букву (их проверяли глазами), уходит только «нейронная» гладкость.

Режимы:
    offset   плакаты ГО и план убежища — офсет: CMYK-растр, сдвиг красок, выгорание, желтоватая бумага;
    sticker  наклейки — дешёвая печать: краски проще, растр мельче, сдвиг, без выгорания;
    paper    бумажки на полу (календарь, план, лента ЭКГ) — легче: зерно бумаги, неровный накат, чуть выгорело.

    photo    старый отпечаток (портрет в стопке карточек): серебряное зерно, мягкость, сепия, пыль.

Как функция: print_look(img, mode, seed), old_photo(img, seed). Как скрипт:
    python3 -I scripts/print_look.py posters                        плакаты: master/*.webp → файлы игры;
    python3 -I scripts/print_look.py <mode> <вход> <выход> [seed]   один файл.
Случайность — с постоянным зерном: повторный запуск даёт тот же файл.
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Параметры режимов: шаг растра (px на 1024 по ширине), сдвиг красок (px), выгорание, бумага, неровность наката, сила растра.
# levels — сколько ступеней тона у краски: офсет печатал плашками и растровыми тинтами, плавной светотени у него нет.
MODES = {
    'offset': dict(cell=2.6, shift=3.2, fade=0.20, paper=(236, 226, 201), mottle=0.10, screen=0.45, grain=6.0, levels=5, flat=7),
    'sticker': dict(cell=2.2, shift=2.0, fade=0.05, paper=(246, 243, 236), mottle=0.07, screen=0.35, grain=4.0, levels=4, flat=5),
    'paper': dict(cell=2.2, shift=0.8, fade=0.10, paper=(238, 230, 210), mottle=0.07, screen=0.25, grain=5.0, levels=0, flat=0),
}
# Углы растра: голубая 15°, пурпурная 75°, жёлтая 0°, чёрная 45° — как в офсете.
ANGLES = {'c': 15, 'm': 75, 'y': 0, 'k': 45}


def _screen(h: int, w: int, cell: float, angle: float) -> np.ndarray:
    """Растровая сетка: в каждой ячейке — круглая точка; значение — порог, при котором точка закрывает пиксель (0…1)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.deg2rad(angle)
    u = (xx * np.cos(a) + yy * np.sin(a)) / cell
    v = (-xx * np.sin(a) + yy * np.cos(a)) / cell
    fu = u - np.floor(u) - 0.5
    fv = v - np.floor(v) - 0.5
    # Порог так, чтобы доля закрытой точкой площади равнялась покрытию краской (круг площадью π r²).
    return np.clip(np.pi * (fu * fu + fv * fv), 0, 1)


def alpha_mask(img: Image.Image) -> np.ndarray:
    """Непрозрачная часть картинки (для бумаги исходника берём только её)."""
    return np.asarray(img.split()[3]) > 8


def _noise(h: int, w: int, rng: np.random.Generator, scale: float) -> np.ndarray:
    """Плавный шум (неровность наката, пятна выгорания): случайное поле, размытое на scale px, нормированное в −1…1."""
    small = rng.random((max(2, int(h / scale)), max(2, int(w / scale)))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(scale / 4))
    a = np.asarray(im).astype(np.float32) / 255
    return (a - a.mean()) / max(1e-6, a.std()) * 0.33


def print_look(img: Image.Image, mode: str = 'offset', seed: int = 1975, scale: float | None = None) -> Image.Image:
    """scale — сколько пикселей картинки на «пиксель» листа шириной 1024 (по умолчанию ширина / 1024): маленькой наклейке
    задают больше, иначе сдвиг красок и плашки уходят меньше пикселя."""
    p = MODES[mode]
    rng = np.random.default_rng(seed)
    has_alpha = img.mode == 'RGBA'
    alpha = img.split()[3] if has_alpha else None
    rgb = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    h, w = rgb.shape[:2]
    k_scale = scale if scale is not None else w / 1024
    # Бумага исходника — «без краски»: цвет листа (светлейшие 3 % пикселей) приводим к белому, иначе подложка уйдёт в растр.
    lum = rgb.mean(axis=2)
    sel = lum >= np.quantile(lum[alpha_mask(img)] if has_alpha else lum, 0.97)
    paper_src = np.median(rgb[sel], axis=0) if sel.any() else np.ones(3, np.float32)
    rgb = np.clip(rgb / np.maximum(paper_src, 0.5)[None, None, :], 0, 1)
    # Вычитание цвета: RGB → CMYK (простой), чёрная — по самому тёмному.
    k = 1 - rgb.max(axis=2)
    den = np.maximum(1e-4, 1 - k)
    c = (1 - rgb[:, :, 0] - k) / den
    m = (1 - rgb[:, :, 1] - k) / den
    y = (1 - rgb[:, :, 2] - k) / den
    inks = {'c': c, 'm': m, 'y': y, 'k': k}
    mottle = _noise(h, w, rng, 60 * k_scale)
    cell = p['cell'] * k_scale
    out = {}
    for name, cov in inks.items():
        cov = np.clip(cov, 0, 1)
        # Чёрная форма — контур и текст — печатается как есть: тонкие линии и мелкие буквы не трогаем.
        if p['flat'] and name != 'k':
            # Плашки: тон ровный внутри пятна, светотень ступенями (так плакаты делили на цвета руками).
            fl = Image.fromarray((cov * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(int(p['flat'] * k_scale) | 1))
            cov = np.asarray(fl).astype(np.float32) / 255
        if p['levels'] and name != 'k':
            n = p['levels'] - 1
            cov = np.round(cov * n) / n
        # Растр: точка закрывает пиксель, где покрытие выше порога сетки; край точки чуть размыт (краска растекается).
        scr = _screen(h, w, cell, ANGLES[name])
        dots = np.clip((cov - scr) * 6 + 0.5, 0, 1)
        ink = cov * (1 - p['screen']) + dots * p['screen']
        # Неровный накат: где-то краски больше, где-то меньше.
        ink = np.clip(ink * (1 + p['mottle'] * mottle * (2 if name != 'k' else 1)), 0, 1)
        # Сдвиг красок: каждая краска печатается своей формой и встаёт чуть мимо.
        dx, dy = rng.uniform(-1, 1, 2) * p['shift'] * k_scale
        if name == 'k':
            dx, dy = 0.0, 0.0
        sh = Image.fromarray((ink * 255).astype(np.uint8)).transform((w, h), Image.AFFINE, (1, 0, -dx, 0, 1, -dy), Image.BILINEAR)
        out[name] = np.asarray(sh).astype(np.float32) / 255
    # Выгорание: красная и жёлтая слабеют сильнее голубой, чёрная сереет.
    f = p['fade']
    out['m'] *= 1 - f * 1.2
    out['y'] *= 1 - f * 0.9
    out['c'] *= 1 - f * 0.6
    out['k'] *= 1 - f * 0.35
    paper = np.array(p['paper'], np.float32) / 255
    # Бумага: волокно и чуть неровный тон.
    grain = rng.normal(0, p['grain'] / 255, (h, w)).astype(np.float32)
    tone = 1 + 0.03 * _noise(h, w, rng, 200 * k_scale)
    base = np.clip(paper[None, None, :] * tone[:, :, None] + grain[:, :, None], 0, 1)
    # Краски вычитаются из бумаги (как настоящие прозрачные краски).
    r = base[:, :, 0] * (1 - out['c']) * (1 - out['k'])
    g = base[:, :, 1] * (1 - out['m']) * (1 - out['k'])
    b = base[:, :, 2] * (1 - out['y']) * (1 - out['k'])
    res = np.clip(np.stack([r, g, b], axis=2), 0, 1)
    im = Image.fromarray((res * 255 + 0.5).astype(np.uint8))
    if has_alpha:
        im = im.convert('RGBA')
        im.putalpha(alpha)
    return im


def old_photo(img: Image.Image, seed: int = 1903) -> Image.Image:
    """Старый отпечаток (портрет): серебряное зерно, мягкость, сжатые тени и света, неровное выцветание, пыль и волоски."""
    rng = np.random.default_rng(seed)
    im = img.convert('RGB').filter(ImageFilter.GaussianBlur(0.8))
    a = np.asarray(im).astype(np.float32) / 255
    h, w = a.shape[:2]
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    # Тон отпечатка: тени не чёрные, света не белые; сепия чуть неровная.
    t = 0.12 + 0.78 * np.clip(lum, 0, 1) ** 1.1
    t = t * (1 + 0.05 * _noise(h, w, rng, 140 * w / 1024))
    sep = np.array([1.0, 0.9, 0.74], np.float32)
    out = t[:, :, None] * sep[None, None, :] + (1 - sep[None, None, :]) * 0.08
    # Серебряное зерно — крупнее цифрового шума, сильнее в средних тонах.
    g = rng.normal(0, 1, (h // 2 + 1, w // 2 + 1)).astype(np.float32)
    gi = np.asarray(Image.fromarray(((g * 0.5 + 0.5).clip(0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float32) / 255 - 0.5
    out += (gi * 0.09 * (1 - np.abs(t - 0.5) * 1.4))[:, :, None]
    res = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    # Пыль и волоски: светлые точки и тонкие дуги (эмульсия со временем).
    d = ImageDraw.Draw(res)
    for _ in range(int(60 * w * h / 1e6) + 20):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.4, 1.6)
        v = int(rng.uniform(180, 235))
        d.ellipse((x - r, y - r, x + r, y + r), fill=(v, int(v * 0.95), int(v * 0.85)))
    for _ in range(6):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        pts = [(x + rng.normal(0, 18) * i / 4, y + rng.normal(0, 18) * i / 4) for i in range(5)]
        d.line(pts, fill=(200, 192, 170), width=1)
    return res


def posters() -> None:
    """Плакаты ГО и план убежища: master/*.webp (исходник модели) → <id>.webp для игры, с настоящей печатью."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent / 'assets' / 'posters'
    for i, src in enumerate(sorted((root / 'master').glob('*.webp'))):
        # План убежища — тонкие линии и мелкий текст на старой бумаге: ему мягкий режим, без плашек.
        im = print_look(Image.open(src), 'paper' if src.stem == 'scheme' else 'offset', 1975 + i)
        size = (768, 512) if im.width > im.height else (512, 768)
        dst = root / src.name
        # Качество 72: растр и сдвиг красок добавили мелочи, а картинки идут в ядро сборки (бюджет 5 МБ); шейдер всё равно старит лист.
        im.resize(size, Image.LANCZOS).save(dst, 'WEBP', quality=72, method=6)
        print(f'{dst.relative_to(root.parent.parent)}  {dst.stat().st_size // 1024} КБ')


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == 'posters':
        posters()
        return
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    mode, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1975
    im = Image.open(src)
    out = old_photo(im, seed) if mode == 'photo' else print_look(im, mode, seed)
    out.save(dst, quality=92)
    print(dst)


if __name__ == '__main__':
    main()
