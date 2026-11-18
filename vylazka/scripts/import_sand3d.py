#!/usr/bin/env python3
"""
Полка Sand3D (партнёр 17.11, 23:30: «давай заменять вещи»; квиз 18.11: «Полка в конструкторе, меняешь ты», первой — мебель).

Настоящие вещи из каталога Sand3D (спейс Sandflow на Hugging Face, docs/vylazka/assets.md, «Sand3D») — в формат игры:
вещь скачивается готовым GLB, упрощается (gltfpack, meshoptimizer: каталог отдаёт до 60 тыс. треугольников на стул, игре
хватает тысячи-двух — на глаз разницы нет) и переводится в запись модели, как KayKit (scripts/import_models.py), но с
материалом на каждую вершину: деталь из дуба ложится на маткап дерева, ножки из стали — на сталь, обивка — на обивку.

Запуск вручную, в сборку и CI не входит (нужна сеть к спейсу и gltfpack из npm):
    GLTFPACK=<путь к gltfpack> python3 -I scripts/import_sand3d.py <каталог кэша>
В кэше — карточки (лицензия, строка авторства) и исходные GLB; в репозиторий они не кладутся. Результат (ГЕНЕРИРУЕМЫЕ
файлы, руками не правятся): src/world/sand3d_meta.ts — опись без вершин (размеры, опора, подпись, авторство; входит в
основную сборку), src/world/sand3d_data.ts — сами модели (отдельный кусок сборки, грузится, когда вещь нужна) и
public/credits_sand3d.txt — титры моделей в корне сборки. Лицензия всех взятых вещей CC-BY-4.0 (или свободнее): строка
авторства каждой обязательна в описи и титрах.

Новая вещь — строкой в SHELF: (id каталога, имя в игре, опора, четверти оборота, сколько треугольников оставить, подпись).
Опоры, как у реквизита: floor — у стены, спина z = 0, лицом в +z; free — посреди, по центру x и z. Четверти оборота
подобраны по рендерам с четырёх сторон: ящики, дверцы и сиденья смотрят в комнату, кровати и нары — длинной стороной
вдоль стены, как кровати игры (bed_home, bed_frame, bunk_triple).
"""
import base64
import json
import math
import os
import re
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://sandflow-sand3d-explorer.hf.space'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'world', 'sand3d_data.ts')
OUT_META = os.path.join(HERE, '..', 'src', 'world', 'sand3d_meta.ts')
OUT_CREDITS = os.path.join(HERE, '..', 'public', 'credits_sand3d.txt')

