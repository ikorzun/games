#!/usr/bin/env python3
"""
Вещи памяти в подробном виде (партнёр 24.11: «полигонов должно быть больше, материал лучше… максимально реалистичное
качество, которое не сломает производительность»; docs/vylazka/things_hq.md).

Берёт готовую модель glTF (.gltf рядом с .bin и картами — так отдаёт Poly Haven — или один .glb, как выгружает Blender) и
переводит её в формат игры:
  public/assets/things/<имя>.bin     — сетка: позиции, нормали, развёртка, индексы (формат ниже);
  public/assets/things/<имя>_c.webp  — цвет (RGB) и затенение щелей (A, из карты AO);
  public/assets/things/<имя>_n.webp  — нормали (RG, как в glTF: +Y вверх), шероховатость (B), металл (A);
  src/world/thing_hq_meta.ts         — опись (блок между // <generated> и // </generated>);
  public/credits_things.txt          — откуда модели и на каких условиях.
Игра качает файлы вещи по нужде, когда вещь появляется (src/world/thing_hq.ts); в ядро сборки входит только опись.

Запуск вручную, в сборку и CI не входит (нужен Pillow; упрощение — node и meshoptimizer из node_modules игры):
    python3 -I scripts/import_thing_hq.py <каталог с исходниками>
В каталоге исходников — по папке на модель (имя папки — из таблицы SOURCES ниже); в репозиторий они не кладутся.
Скачанное — недоверенные данные: его только разбирают.

Правила модели (те же, что в инструкции для Blender, docs/vylazka/things_hq.md, §5): метры, +Y вверх, лицом к +Z; одна
развёртка без наложений; карты — цвет, нормали (OpenGL), шероховатость и металл. Несколько материалов сводятся в один лист
карт сеткой (развёртка каждой детали сжимается в свою клетку) — поэтому у деталей развёртка должна лежать в квадрате 0…1.

Формат .bin (little-endian): 'VZT1', u32 вершин, u32 индексов, f32×3 min, f32×3 max (габарит, м), f32×2 uvMin, f32×2 uvMax,
затем позиции u16×3 (доля габарита), развёртка u16×2 (доля uvMin…uvMax), нормали i8×3 + 1 байт выравнивания,
индексы u16 (вершин ≤ 65535) или u32.
"""
import json
import math
import os
import struct
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'things')
OUT_META = os.path.join(ROOT, 'src', 'world', 'thing_hq_meta.ts')
OUT_CREDITS = os.path.join(ROOT, 'public', 'credits_things.txt')

# Бюджеты (docs/vylazka/things_hq.md, §3): треугольников и сторона карт по классу вещи.
BUDGET = {'small': (12000, 512), 'medium': (25000, 1024), 'large': (40000, 1024)}

