#!/usr/bin/env python3
"""
Чайник памяти, собранный программой (партнёр 24.11: «я не буду делать чайник сам, я не 3д моделер»): в свободных каталогах
нет чайника из сюжета — «эмалированный, на плите; на дне накипь; крышка своя» (docs/vylazka/things_hq.md, §4).

Пишет исходник для scripts/import_thing_hq.py — папку kettle с kettle.gltf, kettle.bin и картами цвета, нормалей и
шероховатости/металла:
    python3 -I tools/things_hq/make_kettle.py <каталог исходников>
    python3 -I scripts/import_thing_hq.py <каталог исходников> kettle

Вещь: светлый эмалированный корпус (тело вращения) с синим поясом, синяя крышка с чёрной шишкой — «своя» (чуть другого
синего, чем пояс), изогнутый носик, дужка с бакелитовой ручкой на двух ушках, закопчённое дно со сколами; под ним чугунная
горелка с решёткой. Развёртка — лист 2048²: каждой детали свой прямоугольник. Метры, +Y вверх, носик смотрит в +X.
"""
import json
import math
import os
import random
import struct
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 2048
SEG = 64

pos, nrm, uvs, idx = [], [], [], []


def vert(p, n, uv):
    l = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
    pos.append(p)
    nrm.append((n[0] / l, n[1] / l, n[2] / l))
    uvs.append(uv)
    return len(pos) - 1


def quad(a, b, c, d):
    idx.extend([a, b, c, a, c, d])


def lathe(profile, rect, y0=0.0, seg=SEG):
    """Тело вращения вокруг оси Y. profile — [(радиус, высота)] снизу вверх; rect — (u0, v0, u1, v1) листа: u — по кругу, v — вдоль профиля."""
    lens = [0.0]
    for i in range(1, len(profile)):
        lens.append(lens[-1] + math.dist(profile[i - 1], profile[i]))
    total = lens[-1] or 1.0
    rows = []
    for i, (r, y) in enumerate(profile):
        a = profile[max(0, i - 1)]
        b = profile[min(len(profile) - 1, i + 1)]
        dr, dy = b[0] - a[0], b[1] - a[1]
        row = []
        for s in range(seg + 1):
            t = 2 * math.pi * s / seg
            c, sn = math.cos(t), math.sin(t)
            u = rect[0] + (rect[2] - rect[0]) * s / seg
            v = rect[3] - (rect[3] - rect[1]) * lens[i] / total
            row.append(vert((r * c, y0 + y, r * sn), (dy * c, -dr, dy * sn), (u, v)))
        rows.append(row)
    for i in range(len(rows) - 1):
        for s in range(seg):
            quad(rows[i][s], rows[i + 1][s], rows[i + 1][s + 1], rows[i][s + 1])


def tube(path, radius, rect, seg=20):
    """Трубка вдоль ломаной path (в плоскости XY или любой): radius — число или функция от доли пути."""
    lens = [0.0]
    for i in range(1, len(path)):
        lens.append(lens[-1] + math.dist(path[i - 1], path[i]))
    total = lens[-1] or 1.0
    rows = []
    for i, p in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = [b[k] - a[k] for k in range(3)]
        tl = math.sqrt(sum(x * x for x in t)) or 1.0
        t = [x / tl for x in t]
        # Опорная ось — Z: все трубки вещи лежат в плоскости XY, так что закрутки нет.
        n1 = (0.0, 0.0, 1.0)
        n2 = (t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0])
        f = lens[i] / total
        r = radius(f) if callable(radius) else radius
        row = []
        for s in range(seg + 1):
            ang = 2 * math.pi * s / seg
            c, sn = math.cos(ang), math.sin(ang)
            d = [n1[k] * c + n2[k] * sn for k in range(3)]
            row.append(vert((p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r), d, (rect[0] + (rect[2] - rect[0]) * s / seg, rect[3] - (rect[3] - rect[1]) * f)))
        rows.append(row)
    for i in range(len(rows) - 1):
        for s in range(seg):
            quad(rows[i][s], rows[i][s + 1], rows[i + 1][s + 1], rows[i + 1][s])


def box(lo, hi, rect):
    """Брусок; каждая грань ложится в один и тот же прямоугольник листа (чугун без рисунка)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    faces = [
        ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), (1, 0, 0)),
        ((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0), (-1, 0, 0)),
        ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (0, 1, 0)),
        ((x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (0, -1, 0)),
        ((x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1), (0, 0, 1)),
        ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (0, 0, -1)),
    ]
    corners = [(rect[0], rect[3]), (rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3])]
    for a, b, c, d, n in faces:
        q = [vert(p, n, corners[k]) for k, p in enumerate((a, b, c, d))]
        quad(*q)


def arc(p0, p1, p2, n=24):
    """Квадратичная кривая через три опорные точки."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(tuple((1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k] for k in range(3)))
    return out