# (id каталога, имя в игре, опора, четверти оборота, треугольников, подпись по-русски)
SHELF = [
    # Убежище и дом, офис, зал ожидания (подбор 18.11 по листам рендеров).
    ('objaverse-ea60847abaaf4662b5f7c75b44f3ce9d', 's3_bunk_black', 'floor', 3, 1800, 'двухъярусная кровать, чёрная железная'),
    ('objaverse-f049870aa95141b881c43111963ab358', 's3_bunk_mattress', 'floor', 0, 1800, 'двухъярусная кровать с матрасами'),
    ('objaverse-0c1ea198d1ae4153a77e99b5bb4a3a47', 's3_bed_iron_white', 'floor', 1, 1600, 'железная кровать, белая, как в медпункте'),
    ('objaverse-e162e6533b224d769edb54cf55f7a62b', 's3_bed_iron_green', 'floor', 1, 1600, 'железная кровать с зелёным одеялом'),
    ('objaverse-2712fae0ee5f4b4d8581573bbfac4d3d', 's3_chair_carved', 'floor', 2, 1200, 'стул с резной спинкой, мягкое сиденье'),
    ('objaverse-5e1f7a56da4a4dab8ad64efd46ed9d9f', 's3_chair_ladder', 'floor', 0, 1200, 'деревянный стул с перекладинами в спинке'),
    ('objaverse-03e6e0abd1a34fe8906982f5e7e0a160', 's3_stool_wood', 'free', 0, 800, 'деревянный табурет на трёх ногах'),
    ('objaverse-f63ff45c124840709310932183c99b1a', 's3_table_kitchen', 'floor', 0, 1200, 'кухонный стол на точёных ножках'),
    ('articraft-rec_desk_with_drawer_9b15398564334344b74629c6e92edb81', 's3_table_work', 'floor', 2, 1200, 'рабочий стол с ящиком на железной раме'),
    ('objaverse-ed090b994a2247398775a49a2d95a6fe', 's3_wardrobe_plain', 'floor', 3, 900, 'платяной шкаф, светлый, две дверцы'),
    ('objaverse-244e006c51f94c63a95d501de5b62360', 's3_wardrobe_grey', 'floor', 0, 1400, 'серый платяной шкаф с ящиками внизу'),
    ('articraft-rec_drawer_cabinet_with_sliding_drawers_dcb143c2511744ba867d83d56a4b39bd', 's3_dresser', 'floor', 3, 1400, 'комод с ящиками, медные ручки'),
    ('objaverse-36b2775809194d4aa1369e54646f2ce7', 's3_bookcase_dark', 'floor', 2, 1200, 'книжный шкаф, тёмное дерево, открытые полки'),
    ('objaverse-467089fb90f44542b2098e78011b24bd', 's3_etagere', 'floor', 0, 1200, 'этажерка'),
    ('objaverse-6a892b8b024743479ba1168b92508d76', 's3_sofa_grey', 'floor', 2, 1600, 'диван с деревянными подлокотниками'),
    ('objaverse-e94fe18bb73047d999258d1af1c7d247', 's3_sofa_olive', 'floor', 2, 1600, 'старый диван, оливковая обивка'),
    ('objaverse-f56d30f5076e4a2a923746e2b9e5eb79', 's3_armchair_round', 'floor', 2, 1600, 'кресло с круглой спинкой'),
    ('objaverse-cec671d5768e4ee98b1c6d86157d3ef1', 's3_armchair_sixties', 'floor', 0, 1600, 'кресло шестидесятых, деревянные подлокотники'),
    ('objaverse-90a896d58d8946628a5ec961e5cc9911', 's3_locker_olive', 'floor', 3, 800, 'оливковый шкафчик, одна дверца'),
    ('articraft-rec_hingeddoor_cabinet_3ea15e426b0b4909b8489120f8c3f814', 's3_locker_grey', 'floor', 2, 800, 'серый металлический шкаф'),
    ('objaverse-e21ffc6d9ab34e759d8633a176f736f2', 's3_rack_metal', 'floor', 3, 1200, 'металлический стеллаж'),
    ('articraft-rec_desk_with_drawer_3ac30148e06d4e7aa50d98cc15b266de', 's3_desk_green', 'floor', 0, 1400, 'двухтумбовый стол с зелёным сукном'),
    ('objaverse-754a8ae1682d4e4db541a1c23b9939e6', 's3_desk_simple', 'floor', 3, 1200, 'письменный стол с тумбой'),
    ('objaverse-eb5257dc531847dfbe00c8a1900b6d40', 's3_bench_wood', 'floor', 0, 1200, 'деревянная скамья со спинкой'),
    ('objaverse-e3639e4198f1484984d80c1cef6598ed', 's3_nightstand', 'floor', 2, 900, 'тумбочка с двумя ящиками'),
    ('objaverse-d02ba46d170143e58ec7f9e4c7edb09c', 's3_crib', 'floor', 3, 1600, 'детская кроватка'),
    ('articraft-rec_hingeddoor_cabinet_1f47162db44740bcb4e29cc0e77d445f', 's3_cabinet_glass', 'floor', 2, 1200, 'шкаф со стеклянными дверцами'),
    ('simready-cabinet_file_b02', 's3_cabinet_medical', 'floor', 3, 1000, 'медицинский шкаф, узкий, стеклянный верх'),
    ('articraft-rec_desk_with_drawer_3ae3738970474ecea6bba0547892523d', 's3_desk_office', 'floor', 3, 1200, 'офисный стол с тумбой'),
    ('objaverse-f6852a46d21e47559f6c8a5e73035bed', 's3_desk_office_grey', 'floor', 1, 1000, 'серый офисный стол'),
    ('objaverse-03b13857f79d4b75889b16fd6c922a61', 's3_chair_office', 'free', 2, 1000, 'офисное кресло на колёсах'),
    ('articraft-rec_drawer_cabinet_with_sliding_drawers_1997a0c3e5264693a49458eecb80d779', 's3_filing_cabinet', 'floor', 3, 900, 'картотечный шкаф, три ящика'),
    ('articraft-rec_drawer_cabinet_with_sliding_drawers_53de4887a6fa4240928b10bd2bfca2f3', 's3_pedestal', 'floor', 2, 900, 'тумба под стол, четыре ящика'),
    ('objaverse-a7830bb1abc348bd9390d126648377fd', 's3_bookcase_office', 'floor', 2, 1000, 'шкаф для бумаг, открытые полки'),
    ('articraft-rec_standing_desk_with_synchronous_telescoping_legs_and_articulated_controls_9d0b44e302e14659af2cfe3f4fbd6903', 's3_table_meeting', 'free', 0, 1200, 'стол для переговоров'),
    ('objaverse-df67fa2a371a483b80be5fb62e5fafce', 's3_coat_stand', 'free', 0, 1000, 'напольная вешалка'),
    ('objaverse-3f5c609f471146e0bb115e8e2bee63fe', 's3_bench_blue', 'floor', 0, 1400, 'скамья, синяя, без подлокотников'),
    ('objaverse-26c89011fdbe4f3d8da663dd2ad7887a', 's3_bench_cast', 'floor', 0, 1400, 'скамья на чугунных ногах'),
    # Второй подбор 18.11 (партнёр: «замени всю мебель на новую самостоятельно»): вещи, которым в первом не нашлось пары.
    ('objaverse-1bed3d79642943bea0e7a04b289011b4', 's3_buffet_louvered', 'floor', 2, 1200, 'тумба: дверцы-жалюзи, открытая полка посередине'),
    ('articraft-rec_desk_with_drawer_ba4acc9c90a5440187cd1f98a3bfbabc', 's3_reception_desk', 'floor', 0, 900, 'стойка ресепшена, Г-образная, столешница под дерево'),
    ('simready-facilitySystem_kitchenette_module_a01', 's3_kitchenette', 'floor', 3, 1800, 'мини-кухня из стали: мойка с краном, плита, шкафчики'),
    ('objaverse-a35cfc0346624133bbc7c4124e444548', 's3_safe_old', 'floor', 2, 900, 'старый сейф: кодовый диск и ручка'),
]

