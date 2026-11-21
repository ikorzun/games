#!/usr/bin/env python3
"""
Перевод готовых моделей (glTF, набор KayKit Furniture Bits, CC0) в формат игры.

Запуск вручную, в сборку и CI не входит (нужен Pillow):
    python3 -I scripts/import_models.py <каталог распакованного набора>
В каталоге ждём Assets/gltf/<имя>.gltf (+ .bin) и Assets/texture/furniturebits_texture.png.
Результат — src/world/models_data.ts (ГЕНЕРИРУЕМЫЙ файл, руками не правится).

Что делает для каждой строки таблицы MODELS:
  - читает glTF и .bin сам, без библиотек: позиции, нормали, uv, индексы;
  - цвет берёт из атласа-градиента: в точке uv каждой вершины ближайший тексель (v = 0 — верхняя строка),
    получается sRGB-цвет вершины;
  - масштабирует в метры (в наборе 1 единица ~ 0,7 м; для модели можно задать свой масштаб);
  - при необходимости поворачивает вокруг y на turn четвертей оборота (как Xf.rot: (x, z) -> (z, -x));
  - переносит начало координат по правилам реквизита: пол (floor) — по центру x, низ y = 0, спина z = 0;
    свободный (free) — по центру x и z, низ y = 0; настенный (wall) — по центру x, z = 0, низ y = 0;
  - склеивает одинаковые вершины (позиция, нормаль, цвет);
  - квантует: позиции uint16 по габариту модели, нормали int8, цвета uint8, индексы uint16.
Порядок обхода граней сохраняется (glTF: против часовой, как и в игре). Поворот его не меняет.
"""
import base64
import json
import math
import os
import struct
import sys

from PIL import Image

# Исходное имя файла -> имя в игре, масштаб (единицы набора -> метры), опора, turn.
# Новую модель добавляют строкой сюда; опоры: floor / free / wall.
SCALE = 0.7
MODELS = [
    # (источник,                    игра,                 масштаб, опора,   turn)
    ('chair_A',                     'chair_a',            SCALE, 'floor', 0),
    ('chair_B',                     'chair_b',            SCALE, 'floor', 0),
    ('chair_C',                     'chair_c',            SCALE, 'floor', 0),
    ('chair_stool',                 'stool',              SCALE, 'floor', 0),
    ('armchair',                    'armchair',           SCALE, 'floor', 0),
    ('couch',                       'couch',              SCALE, 'floor', 0),
    ('table_low',                   'table_low',          SCALE, 'floor', 0),
    ('table_medium',                'table_medium',       SCALE, 'floor', 0),
    ('table_medium_long',           'table_long',         SCALE, 'floor', 0),
    ('table_small',                 'table_small',        SCALE, 'floor', 0),
    ('cabinet_medium',              'cabinet_medium',     SCALE, 'floor', 0),
    ('cabinet_small',               'cabinet_small',      SCALE, 'floor', 0),
    ('shelf_A_big',                 'shelf_big',          SCALE, 'floor', 0),
    ('shelf_B_large_decorated',     'shelf_large',        SCALE, 'floor', 0),
    ('lamp_standing',               'lamp_standing',      SCALE, 'floor', 0),
    ('lamp_table',                  'lamp_table',         SCALE, 'free',  0),
    ('cactus_medium_A',             'cactus',             SCALE, 'free',  0),
    ('cactus_small_A',              'cactus_small',       SCALE, 'free',  0),
    ('bed_single_A',                'bed_single',         SCALE, 'floor', 0),
    ('bed_double_A',                'bed_double',         SCALE, 'floor', 0),
    ('pictureframe_large_A',        'picture_large',      SCALE, 'wall',  0),
    ('pictureframe_medium',         'picture_medium',     SCALE, 'wall',  0),
    ('pictureframe_small_A',        'picture_small',      SCALE, 'wall',  0),
    ('rug_rectangle_A',             'rug_rect',           SCALE, 'free',  0),
    ('rug_oval_A',                  'rug_oval',           SCALE, 'free',  0),
    ('pillow_A',                    'pillow',             SCALE, 'free',  0),
    ('book_set',                    'book_set',           SCALE, 'free',  0),
]

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'world', 'models_data.ts')
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_accessor(gl, blob, idx):
    """Массив значений аксессора: список кортежей (или чисел для SCALAR)."""
    acc = gl['accessors'][idx]
    view = gl['bufferViews'][acc['bufferView']]
    fmt, size = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    stride = view.get('byteStride') or size * n
    base = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = []
    for i in range(acc['count']):
        vals = struct.unpack_from('<' + fmt * n, blob, base + i * stride)
        out.append(vals[0] if n == 1 else vals)
    return out


def load_model(pack, src):
    path = os.path.join(pack, 'Assets', 'gltf', src + '.gltf')
    with open(path, 'r', encoding='utf-8') as f:
        gl = json.load(f)
    assert len(gl['meshes']) == 1 and len(gl['meshes'][0]['primitives']) == 1, src
    uri = gl['buffers'][0]['uri']
    assert '/' not in uri and '\\' not in uri and not uri.startswith('data:'), 'ждём .bin рядом: ' + src
    with open(os.path.join(pack, 'Assets', 'gltf', uri), 'rb') as f:
        blob = f.read()
    prim = gl['meshes'][0]['primitives'][0]
    at = prim['attributes']
    return (read_accessor(gl, blob, at['POSITION']), read_accessor(gl, blob, at['NORMAL']),
            read_accessor(gl, blob, at['TEXCOORD_0']), read_accessor(gl, blob, prim['indices']))


