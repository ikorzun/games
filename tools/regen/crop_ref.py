"""crop_ref.py <кадр.png|webp> <refs/out.jpg> [x0 y0 x1 y1]: кроп-референс средней крупности из принятого общего плана —
доли кадра (по умолчанию 0.15 0.12 0.85 0.82), растянутые до 1920×1080, jpg q92. В REGEN_REFS — как file:<out.jpg>."""
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
b = [float(v) for v in sys.argv[3:7]] or [0.15, 0.12, 0.85, 0.82]
im = Image.open(src).convert('RGB'); w, h = im.size
im.crop((round(b[0] * w), round(b[1] * h), round(b[2] * w), round(b[3] * h))).resize((1920, 1080), Image.LANCZOS).save(out, quality=92)
print(out, b)