# Масштаб, где каталог отдал вещь не в настоящем размере (на глаз по листу рендеров и по росту человека): диван — вдвое
# меньше настоящего (0,9 м в ширину, сиденье на 0,22 м), кухонный стол — 0,64 м в высоту (у настоящего 0,74), серый
# офисный стол — 0,96 м (стол «стоя», а он сидячий). 18.11, когда полка встала вместо мебели игры: письменный стол с
# тумбой — столешница на 0,88 м (у настоящего 0,75), офисное кресло — 0,86 м в ширину по подлокотникам (у настоящего
# около 0,7; шесть таких вокруг стола переговоров толкались локтями).
# Второй подбор: тумба под телевизор у каталога — 0,34 м в глубину (кинескоп глубже), сейф чуть больше ниши командной.
SCALE = {'s3_sofa_grey': 1.9, 's3_table_kitchen': 1.15, 's3_desk_office_grey': 0.8, 's3_desk_simple': 0.86, 's3_chair_office': 0.85,
         's3_buffet_louvered': 1.15, 's3_safe_old': 0.9}

# Дверцы и ящики (партнёр 18.11, 12:32: «открой дверцы и ящики у шкафов»). Подвижные детали берутся из шарниров каталога
# (s3d_joint в узлах GLB: тип, ось, пределы; узел шарнира — родитель детали), а где каталог шарниров не дал — по имени детали
# (MOVERS): ось дверцы — вертикаль у края, дальнего от ручки (или у петель; без них — у внешнего края шкафа), ящик выезжает
# вперёд. Игра открывает их по сиду (world/furniture.ts) на долю t от 0 до 1; t = 1 — предел, записанный здесь.
# Открытая деталь выходит вперёд от лица вещи не дальше OPEN_REACH: столько и прибавляется к габариту открываемой вещи,
# а большая дверца при этом открывается не до упора (дверца шкафа в полметра — примерно на 45°).
OPEN_REACH = 0.35
DOOR_MAX = math.radians(95)
DRAWER_SHARE = 0.8
# Шарниры каталога: берём дверцы и ящики; ручки, кнопки, крышки замков, ножки стола-трансформера, кран — нет.
JOINT_TAKE = re.compile(r'door|drawer|slide', re.I)
JOINT_SKIP = re.compile(r'handle|knob|button|stage|flap|accessory|lock|cover|tap|strainer|paddle|spin', re.I)
MOVERS = {
    's3_wardrobe_plain': [('door_panel', 'door'), ('companion_door', 'door')],
    's3_locker_olive': [('door', 'door')],
    's3_buffet_louvered': [('shutter_panel', 'door'), ('shutter_panel.001', 'door')],
    's3_safe_old': [('door_group', 'door')],
}
# Тумбочка не здесь: её «ящики» — одни лицевые панели на сплошном корпусе, выдвигать нечего.

# Пресеты материалов sand3d (имя материала начинается с пресета: «walnut #9a6d4c») → материалы игры (world/materials.ts).
MAT_ID = {'concrete': 0, 'steel': 5, 'rubber': 7, 'wood': 8, 'enamel': 9, 'brass': 10, 'paper': 15, 'metalGrey': 21,
          'bakelite': 23, 'glass': 24, 'leather': 25, 'veneer': 35, 'upholstery': 36}
