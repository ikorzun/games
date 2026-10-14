"""scary.py: страшные кадры «Хода следствия» по промптам владельца (docs/production/prompts/scary-frames.md).

Находка тела — красная пиксельная замена фигуры, как в передаче; признание — тёмный силуэт без лица на красном.
Модель — GPT Image 2.5 sunburst, high (генерация и журнал расходов — tools/hod/memory.py). VHS не запекается: игра
кладёт аналоговую запись поверх кадра, поэтому ANALOG FINISH и строки про VHS из промптов убираются.

  python3 tools/hod/scary.py find                  # находка: assets/ep01/_hod/memory/scenes/field_find.png («Воспоминания»)
  python3 tools/hod/scary.py sil op_shmel_sil      # признание Шмелёва → assets/ep01/hod/hod_op/op_shmel_sil.webp
  python3 tools/hod/scary.py sil recon_sil         # вежливый человек реконструкции → assets/ep01/hod/hod_recon/recon_sil.webp
  python3 tools/hod/scary.py pixelate <png> [x0,y0,x1,y1] [блоков]  # жёсткие красные блоки, если модель смазала фигуру
  python3 tools/hod/scary.py prompt find|sil <id>  # промпт и картинки — проверить до генерации
"""
import os, re, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memory as M  # noqa: E402

DOC = os.path.join(M.ROOT, 'docs/production/prompts/scary-frames.md')
CRIME, CONFESSION = re.findall(r'```\n(.*?)```', open(DOC, encoding='utf-8').read(), re.S)[:2]


NO_VHS = ('Do not add any VHS look, video noise, scanlines, grain or film texture: the game applies its own analog video '
          'effect on top of this image.')


def no_vhs(p: str) -> str:
    """Убрать запечённый VHS (правило memory-style.md): секцию ANALOG FINISH и строки про VHS в FINAL CHECK."""
    p = re.sub(r'ANALOG FINISH\n.*?\n\n(?=[A-Z][A-Z :&—-]+\n)', '', p, flags=re.S)
    p = p.replace('Clean graphic-novel rendering and subtle VHS.', 'Clean graphic-novel rendering.')
    p = p.replace('Subtle VHS texture.\n', '')
    assert 'VHS texture' not in p and 'VHS treatment' not in p, 'VHS остался в промпте'
    return p + '\n' + NO_VHS


# Находка в лесополосе под Апрелевкой (пятница, 7:20): секция SCENE BRIEF промпта заменяется этой сценой целиком.
FIND_BRIEF = '''A strip of birch trees between a mown field and a dirt country road near Aprelevka, outside Moscow, early morning in August 1993: a low sun through the birch trunks, mist over the field, dew on the tall grass. Red-and-white striped tape is stretched between the birch trunks across the frame; two spades lean against a birch at the tape.

Beyond the tape, in the tall grass a few metres away, one deceased adult is represented by a single red pixelated silhouette, lying diagonally on the ground. Its position communicates a motionless human figure without showing bodily details.

Do not add detectives, witnesses or other people unless explicitly requested in the scene brief.'''

# Признание: кто за силуэтом и во что одет — для character reference (лист головы утверждён владельцем).
SIL = {
    'op_shmel_sil': ('accomplice', 'hod_op', 'a navy tracksuit top zipped up to a stand-up collar'),
    'recon_sil': ('murashov', 'hod_recon', 'a light summer jacket over a collared shirt with a narrow tie'),
}
COMPOSITION = os.path.join(M.RAW, 'refs', 'confession_ref.png')  # вырезка с фото владельца: только изображение на экране


def find_inputs() -> tuple[str, list[str]]:
    real = os.path.join(M.ROOT, 'assets/ep01/hod/hod_field/field_find.webp')
    src = os.path.join(M.RAW, 'src', 'field_find.png')
    im = Image.open(real).convert('RGB')
    pad = Image.new('RGB', (1920, 1088))
    pad.paste(im, (0, 4)); pad.paste(im.crop((0, 0, 1920, 4)), (0, 0)); pad.paste(im.crop((0, 1076, 1920, 1080)), (0, 1084))
    os.makedirs(os.path.dirname(src), exist_ok=True)
    pad.save(src)
    style = os.path.join(M.RAW, 'scenes', 'field_wide.png')
    prompt = re.sub(r'SCENE BRIEF\n.*?\n\n(?=ART DIRECTION\n)', lambda _: 'SCENE BRIEF\n' + FIND_BRIEF + '\n\n', CRIME, flags=re.S)
    assert FIND_BRIEF.splitlines()[0] in prompt, 'SCENE BRIEF не заменён'
    head = 'Image 1 is the selected scene reference. Image 2 is the separate style reference.\n\n'
    return head + no_vhs(prompt), [src, style]


