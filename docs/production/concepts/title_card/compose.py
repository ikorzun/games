"""Концепты заставки эпизода: фон + настоящий логотип передачи (logo_kr.webp, не генерируется) + название эпизода
шрифтом игры (JetBrains Mono). Запуск из корня репозитория."""
import random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
D = '/private/tmp/claude-501/-Users-ikorzyn-Desktop-Claude-CriminalRussia/7d831296-a78c-43b6-8ee4-a45c40a92223/scratchpad/title'
FD = '/private/tmp/claude-501/-Users-ikorzyn-Desktop-Claude-CriminalRussia/7d831296-a78c-43b6-8ee4-a45c40a92223/scratchpad/fonts'
W, H = 1920, 1080
LOGO = Image.open('assets/common/ui/logo_kr.webp').convert('RGBA')
TITLE, SUB = 'Смерть за квартиры', 'Эпизод 1  ·  Москва, 1993'


def font(weight, size, cyr=True):
    return ImageFont.truetype(f'{FD}/JetBrainsMono-{weight}-{"cyrillic" if cyr else "latin"}.ttf', size)


def text(d, xy, s, size, weight=500, fill=(240, 236, 228), anchor='mm', spacing=0.0):
    """Кириллица и латиница лежат в разных подмножествах шрифта: рисуем посимвольно нужным."""
    fc, fl = font(weight, size, True), font(weight, size, False)
    pick = lambda ch: fc if fc.getmask(ch).getbbox() or ch == ' ' and False else fl
    glyphs = [(ch, fc if ('\u0400' <= ch <= '\u04ff' or ch == '\u2116') else fl) for ch in s]
    widths = [f.getlength(ch) + spacing * size for ch, f in glyphs]
    total = sum(widths) - spacing * size
    x, y = xy
    if anchor[0] == 'm':
        x -= total / 2
    for (ch, f), w in zip(glyphs, widths):
        d.text((x, y), ch, font=f, fill=fill, anchor='l' + anchor[1])
        x += w


def crt(im, strength=0.06):
    """Строки развёртки и лёгкий шум — как в рантайме (scanlines), чтобы концепт читался как экран."""
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for y in range(0, im.height, 3):
        d.line([(0, y), (im.width, y)], fill=(0, 0, 0, int(255 * strength)))
    return Image.alpha_composite(im.convert('RGBA'), ov)


def logo(h):
    return LOGO.resize((round(LOGO.width * h / LOGO.height), h), Image.LANCZOS)


def place(im, lg, cx, cy):
    im.alpha_composite(lg, (round(cx - lg.width / 2), round(cy - lg.height / 2)))


def bg(name, dark=0.0):
    im = Image.open(f'{D}/bg_{name}.png').convert('RGBA').resize((W, 1088)).crop((0, 4, W, 1084))
    if dark:
        im = Image.alpha_composite(im, Image.new('RGBA', im.size, (0, 0, 0, int(255 * dark))))
    return im


def concept_air():
    """А. «Эфир»: чёрный экран после помех, логотип по центру, название эпизода строкой ниже."""
    random.seed(7)
    im = Image.new('RGBA', (W, H), (8, 8, 10, 255))
    noise = Image.effect_noise((W // 3, H // 3), 18).resize((W, H)).convert('RGBA')
    noise.putalpha(28)
    im = Image.alpha_composite(im, noise)
    place(im, logo(380), W / 2, H / 2 - 90)
    d = ImageDraw.Draw(im)
    text(d, (W / 2, H / 2 + 175), TITLE.upper(), 46, 500, spacing=0.12)
    text(d, (W / 2, H / 2 + 235), SUB, 24, 300, fill=(170, 166, 160), spacing=0.06)
    return crt(im, 0.18)


def concept_tv():
    """Б. «Телевизор»: в тёмной комнате 1993-го включён телевизор, на экране — логотип; название — подпись внизу слева."""
    im = bg('tv')
    sx0, sy0, sx1, sy1 = SCREEN  # экран телевизора на фоне (подобран по картинке)
    lg = logo(round((sy1 - sy0) * 0.62))
    glow = lg.filter(ImageFilter.GaussianBlur(6))
    place(im, glow, (sx0 + sx1) / 2, (sy0 + sy1) / 2)
    place(im, lg, (sx0 + sx1) / 2, (sy0 + sy1) / 2)
    d = ImageDraw.Draw(im)
    text(d, (110, H - 150), TITLE.upper(), 44, 500, anchor='lm', spacing=0.12)
    text(d, (110, H - 95), SUB, 22, 300, fill=(185, 180, 172), anchor='lm', spacing=0.06)
    return crt(im, 0.05)


def concept_folder():
    """В. «Дело»: закрытая папка дела под лампой; логотип вверху, название — на ярлыке папки."""
    im = bg('folder')
    place(im, logo(250), W / 2, 165)
    lx, ly = LABEL
    lay = Image.new('RGBA', (420, 140), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    text(d, (210, 48), 'ДЕЛО № 1', 24, 500, fill=(45, 40, 36, 235), spacing=0.1)
    text(d, (210, 92), TITLE, 23, 500, fill=(45, 40, 36, 235), spacing=0.02)
    lay = lay.rotate(4.8, resample=Image.BICUBIC)  # ярлык на папке слегка повёрнут
    im.alpha_composite(lay, (lx - 210, ly - 70))
    return crt(im, 0.04)


def concept_city():
    """Г. «Город»: ночная Пресня под дождём, логотип в тёмном небе, название под ним."""
    im = bg('city')
    place(im, logo(330), W / 2, 270)
    d = ImageDraw.Draw(im)
    text(d, (W / 2, 505), TITLE.upper(), 44, 500, spacing=0.12)
    text(d, (W / 2, 560), SUB, 22, 300, fill=(200, 195, 186), spacing=0.06)
    return crt(im, 0.05)


SCREEN = tuple(int(v) for v in sys.argv[1].split(',')) if len(sys.argv) > 1 else (760, 330, 1160, 640)
LABEL = tuple(int(v) for v in sys.argv[2].split(',')) if len(sys.argv) > 2 else (960, 560)
out = []
for name, fn in [('A_air', concept_air), ('B_tv', concept_tv), ('C_folder', concept_folder), ('D_city', concept_city)]:
    try:
        im = fn().convert('RGB'); im.save(f'{D}/{name}.jpg', quality=90); out.append(name)
    except FileNotFoundError as e:
        print('skip', name, e)
print(out)