PRESET = {
    'oak': 'wood', 'walnut': 'wood', 'pine': 'wood', 'birch': 'wood', 'wood': 'wood', 'teak': 'wood', 'mahogany': 'wood',
    'cherry': 'wood', 'maple': 'wood', 'plywood': 'wood', 'bamboo': 'wood',
    'steel': 'steel', 'brushed_steel': 'steel', 'chrome': 'steel', 'aluminium': 'steel', 'aluminum': 'steel', 'iron': 'steel',
    'metal': 'steel', 'painted_metal': 'metalGrey', 'cast_iron': 'metalGrey', 'zinc': 'steel',
    'brass': 'brass', 'copper': 'brass', 'bronze': 'brass', 'gold': 'brass',
    'plastic': 'bakelite', 'glossy_plastic': 'bakelite', 'abs': 'bakelite', 'resin': 'bakelite',
    'rubber': 'rubber', 'glass': 'glass', 'ceramic': 'enamel', 'porcelain': 'enamel', 'enamel': 'enamel',
    'fabric': 'upholstery', 'velvet': 'upholstery', 'cloth': 'upholstery', 'linen': 'upholstery', 'cotton': 'upholstery',
    'wool': 'upholstery', 'leather': 'leather', 'marble': 'concrete', 'concrete': 'concrete', 'stone': 'concrete',
    'paper': 'paper', 'cardboard': 'paper', 'light': 'enamel',
}


def get(path, cache, name):
    """Файл спейса с кэшем: каталог на одном процессоре — каждое берём один раз, с паузой."""
    f = os.path.join(cache, name)
    if os.path.exists(f):
        with open(f, 'rb') as h:
            return h.read()
    last = None
    for k in range(4):
        try:
            with urllib.request.urlopen(BASE + path, timeout=90) as r:
                data = r.read()
            with open(f, 'wb') as h:
                h.write(data)
            time.sleep(0.4)
            return data
        except Exception as e:  # сеть спейса нестабильна: повтор с паузой
            last = e
            time.sleep(3 + 4 * k)
    raise SystemExit(f'не скачалось {path}: {last}')


def glb_json_bin(b):
    magic, _ver, _len = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67, 'не GLB'
    jl, jt = struct.unpack_from('<II', b, 12)
    assert jt == 0x4E4F534A
    gl = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl, bt = struct.unpack_from('<II', b, off)
    assert bt == 0x004E4942
    return gl, b[off + 8:off + 8 + bl]


COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_accessor(gl, blob, idx):
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


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]  # glTF — по столбцам
    t = n.get('translation', [0, 0, 0])
    q = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def game_mat(material):
    """Материал игры и цвет (sRGB, 0…255) по материалу GLB: пресет — первое слово имени."""
    name = (material.get('name') or '').strip().lower()
    preset = name.split(' ')[0].split('#')[0].strip()
    key = PRESET.get(preset)
    if key is None:
        for k, v in PRESET.items():
            if k in name:
                key = v
                break
    key = key or 'paper'
    c = material.get('pbrMetallicRoughness', {}).get('baseColorFactor', [0.6, 0.6, 0.6, 1])
    srgb = tuple(int(round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055))) for v in c[:3])
    return MAT_ID[key], tuple(max(0, min(255, v)) for v in srgb), key