# имя в игре → исходник и что с ним сделать:
#   src — (папка, файл); klass — класс бюджета; turn — четверти оборота вокруг вертикали (лицом к +z); height — высота в игре, м
#   (None — как есть); credit — строка авторства; tex — сторона листа карт, если не по классу;
#   patches — что закрасить на карте цвета: (материал, u0, v0, u1, v1) в долях его карты — цветом вокруг (марка на циферблате);
#   art — материал, чью картинку заменить нашей (снимок в рамке); hue — (от, до, в какой тон), градусы: перекрасить краску.
SOURCES = {
    # Квиз 24.11: «Всегда подробная, цвет ярче» — бирюзовая краска будильника перекрашена в красный болванки.
    'alarm_clock': dict(src=('alarm_clock_01', 'alarm_clock_01.gltf'), klass='small', turn=0, height=0.2, hue=(120, 215, 4), credit='Alarm Clock 01 by James Ray Cock and Yann Kervran, Poly Haven (polyhaven.com), CC0'),
    'wet_floor_sign': dict(src=('WetFloorSign_01', 'WetFloorSign_01.gltf'), klass='small', turn=0, height=None, credit='Wet Floor Sign 01 by Fran Calvente, Poly Haven (polyhaven.com), CC0'),
    'office_clock': dict(src=('wall_clock', 'wall_clock.gltf'), klass='small', turn=0, height=0.34, patches=[('wall_clock', 0.232, 0.592, 0.308, 0.652)], credit='Wall Clock by PierreB3D, Poly Haven (polyhaven.com), CC0'),
    # Sand3D (CC-BY-4.0): форма подробная, карт нет — у каждой детали свой цвет, шероховатость и металл клеткой листа.
    'remote': dict(src=('remote', 'model.glb'), klass='small', turn=0, height=None, fit=0.22, tex=256, credit='"Remote Control" by budakbina, https://sketchfab.com/3d-models/c7ec86e7feb746489b30b4a01c2510af, CC-BY-4.0; modified: rewritten as a sand3d program'),
    'office_terminal': dict(src=('office_terminal', 'model.glb'), klass='medium', turn=2, height=None, fit=0.52, tex=256, credit='"Vic-30" by fisherw, https://sketchfab.com/3d-models/98869ceaacdc4b1ebfca60caad424c09, CC-BY-4.0; modified: rewritten as a sand3d program'),
    'office_chair': dict(src=('office_chair', 'model.gltf'), klass='large', turn=0, height=1.02, tex=256, credit='"Silla DISGRAF 8 B" by jacavision, https://sketchfab.com/3d-models/2ef40e2a05f74110bb90c3072fa3c2cd, CC-BY-4.0; modified: rewritten as a sand3d program'),
    'water_cooler': dict(src=('water_cooler', 'model.glb'), klass='large', turn=0, height=1.35, tex=256, credit='NVIDIA SimReady assets: "water_cooler_a01" by NVIDIA, https://huggingface.co/datasets/nvidia/simready-assets/tree/653d91e182011f357cf1644013cc94ddf194d349/water_cooler_a01, CC BY 4.0; modified: rewritten as a sand3d program'),
    'desk_phone': dict(src=('desk_phone', 'model.glb'), klass='small', turn=0, height=None, fit=0.24, tex=256, credit='"Office Phone" by maxdragon, https://sketchfab.com/3d-models/4176a01b6d0b4d13ad165c0df278a6b5, CC-BY-4.0; modified: rewritten as a sand3d program'),
    'st_cup': dict(src=('st_cup', 'model.glb'), klass='small', turn=0, height=0.14, tex=256, credit='"Coffee Paper-cup" by DenPennicus, https://sketchfab.com/3d-models/70d51490fb8e4de0a132d9f543859a35, CC-BY-4.0; modified: rewritten as a sand3d program'),
    # Чайник собран программой (tools/things_hq/make_kettle.py): в каталогах нет эмалированного, на плите.
    'kettle': dict(src=('kettle', 'kettle.gltf'), klass='medium', turn=0, height=None, credit='Kettle: made for Untitled Session (tools/things_hq/make_kettle.py)'),
    # Пять вещей, собранных программой (tools/things_hq/make_small.py): в каталогах их нет.
    'st_ticket': dict(src=('st_ticket', 'st_ticket.gltf'), klass='small', turn=0, height=None, credit='Ticket: made for Untitled Session (tools/things_hq/make_small.py)'),
    'st_note': dict(src=('st_note', 'st_note.gltf'), klass='small', turn=0, height=None, credit='Note: made for Untitled Session (tools/things_hq/make_small.py)'),
    'st_key': dict(src=('st_key', 'st_key.gltf'), klass='small', turn=0, height=None, credit='Key with a tag: made for Untitled Session (tools/things_hq/make_small.py)'),
    'slippers': dict(src=('slippers', 'slippers.gltf'), klass='small', turn=1, height=None, credit='Slippers: made for Untitled Session (tools/things_hq/make_small.py)'),
    'st_coat': dict(src=('st_coat', 'st_coat.gltf'), klass='medium', turn=0, height=None, tex=512, credit='Coat: made for Untitled Session (tools/things_hq/make_small.py)'),
    'photo_frame': dict(src=('standing_picture_frame_01', 'standing_picture_frame_01.gltf'), klass='small', turn=3, height=0.3, tex=1024, art='standing_picture_frame_01_artwork', credit='Standing Picture Frame 01 by James Ray Cock, Poly Haven (polyhaven.com), CC0'),
}
# Насыщенность карты цвета у всех подробных вещей (квиз 24.11: «цвет ярче»): вещь памяти должна находиться взглядом.
SATURATION = 1.4


