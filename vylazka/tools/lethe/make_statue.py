#!/usr/bin/env python3
"""
Статуя красной комнаты забвения из скана (квиз партнёра 24.11, ночь: «Готовая модель» — скан классической статуи).

Источник — гипсовый слепок архаической коры в хитоне и накидке (эпиблема), SMK — Statens Museum for Kunst, Копенгаген,
инв. KAS1800, «Kore iført chiton og kappe (epiblema)»; лицензия — Public Domain Mark 1.0
(https://creativecommons.org/publicdomain/mark/1.0/, поле rights в открытом API музея). Файл скана (STL, 288 766 треугольников)
скачивается с api.smk.dk и в репозиторий не кладётся:

    curl -o kore.stl https://api.smk.dk/api/v1/download-3d/9c67ws64f_smk-kore.stl
    python3 -I tools/lethe/make_statue.py kore.stl            # → public/assets/pockets/lethe_statue.bin

Что делает: сваривает вершины, упрощает сетку кластеризацией вершин по сетке кубиков (размер кубика подбирается делением
пополам, пока треугольников не станет не больше TARGET), поворачивает в оси игры (y вверх, лицом к −z — к тому, кто входит),
ставит низ подножия на y = 0 и середину на x = z = 0, масштабирует до настоящей высоты слепка (2,05 м), считает нормали
(взвешенные по площади). Пишет файл в формате вещей памяти VZT1 (scripts/import_thing_hq.py; разбирает world/thing_hq.ts,
decodeThingHq): развёртки у скана нет — uv нулевые.
"""
import struct
import sys
from pathlib import Path

import numpy as np

TARGET = 40000
HEIGHT_M = 2.05
OUT = Path(__file__).resolve().parents[2] / 'public' / 'assets' / 'pockets' / 'lethe_statue.bin'


def read_stl(path: str) -> tuple[np.ndarray, np.ndarray]:
    dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    with open(path, 'rb') as f:
        head = f.read(84)
        count = struct.unpack('<I', head[80:84])[0]
        d = np.fromfile(f, dtype=dt, count=count)
    if len(d) != count:
        raise SystemExit(f'STL обрезан: {len(d)} из {count} треугольников')
    v = d['v'].reshape(-1, 3).astype(np.float64)
    key = np.round(v * 1e4).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    pos = np.zeros((len(uniq), 3))
    np.add.at(pos, inv, v)
    pos /= np.bincount(inv, minlength=len(uniq))[:, None]
    return pos, inv.reshape(-1, 3)


def cluster(pos: np.ndarray, tri: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    lo = pos.min(0)
    key = np.floor((pos - lo) / cell).astype(np.int64)
    uniq, cid = np.unique(key, axis=0, return_inverse=True)
    out = np.zeros((len(uniq), 3))
    np.add.at(out, cid, pos)
    out /= np.bincount(cid, minlength=len(uniq))[:, None]
    t = cid[tri]
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = t[keep]
    # Одинаковые треугольники (в том числе развёрнутые) — один раз.
    s = np.sort(t, axis=1)
    _, first = np.unique(s, axis=0, return_index=True)
    t = t[np.sort(first)]
    used = np.unique(t)
    remap = np.full(len(out), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return out[used], remap[t]


def normals(pos: np.ndarray, tri: np.ndarray) -> np.ndarray:
    a, b, c = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
    fn = np.cross(b - a, c - a)
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, tri[:, k], fn)
    return vn / (np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12)


def write_vzt1(path: Path, pos: np.ndarray, nrm: np.ndarray, tri: np.ndarray) -> int:
    lo = pos.min(0)
    hi = pos.max(0)
    q = np.round((pos - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype('<u2')
    n8 = np.round(np.clip(nrm, -1, 1) * 127).astype('<i1')
    nv, ni = len(pos), tri.size
    buf = bytearray()
    buf += b'VZT1'
    buf += struct.pack('<II', nv, ni)
    buf += struct.pack('<6f', *lo, *hi)
    buf += struct.pack('<4f', 0, 0, 1, 1)
    buf += q.tobytes()
    buf += np.zeros(nv * 2, dtype='<u2').tobytes()
    nb = np.zeros((nv, 4), dtype='<i1')
    nb[:, :3] = n8
    buf += nb.tobytes()
    buf += b'\0' * ((4 - len(buf) % 4) % 4)
    buf += tri.astype('<u4' if nv > 65535 else '<u2').reshape(-1).tobytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(buf))
    return len(buf)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    pos, tri = read_stl(sys.argv[1])
    print(f'скан: {len(pos)} вершин, {len(tri)} треугольников')
    # Оси скана: z — вверх, лицо — к −y. Игра: y — вверх, лицо — к −z. Поворот (x, y, z) → (−x, z, y) — без зеркала.
    pos = np.stack([-pos[:, 0], pos[:, 2], pos[:, 1]], axis=1)
    lo, hi = pos.min(0), pos.max(0)
    k = HEIGHT_M / (hi[1] - lo[1])
    pos = (pos - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * k
    a, b = 1e-4, 0.2
    best = None
    for _ in range(30):
        cell = (a + b) / 2
        p, t = cluster(pos, tri, cell)
        if len(t) > TARGET:
            a = cell
        else:
            b = cell
            best = (p, t, cell)
    p, t, cell = best
    nrm = normals(p, t)
    size = write_vzt1(OUT, p, nrm, t)
    print(f'итог: {len(p)} вершин, {len(t)} треугольников, кубик {cell * 1000:.1f} мм, габарит {p.min(0).round(3)}…{p.max(0).round(3)} м')
    print(f'{OUT}: {size / 1024:.0f} КБ')


if __name__ == '__main__':
    main()