def gather(gl, blob, movers=frozenset()):
    """
    Все треугольники сцены в мировых координатах: (позиция, нормаль, материал игры, цвет, деталь, узел). Деталь — имя
    подвижного узла из movers, внутри которого лежит сетка (внешний, если вложены), или None; узел — имя узла сетки.
    """
    verts, tris, mats_seen = [], [], {}

    def walk(ni, parent, part):
        n = gl['nodes'][ni]
        m = mat_mul(parent, node_matrix(n))
        if part is None and n.get('name') in movers:
            part = n['name']
        if 'mesh' in n:
            for pr in gl['meshes'][n['mesh']]['primitives']:
                if pr.get('mode', 4) != 4:
                    continue
                P = read_accessor(gl, blob, pr['attributes']['POSITION'])
                N = read_accessor(gl, blob, pr['attributes']['NORMAL']) if 'NORMAL' in pr['attributes'] else None
                I = read_accessor(gl, blob, pr['indices']) if 'indices' in pr else list(range(len(P)))
                mi = pr.get('material')
                gm, col, key = game_mat(gl['materials'][mi]) if mi is not None else (MAT_ID['paper'], (150, 150, 150), 'paper')
                mats_seen[key] = mats_seen.get(key, 0) + len(I) // 3
                first = len(verts)
                for k, p in enumerate(P):
                    x = m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3]
                    y = m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3]
                    z = m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3]
                    if N is not None:
                        q = N[k]
                        nx = m[0][0] * q[0] + m[0][1] * q[1] + m[0][2] * q[2]
                        ny = m[1][0] * q[0] + m[1][1] * q[1] + m[1][2] * q[2]
                        nz = m[2][0] * q[0] + m[2][1] * q[1] + m[2][2] * q[2]
                    else:
                        nx, ny, nz = 0.0, 1.0, 0.0
                    verts.append(((x, y, z), (nx, ny, nz), gm, col, part, n.get('name')))
                det = (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                       + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
                for t in range(0, len(I) - 2, 3):
                    a, b, c = first + I[t], first + I[t + 1], first + I[t + 2]
                    tris.append((a, c, b) if det < 0 else (a, b, c))
        for c in n.get('children', []):
            walk(c, m, part)

    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    for ni in gl['scenes'][gl.get('scene', 0)]['nodes']:
        walk(ni, ident, None)
    return verts, tris, mats_seen


def joint_frames(gl):
    """Шарниры каталога: имя узла → тип, ось и точка оси в мировых координатах (м), пределы."""
    out = {}

    def walk(ni, parent):
        n = gl['nodes'][ni]
        m = mat_mul(parent, node_matrix(n))
        j = (n.get('extras') or {}).get('s3d_joint')
        if j and n.get('name') and j.get('type') in ('revolute', 'prismatic') and 'lower' in j and 'upper' in j:
            ax = j.get('axis', [0, 0, 1])
            a = [sum(m[r][c] * ax[c] for c in range(3)) for r in range(3)]
            la = math.sqrt(sum(v * v for v in a)) or 1.0
            out[n['name']] = {'type': j['type'], 'o': [m[0][3], m[1][3], m[2][3]], 'a': [v / la for v in a],
                              'lower': j['lower'], 'upper': j['upper']}
        for c in n.get('children', []):
            walk(c, m)

    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    for ni in gl['scenes'][gl.get('scene', 0)]['nodes']:
        walk(ni, ident)
    return out


def rodrigues(a, th):
    """Матрица поворота на угол th (рад) вокруг единичной оси a (правый винт)."""
    c, s_, t = math.cos(th), math.sin(th), 1 - math.cos(th)
    x, y, z = a
    return [[c + x * x * t, x * y * t - z * s_, x * z * t + y * s_],
            [y * x * t + z * s_, c + y * y * t, y * z * t - x * s_],
            [z * x * t - y * s_, z * y * t + x * s_, c + z * z * t]]


def move_point(p, j, t):
    """Точка детали при открытии шарнира j на долю t: поворот вокруг оси через o или сдвиг вдоль оси."""
    if j['k'] == 'p':
        return [p[k] + j['a'][k] * j['hi'] * t for k in range(3)]
    r = rodrigues(j['a'], j['hi'] * t)
    d = [p[k] - j['o'][k] for k in range(3)]
    return [j['o'][k] + sum(r[k][c] * d[c] for c in range(3)) for k in range(3)]


def turn_xz(x, z, t):
    for _ in range(t % 4):
        x, z = z, -x
    return x, z


def convert(verts, tris, mount, turn, scale=1.0, movers=None, name=''):
    out = []
    for (p, n, gm, col, part, leaf) in verts:
        x, z = turn_xz(p[0] * scale, p[2] * scale, turn)
        nx, nz = turn_xz(n[0], n[2], turn)
        out.append(((x, p[1] * scale, z), (nx, n[1], nz), gm, col, part, leaf))
    lo = [min(v[0][k] for v in out) for k in range(3)]
    hi = [max(v[0][k] for v in out) for k in range(3)]
    if mount in ('floor', 'wall'):
        off = [(lo[0] + hi[0]) / 2, lo[1], lo[2]]
    elif mount == 'free':
        off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    else:
        raise SystemExit('неизвестная опора: ' + mount)
    lo = [lo[k] - off[k] for k in range(3)]
    hi = [hi[k] - off[k] for k in range(3)]
    span = [max(hi[k] - lo[k], 1e-9) for k in range(3)]
    joints, part_of = open_parts(out, off, lo, hi, mount, turn, scale, movers or {}, name)
    table, remap = {}, []
    pos, nrm, col, mat, prt = [], [], [], [], []
    for i, (p, n, gm, c, _part, _leaf) in enumerate(out):
        q = tuple(int(round((p[k] - off[k] - lo[k]) / span[k] * 65535)) for k in range(3))
        ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
        qn = tuple(max(-127, min(127, int(round(n[k] / ln * 127)))) for k in range(3))
        key = (q, qn, gm, c, part_of[i])
        if key not in table:
            table[key] = len(pos)
            pos.append(q)
            nrm.append(qn)
            col.append(c)
            mat.append(gm)
            prt.append(part_of[i])
        remap.append(table[key])
    keep = [(remap[a], remap[b], remap[c]) for (a, b, c) in tris]
    keep = [t for t in keep if len(set(t)) == 3]
    flat = [i for t in keep for i in t]
    assert len(pos) < 65536

    def b64(b):
        return base64.b64encode(b).decode('ascii')

    rec = {
        'v': len(pos), 't': len(keep),
        'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi],
        'pos': b64(struct.pack('<%dH' % (len(pos) * 3), *[c for p in pos for c in p])),
        'nrm': b64(struct.pack('<%db' % (len(nrm) * 3), *[c for n in nrm for c in n])),
        'col': b64(struct.pack('<%dB' % (len(col) * 3), *[c for q in col for c in q])),
        'mat': b64(bytes(mat)),
        'idx': b64(struct.pack('<%dH' % len(flat), *flat)),
    }
    if joints:
        rec['part'] = b64(bytes(prt))
        rec['jt'] = [{'k': j['k'], 'o': [round(v, 4) for v in j['o']], 'a': [round(v, 5) for v in j['a']], 'hi': round(j['hi'], 4), 'w': j['w']} for j in joints]
        # Габарит со всем открытым до предела (t = 1): по нему игра считает место открываемой вещи.
        olo, ohi = list(lo), list(hi)
        for i, (p, _n, _gm, _c, _part, _leaf) in enumerate(out):
            if part_of[i]:
                q = move_point([p[k] - off[k] for k in range(3)], joints[part_of[i] - 1], 1.0)
                for k in range(3):
                    olo[k] = min(olo[k], q[k])
                    ohi[k] = max(ohi[k], q[k])
        rec['omin'] = [round(v, 4) for v in olo]
        rec['omax'] = [round(v, 4) for v in ohi]
    return rec


def open_parts(out, off, lo, hi, mount, turn, scale, movers, name):
    """
    Подвижные детали в координатах вещи (после поворота, масштаба и сдвига к опоре): шарниры [{k, o, a, hi, w}] и номер
    детали каждой вершины (0 — неподвижная). Ящик, который выезжает не в комнату (у стола партнёров — к стене), и дверца на
    невертикальной оси остаются закрытыми.
    """
    def pt(p):
        x, z = turn_xz(p[0] * scale, p[2] * scale, turn)
        return [x - off[0], p[1] * scale - off[1], z - off[2]]

    def dr(a):
        x, z = turn_xz(a[0], a[2], turn)
        return [x, a[1], z]

    names = []
    for v in out:
        if v[4] is not None and v[4] not in names:
            names.append(v[4])
    joints, index = [], {}
    for pn in names:
        kind, frame = movers[pn]
        idx = [i for i, v in enumerate(out) if v[4] == pn]
        P = [[out[i][0][k] - off[k] for k in range(3)] for i in idx]
        plo = [min(q[k] for q in P) for k in range(3)]
        phi = [max(q[k] for q in P) for k in range(3)]
        if kind == 'cat':
            a = dr(frame['a'])
            j = {'k': 'r' if frame['type'] == 'revolute' else 'p', 'o': pt(frame['o']), 'a': a}
            lim = frame['upper'] if abs(frame['upper']) >= abs(frame['lower']) else frame['lower']
            if j['k'] == 'p':
                if a[2] < 0.7 and mount != 'free':
                    continue
                j['hi'], j['w'] = lim * scale, 'drawer'
            else:
                if abs(a[1]) < 0.9:
                    continue
                j['hi'], j['w'] = max(-DOOR_MAX, min(DOOR_MAX, lim)), 'door'
        elif kind == 'drawer':
            j = {'k': 'p', 'o': [0, 0, 0], 'a': [0, 0, 1], 'hi': DRAWER_SHARE * (phi[2] - plo[2]), 'w': 'drawer'}
        else:
            # Ось дверцы: у петель, а нет их — у края, дальнего от ручки, а нет и ручки — у внешнего края шкафа.
            def centre(pat):
                Q = [[out[i][0][k] - off[k] for k in range(3)] for i in idx if re.search(pat, out[i][5] or '', re.I)]
                return sum(q[0] for q in Q) / len(Q) if Q else None
            hinge, grip = centre(r'hinge|pin'), centre(r'handle|pull|grip|knob')
            mid = (plo[0] + phi[0]) / 2
            if hinge is not None:
                hx = plo[0] if hinge < mid else phi[0]
            elif grip is not None:
                hx = phi[0] if grip < mid else plo[0]
            else:
                hx = plo[0] if mid < 0 else phi[0]
            free = phi[0] if hx == plo[0] else plo[0]
            # Правый винт вокруг +y: точка со сдвигом dx от оси уходит в z на −dx·sin θ; вперёд — θ со знаком, обратным dx.
            sign = -1.0 if free > hx else 1.0
            j = {'k': 'r', 'o': [hx, 0, phi[2]], 'a': [0, 1, 0], 'hi': sign * DOOR_MAX, 'w': 'door'}
        # Не дальше OPEN_REACH вперёд от лица вещи и не вбок за её бока: предел урезается по самим вершинам детали.
        reach = hi[2] + OPEN_REACH
        side = (lo[0], hi[0])

        def over(t):
            Q = [move_point(q, j, t) for q in P]
            return max(q[2] for q in Q) > reach or min(q[0] for q in Q) < side[0] or max(q[0] for q in Q) > side[1]

        if over(1.0):
            a_, b_ = 0.0, 1.0
            for _ in range(30):
                m_ = (a_ + b_) / 2
                if over(m_):
                    b_ = m_
                else:
                    a_ = m_
            j['hi'] *= a_
        if abs(j['hi']) < 1e-3:
            continue
        joints.append(j)
        index[pn] = len(joints)
    part_of = [index.get(v[4], 0) for v in out]
    if joints:
        print(f'  {name}: подвижных деталей {len(joints)} — ' + ', '.join(f"{j['w']} {j['hi']:.2f}" for j in joints))
    return joints, part_of


def simplify(gltfpack, cache, cid, target, ratio):
    """Упрощённый GLB (кэш по числу треугольников): meshoptimizer через gltfpack, нормали сохраняются, без сжатия."""
    small = os.path.join(cache, cid + f'.s{target}.glb')
    if not os.path.exists(small):
        subprocess.run([gltfpack, '-i', os.path.join(cache, cid + '.glb'), '-o', small, '-si', f'{ratio:.5f}', '-noq', '-kn'], check=True, stdout=subprocess.DEVNULL)
    with open(small, 'rb') as h:
        return glb_json_bin(h.read())


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    gltfpack = os.environ.get('GLTFPACK')
    if not gltfpack:
        sys.exit('нужен GLTFPACK=<путь к gltfpack> (npm install gltfpack)')
    records, credits = {}, []
    for (cid, name, mount, turn, target, ru) in SHELF:
        card = json.loads(get('/api/object/' + urllib.parse.quote(cid), cache, cid + '.json'))
        lic, src = card.get('license'), card.get('source_license')
        if card.get('license_status') != 'ok' or src not in ('CC-BY-4.0', 'CC0-1.0', 'CC0', 'Apache-2.0'):
            sys.exit(f'{cid}: лицензия {lic} / {src} / {card.get("license_status")} — не берём')
        raw = get(card['glb_url'], cache, cid + '.glb')
        gl, blob = glb_json_bin(raw)
        full = sum(gl['accessors'][p['indices']]['count'] // 3 for m in gl['meshes'] for p in m['primitives'] if 'indices' in p)
        ratio = min(1.0, target / max(1, full))
        # Доля считается по сеткам, а одна сетка может стоять во многих узлах (ручка комода — на каждом ящике): тогда
        # треугольников выходит больше задуманного. Упрощать такие сильнее (-sa) пробовали — съедается корпус, а не ручки;
        # комод остаётся в 3,3 тыс., это в бюджете.
        sgl, sblob = simplify(gltfpack, cache, cid, target, ratio)
        # Шарниры — из полного GLB (упрощённый держит имена узлов, но не их extras); детали ищутся по именам узлов.
        movers = {jn: ('cat', f) for jn, f in joint_frames(gl).items() if JOINT_TAKE.search(jn) and not JOINT_SKIP.search(jn)}
        for (nn, kind) in MOVERS.get(name, []):
            movers[nn] = (kind, None)
        verts, tris, seen = gather(sgl, sblob, frozenset(movers))
        rec = convert(verts, tris, mount, turn, SCALE.get(name, 1.0), movers, name)
        records[name] = rec
        credits.append({'name': name, 'mount': mount, 'id': cid, 'title': card.get('name'), 'license': lic, 'source': src, 'attribution': card.get('attribution'), 'ru': ru})
        print(f'{name}: {full} → {rec["t"]} треугольников, {rec["v"]} вершин, материалы {seen}, габарит {rec["min"]}…{rec["max"]}', flush=True)
    write_meta(records, credits)
    write_data(records, credits)
    write_credits(credits)


def ts_str(v):
    return json.dumps(v, ensure_ascii=False)


def write_meta(records, credits):
    """Опись полки: размеры, опора, подпись и авторство — без самих вершин (лёгкая, входит в основную сборку)."""
    lines = [
        '// ГЕНЕРИРУЕМЫЙ ФАЙЛ: не править руками. Источник — scripts/import_sand3d.py (полка Sand3D: вещи каталога Sandflow,',
        '// записанные программой). Здесь опись без вершин — она лёгкая и входит в основную сборку; сами модели и строки',
        '// авторства — sand3d_data.ts, отдельный кусок сборки (world/sand3d.ts грузит его, когда вещь нужна): в основном коде',
        '// игры нет ни адресов, ни ссылок. Лицензии — CC-BY-4.0 и свободнее: строка авторства каждой вещи обязательна в описи,',
        '// в титрах и в файле credits_sand3d.txt сборки.',
        '',
        'export interface Sand3dMeta {',
        '  /** Вершин и треугольников. */',
        '  v: number;',
        '  t: number;',
        '  /** Габарит, м, в координатах реквизита (пол y = 0; у стены — спина z = 0, посреди пола — середина в начале). */',
        '  min: [number, number, number];',
        '  max: [number, number, number];',
        "  mount: 'floor' | 'free';",
        '  /** Подпись по-русски. */',
        '  ru: string;',
        '  /**',
        '   * Дверцы и ящики (по порядку подвижных деталей записи): что это, и габарит со всем открытым до предела, м. Нет —',
        '   * у вещи ничего не открывается.',
        '   */',
        "  open?: { w: ReadonlyArray<'door' | 'drawer'>; min: [number, number, number]; max: [number, number, number] };",
        '}',
        '',
        'export const SAND3D_META: Record<string, Sand3dMeta> = {',
    ]
    for c in credits:
        r = records[c['name']]
        op = ''
        if 'jt' in r:
            op = f", open: {{ w: {json.dumps([j['w'] for j in r['jt']])}, min: {json.dumps(r['omin'])}, max: {json.dumps(r['omax'])} }}"
        lines.append(f"  {c['name']}: {{ v: {r['v']}, t: {r['t']}, min: {json.dumps(r['min'])}, max: {json.dumps(r['max'])}, mount: '{c['mount']}', ru: {ts_str(c['ru'])}{op} }},")
    lines.append('};')
    with open(OUT_META, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('записано', OUT_META, os.path.getsize(OUT_META) // 1024, 'КБ')


def write_data(records, credits):
    lines = [
        '// ГЕНЕРИРУЕМЫЙ ФАЙЛ: не править руками. Источник — scripts/import_sand3d.py; опись (размеры, подписи) — sand3d_meta.ts.',
        '// Формат записи — как models_data.ts, плюс mat: материал игры на каждую вершину (uint8, номера world/materials.ts).',
        '// Отдельный кусок сборки: игра грузит его, только когда вещь полки нужна (world/sand3d.ts). Здесь же строки авторства',
        '// (CC-BY-4.0): их показывают конструктор и файл титров сборки, а основному коду игры адреса не нужны.',
        "import type { ModelRecord } from './models_data';",
        "import type { JointRec } from './models';",
        '',
        '/** Запись модели полки: материал на вершину; у вещей с дверцами и ящиками — деталь на вершину и шарниры. */',
        'export interface Sand3dRecord extends ModelRecord {',
        '  mat: string;',
        '  part?: string;',
        '  jt?: readonly JointRec[];',
        '}',
        '',
        'export interface Sand3dCredit {',
        '  /** Имя вещи в игре, id каталога, название в каталоге. */',
        '  name: string;',
        '  id: string;',
        '  title: string;',
        '  /** Лицензия набора Sand3D и исходная лицензия вещи. */',
        '  license: string;',
        '  source: string;',
        '  /** Строка авторства — как в каталоге, без изменений. */',
        '  attribution: string;',
        '}',
        '',
        'export const SAND3D_CREDITS: readonly Sand3dCredit[] = [',
    ]
    for c in credits:
        lines.append(f"  {{ name: {ts_str(c['name'])}, id: {ts_str(c['id'])}, title: {ts_str(c['title'])}, license: {ts_str(c['license'])}, source: {ts_str(c['source'])}, attribution: {ts_str(c['attribution'])} }},")
    lines += [
        '];',
        '',
        'export const SAND3D_DATA: Record<string, Sand3dRecord> = {',
    ]
    for name, r in records.items():
        lines.append(f'  {name}: {{')
        lines.append(f"    v: {r['v']}, t: {r['t']}, min: {json.dumps(r['min'])}, max: {json.dumps(r['max'])},")
        for k in ('pos', 'nrm', 'col', 'mat', 'idx'):
            lines.append(f"    {k}: '{r[k]}',")
        if 'jt' in r:
            lines.append(f"    part: '{r['part']}',")
            lines.append('    jt: [' + ', '.join("{ k: '%s', o: %s, a: %s, hi: %s, w: '%s' }" % (j['k'], json.dumps(j['o']), json.dumps(j['a']), json.dumps(j['hi']), j['w']) for j in r['jt']) + '],')
        lines.append('  },')
    lines.append('};')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('записано', OUT, os.path.getsize(OUT) // 1024, 'КБ')


def write_credits(credits):
    """Титры моделей в корне сборки (public/ → dist/): CC-BY требует подписи там, где вещь распространяется."""
    lines = [
        'Untitled Session — 3D models from the Sand3D catalog (Sandflow), CC BY 4.0: https://creativecommons.org/licenses/by/4.0/',
        'Each model below is credited as the catalog gives it. Changes made for the game: the mesh was simplified',
        '(meshoptimizer), rotated and in a few cases rescaled, and its materials were mapped to the game\'s own materials.',
        '',
    ]
    for c in credits:
        lines.append(f"{c['name']} — {c['title']}: {c['attribution']}")
    with open(OUT_CREDITS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('записано', OUT_CREDITS)


if __name__ == '__main__':
    main()
