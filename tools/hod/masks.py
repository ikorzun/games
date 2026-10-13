"""masks.py: маски людей на кадрах «Хода следствия» → assets/ep01/hod/<сет>/<кадр>.<кто>.webp (480×270, серое).

Подсветка того, на ком внимание (решение владельца 2026-10-13): игра приглушает окружение и кладёт контровой свет
по маске человека (assets.shots[].cast[].mask, docs/architecture/08-shot-grammar.md §3.1). Маски считает Apple Vision
локально (tools/hod/person_masks.swift), без кредитов и без отправки кадров наружу. Кто есть кто — по порядку масок
слева направо (центр маски), порядок задан в ORDER; число найденных людей должно совпасть. «_» в порядке — человек
не из состава кадра (массовка на лавке, в очереди): его маска не сохраняется.

    python3 tools/hod/masks.py             # все кадры из ORDER
    python3 tools/hod/masks.py office_am_wide
    python3 tools/hod/masks.py --memory    # «Воспоминания» (tools/hod/memory.py): кадры 16:9 и квадраты из MEMORY
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SWIFT = os.path.join(ROOT, 'tools/hod/person_masks.swift')
SIZE = (480, 270)  # шейдер читает маску с линейной интерполяцией и сам размывает край
SQUARE = (360, 360)  # маска квадратного кадра «Воспоминаний»

# Кадр → (сет, люди слева направо по центру маски).
ORDER = {
    'office_am_wide': ('hod_office_am', ['sledak', 'oper']),
    'office_am_ots_oper': ('hod_office_am', ['sledak', 'oper']),
}
# «Воспоминания»: маски свои — силуэты в рисунке не совпадают с реалистичными; у квадратов — тоже свои. Вставки с фото и
# фона осмотра нет: там в центре внимания предмет, а не человек.
MEMORY = {
    **ORDER,
    'office_am_phone': ('hod_office_call_am', ['sledak', 'oper']),
    'car_wide': ('hod_car', ['oper', 'sledak']),
    'car_ots_oper': ('hod_car', ['oper', 'sledak']),
    'flat_wide': ('hod_flat', ['oper', 'buyer', 'sledak', 'lapin_wife']),
    'flat_ots_buyer': ('hod_flat', ['buyer', 'sledak']),
    'flat_ots_wife': ('hod_flat', ['sledak', 'lapin_wife']),
    # остальные места (2026-10-13); третий элемент — порядок у квадрата, если кадрирование его меняет
    'office_eve_wide': ('hod_office_eve', ['sledak', 'expert', 'oper']),
    'office_eve_ots_expert': ('hod_office_eve', ['sledak', 'expert', '_']),  # Сайко у окна на заднем плане
    'office_eve_lens': ('hod_office_lens', ['sledak', 'expert']),
    'office_eve_phone': ('hod_office_call_eve', ['sledak', 'expert']),
    'office_d2_wide': ('hod_office_d2', ['sledak', 'oper', 'boss']),
    'office_d2_ots_boss': ('hod_office_d2', ['sledak', 'boss']),
    'office_night_wide': ('hod_office_night', ['sledak', 'expert', 'oper']),
    'office_night_ots_expert': ('hod_office_night', ['sledak', 'expert']),
    'landing_chain_wide': ('hod_landing_chain', ['neighbor', 'sledak', 'oper']),
    'landing_chain_ots': ('hod_landing_chain', ['neighbor', 'sledak']),
    'landing_open_wide': ('hod_landing_open', ['neighbor', 'sledak', 'oper']),
    'landing_open_ots': ('hod_landing_open', ['neighbor', 'sledak']),
    'notary_wide': ('hod_notary', ['assistant', 'notary', 'sledak', 'oper']),
    'notary_ots_notary': ('hod_notary', ['notary', 'sledak']),
    'notary_alone_wide': ('hod_notary_alone', ['notary', 'sledak', 'oper']),
    'stairs_wide': ('hod_notary_stairs', ['sledak', 'assistant', 'oper']),
    'stairs_ots_assistant': ('hod_notary_stairs', ['assistant', 'oper']),
    'zhek_wide': ('hod_zhek', ['_', 'oper', 'sledak']),  # лавка слева; паспортистку за окошком Vision не видит
    'zhek_ots_clerk': ('hod_zhek', ['sledak', 'passport_clerk']),
    'bti_wide': ('hod_bti', ['clerk', 'sledak']),
    'bti_ots_clerk': ('hod_bti', ['clerk', 'sledak']),
    'recon_wide': ('hod_recon', ['_', '_', 'zoya', 'murashov_sil']),  # очередь на лавке
    'recon_ots_zoya': ('hod_recon', ['_', '_', 'zoya', 'murashov_sil']),
}


def path_of(shot: str, who: str) -> str:
    return f'assets/ep01/hod/{ORDER[shot][0]}/{shot}.{who}.webp'


def people_masks(frame: str, people: list[str], label: str) -> list[tuple[str, np.ndarray]]:
    """Маски Vision, слева направо по центру маски → (кто, маска); число людей должно совпасть с порядком."""
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
    # Vision иногда отдаёт того же человека дважды (бледный дубль поверх) — оставляем более плотную маску.
    kept: list[tuple[float, np.ndarray]] = []
    for cx, m in sorted(found, key=lambda f: -f[1].sum()):
        if all(np.minimum(m, k).sum() / max(1e-6, m.sum()) < 0.6 for _, k in kept):
            kept.append((cx, m))
    found = kept
    if len(found) != len(people):
        sys.exit(f'{label}: людей на кадре {len(found)}, а в порядке {len(people)} — проверьте кадр и порядок')
    pairs = list(zip(sorted(found, key=lambda f: f[0]), people))
    for (cx, _), who in pairs:
        print(f'{label}: {who} (центр {cx:.2f})')
    return [(who, m) for (_, m), who in pairs]


def save(m: np.ndarray, path: str, size: tuple[int, int]) -> None:
    Image.fromarray((m * 255).clip(0, 255).astype(np.uint8), 'L').resize(size, Image.LANCZOS).save(
        os.path.join(ROOT, path), 'WEBP', quality=90)
    print('  →', path)


def make(shot: str) -> None:
    set_, people = ORDER[shot]
    for who, m in people_masks(os.path.join(ROOT, f'assets/ep01/hod/{set_}/{shot}.webp'), people, shot):
        save(m, path_of(shot, who), SIZE)


def make_memory(shot: str) -> None:
    """Кадр «Воспоминаний» и его квадрат (что есть) → <кадр>[.square].<кто>.webp рядом с ними."""
    set_, people, *square = MEMORY[shot]
    for tail, size, order in (('', SIZE, people), ('.square', SQUARE, square[0] if square else people)):
        frame = f'assets/ep01/hod_memory/{set_}/{shot}{tail}.webp'
        if os.path.exists(os.path.join(ROOT, frame)):
            for who, m in people_masks(os.path.join(ROOT, frame), order, shot + tail):
                if who != '_':
                    save(m, f'assets/ep01/hod_memory/{set_}/{shot}{tail}.{who}.webp', size)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['--memory']:
        for s in args[1:] or MEMORY:
            make_memory(s)
    else:
        for s in args or ORDER:
            make(s)