def group_photo(size):
    """Снимок в рамке: «фотография. пятеро. лиц не разобрать» — пять фигур, вместо лиц светлые пятна. Рисуется здесь, без чужих картинок."""
    import random

    from PIL import ImageDraw, ImageFilter

    rnd = random.Random(5)
    w = h = size
    img = Image.new('RGB', (w, h), (168, 150, 118))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(190 - 70 * t), int(172 - 68 * t), int(138 - 62 * t)))
    for i in range(5):
        cx = w * (0.16 + 0.17 * i) + rnd.uniform(-0.01, 0.01) * w
        top = h * (0.3 + (0.05 if i % 2 else 0.0) + rnd.uniform(-0.02, 0.02))
        bw = w * 0.085
        tone = rnd.randint(38, 70)
        d.ellipse([cx - bw, top + h * 0.1, cx + bw, h * 1.1], fill=(tone, tone - 6, tone - 14))
        d.ellipse([cx - bw * 0.62, top - h * 0.03, cx + bw * 0.62, top + h * 0.13], fill=(236, 226, 200))
    img = img.filter(ImageFilter.GaussianBlur(size / 90))
    px = img.load()
    for y in range(h):
        for x in range(w):
            g = rnd.randint(-9, 9)
            r, gg, bb = px[x, y]
            px[x, y] = (max(0, min(255, r + g)), max(0, min(255, gg + g)), max(0, min(255, bb + g)))
    return img


def grade(img, hue):
    """Насыщенность и (если задано) перекраска: тон из полосы hue[0]…hue[1] градусов уходит в hue[2]."""
    h, s, v = img.convert('HSV').split()
    s = s.point(lambda x: min(255, int(x * SATURATION)))
    if hue:
        lo, hi, to = (int(x / 360 * 255) for x in hue)
        # Перекрашенное — гуще и чуть темнее: красная краска болванки была плотнее выцветшей бирюзы оригинала.
        mask = Image.composite(h.point(lambda x: 255 if lo <= x <= hi else 0), Image.new('L', h.size, 0), s.point(lambda x: 255 if x > 28 else 0))
        h = Image.composite(Image.new('L', h.size, to), h, mask)
        s = Image.composite(s.point(lambda x: min(255, int(x * 2.1 + 70))), s, mask)
        v = Image.composite(v.point(lambda x: int(x * 0.86)), v, mask)
    return Image.merge('HSV', (h, s, v)).convert('RGB')


COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_gltf(path):
    """glTF или GLB → (json, [буферы], каталог рядом с файлом, {номер картинки: байты} для вшитых)."""
    base = os.path.dirname(path)
    with open(path, 'rb') as f:
        raw = f.read()
    if raw[:4] == b'glTF':
        _, _, total = struct.unpack_from('<III', raw, 0)
        off = 12
        doc = None
        blob = b''
        while off < total:
            n, kind = struct.unpack_from('<II', raw, off)
            body = raw[off + 8 : off + 8 + n]
            if kind == 0x4E4F534A:
                doc = json.loads(body)
            elif kind == 0x004E4942:
                blob = body
            off += 8 + n
        return doc, [blob], base
    doc = json.loads(raw)
    bufs = []
    for b in doc.get('buffers', []):
        with open(os.path.join(base, b['uri']), 'rb') as f:
            bufs.append(f.read())
    return doc, bufs, base


def accessor(doc, bufs, i):
    a = doc['accessors'][i]
    v = doc['bufferViews'][a['bufferView']]
    fmt, size = COMPONENTS[a['componentType']]
    w = WIDTH[a['type']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 0) or size * w
    buf = bufs[v['buffer']]
    out = []
    for k in range(a['count']):
        vals = struct.unpack_from('<' + fmt * w, buf, start + k * stride)
        if a.get('normalized'):
            m = {'b': 127.0, 'B': 255.0, 'h': 32767.0, 'H': 65535.0}[fmt]
            vals = tuple(max(-1.0, x / m) for x in vals)
        out.append(vals if w > 1 else vals[0])
    return out


def mat_mul(a, b):
    return [sum(a[i * 4 + k] * b[k * 4 + j] for k in range(4)) for i in range(4) for j in range(4)]


def node_matrix(n):
    """Матрица узла по строкам (glTF хранит по столбцам)."""
    if 'matrix' in n:
        m = n['matrix']
        return [m[j * 4 + i] for i in range(4) for j in range(4)]
    t = n.get('translation', [0, 0, 0])
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * s[0], r[1] * s[1], r[2] * s[2], t[0], r[3] * s[0], r[4] * s[1], r[5] * s[2], t[1], r[6] * s[0], r[7] * s[1], r[8] * s[2], t[2], 0, 0, 0, 1]