# Прямоугольники листа (u0, v0, u1, v1), v вниз.
R_BODY = (0.0, 0.0, 1.0, 0.5)
R_LID = (0.0, 0.5, 0.5, 0.72)
R_SPOUT = (0.5, 0.5, 0.75, 0.72)
R_BAKELITE = (0.75, 0.5, 0.875, 0.72)
R_STEEL = (0.875, 0.5, 1.0, 0.72)
R_IRON = (0.0, 0.74, 0.5, 1.0)
R_KNOB = (0.5, 0.74, 0.75, 1.0)

BURNER_H = 0.055  # высота горелки с решёткой: на ней стоит чайник


def build_mesh():
    # Горелка: чашка, рассекатель и четыре лапы решётки.
    lathe([(0.0, 0.0), (0.085, 0.0), (0.092, 0.006), (0.092, 0.02), (0.06, 0.03), (0.034, 0.03), (0.034, 0.04), (0.03, 0.044), (0.0, 0.044)], R_IRON, seg=40)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        # Лапа — брусок вдоль радиуса, повёрнутый на свой угол.
        first = len(pos)
        box((0.03, 0.03, -0.006), (0.115, BURNER_H, 0.006), R_IRON)
        for i in range(first, len(pos)):
            x, y, z = pos[i]
            nx, ny, nz = nrm[i]
            pos[i] = (x * c - z * s, y, x * s + z * c)
            nrm[i] = (nx * c - nz * s, ny, nx * s + nz * c)
    y0 = BURNER_H
    # Корпус: плоское дно с отбортовкой, пузатые бока, плечи, горло с закатанным краем.
    body = [(0.0, 0.0), (0.082, 0.0), (0.09, 0.004), (0.098, 0.018), (0.108, 0.045), (0.112, 0.075), (0.109, 0.105), (0.098, 0.13), (0.08, 0.148), (0.062, 0.157), (0.054, 0.16), (0.054, 0.166), (0.057, 0.168), (0.057, 0.171), (0.05, 0.172)]
    lathe(body, R_BODY, y0)
    # Крышка: пологий купол с бортиком, сидит в горле.
    lid = [(0.052, 0.168), (0.054, 0.172), (0.05, 0.178), (0.036, 0.186), (0.018, 0.19), (0.0, 0.191)]
    lathe(lid, R_LID, y0, seg=48)
    # Шишка крышки: ножка и бакелитовый шар.
    lathe([(0.0, 0.189), (0.007, 0.19), (0.006, 0.198), (0.012, 0.202), (0.015, 0.21), (0.012, 0.218), (0.0, 0.221)], R_KNOB, y0, seg=24)
    # Носик: от бока корпуса вверх и вперёд, сужается; срез наверху.
    spout = arc((0.09, y0 + 0.07, 0.0), (0.15, y0 + 0.085, 0.0), (0.158, y0 + 0.165, 0.0))
    tube(spout, lambda f: 0.024 - 0.011 * f, R_SPOUT)
    # Ушки дужки (сталь) и сама дужка: проволока с бакелитовой ручкой посередине.
    for sx in (-1, 1):
        box((sx * 0.066 - 0.006, y0 + 0.15, -0.004), (sx * 0.066 + 0.006, y0 + 0.178, 0.004), R_STEEL)
    handle = arc((-0.066, y0 + 0.172, 0.0), (0.0, y0 + 0.36, 0.0), (0.066, y0 + 0.172, 0.0), 32)
    tube(handle, 0.0035, R_STEEL, seg=10)
    tube(handle[11:22], lambda f: 0.0105 + 0.002 * math.sin(f * math.pi), R_BAKELITE, seg=16)


