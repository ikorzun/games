"""masks.py: маски людей на кадрах «Хода следствия» → assets/ep01/hod/<сет>/<кадр>.<кто>.webp (480×270, серое).

Подсветка того, на ком внимание (решение владельца 2026-10-13): игра приглушает окружение и кладёт контровой свет
по маске человека (assets.shots[].cast[].mask, docs/architecture/08-shot-grammar.md §3.1). Маски считает Apple Vision
локально (tools/hod/person_masks.swift), без кредитов и без отправки кадров наружу. Кто есть кто — по порядку масок
слева направо (центр маски), порядок задан в ORDER; число найденных людей должно совпасть.

    python3 tools/hod/masks.py             # все кадры из ORDER
    python3 tools/hod/masks.py office_am_wide
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SWIFT = os.path.join(ROOT, 'tools/hod/person_masks.swift')
SIZE = (480, 270)  # шейдер читает маску с линейной интерполяцией и сам размывает край

# Кадр → (сет, люди слева направо по центру маски).
ORDER = {
    'office_am_wide': ('hod_office_am', ['sledak', 'oper']),
    'office_am_ots_oper': ('hod_office_am', ['sledak', 'oper']),
}


def path_of(shot: str, who: str) -> str:
    return f'assets/ep01/hod/{ORDER[shot][0]}/{shot}.{who}.webp'


def make(shot: str) -> None:
    set_, people = ORDER[shot]
    frame = os.path.join(ROOT, f'assets/ep01/hod/{set_}/{shot}.webp')
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['swift', SWIFT, frame, tmp], check=True, capture_output=True)
        found = []
        for name in sorted(os.listdir(tmp)):
            m = np.asarray(Image.open(os.path.join(tmp, name)).convert('L'), dtype=np.float32) / 255.0
            xs = np.nonzero(m.max(axis=0) > 0.5)[0]
            if len(xs) == 0:
                continue
            cx = float((m.sum(axis=0) * np.arange(m.shape[1])).sum() / max(1e-6, m.sum())) / m.shape[1]
            found.append((cx, m))
    if len(found) != len(people):
        sys.exit(f'{shot}: людей на кадре {len(found)}, а в ORDER {len(people)} — проверьте кадр и порядок')
    for (cx, m), who in zip(sorted(found, key=lambda f: f[0]), people):
        out = os.path.join(ROOT, path_of(shot, who))
        Image.fromarray((m * 255).clip(0, 255).astype(np.uint8), 'L').resize(SIZE, Image.LANCZOS).save(out, 'WEBP', quality=90)
        print(f'{shot}: {who} (центр {cx:.2f}) → {path_of(shot, who)}')


if __name__ == '__main__':
    for s in sys.argv[1:] or ORDER:
        make(s)