def image_of(doc, bufs, base, tex_index):
    """Картинка текстуры glTF (файл рядом или вшитая в буфер)."""
    if tex_index is None:
        return None
    img = doc['images'][doc['textures'][tex_index]['source']]
    if 'uri' in img:
        return Image.open(os.path.join(base, img['uri']))
    v = doc['bufferViews'][img['bufferView']]
    import io

    return Image.open(io.BytesIO(bufs[v['buffer']][v.get('byteOffset', 0) : v.get('byteOffset', 0) + v['byteLength']]))


def collect(doc, bufs):
    """Все треугольники сцены в координатах мира: [(материал, позиции, нормали, развёртка, индексы)]."""
    parts = []

    def walk(ni, parent):
        n = doc['nodes'][ni]
        m = mat_mul(parent, node_matrix(n))
        if 'mesh' in n:
            for p in doc['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) != 4:
                    continue
                # Прозрачное (стекло циферблата) пока не берётся: у вещи игры один непрозрачный проход, и стекло легло бы
                # чёрной заглушкой поверх того, что под ним (docs/vylazka/things_hq.md, «Что не сделано»).
                if 'material' in p and doc['materials'][p['material']].get('alphaMode') == 'BLEND':
                    continue
                at = p['attributes']
                pos = accessor(doc, bufs, at['POSITION'])
                nrm = accessor(doc, bufs, at['NORMAL']) if 'NORMAL' in at else None
                uv = accessor(doc, bufs, at['TEXCOORD_0']) if 'TEXCOORD_0' in at else [(0.5, 0.5)] * len(pos)
                idx = accessor(doc, bufs, p['indices']) if 'indices' in p else list(range(len(pos)))
                wp = [(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]) for x, y, z in pos]
                # Нормали — той же матрицей без сдвига (масштаб у вещей ровный), затем к единице.
                wn = []
                for k in range(len(pos)):
                    x, y, z = nrm[k] if nrm else (0.0, 1.0, 0.0)
                    a, b, c = m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z
                    l = math.sqrt(a * a + b * b + c * c) or 1.0
                    wn.append((a / l, b / l, c / l))
                # Отражающая матрица выворачивает обход треугольников.
                det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
                if det < 0:
                    idx = [idx[i + k] for i in range(0, len(idx), 3) for k in (0, 2, 1)]
                parts.append((p.get('material'), wp, wn, uv, idx))
        for c in n.get('children', []):
            walk(c, m)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    scene = doc['scenes'][doc.get('scene', 0)]
    for ni in scene['nodes']:
        walk(ni, ident)
    return parts