def noise(rnd, size, cell):
    """Плавный шум: случайная мелкая картинка, растянутая до листа."""
    small = Image.new('L', (max(2, size // cell), max(2, size // cell)))
    small.putdata([rnd.randint(0, 255) for _ in range(small.size[0] * small.size[1])])
    return small.resize((size, size), Image.BICUBIC)


def paint():
    rnd = random.Random(24)
    W = SIZE
    px = lambda r: (int(r[0] * W), int(r[1] * W), int(r[2] * W), int(r[3] * W))
    col = Image.new('RGB', (W, W), (40, 40, 40))
    rough = Image.new('L', (W, W), 40)
    metal = Image.new('L', (W, W), 0)
    height = Image.new('L', (W, W), 128)
    d = ImageDraw.Draw(col)
    dr = ImageDraw.Draw(rough)
    dm = ImageDraw.Draw(metal)

    # Корпус: светлая эмаль (на тёмном полу читается, как и прежняя болванка), синий пояс, копоть снизу.
    bx = px(R_BODY)
    bh = bx[3] - bx[1]
    d.rectangle(bx, fill=(236, 228, 204))
    belt0, belt1 = bx[1] + int(bh * 0.3), bx[1] + int(bh * 0.4)
    d.rectangle((bx[0], belt0, bx[2], belt1), fill=(30, 74, 168))
    d.rectangle((bx[0], belt0 - 6, bx[2], belt0 - 2), fill=(30, 74, 168))
    # Дно и низ боков: v идёт от горла (верх прямоугольника) к центру дна (низ). Копоть — тёплая чёрно-бурая, языками вверх.
    soot = Image.new('L', (W, W), 0)
    ds = ImageDraw.Draw(soot)
    n1 = noise(rnd, W, 96)
    for x in range(bx[0], bx[2], 4):
        k = n1.getpixel((x, 10)) / 255
        top = bx[1] + int(bh * (0.7 + 0.1 * k))
        ds.rectangle((x, top, x + 4, bx[3]), fill=255)
    soot = soot.filter(ImageFilter.GaussianBlur(26))
    col.paste(Image.new('RGB', (W, W), (34, 24, 18)), (0, 0), soot)
    rough.paste(Image.new('L', (W, W), 235), (0, 0), soot)
    # Накипь на дне (самый низ прямоугольника — середина дна): белёсые разводы.
    scale = Image.new('L', (W, W), 0)
    ImageDraw.Draw(scale).rectangle((bx[0], bx[3] - int(bh * 0.12), bx[2], bx[3]), fill=255)
    scale = ImageChops.multiply(scale.filter(ImageFilter.GaussianBlur(10)), noise(rnd, W, 24).point(lambda v: 255 if v > 120 else 0).filter(ImageFilter.GaussianBlur(3)))
    col.paste(Image.new('RGB', (W, W), (196, 190, 172)), (0, 0), scale)

    # Крышка — «своя»: синий другого тона, чем пояс; шишка чёрная.
    lx = px(R_LID)
    d.rectangle(lx, fill=(22, 96, 150))
    kx = px(R_KNOB)
    d.rectangle(kx, fill=(22, 20, 19))
    dr.rectangle(kx, fill=70)
    # Носик — светлая эмаль, срез тёмный (v сверху — кончик).
    sx = px(R_SPOUT)
    d.rectangle(sx, fill=(236, 228, 204))
    d.rectangle((sx[0], sx[1], sx[2], sx[1] + 14), fill=(26, 24, 24))
    # Бакелит ручки, сталь дужки и ушек, чугун горелки.
    ax = px(R_BAKELITE)
    d.rectangle(ax, fill=(24, 21, 19))
    dr.rectangle(ax, fill=80)
    tx = px(R_STEEL)
    d.rectangle(tx, fill=(150, 150, 146))
    dr.rectangle(tx, fill=90)
    dm.rectangle(tx, fill=255)
    ix = px(R_IRON)
    d.rectangle(ix, fill=(46, 44, 44))
    dr.rectangle(ix, fill=200)
    dm.rectangle(ix, fill=150)
    rmask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(rmask).rectangle(ix, fill=255)
    rmask = ImageChops.multiply(rmask, noise(rnd, W, 40).point(lambda v: 255 if v > 150 else 0).filter(ImageFilter.GaussianBlur(5)))
    col.paste(Image.new('RGB', (W, W), (96, 52, 28)), (0, 0), rmask)

    # Сколы эмали: чёрные пятна с бурой каймой — по закатанному краю горла, у пояса, на носике и крышке; под сколом металл.
    chips = Image.new('L', (W, W), 0)
    dc = ImageDraw.Draw(chips)

    def chip(x, y, r):
        pts = []
        for i in range(9):
            a = 2 * math.pi * i / 9
            q = r * rnd.uniform(0.55, 1.2)
            pts.append((x + math.cos(a) * q * 1.5, y + math.sin(a) * q))
        dc.polygon(pts, fill=255)

    for _ in range(26):
        chip(rnd.uniform(bx[0], bx[2]), bx[1] + rnd.uniform(0, bh * 0.05), rnd.uniform(5, 16))
    for _ in range(14):
        chip(rnd.uniform(bx[0], bx[2]), bx[1] + rnd.uniform(bh * 0.1, bh * 0.66), rnd.uniform(4, 13))
    for _ in range(8):
        chip(rnd.uniform(lx[0], lx[2]), rnd.uniform(lx[1], lx[1] + (lx[3] - lx[1]) * 0.35), rnd.uniform(5, 12))
    for _ in range(6):
        chip(rnd.uniform(sx[0], sx[2]), rnd.uniform(sx[1], sx[1] + (sx[3] - sx[1]) * 0.3), rnd.uniform(4, 10))
    halo = chips.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2))
    col.paste(Image.new('RGB', (W, W), (110, 62, 34)), (0, 0), halo)
    col.paste(Image.new('RGB', (W, W), (20, 19, 20)), (0, 0), chips)
    rough.paste(Image.new('L', (W, W), 190), (0, 0), halo)
    metal.paste(Image.new('L', (W, W), 150), (0, 0), chips)
    # Рельеф: скол — ямка в слое эмали; копоть и чугун — шершавые.
    height.paste(Image.new('L', (W, W), 60), (0, 0), chips.filter(ImageFilter.GaussianBlur(1.5)))
    grain = noise(rnd, W, 3).point(lambda v: 118 + v // 12)
    gmask = ImageChops.lighter(soot, rmask.point(lambda v: 255 if v else 0))
    im = Image.new('L', (W, W), 0)
    ImageDraw.Draw(im).rectangle(ix, fill=255)
    gmask = ImageChops.lighter(gmask, im)
    height.paste(grain, (0, 0), gmask)
    # Лёгкая неровность эмали: без неё блик слишком ровный, «пластиковый».
    wob = noise(rnd, W, 180).point(lambda v: 120 + v // 16)
    height = ImageChops.add(height, wob, 2, -64)

    return (col, *maps(height, rough, metal))


def maps(height, rough, metal, k=3.0):
    """Карта нормалей из высоты (OpenGL: +Y вверх, а v листа идёт вниз) и карта «затенение, шероховатость, металл»."""
    W = height.size[0]
    hx = ImageChops.subtract(ImageChops.offset(height, 1, 0), ImageChops.offset(height, -1, 0), 1.0 / k, 128)
    hy = ImageChops.subtract(ImageChops.offset(height, 0, -1), ImageChops.offset(height, 0, 1), 1.0 / k, 128)
    nmap = Image.merge('RGB', (hx, hy, Image.new('L', (W, W), 255)))
    orm = Image.merge('RGB', (Image.new('L', (W, W), 255), rough, metal))
    return nmap, orm


def write(root, name, col, nmap, orm):
    """Записать собранную сетку и карты исходником для импорта: <root>/<name>/<name>.gltf, .bin и три картинки."""
    out = os.path.join(root, name)
    os.makedirs(out, exist_ok=True)
    col.save(os.path.join(out, f'{name}_diff.png'))
    nmap.save(os.path.join(out, f'{name}_nor.png'))
    orm.save(os.path.join(out, f'{name}_arm.png'))
    blob = b''.join(struct.pack('<3f', *p) for p in pos) + b''.join(struct.pack('<3f', *n) for n in nrm) + b''.join(struct.pack('<2f', *u) for u in uvs) + struct.pack('<%dI' % len(idx), *idx)
    nv = len(pos)
    with open(os.path.join(out, f'{name}.bin'), 'wb') as f:
        f.write(blob)
    doc = {
        'asset': {'version': '2.0', 'generator': 'vylazka/tools/things_hq'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 2}}, 'normalTexture': {'index': 1}, 'occlusionTexture': {'index': 2}}],
        'textures': [{'source': 0}, {'source': 1}, {'source': 2}],
        'images': [{'uri': f'{name}_diff.png'}, {'uri': f'{name}_nor.png'}, {'uri': f'{name}_arm.png'}],
        'buffers': [{'uri': f'{name}.bin', 'byteLength': len(blob)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': nv * 12},
            {'buffer': 0, 'byteOffset': nv * 12, 'byteLength': nv * 12},
            {'buffer': 0, 'byteOffset': nv * 24, 'byteLength': nv * 8},
            {'buffer': 0, 'byteOffset': nv * 32, 'byteLength': len(idx) * 4},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': nv, 'type': 'VEC3', 'min': [min(p[k] for p in pos) for k in range(3)], 'max': [max(p[k] for p in pos) for k in range(3)]},
            {'bufferView': 1, 'componentType': 5126, 'count': nv, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': nv, 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
        ],
    }
    with open(os.path.join(out, f'{name}.gltf'), 'w', encoding='utf-8') as f:
        json.dump(doc, f)
    print(f'{name}: {len(idx) // 3} треугольников, {nv} вершин → {out}')


def reset():
    """Начать новую вещь: сетка пустая."""
    for a in (pos, nrm, uvs, idx):
        a.clear()


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build_mesh()
    write(sys.argv[1], 'kettle', *paint())


if __name__ == '__main__':
    main()