def turn_xz(x, z, t):
    """t четвертей оборота, как Xf.rot в игре."""
    for _ in range(t % 4):
        x, z = z, -x
    return x, z


def convert(pack, tex, src, scale, mount, turn):
    P, N, UV, I = load_model(pack, src)
    w, h = tex.size
    px = tex.load()
    verts = []
    for p, n, uv in zip(P, N, UV):
        x, y, z = (c * scale for c in p)
        x, z = turn_xz(x, z, turn)
        nx, nz = turn_xz(n[0], n[2], turn)
        # Ближайший тексель; v = 0 — верхняя строка.
        tx = min(w - 1, max(0, int(math.floor(uv[0] * w))))
        ty = min(h - 1, max(0, int(math.floor(uv[1] * h))))
        verts.append(((x, y, z), (nx, n[1], nz), px[tx, ty][:3]))
    lo = [min(v[0][k] for v in verts) for k in range(3)]
    hi = [max(v[0][k] for v in verts) for k in range(3)]
    # Перенос начала координат.
    if mount == 'floor' or mount == 'wall':
        off = [(lo[0] + hi[0]) / 2, lo[1], lo[2]]
    elif mount == 'free':
        off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    else:
        raise SystemExit('неизвестная опора: ' + mount)
    lo = [lo[k] - off[k] for k in range(3)]
    hi = [hi[k] - off[k] for k in range(3)]
    span = [max(hi[k] - lo[k], 1e-9) for k in range(3)]
    # Квантование и склейка.
    table, remap = {}, []
    pos, nrm, col = [], [], []
    for (p, n, c) in verts:
        q = tuple(int(round((p[k] - off[k] - lo[k]) / span[k] * 65535)) for k in range(3))
        ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
        qn = tuple(max(-127, min(127, int(round(n[k] / ln * 127)))) for k in range(3))
        key = (q, qn, tuple(c))
        if key not in table:
            table[key] = len(pos)
            pos.append(q)
            nrm.append(qn)
            col.append(tuple(c))
        remap.append(table[key])
    idx = [remap[i] for i in I]
    # Вырожденные после склейки треугольники выбрасываем.
    tris = [idx[t:t + 3] for t in range(0, len(idx), 3)]
    tris = [t for t in tris if len(set(t)) == 3]
    flat = [i for t in tris for i in t]
    assert len(pos) < 65536

    def b64(b):
        return base64.b64encode(b).decode('ascii')

    return {
        'v': len(pos), 't': len(tris),
        'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi],
        'pos': b64(struct.pack('<%dH' % (len(pos) * 3), *[c for p in pos for c in p])),
        'nrm': b64(struct.pack('<%db' % (len(nrm) * 3), *[c for n in nrm for c in n])),
        'col': b64(struct.pack('<%dB' % (len(col) * 3), *[c for q in col for c in q])),
        'idx': b64(struct.pack('<%dH' % len(flat), *flat)),
    }


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pack = sys.argv[1]
    tex = Image.open(os.path.join(pack, 'Assets', 'texture', 'furniturebits_texture.png')).convert('RGB')
    lines = [
        '// ГЕНЕРИРУЕМЫЙ ФАЙЛ: не править руками. Источник — scripts/import_models.py (набор KayKit Furniture Bits 1.0,',
        '// Kay Lousberg, CC0, https://kaylousberg.itch.io/furniture-bits). Перегенерация: см. docs/vylazka/assets.md.',
        '// Формат записи: pos — uint16 x3 на вершину по габариту min..max, nrm — int8 x3 (/127), col — uint8 x3 (sRGB),',
        '// idx — uint16, по три на треугольник; всё в base64 (little-endian).',
        '',
        'export interface ModelRecord {',
        '  /** Вершин и треугольников. */',
        '  v: number;',
        '  t: number;',
        '  /** Габарит, м, в координатах реквизита. */',
        '  min: [number, number, number];',
        '  max: [number, number, number];',
        '  pos: string;',
        '  nrm: string;',
        '  col: string;',
        '  idx: string;',
        '}',
        '',
        'export const MODEL_DATA: Record<string, ModelRecord> = {',
    ]
    for src, name, scale, mount, turn in MODELS:
        r = convert(pack, tex, src, scale, mount, turn)
        print('%-16s <- %-24s вершин %4d, треугольников %3d, габарит %.2f x %.2f x %.2f м' % (
            name, src, r['v'], r['t'], r['max'][0] - r['min'][0], r['max'][1] - r['min'][1], r['max'][2] - r['min'][2]))
        lines.append('  %s: {' % name)
        lines.append('    v: %d, t: %d, min: %s, max: %s,' % (r['v'], r['t'], json.dumps(r['min']), json.dumps(r['max'])))
        for k in ('pos', 'nrm', 'col', 'idx'):
            lines.append("    %s: '%s'," % (k, r[k]))
        lines.append('  },')
    lines.append('};')
    text = '\n'.join(lines) + '\n'
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print('записано %s: %d КБ' % (os.path.normpath(OUT), len(text.encode()) // 1024))


if __name__ == '__main__':
    main()