def bake_maps(doc, bufs, base, mats, size, patches, art, hue):
    """Карты всех материалов — в один лист сеткой. Возвращает (цвет+AO, нормали+шероховатость+металл, {материал: клетка})."""
    n = max(1, len(mats))
    grid = 1
    while grid * grid < n:
        grid += 1
    cell = size // grid
    col = Image.new('RGBA', (size, size), (128, 128, 128, 255))
    nrm = Image.new('RGBA', (size, size), (128, 128, 255, 0))
    cells = {}
    for k, mi in enumerate(mats):
        cx, cy = k % grid, k // grid
        cells[mi] = (cx / grid, cy / grid, 1.0 / grid)
        m = doc['materials'][mi] if mi is not None else {}
        pbr = m.get('pbrMetallicRoughness', {})
        f = pbr.get('baseColorFactor', [1, 1, 1, 1])
        base_img = image_of(doc, bufs, base, pbr.get('baseColorTexture', {}).get('index'))
        orm_img = image_of(doc, bufs, base, pbr.get('metallicRoughnessTexture', {}).get('index'))
        ao_img = image_of(doc, bufs, base, m.get('occlusionTexture', {}).get('index'))
        n_img = image_of(doc, bufs, base, m.get('normalTexture', {}).get('index'))
        box = (cell, cell)
        if art and m.get('name') == art:
            c = group_photo(cell)
            n_img = None
            orm_img = None
            pbr = {'roughnessFactor': 0.45, 'metallicFactor': 0.0}
        elif base_img is not None:
            c = base_img.convert('RGB')
            # Закрасить то, чему в игре не место (марка на циферблате), цветом вокруг — до уменьшения, по карте материала.
            for name, u0, v0, u1, v1 in patches:
                if name != m.get('name'):
                    continue
                W, H = c.size
                bx = (int(u0 * W), int(v0 * H), int(u1 * W), int(v1 * H))
                ring = c.crop((bx[0] - 8, bx[1] - 8, bx[2] + 8, bx[1])).resize((1, 1), Image.BOX).getpixel((0, 0))
                c.paste(ring, bx)
            c = grade(c.resize(box, Image.LANCZOS), hue)
        else:
            # Цвет без карты: множитель материала (линейный) → sRGB.
            c = grade(Image.new('RGB', box, tuple(int(round(255 * (x ** (1 / 2.2)))) for x in f[:3])), hue)
        if orm_img is not None:
            o = orm_img.convert('RGB').resize(box, Image.LANCZOS)
            ao_ch, rough, metal = o.split()
            if ao_img is None:
                ao_ch = Image.new('L', box, 255)
        else:
            # По правилам glTF шероховатость и металл без значения — единица; None пишет выгрузка sand3d у стали.
            rf, mf = pbr.get('roughnessFactor'), pbr.get('metallicFactor')
            rough = Image.new('L', box, int(round(255 * (1.0 if rf is None else rf))))
            metal = Image.new('L', box, int(round(255 * (1.0 if mf is None else mf))))
            ao_ch = Image.new('L', box, 255)
        if ao_img is not None:
            ao_ch = ao_img.convert('RGB').resize(box, Image.LANCZOS).split()[0]
        if n_img is not None:
            nr, ng, _ = n_img.convert('RGB').resize(box, Image.LANCZOS).split()
        else:
            nr, ng = Image.new('L', box, 128), Image.new('L', box, 128)
        col.paste(Image.merge('RGBA', (*c.split(), ao_ch)), (cx * cell, cy * cell))
        nrm.paste(Image.merge('RGBA', (nr, ng, rough, metal)), (cx * cell, cy * cell))
    return col, nrm, cells


def simplify(pos, nrm, uv, idx, target):
    """meshoptimizer (node, tools/things_hq/simplify.mjs): форма, нормали и швы развёртки берегутся."""
    nv = len(pos)
    blob = struct.pack('<III', nv, len(idx), target)
    blob += b''.join(struct.pack('<8f', *pos[i], *nrm[i], *uv[i]) for i in range(nv))
    blob += struct.pack('<%dI' % len(idx), *idx)
    out = subprocess.run(['node', os.path.join(ROOT, 'tools', 'things_hq', 'simplify.mjs')], input=blob, stdout=subprocess.PIPE, check=True, cwd=ROOT).stdout
    nv2, ni2 = struct.unpack_from('<II', out, 0)
    off = 8
    p2, n2, u2 = [], [], []
    for _ in range(nv2):
        v = struct.unpack_from('<8f', out, off)
        off += 32
        p2.append(v[0:3])
        n2.append(v[3:6])
        u2.append(v[6:8])
    return p2, n2, u2, list(struct.unpack_from('<%dI' % ni2, out, off))


