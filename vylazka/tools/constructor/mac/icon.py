"""Иконка программы «Конструктор» (mac/AppIcon.icns): стул из точек в луче фонаря — так мир выглядит в игре.

Рисует SVG, Chromium (Playwright) переводит его в PNG 1024, Pillow уменьшает, файл .icns собирается здесь же (Pillow
его писать не умеет). Запуск: python3 -I tools/constructor/mac/icon.py (из vylazka/); нужен playwright для Python или Node.
"""
import io
import math
import random
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "AppIcon.icns"


# Стул в три четверти: сиденье, спинка с верхней и средней перекладинами, четыре ножки, царга спереди.
CHAIR = [
    [(372, 548), (604, 522), (690, 596), (450, 628)],  # сиденье
    [(450, 628), (690, 596), (690, 618), (450, 652)],  # кромка сиденья
    [(360, 250), (392, 246), (392, 548), (360, 552)],  # левая стойка спинки
    [(588, 226), (620, 222), (620, 524), (588, 528)],  # правая стойка спинки
    [(360, 250), (620, 222), (620, 264), (360, 292)],  # верхняя перекладина
    [(360, 382), (620, 354), (620, 382), (360, 410)],  # средняя перекладина
    [(440, 640), (468, 636), (468, 812), (440, 816)],  # ножка спереди слева
    [(674, 606), (702, 602), (702, 790), (674, 794)],  # ножка спереди справа
    [(362, 552), (388, 549), (388, 760), (362, 763)],  # ножка сзади слева
    [(594, 528), (618, 525), (618, 728), (594, 731)],  # ножка сзади справа
    [(468, 740), (674, 712), (674, 732), (468, 760)],  # царга между передними ножками
]


def _in_poly(x: float, y: float, poly) -> bool:
    inside = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def inside_chair(x: float, y: float) -> bool:
    return any(_in_poly(x, y, poly) for poly in CHAIR)


def svg() -> str:
    rnd = random.Random(18)
    light = (214, 190)  # фонарь — сверху слева
    dots = []
    step = 13
    for gy in range(210, 830, step):
        for gx in range(340, 720, step):
            x = gx + rnd.uniform(-4, 4)
            y = gy + rnd.uniform(-4, 4)
            if not inside_chair(x, y):
                continue
            d = math.hypot(x - light[0], y - light[1])
            a = max(0.35, min(1.0, 1.25 - d / 900))
            r = 5.0 + rnd.uniform(-1.1, 1.1)
            dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="#f1d9a6" opacity="{a:.2f}"/>')
    # Пол — редкие точки, тают к краям: место собрано только там, куда светят.
    for _ in range(260):
        x = rnd.uniform(220, 820)
        y = rnd.uniform(776, 836)
        fade = 1 - abs(x - 520) / 320
        if fade <= 0 or rnd.random() > fade:
            continue
        dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rnd.uniform(2.4, 4.2):.1f}" fill="#c9a76a" opacity="{0.25 + 0.5 * fade:.2f}"/>')
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2026"/><stop offset="1" stop-color="#0d0f12"/></linearGradient>
  <radialGradient id="beam" cx="{light[0]}" cy="{light[1]}" r="760" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#e3b25e" stop-opacity="0.55"/><stop offset="0.45" stop-color="#e3b25e" stop-opacity="0.16"/><stop offset="1" stop-color="#e3b25e" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="shape"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
</defs>
<g clip-path="url(#shape)">
  <rect x="100" y="100" width="824" height="824" fill="url(#bg)"/>
  <polygon points="{light[0] - 40},{light[1] - 30} {light[0] + 30},{light[1] - 60} 930,700 930,960 520,960" fill="url(#beam)"/>
  {''.join(dots)}
</g>
<rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="#ffffff" stroke-opacity="0.07"/>
</svg>"""


def render(svg_text: str) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "icon.svg"
        png = Path(tmp) / "icon.png"
        src.write_text(svg_text, encoding="utf8")
        script = (
            "const { chromium } = require('playwright');"
            "(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });"
            f"await p.goto('file://{src}'); await p.screenshot({{ path: '{png}', omitBackground: true }}); await b.close(); }})();"
        )
        subprocess.run(["node", "-e", script], check=True)
        return Image.open(png).convert("RGBA").copy()


def icns(img: Image.Image) -> bytes:
    """Записи .icns с PNG внутри: 16…1024 и пары @2x."""
    kinds = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    body = b""
    for kind, size in kinds:
        buf = io.BytesIO()
        img.resize((size, size), Image.LANCZOS).save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    return b"icns" + struct.pack(">I", len(body) + 8) + body


if __name__ == "__main__":
    image = render(svg())
    OUT.write_bytes(icns(image))
    if "--png" in sys.argv:
        image.save(HERE / "icon_preview.png")
    print(f"{OUT} — {OUT.stat().st_size // 1024} КБ")