def sil_inputs(sid: str) -> tuple[str, list[str]]:
    who, _, clothes = SIL[sid]
    head = (f'Image 1 is the selected portrait reference: a dark male silhouette against a red background, photographed from '
            f'a screen — take only its framing and silhouette-to-background relationship, never the screen itself. Image 2 '
            f'is the character reference: {M.CHARS[who]["name"]}; preserve his head shape, hairstyle, ears and build, and the '
            f'silhouette of his clothing — {clothes} — instead of the plain dark shirt.\n\n')
    return head + no_vhs(CONFESSION), [COMPOSITION, os.path.join(M.RAW, 'sheets', f'{who}_head.png')]


def find() -> None:
    prompt, images = find_inputs()
    M.gen('field_find', prompt, images, '1920x1088', os.path.join(M.RAW, 'scenes'))


def sil(sid: str) -> None:
    """Силуэт — одна картинка на оба режима графики: кладётся как кадр «Реализма» (file) без «Воспоминаний»."""
    prompt, images = sil_inputs(sid)
    out = M.gen(sid, prompt, images, '1920x1088', os.path.join(M.RAW, 'scenes'))
    _, set_, _ = SIL[sid]
    dst = os.path.join(M.ROOT, f'assets/ep01/hod/{set_}/{sid}.webp')
    Image.open(out).convert('RGB').resize((1920, 1088), Image.LANCZOS).crop((0, 4, 1920, 1084)).save(dst, 'WEBP', quality=82, method=6)
    print('принято', dst)


def pixelate(path: str, box: tuple[int, int, int, int] | None = None, blocks: int = 24) -> None:
    """Красная фигура → жёсткие квадратные блоки на одной сетке экрана (как в передаче). Ищется только внутри box
    (красная лента оцепления рядом — не фигура). Блок, где красного ≥ 10 %, заливается одним из трёх соседних тонов
    красного самой фигуры — так края ступенчатые и без бахромы; редкие красные пиксели в прочих блоках заменяются
    средним цветом их не красных пикселей."""
    import numpy as np
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 90) & (r > g * 1.45) & (r > b * 1.6)  # красный и бурый, но не трава, не беж
    if box:
        keep = np.zeros_like(red)
        keep[box[1]:box[3], box[0]:box[2]] = True
        red &= keep
    ys, xs = np.nonzero(red)
    if len(xs) == 0:
        sys.exit(f'{path}: красной фигуры нет')
    length = max(xs.max() - xs.min(), ys.max() - ys.min())
    B = max(8, int(round(length / blocks)))
    base = np.median(a[red], axis=0)
    tones = [tuple(int(v) for v in (base * k).clip(0, 255)) for k in (0.9, 1.0, 1.08)]
    out = a.copy()
    rng = np.random.default_rng(7)
    x0, y0 = (box[0], box[1]) if box else (0, 0)
    for y in range(y0, a.shape[0], B):
        for x in range(x0, a.shape[1], B):
            cell = red[y:y + B, x:x + B]
            if not cell.any():
                continue
            if cell.mean() >= 0.1:
                out[y:y + B, x:x + B] = tones[rng.integers(0, 3)]
            else:
                rest = a[y:y + B, x:x + B][~cell]
                fill = rest.mean(axis=0) if len(rest) else base
                out[y:y + B, x:x + B][cell] = fill
    before = path[:-4] + '.prepix.png'  # что было до блоков — рядом
    if not os.path.exists(before):
        im.save(before)
    Image.fromarray(out.clip(0, 255).astype('uint8')).save(path)
    print(f'{path}: блок {B} px, тон {tuple(int(v) for v in base)}, блоков по длине фигуры ≈ {length // B}')


if __name__ == '__main__':
    cmd, *args = sys.argv[1:] or ['prompt', 'find']
    if cmd == 'find':
        find()
    elif cmd == 'sil':
        for sid in args:
            sil(sid)
    elif cmd == 'pixelate':  # pixelate <png> [x0,y0,x1,y1] [блоков по длине фигуры]
        box = tuple(int(v) for v in args[1].split(',')) if len(args) > 1 else None
        pixelate(args[0], box, int(args[2]) if len(args) > 2 else 24)
    elif cmd == 'prompt':
        text, files = find_inputs() if args[0] == 'find' else sil_inputs(args[1])
        print(text, '\n\nIMAGES:', *[os.path.relpath(f, M.ROOT) for f in files], sep='\n')