def build(name, src_root):
    src = SOURCES[name]
    folder, fname = src['src']
    turn, height, credit = src['turn'], src['height'], src['credit']
    max_tris, tex = BUDGET[src['klass']]
    tex = src.get('tex', tex)
    doc, bufs, base = load_gltf(os.path.join(src_root, folder, fname))
    parts = collect(doc, bufs)
    mats = []
    for p in parts:
        if p[0] not in mats:
            mats.append(p[0])
    col, nmap, cells = bake_maps(doc, bufs, base, mats, tex, src.get('patches', []), src.get('art'), src.get('hue'))
    pos, nrm, uv, idx = [], [], [], []
    for mi, wp, wn, wuv, widx in parts:
        cx, cy, cs = cells[mi]
        first = len(pos)
        pos += wp
        nrm += wn
        # Развёртка детали — в свою клетку листа (у одной детали клетка — весь лист).
        uv += [(cx + (u % 1.0 if not 0.0 <= u <= 1.0 else u) * cs, cy + (v % 1.0 if not 0.0 <= v <= 1.0 else v) * cs) for u, v in wuv] if len(mats) > 1 else list(wuv)
        idx += [first + i for i in widx]
    # Четверти оборота вокруг вертикали: лицом вещь должна смотреть в +z.
    for _ in range(turn % 4):
        pos = [(z, y, -x) for x, y, z in pos]
        nrm = [(z, y, -x) for x, y, z in nrm]
    lo = [min(p[k] for p in pos) for k in range(3)]
    hi = [max(p[k] for p in pos) for k in range(3)]
    s = (height / (hi[1] - lo[1])) if height else 1.0
    # fit — наибольший размер вещи, м (для лежащих: пульт, телефон).
    if src.get('fit'):
        s = src['fit'] / max(hi[k] - lo[k] for k in range(3))
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    # Начало координат вещи — середина основания: так стоит и болванка игры (world/thing_mesh.ts).
    pos = [((x - cx) * s, (y - lo[1]) * s, (z - cz) * s) for x, y, z in pos]
    src_tris = len(idx) // 3
    if src_tris > max_tris:
        pos, nrm, uv, idx = simplify(pos, nrm, uv, idx, max_tris)
    lo = [min(p[k] for p in pos) for k in range(3)]
    hi = [max(p[k] for p in pos) for k in range(3)]
    ulo = [min(u[k] for u in uv) for k in range(2)]
    uhi = [max(u[k] for u in uv) for k in range(2)]
    nv = len(pos)
    q = lambda v, a, b: max(0, min(65535, int(round((v - a) / ((b - a) or 1.0) * 65535))))
    blob = b'VZT1' + struct.pack('<II', nv, len(idx)) + struct.pack('<3f3f2f2f', *lo, *hi, *ulo, *uhi)
    blob += b''.join(struct.pack('<3H', *(q(p[k], lo[k], hi[k]) for k in range(3))) for p in pos)
    blob += b''.join(struct.pack('<2H', *(q(u[k], ulo[k], uhi[k]) for k in range(2))) for u in uv)
    blob += b''.join(struct.pack('<3bx', *(max(-127, min(127, int(round(c * 127)))) for c in n)) for n in nrm)
    while len(blob) % 4:
        blob += b'\0'
    blob += struct.pack('<%d%s' % (len(idx), 'H' if nv <= 65535 else 'I'), *idx)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name + '.bin'), 'wb') as f:
        f.write(blob)
    # exact — цвет под нулевой альфой не выбрасывать: в альфе лежат данные (AO, металл), а не прозрачность.
    col.save(os.path.join(OUT_DIR, name + '_c.webp'), quality=86, method=6, exact=True)
    nmap.save(os.path.join(OUT_DIR, name + '_n.webp'), quality=90, method=6, exact=True)
    sizes = [os.path.getsize(os.path.join(OUT_DIR, name + e)) for e in ('.bin', '_c.webp', '_n.webp')]
    print(f'{name}: {src_tris} → {len(idx) // 3} треугольников, {nv} вершин, карты {tex}², файлы {sizes[0] // 1024} + {sizes[1] // 1024} + {sizes[2] // 1024} КБ, габарит {[round(hi[k] - lo[k], 3) for k in range(3)]}')
    r = lambda v: '[' + ', '.join(f'{x:.4f}' for x in v) + ']'
    return f"  {name}: {{ file: '{name}', tris: {len(idx) // 3}, verts: {nv}, tex: {tex}, min: {r(lo)}, max: {r(hi)}, credit: {json.dumps(credit, ensure_ascii=False)} }},", credit


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows, credits = [], []
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    for name in SOURCES:
        if only and name not in only:
            # Не пересобирать: строка описи остаётся прежней.
            import re

            old = re.search(r'^  %s: \{.*$' % name, open(OUT_META, encoding='utf-8').read(), re.M)
            if old:
                rows.append(old.group(0))
                credits.append(SOURCES[name]['credit'])
                continue
        row, credit = build(name, sys.argv[1])
        rows.append(row)
        credits.append(credit)
    with open(OUT_META, encoding='utf-8') as f:
        text = f.read()
    a, b = text.index('// <generated>'), text.index('// </generated>')
    block = '// <generated>\nexport const THING_HQ: Readonly<Record<string, ThingHqMeta>> = {\n' + '\n'.join(rows) + '\n};\n'
    with open(OUT_META, 'w', encoding='utf-8') as f:
        f.write(text[:a] + block + text[b:])
    with open(OUT_CREDITS, 'w', encoding='utf-8') as f:
        f.write('Untitled Session — detailed models of memory things\n\nChanges made for the game: scale and origin, texture maps resized and repacked, meshes simplified where noted in docs.\n\n' + '\n'.join(credits) + '\n')


if __name__ == '__main__':
    main()
