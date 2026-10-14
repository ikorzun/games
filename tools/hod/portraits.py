"""portraits.py: портреты для окна реплики «Хода следствия» → assets/ep01/portraits/<id>.webp (128×128).

Круг у имени в окне реплики (макет в Figma, 2026-10-13). Лица вырезаются из летних кадров эпизода, чтобы портрет
совпадал с тем, что игрок видит в сцене: референсы assets/ep01/faces сняты в зимней одежде. Исключение — Мурашов:
в летних кадрах он только со спины, его портрет — из faces (костюм без зимних примет).

    python3 tools/hod/portraits.py
"""
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
H = 'assets/ep01/hod/'
SIZE = 128  # кружок 2.4em: 48 px на десктопе, ×2–3 на плотных экранах
CROPS = {  # персонаж: (файл, центр x, центр y, сторона квадрата) в пикселях исходника
    'sledak': (H+'hod_office_am/office_am_wide.webp', 432, 368, 200),
    'oper': (H+'hod_office_am/office_am_ots_oper.webp', 1133, 322, 330),
    'expert': (H+'hod_office_eve/office_eve_ots_expert.webp', 1037, 352, 330),
    'boss': (H+'hod_office_d2/office_d2_ots_boss.webp', 1056, 262, 330),
    'neighbor': (H+'hod_landing_open/landing_open_ots.webp', 691, 342, 380),
    'buyer': (H+'hod_flat/flat_ots_buyer.webp', 672, 312, 330),
    'lapin_wife': (H+'hod_flat/flat_ots_wife.webp', 1402, 302, 330),
    'notary': (H+'hod_notary/notary_ots_notary.webp', 730, 420, 330),
    'assistant': (H+'hod_notary_stairs/stairs_ots_assistant.webp', 643, 342, 330),
    'clerk': (H+'hod_bti/bti_ots_clerk.webp', 691, 375, 380),
    'passport_clerk': (H+'hod_zhek/zhek_ots_clerk.webp', 1133, 365, 330),
    'zoya': (H+'hod_recon/recon_ots_zoya.webp', 730, 292, 330),
    'murashov_sil': ('assets/ep01/faces/murashov.webp', 800, 520, 640),
    # дни 3–5
    'murashov': (H+'hod_agency/agency_ots_murashov.webp', 1345, 300, 380),
    'accomplice': (H+'hod_op/op_metro.webp', 505, 550, 300),
    'klava': (H+'hod_second/second_ots_klava.webp', 1065, 280, 360),
    'landlady': (H+'hod_chertanovo/chertanovo_wide.webp', 1150, 292, 230),
    'sledak_old': (H+'hod_2004/gromov_2004.webp', 760, 375, 400),
}


def main():
    out = os.path.join(ROOT, 'assets/ep01/portraits')
    os.makedirs(out, exist_ok=True)
    for who, (path, cx, cy, side) in CROPS.items():
        im = Image.open(os.path.join(ROOT, path)).convert('RGB')
        box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
        im.crop(box).resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(out, f'{who}.webp'), 'WEBP', quality=85, method=6)
    print(f'портретов: {len(CROPS)} → {out}')


if __name__ == '__main__':
    main()
