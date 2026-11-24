#!/usr/bin/env python3
"""
Вещи памяти, которых нет в свободных каталогах, собранные программой (партнёр 24.11: «я не буду делать чайник сам, я не 3д
моделер»; «делай оставшиеся пять вещей»): билет, записка, ключ с биркой, тапочки и пальто. Помощники сетки и запись glTF — из
make_kettle.py. Пишет исходники для scripts/import_thing_hq.py:
    python3 -I tools/things_hq/make_small.py <каталог исходников> [имя,имя]
    python3 -I scripts/import_thing_hq.py <каталог исходников> st_ticket,st_note,st_key,slippers,st_coat

Приметы — из сюжета (docs/vylazka/koma/memory_things.md, «известно точно»). Букв и цифр на картах нет: печать и почерк —
штрихи, которые не читаются. Метры, +Y вверх, вещь лежит на полу, середина основания — в начале координат.
"""
import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_kettle as k  # noqa: E402

W = 1024


def surface(fn, nu, nv, rect, flip=False):
    """Поверхность по формуле fn(u, v) → (x, y, z), u и v от 0 до 1; rect — её прямоугольник листа. flip — изнанка."""
    e = 1e-3
    rows = []
    for i in range(nu + 1):
        row = []
        for j in range(nv + 1):
            u, v = i / nu, j / nv
            p = fn(u, v)
            a = fn(min(1, u + e), v)
            b = fn(max(0, u - e), v)
            c = fn(u, min(1, v + e))
            d = fn(u, max(0, v - e))
            du = [a[q] - b[q] for q in range(3)]
            dv = [c[q] - d[q] for q in range(3)]
            # Лицо — туда, куда смотрит dv × du: у поверхности «u вдоль x, v вдоль z» это вверх.
            n = (dv[1] * du[2] - dv[2] * du[1], dv[2] * du[0] - dv[0] * du[2], dv[0] * du[1] - dv[1] * du[0])
            # На вырожденном месте (полюс овала, сошедшийся в точку носок) нормали по формуле нет: берём её чуть в стороне,
            # а если и там нет — вертикаль.
            if n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-18:
                uu, vv = min(1 - 4 * e, max(4 * e, u + (0.5 - u) * 0.08)), min(1 - 4 * e, max(4 * e, v + (0.5 - v) * 0.08))
                du = [fn(uu + e, vv)[q] - fn(uu - e, vv)[q] for q in range(3)]
                dv = [fn(uu, vv + e)[q] - fn(uu, vv - e)[q] for q in range(3)]
                n = (dv[1] * du[2] - dv[2] * du[1], dv[2] * du[0] - dv[0] * du[2], dv[0] * du[1] - dv[1] * du[0])
                if n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-18:
                    n = (0.0, 1.0, 0.0)
            if flip:
                n = (-n[0], -n[1], -n[2])
            row.append(k.vert(p, n, (rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v)))
        rows.append(row)
    for i in range(nu):
        for j in range(nv):
            q = (rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
            k.quad(*(q if not flip else q[::-1]))


def slab(fn, nu, nv, top, bottom, thick):
    """Лист с толщиной: лицо, изнанка (опущена на thick по нормали «вниз») и кромка той же картой, что лицо."""
    surface(fn, nu, nv, top)
    low = lambda u, v: (fn(u, v)[0], fn(u, v)[1] - thick, fn(u, v)[2])
    surface(low, nu, nv, bottom, flip=True)
    edge = (top[0], top[1], top[0] + (top[2] - top[0]) * 0.02, top[3])
    for a, b in (((0, 0), (1, 0)), ((1, 0), (1, 1)), ((1, 1), (0, 1)), ((0, 1), (0, 0))):
        n = max(nu, nv)
        side = lambda u, v, a=a, b=b: (lambda p: (p[0], p[1] - thick * v, p[2]))(fn(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
        surface(side, n, 1, edge, flip=True)


def blank(color, rough=200, metal=0):
    return Image.new('RGB', (W, W), color), Image.new('L', (W, W), rough), Image.new('L', (W, W), metal), Image.new('L', (W, W), 128)


def box_px(r):
    return (int(r[0] * W), int(r[1] * W), int(r[2] * W), int(r[3] * W))


def fibre(rnd, cell, lo, hi):
    """Зерно бумаги или ворс: шум в заданных пределах яркости."""
    return k.noise(rnd, W, cell).point(lambda v: lo + (hi - lo) * v // 255)


def scribble(d, rnd, x0, x1, y, amp, fill, width=3):
    """Строчка почерка, которую не прочесть: дрожащая линия с разрывами между «словами»."""
    x = x0
    while x < x1:
        word = rnd.uniform(30, 90)
        pts = []
        t = 0.0
        while t < word and x + t < x1:
            pts.append((x + t, y + math.sin(t * rnd.uniform(0.25, 0.5)) * amp * rnd.uniform(0.4, 1.0) + rnd.uniform(-1, 1)))
            t += rnd.uniform(3, 7)
        if len(pts) > 1:
            d.line(pts, fill=fill, width=width, joint='curve')
        x += word + rnd.uniform(14, 30)


# ── Билет: «картонный билет с отрывным краем и двумя полосками»; прокомпостирован, верхняя строка (имя, дата) стёрта ──────────────────────────────────
def ticket(root):
    k.reset()
    rnd = random.Random(7)
    L, Wd, T = 0.12, 0.06, 0.0022
    top, bot = (0.0, 0.0, 1.0, 0.5), (0.0, 0.5, 1.0, 1.0)
    # Картон чуть выгнут и приподнят одним углом: лежал в кармане.
    fn = lambda u, v: ((u - 0.5) * L, T + 0.004 * math.sin(u * math.pi) * 0.6 + 0.006 * (u ** 3) * v, (v - 0.5) * Wd)
    slab(fn, 24, 12, top, bot, T)
    col, rough, metal, height = blank((196, 150, 84), 225)
    d = ImageDraw.Draw(col)
    for r, tone in ((top, (206, 160, 88)), (bot, (188, 146, 84))):
        d.rectangle(box_px(r), fill=tone)
    x0, y0, x1, y1 = box_px(top)
    h = y1 - y0
    # Две полоски поперёк и отрывной край с проколами.
    d.rectangle((x0 + int(W * 0.56), y0, x0 + int(W * 0.62), y1), fill=(150, 34, 28))
    d.rectangle((x0 + int(W * 0.65), y0, x0 + int(W * 0.68), y1), fill=(150, 34, 28))
    px = x0 + int(W * 0.8)
    for y in range(y0 + 8, y1, 22):
        d.ellipse((px - 5, y, px + 5, y + 10), fill=(60, 44, 26))
    # Печать: строки, которые не читаются; верхняя — стёрта до пятна (имя).
    ink = (52, 40, 30)
    smear = Image.new('L', (W, W), 0)
    ImageDraw.Draw(smear).rectangle((x0 + 40, y0 + int(h * 0.16), x0 + int(W * 0.46), y0 + int(h * 0.32)), fill=150)
    col.paste(Image.new('RGB', (W, W), (170, 132, 80)), (0, 0), smear.filter(ImageFilter.GaussianBlur(14)))
    for row, y in enumerate((0.46, 0.62, 0.78)):
        scribble(d, rnd, x0 + 40, x0 + int(W * (0.5 if row else 0.42)), y0 + int(h * y), 5, ink, 5)
    # Компостер: круглая дырка у края.
    d.ellipse((x0 + int(W * 0.9), y0 + int(h * 0.4), x0 + int(W * 0.9) + 34, y0 + int(h * 0.4) + 34), fill=(30, 24, 18))
    grain = fibre(rnd, 2, 236, 255)
    col = ImageChops.multiply(col, Image.merge('RGB', (grain, grain, grain)))
    height = fibre(rnd, 3, 116, 140)
    k.write(root, 'st_ticket', col, *k.maps(height, rough, metal, 2.0))


# ── Записка: «сложенный вдвое листок с тремя тёмными строчками»; «почерк ровный. как на бирках» ───────────────────────────────────────────────────────────────
def note(root):
    k.reset()
    rnd = random.Random(11)
    L, Wd, T = 0.16, 0.11, 0.0006
    half = Wd / 2
    lift = math.radians(16)
    out_r, in_r = (0.0, 0.0, 1.0, 0.5), (0.0, 0.5, 1.0, 1.0)
    # Нижняя половина лежит, верхняя приподнята на сгибе: видны строчки внутри.
    low = lambda u, v: ((u - 0.5) * L, 0.0012 + 0.0015 * math.sin(u * math.pi), (v - 0.5) * half * 2 * 0.5 + half * 0.5)
    slab(low, 16, 6, (0.0, 0.5, 1.0, 0.75), (0.0, 0.0, 1.0, 0.25), T)

    def up(u, v):
        w = v * half
        sag = 0.003 * math.sin(u * math.pi) * v
        return ((u - 0.5) * L, 0.0012 + math.sin(lift) * w + sag, math.cos(lift) * w)

    slab(up, 16, 6, (0.0, 0.25, 1.0, 0.5), (0.0, 0.75, 1.0, 1.0), T)
    col, rough, metal, height = blank((226, 218, 196), 235)
    d = ImageDraw.Draw(col)
    # Внутренние стороны (где пишут): три тёмные строчки на нижней половине и их отпечаток на верхней.
    x0, y0, x1, y1 = box_px((0.0, 0.5, 1.0, 0.75))
    for i in range(3):
        scribble(d, rnd, x0 + 70, x1 - (90 if i < 2 else 380), y0 + int((y1 - y0) * (0.25 + 0.25 * i)), 3, (34, 34, 52), 6)
    x0, y0, x1, y1 = box_px((0.0, 0.75, 1.0, 1.0))
    for i in range(3):
        scribble(d, rnd, x0 + 70, x1 - 120, y0 + int((y1 - y0) * (0.25 + 0.25 * i)), 5, (196, 190, 176), 4)
    # Строчки проступают и на верхней, наружной стороне приподнятой половины: чернила пробили бумагу — их видно сверху.
    x0, y0, x1, y1 = box_px((0.0, 0.25, 1.0, 0.5))
    for i in range(3):
        scribble(d, rnd, x0 + 70, x1 - (90 if i < 2 else 380), y0 + int((y1 - y0) * (0.25 + 0.25 * i)), 3, (30, 30, 52), 26)
    # Сгиб и залом уголка — тенью; бумага с зерном и желтизной по краю.
    for r in (out_r, in_r):
        bx = box_px(r)
        mid = (bx[1] + bx[3]) // 2
        d.line((bx[0], mid, bx[2], mid), fill=(176, 168, 148), width=5)
    grain = fibre(rnd, 2, 238, 255)
    stain = fibre(rnd, 160, 226, 255)
    col = ImageChops.multiply(ImageChops.multiply(col, Image.merge('RGB', (grain, grain, grain))), Image.merge('RGB', (stain, stain, stain.point(lambda v: max(0, v - 14)))))
    height = fibre(rnd, 4, 120, 136)
    k.write(root, 'st_note', col, *k.maps(height, rough, metal, 2.0))


# ── Ключ: «ключ с большой овальной биркой на кольце»; «номер сбит. один из многих» ─────────────────────────────────────────────────────────────────────────
def key(root):
    k.reset()
    rnd = random.Random(3)
    R_KEY, R_RING, R_TAG, R_TAGB = (0.0, 0.0, 0.5, 0.25), (0.5, 0.0, 1.0, 0.25), (0.0, 0.25, 1.0, 0.75), (0.0, 0.75, 1.0, 1.0)
    T = 0.0024
    y = 0.002
    # Сам ключ: плоская головка-кольцо, стержень, бородка из трёх зубцов.
    kx = -0.052

    def flat_ring(cx, cz, r0, r1, rect, sx=1.0):
        first = len(k.pos)
        k.lathe([(r0, y), (r1, y), (r1, y + T), (r0, y + T), (r0, y)], rect, seg=36)
        for i in range(first, len(k.pos)):
            p = k.pos[i]
            k.pos[i] = (cx + p[0] * sx, p[1], cz + p[2])

    flat_ring(kx, 0.0, 0.0045, 0.011, R_KEY)
    k.box((kx + 0.0105, y, -0.0022), (kx + 0.052, y + T, 0.0022), R_KEY)
    for i, (dx, dz) in enumerate(((0.036, 0.009), (0.042, 0.006), (0.048, 0.0095))):
        k.box((kx + dx, y, 0.0022), (kx + dx + 0.004, y + T, dz), R_KEY)
    # Кольцо продето в головку и лежит поверх: проволочный тор, чуть наклонён.
    ring_c = (kx - 0.012, y + 0.003, 0.0)
    first = len(k.pos)
    prof = [(0.012 + 0.0011 * math.cos(a), 0.0011 * math.sin(a)) for a in [2 * math.pi * i / 10 for i in range(11)]]
    k.lathe(prof, R_RING, seg=40)
    tilt = math.radians(14)
    for i in range(first, len(k.pos)):
        p, n = k.pos[i], k.nrm[i]
        k.pos[i] = (ring_c[0] + p[0], ring_c[1] + p[1] * math.cos(tilt) + p[2] * math.sin(tilt), ring_c[2] + p[2])
        k.nrm[i] = n
    # Бирка: большой овал из пластмассы, пухлый, с фаской; дырка под кольцо нарисована.
    A, B, TH = 0.032, 0.02, 0.004
    tc = (kx - 0.012 - 0.012 - A * 0.86, 0.0, 0.004)
    top = lambda u, v: (tc[0] + math.cos(u * 2 * math.pi) * A * v, y + TH * (0.72 + 0.28 * math.sqrt(max(0.0, 1 - v ** 8))) , tc[2] + math.sin(u * 2 * math.pi) * B * v)
    # v идёт от середины к краю: на листе — овал (полярная развёртка рисуется как круг).
    surface(lambda u, v: top(u, 1 - v), 48, 6, R_TAG)
    surface(lambda u, v: (top(u, 1 - v)[0], y, top(u, 1 - v)[2]), 48, 2, R_TAGB, flip=True)
    surface(lambda u, v: (tc[0] + math.cos(u * 2 * math.pi) * A, y + TH * 0.72 * (1 - v), tc[2] + math.sin(u * 2 * math.pi) * B), 48, 1, (0.0, 0.25, 1.0, 0.27))
    col, rough, metal, height = blank((120, 120, 116), 110, 255)
    d = ImageDraw.Draw(col)
    dr, dm = ImageDraw.Draw(rough), ImageDraw.Draw(metal)
    d.rectangle(box_px(R_KEY), fill=(176, 142, 62))  # латунь
    d.rectangle(box_px(R_RING), fill=(160, 160, 156))
    for r in (R_TAG, R_TAGB):
        d.rectangle(box_px(r), fill=(176, 36, 30))
        dr.rectangle(box_px(r), fill=90)
        dm.rectangle(box_px(r), fill=0)
    # Бирка в полярной развёртке: v = 0 (верх прямоугольника) — край, v = 1 — середина. Потёртый край и вдавленный ободок.
    x0, y0, x1, y1 = box_px(R_TAG)
    d.rectangle((x0, y0, x1, y0 + int((y1 - y0) * 0.1)), fill=(200, 96, 80))
    d.rectangle((x0, y0 + int((y1 - y0) * 0.22), x1, y0 + int((y1 - y0) * 0.26)), fill=(120, 20, 18))
    hd = ImageDraw.Draw(height)
    hd.rectangle((x0, y0 + int((y1 - y0) * 0.22), x1, y0 + int((y1 - y0) * 0.26)), fill=90)
    # Номер на бирке сбит: в середине овала (низ прямоугольника) — исцарапанное светлое пятно.
    for _ in range(140):
        a = (rnd.uniform(x0, x1), rnd.uniform(y0 + (y1 - y0) * 0.55, y1))
        d.line((a[0], a[1], a[0] + rnd.uniform(-40, 40), a[1] + rnd.uniform(-10, 10)), fill=(214, 150, 130), width=2)
    # Царапины на латуни.
    kx0, ky0, kx1, ky1 = box_px(R_KEY)
    for _ in range(60):
        a = (rnd.uniform(kx0, kx1), rnd.uniform(ky0, ky1))
        d.line((a[0], a[1], a[0] + rnd.uniform(-30, 30), a[1] + rnd.uniform(-6, 6)), fill=(206, 176, 96), width=1)
    k.write(root, 'st_key', col, *k.maps(height.filter(ImageFilter.GaussianBlur(1)), rough, metal, 2.0))


# ── Тапочки: пара домашних, в клетку; один стоптан сильнее и стоит чуть вкось ───────────────────────────────────────────
def slippers(root):
    k.reset()
    rnd = random.Random(5)
    R_UP, R_IN, R_SOLE, R_INSOLE = (0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 1.0, 0.5), (0.0, 0.5, 0.5, 1.0), (0.5, 0.5, 1.0, 1.0)
    Ln, SOLE = 0.27, 0.014

    def half_width(t):
        # Силуэт подошвы: узкая пятка, широкий носок.
        return 0.036 + 0.014 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.8 + 0.008 * t

    def outline(a):
        # Точка контура по углу: t вдоль ступни от пятки (0) до носка (1).
        t = 0.5 - 0.5 * math.cos(a)
        side = math.sin(a)
        r = math.sqrt(max(0.0, 1 - (2 * t - 1) ** 8)) if 0 < t < 1 else 0.0
        return (t, side * half_width(t) * (r if abs(2 * t - 1) > 0.8 else 1.0))

    def one(ox, yaw, worn):
        first = len(k.pos)
        sole_h = SOLE * (0.72 if worn else 1.0)
        # Подошва: верх (стелька), низ и кромка.
        plane = lambda u, v, yy: ((u - 0.5) * Ln, yy, (2 * v - 1) * half_width(u) * math.sqrt(max(0.0, 1 - (2 * u - 1) ** 10)))
        surface(lambda u, v: plane(u, v, sole_h), 20, 8, R_INSOLE)
        surface(lambda u, v: plane(u, v, 0.0), 20, 8, R_SOLE, flip=True)
        for sgn in (0.0, 1.0):
            surface(lambda u, v, sgn=sgn: (plane(u, sgn, 0)[0], sole_h * v, plane(u, sgn, 0)[2]), 20, 1, (0.0, 0.5, 0.5, 0.56), flip=(sgn == 0.0))
        # Верх: свод над передней половиной, к носку опускается; у стоптанного — ниже и примят.
        arch = 0.05 * (0.78 if worn else 1.0)

        def upper(u, v):
            t = 0.42 + 0.58 * u
            hw = half_width(t) * math.sqrt(max(0.0, 1 - (2 * t - 1) ** 10)) * 1.02
            a = (2 * v - 1)
            hgt = arch * math.sin(min(1.0, u * 1.25 + 0.2) * math.pi * 0.5) * (1 - 0.75 * u ** 3)
            return ((t - 0.5) * Ln, sole_h + hgt * math.sqrt(max(0.0, 1 - a * a)) * (1.0 if not worn else 1 - 0.25 * (a > 0.2)), a * hw)

        surface(upper, 16, 12, R_UP)
        surface(lambda u, v: (upper(u, v)[0], upper(u, v)[1] - 0.004, upper(u, v)[2] * 0.96), 16, 12, R_IN, flip=True)
        c, s = math.cos(yaw), math.sin(yaw)
        for i in range(first, len(k.pos)):
            x, y, z = k.pos[i]
            nx, ny, nz = k.nrm[i]
            k.pos[i] = (ox + x * c - z * s, y, x * s + z * c)
            k.nrm[i] = (nx * c - nz * s, ny, nx * s + nz * c)

    # Пара стоит носками вперёд (в −X после поворота импорта не важен: вещь симметрична); левый чуть развёрнут и стоптан.
    one(0.0, 0.0, False)
    first = len(k.pos)
    one(0.0, 0.0, True)
    for i in range(len(k.pos)):
        x, y, z = k.pos[i]
        if i >= first:
            a = math.radians(11)
            k.pos[i] = (x * math.cos(a) - z * math.sin(a) + 0.012, y, x * math.sin(a) + z * math.cos(a) + 0.062)
            nx, ny, nz = k.nrm[i]
            k.nrm[i] = (nx * math.cos(a) - nz * math.sin(a), ny, nx * math.sin(a) + nz * math.cos(a))
        else:
            k.pos[i] = (x, y, z - 0.062)
    col, rough, metal, height = blank((90, 30, 26), 240)
    d = ImageDraw.Draw(col)
    # Клетка: красно-бурая шотландка на войлоке.
    x0, y0, x1, y1 = box_px(R_UP)
    d.rectangle((x0, y0, x1, y1), fill=(170, 40, 34))
    step = 64
    for x in range(x0, x1, step):
        d.rectangle((x, y0, x + 20, y1), fill=(96, 22, 24))
        d.rectangle((x + 38, y0, x + 42, y1), fill=(226, 196, 120))
    plaid = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dp = ImageDraw.Draw(plaid)
    for y in range(y0, y1, step):
        dp.rectangle((x0, y, x1, y + 20), fill=(60, 14, 18, 130))
        dp.rectangle((x0, y + 38, x1, y + 42), fill=(226, 196, 120, 200))
    col.paste(plaid, (0, 0), plaid)
    d = ImageDraw.Draw(col)
    d.rectangle(box_px(R_IN), fill=(196, 176, 140))  # подкладка
    d.rectangle(box_px(R_INSOLE), fill=(186, 160, 120))  # стелька
    sx0, sy0, sx1, sy1 = box_px(R_INSOLE)
    # Вытертый след пятки и пальцев на стельке.
    wear = Image.new('L', (W, W), 0)
    dw = ImageDraw.Draw(wear)
    dw.ellipse((sx0 + 30, sy0 + 150, sx0 + 170, sy1 - 150), fill=200)
    dw.ellipse((sx0 + 290, sy0 + 110, sx1 - 40, sy1 - 110), fill=160)
    col.paste(Image.new('RGB', (W, W), (120, 96, 70)), (0, 0), wear.filter(ImageFilter.GaussianBlur(22)))
    d = ImageDraw.Draw(col)
    d.rectangle(box_px(R_SOLE), fill=(74, 70, 66))  # резина
    ImageDraw.Draw(rough).rectangle(box_px(R_SOLE), fill=170)
    felt = fibre(rnd, 2, 214, 255)
    col = ImageChops.multiply(col, Image.merge('RGB', (felt, felt, felt)))
    height = fibre(rnd, 3, 104, 152)
    k.write(root, 'slippers', col, *k.maps(height, rough, metal, 2.0))


# ── Пальто: «пальто. одна пуговица пришита другой ниткой. карманы пусты.» — брошено комом, рукав в сторону ─────────────────────
def coat(root):
    k.reset()
    rnd = random.Random(19)
    R_CLOTH, R_LINING, R_SLEEVE = (0.0, 0.0, 1.0, 0.6), (0.0, 0.6, 0.5, 1.0), (0.5, 0.6, 1.0, 1.0)
    SX, SZ, H = 0.56, 0.48, 0.33
    # Складки: несколько гребней случайного направления поверх общего холма; у краёв ткань ложится на пол волной.
    ridges = [(rnd.uniform(0, math.pi), rnd.uniform(7, 15), rnd.uniform(0, 6.28), rnd.uniform(0.012, 0.03)) for _ in range(7)]

    def heap(u, v):
        x, z = (u - 0.5) * SX, (v - 0.5) * SZ
        # Холм: пальто перекинуто через спинку невидимого сиденья — гребень по z = −0,06, пола свисает вперёд.
        ru = (2 * u - 1)
        rv = (2 * v - 1)
        edge = max(0.0, 1 - ru ** 6) * max(0.0, 1 - rv ** 6)
        crest = math.exp(-((z + 0.07) / 0.12) ** 2) * (0.82 + 0.18 * math.cos(ru * 2.2))
        apron = 0.42 * math.exp(-((z - 0.1) / 0.16) ** 2)
        y = H * edge * min(1.0, max(crest, apron))
        fold = sum(a * math.sin((x * math.cos(t) + z * math.sin(t)) * f * 6.28 + ph) for t, f, ph, a in ridges)
        y += fold * edge * (0.35 + 0.65 * min(1.0, y / (H * 0.5)))
        # Подол — волной по краю.
        y += 0.012 * (1 - edge) * (1 + math.sin(u * 23 + v * 17))
        return (x, max(0.004, y), z)

    surface(heap, 72, 64, R_CLOTH)
    # Дно закрыто подкладкой: вещь не просвечивает снизу при росте и распаде.
    surface(lambda u, v: ((u - 0.5) * SX * 0.98, 0.002, (v - 0.5) * SZ * 0.98), 8, 8, R_LINING, flip=True)
    # Рукав лежит отдельно, согнут в локте; манжета открыта — видна подкладка.
    sleeve = k.arc((-0.12, 0.2, 0.06), (-0.34, 0.2, 0.2), (-0.3, 0.035, 0.24), 20)
    k.tube(sleeve, lambda f: 0.062 - 0.012 * f + 0.006 * math.sin(f * 14), R_SLEEVE, seg=18)
    # Воротник: валик на гребне.
    collar = k.arc((-0.1, H * 0.93, -0.1), (0.02, H * 1.06, -0.13), (0.14, H * 0.9, -0.08), 16)
    k.tube(collar, lambda f: 0.03 * math.sin(max(0.08, f) * math.pi) ** 0.5 + 0.006, R_SLEEVE, seg=14)
    # Пуговицы на поле (диски): три, средняя пришита другой ниткой — на карте.
    btn_uv = [(0.5, 0.74), (0.5, 0.83), (0.5, 0.92)]
    R_BTN = [(0.0 + 0.1 * i, 0.6, 0.1 + 0.1 * i, 0.7) for i in range(3)]
    for (u, v), r in zip(btn_uv, R_BTN):
        c = heap(u, v)
        first = len(k.pos)
        k.lathe([(0.0, 0.0), (0.011, 0.0), (0.012, 0.002), (0.0105, 0.0045), (0.0, 0.0035)], (r[0], r[1], r[0] + 0.02, r[3]), seg=20)
        # Крышка пуговицы — отдельной поверхностью, чтобы дырочки легли кругом.
        surface(lambda a, b: (math.cos(a * 6.283) * 0.0105 * b, 0.0046, math.sin(a * 6.283) * 0.0105 * b), 20, 2, (r[0] + 0.02, r[1], r[2], r[3]), flip=True)
        tilt = math.radians(38)
        for i in range(first, len(k.pos)):
            x, y, z = k.pos[i]
            nx, ny, nz = k.nrm[i]
            k.pos[i] = (c[0] + x, c[1] + 0.001 + y * math.cos(tilt) - z * math.sin(tilt), c[2] + y * math.sin(tilt) + z * math.cos(tilt))
            k.nrm[i] = (nx, ny * math.cos(tilt) - nz * math.sin(tilt), ny * math.sin(tilt) + nz * math.cos(tilt))
    col, rough, metal, height = blank((40, 52, 86), 245)
    d = ImageDraw.Draw(col)
    # Шерсть «в ёлочку»: синее пальто (ярче настоящего чёрного — вещь должна находиться взглядом).
    weave = Image.new('L', (W, W), 0)
    dwv = ImageDraw.Draw(weave)
    for y in range(0, W, 6):
        for x in range(0, W, 24):
            up_ = (x // 24) % 2 == 0
            dwv.line((x, y + (0 if up_ else 6), x + 24, y + (6 if up_ else 0)), fill=255, width=2)
    col.paste(Image.new('RGB', (W, W), (70, 88, 132)), (0, 0), weave)
    height.paste(Image.new('L', (W, W), 150), (0, 0), weave)
    d = ImageDraw.Draw(col)
    # Подкладка — серо-золотистый атлас; рукав и воротник — та же шерсть, темнее.
    d.rectangle(box_px(R_LINING), fill=(150, 138, 110))
    ImageDraw.Draw(rough).rectangle(box_px(R_LINING), fill=110)
    sl = box_px(R_SLEEVE)
    dark = Image.new('L', (W, W), 0)
    ImageDraw.Draw(dark).rectangle(sl, fill=70)
    col.paste(Image.new('RGB', (W, W), (22, 28, 50)), (0, 0), dark)
    # Манжета (конец трубки — низ прямоугольника): полоска подкладки.
    ImageDraw.Draw(col).rectangle((sl[0], sl[3] - 26, sl[2], sl[3]), fill=(150, 138, 110))
    # Пуговицы: тёмный рог, четыре дырочки; у средней нитка рыжая, у остальных чёрная.
    d = ImageDraw.Draw(col)
    for i, r in enumerate(R_BTN):
        bx = box_px(r)
        d.rectangle(bx, fill=(30, 26, 24))
        ImageDraw.Draw(rough).rectangle(bx, fill=70)
        cx, cy = bx[0] + int((bx[2] - bx[0]) * 0.6), (bx[1] + bx[3]) // 2
        thread = (214, 120, 40) if i == 1 else (12, 12, 14)
        # Крышка — в полярной развёртке: дырочки и нитка — полосой у середины (низ прямоугольника крышки).
        d.rectangle((bx[0] + int((bx[2] - bx[0]) * 0.2), bx[3] - 34, bx[2], bx[3]), fill=thread)
        del cx, cy
    felt = fibre(rnd, 2, 210, 255)
    big = fibre(rnd, 120, 200, 255)
    col = ImageChops.multiply(ImageChops.multiply(col, Image.merge('RGB', (felt, felt, felt))), Image.merge('RGB', (big, big, big)))
    height = ImageChops.add(height, fibre(rnd, 3, 100, 150), 2, 0)
    k.write(root, 'st_coat', col, *k.maps(height, rough, metal, 2.5))


MAKERS = {'st_ticket': ticket, 'st_note': note, 'st_key': key, 'slippers': slippers, 'st_coat': coat}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else list(MAKERS)
    for name in only:
        MAKERS[name](sys.argv[1])
