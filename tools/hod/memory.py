"""memory.py: режим «Воспоминания» — кадры в стиле графического романа по промпту владельца (2026-10-13).

Промпт и негатив — docs/production/prompts/memory-style.md (дословно). Модель — GPT Image 2.5 sunburst, high.
Порядок: листы развёртки персонажей → владелец утверждает лица → кадры 16:9 → квадраты для телефона из
утверждённых кадров (лица и детали совпадают). Сырьё — assets/ep01/_hod/memory/ (вне git), расходы в долларах
по фактическим токенам — там же, ledger.json.

  python3 tools/hod/memory.py sheets sledak oper buyer lapin_wife   # листы: голова и фигура со всех сторон
  python3 tools/hod/memory.py scene office_am_wide                  # кадр 1920×1088 по кадру «Реализма»
  python3 tools/hod/memory.py square office_am_wide                 # квадрат 1536×1536 из принятого кадра
  python3 tools/hod/memory.py prompt office_am_ots_oper             # промпт и картинки кадра — проверить до генерации
  python3 tools/hod/memory.py fix flat_wide 1695,210,1810,330 "…"   # правка по маске: только прямоугольник
  python3 tools/hod/memory.py cost                                  # сколько потрачено
"""
import json, os, re, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'assets/ep01/_hod/memory')
GPT = os.path.expanduser('~/.claude/skills/gpt-image/scripts/gpt_image.py')
PRICE = {'text': 5.0, 'image_in': 8.0, 'image_out': 30.0}  # $ за 1 млн токенов, GPT Image 2.5 (flare = sunburst)

# ───────────────────────────── промпт владельца ─────────────────────────────

_md = open(os.path.join(ROOT, 'docs/production/prompts/memory-style.md'), encoding='utf-8').read()
_blocks = re.findall(r'```\n(.*?)```', _md, re.S)
PROMPT, NEGATIVE = _blocks[0], _blocks[1]
_parts = re.split(r'━+\n(\d\d)\. [^\n]+\n━+\n', PROMPT)
HEADER = _parts[0].strip()
SECTIONS = {_parts[i]: _parts[i + 1].strip() for i in range(1, len(_parts), 2)}
TITLES = dict(re.findall(r'━+\n(\d\d)\. ([^\n]+)\n━+', PROMPT))
# Подсветку говорящего и запись VHS делает игра на лету — в картинку их не впекаем (memory-style.md).
NO_RUNTIME = ['Subtle environmental dimming.', 'Soft directional rim light on the active speaker.', 'Delicate VHS texture.',
              'Subtle analog videotape texture.', '7. Active speaker lighting', '8. Subtle analog VHS treatment']
NO_VHS = ('Do not add any VHS look, video noise, scanlines, grain or film texture: the game applies its own analog video '
          'effect and lights the active speaker on top of this image.')


def section(n: str) -> str:
    text = SECTIONS[n]
    for line in NO_RUNTIME:
        text = text.replace(line + '\n', '').replace(line, '')
    return f'{n}. {TITLES[n]}\n{text}'


def style(numbers: list[str], header: bool) -> str:
    head = HEADER if header else HEADER.split('ART DIRECTION', 1)[1].join(['ART DIRECTION', ''])
    body = '\n\n'.join(section(n) for n in numbers)
    avoid = ', '.join(w.strip() for w in NEGATIVE.replace('\n', ' ').split(',') if w.strip())
    return f'{head}\n\n{body}\n\n{NO_VHS}\n\nAvoid: {avoid}.'


# ───────────────────────────── персонажи ─────────────────────────────

H = 'assets/ep01/hod/'
CHARS = {
    'sledak': {
        'name': 'Investigator Andrei Gromov',
        'look': 'man, 29, lean and a little stooped from desk work, a long pale face with hollow cheeks, grey eyes with dark circles '
                'under them, heavy straight brows, a thin nose with a slight bump, short dark-brown hair that will not lie flat at '
                'the crown, a day of stubble',
        'costume': 'a pale-blue short-sleeved cotton shirt, a narrow dark-navy tie loosened at the collar, grey suit trousers, black '
                   'leather shoes, a cheap wristwatch on a cracked strap; no jacket, no coat, no sweater',
        'refs': [('assets/ep01/faces/sledak.webp', None), (H + 'hod_office_am/office_am_wide.webp', (150, 200, 640, 640)),
                 (H + 'hod_flat/flat_wide.webp', (1130, 60, 1500, 1080))],
    },
    'oper': {
        'name': 'Detective Viktor Sayko',
        'look': 'man, 34, stocky and broad-shouldered, a round wind-burnt face, a nose broken and set crooked with a small healed '
                'scrape across the bridge exactly as in the summer frame, small lively grey-green eyes, pale eyebrows, '
                'close-cropped fair hair, a chipped front tooth',
        'costume': 'a faded blue-grey checked short-sleeved shirt worn open over a grey cotton T-shirt, faded blue jeans, worn brown '
                   'shoes, a steel wristwatch; no leather jacket, no sweater',
        'refs': [('assets/ep01/faces/oper.webp', None), (H + 'hod_office_am/office_am_ots_oper.webp', (800, 0, 1560, 760)),
                 (H + 'hod_flat/flat_wide.webp', (40, 20, 430, 1080))],
    },
    'buyer': {
        'name': 'Lapin, the new owner of the flat',
        'look': 'man, 40, thin and narrow-shouldered, a long anxious face with early lines across the forehead, large grey eyes behind '
                'thin-rimmed glasses, a receding hairline with soft light-brown hair, a weak chin',
        'costume': 'an old beige short-sleeved checked shirt with specks of white paint, old grey trousers rolled up at the ankles and '
                   'spattered with paint, worn shoes, thin-rimmed glasses',
        'refs': [('assets/ep01/faces/buyer.webp', None), (H + 'hod_flat/flat_ots_buyer.webp', (330, 0, 1030, 800)),
                 (H + 'hod_flat/flat_wide.webp', (560, 150, 860, 1040))],
    },
    'lapin_wife': {
        'name': 'Irina Lapina, his wife',
        'look': 'woman, 40, thin and pale, a narrow face with sharp cheekbones, large tired grey-blue eyes, a straight nose, a '
                'clenched mouth, dark-blond hair pulled back into a low bun with strands escaping',
        'costume': 'a simple faded blue-grey cotton summer dress with a small print and short sleeves, a light apron over it, '
                   'slippers, a thin chain with a small cross',
        'refs': [('assets/ep01/faces/lapin_wife.webp', None), (H + 'hod_flat/flat_ots_wife.webp', (1100, 0, 1720, 820)),
                 (H + 'hod_flat/flat_wide.webp', (1630, 210, 1870, 680))],
    },
}

REF_TEXT = ('Reference 1 is an identity portrait: take only the face, age and hair from it and ignore its winter clothing, head '
            'pose and gaze. Reference 2 shows the same person in a summer film frame: face, hair, clothing and build. '
            'Reference 3 shows the full figure in the same summer clothing.')

SHEETS = {
    'head': ('CHARACTER HEAD TURNAROUND SHEET — {name}. One and the same person drawn six times as a model sheet for an illustrated '
             'film, in two rows of three on a plain flat light warm-grey background: top row — front view, three-quarter view '
             'turned to the left, left profile; bottom row — back of the head, right profile, three-quarter view turned to the '
             'right. Head and shoulders only, all six at exactly the same scale with aligned eye lines and the same even soft '
             'front light; neutral calm expression, mouth closed. Nothing else on the sheet: no text, no labels, no numbers, no '
             'frames, no props.'),
    'body': ('CHARACTER FULL-FIGURE TURNAROUND SHEET — {name}. One and the same person standing at full height, drawn four times '
             'side by side as a model sheet for an illustrated film: front view, three-quarter view turned to the left, left side '
             'view, back view; all at exactly the same scale with feet on one baseline and heads at one height, relaxed neutral '
             'stance, arms hanging naturally, on a plain flat light warm-grey background with even soft front light and only a '
             'faint contact shadow under the feet. No text, no labels, no numbers, no frames, no props.'),
}
SHEET_STYLE = ['02', '03', '04', '05', '10', '12']


def sheet_prompt(who: str, kind: str) -> str:
    c = CHARS[who]
    return (f'{SHEETS[kind].format(name=c["name"])}\n\nWho: {c["look"]}. Clothing (summer, August 1993): {c["costume"]}. '
            f'{REF_TEXT} All views must show exactly the same person: the same face, age, proportions, hairstyle and clothes '
            f'as in the references.\n\n{style(SHEET_STYLE, header=False)}')


# ───────────────────────────── генерация и расходы ─────────────────────────────

def ledger_add(name: str, usage: dict) -> float:
    path = os.path.join(RAW, 'ledger.json')
    rows = json.load(open(path)) if os.path.exists(path) else []
    det_in = usage.get('input_tokens_details') or {}
    det_out = usage.get('output_tokens_details') or {}
    cost = (det_in.get('text_tokens', 0) * PRICE['text'] + det_in.get('image_tokens', 0) * PRICE['image_in']
            + det_out.get('image_tokens', usage.get('output_tokens', 0)) * PRICE['image_out']) / 1e6
    rows.append({'name': name, 'usage': usage, 'cost': round(cost, 4)})
    json.dump(rows, open(path, 'w'), indent=1)
    return cost


def spent() -> float:
    path = os.path.join(RAW, 'ledger.json')
    return sum(r['cost'] for r in json.load(open(path))) if os.path.exists(path) else 0.0


def gen(name: str, prompt: str, images: list[str], size: str, out_dir: str, mask: str = '') -> str:
    os.makedirs(out_dir, exist_ok=True)
    env = {**os.environ, 'SSL_CERT_FILE': '/etc/ssl/cert.pem'}
    cmd = [sys.executable, GPT, prompt, '--model', 'sunburst', '--quality', 'high', '--size', size, '--format', 'png',
           '--out', out_dir, '--name', name]
    for im in images:
        cmd += ['--image', im]
    if mask:
        cmd += ['--mask', mask]
    for attempt in (1, 2):  # запрос к API изредка виснет до таймаута — один повтор
        res = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if res.returncode == 0:
            break
        print(f'{name}: попытка {attempt} не удалась: {res.stderr.strip()[-300:]}', file=sys.stderr)
    else:
        sys.exit(f'{name}: генерация не удалась')
    data = json.loads(res.stdout[res.stdout.index('{'):])
    cost = ledger_add(name, data.get('usage') or {})
    print(f'{name}: ${cost:.3f}; всего потрачено ${spent():.2f} → {data["files"][0]}')
    return data['files'][0]


def ref_files(who: str) -> list[str]:
    out = []
    os.makedirs(os.path.join(RAW, 'refs'), exist_ok=True)
    for i, (path, box) in enumerate(CHARS[who]['refs']):
        im = Image.open(os.path.join(ROOT, path)).convert('RGB')
        if box:
            im = im.crop(box)
        im.thumbnail((1024, 1024))
        dst = os.path.join(RAW, 'refs', f'{who}_{i + 1}.png')
        im.save(dst)
        out.append(dst)
    return out


def sheets(who: str) -> None:
    refs = ref_files(who)
    for kind in ('head', 'body'):
        gen(f'{who}_{kind}', sheet_prompt(who, kind), refs, '2560x1440', os.path.join(RAW, 'sheets'))


# ───────────────────────────── кадры ─────────────────────────────

EP = json.load(open(os.path.join(ROOT, 'episodes/s1/ep01_hod.json'), encoding='utf-8'))
SHOT = {s['id'][3:]: s for s in EP['assets']['shots']}
EXTRA = {'flat_inspect': 'hod_flat_inspect'}  # фон мини-игры осмотра: только 16:9 (квадрат сдвинул бы зоны находок)
CLOTHES = {'sledak': 'pale-blue short-sleeved shirt and a navy tie', 'oper': 'blue-grey checked shirt over a grey T-shirt',
           'buyer': 'thin-rimmed glasses and a beige paint-spattered checked shirt', 'lapin_wife': 'blue-grey print dress and an apron'}
SCENE_STYLE = ['01', '02', '03', '04', '05', '06', '07', '10', '11', '12', '13']
SQUARE_STYLE = ['02', '03', '04', '05', '06', '07', '10', '12']
SQUARE = ('Reframe this illustrated film frame (image 1) into a square 1:1 frame for a phone screen. Keep every person who is '
          'fully visible in image 1 fully inside the square with exactly the same identity, pose, gaze, expression and clothes; '
          'a person seen only as a shoulder or the back of the head at an edge of image 1 stays at that edge, cut by the frame '
          'the same way. Keep the same moment, room, light and drawing style. Extend the room above and below as needed and '
          'bring the framing slightly closer; do not move anyone relative to the others, do not add or remove people or objects.')

# Кто где и куда смотрит — по принятым кадрам «Реализма» (tools/hod/shots.py) и проверке их взглядов 2026-10-13:
# портреты-развёртки смотрят в объектив, без этих строк модель переносит их взгляд в кадр.
STAGING = {
    'office_am_wide': {
        'sledak': 'sits behind the desk on the LEFT, his face in three-quarter view turned right, his eyes on Sayko',
        'oper': "sits on the visitor's chair on the RIGHT, turned left, leaning forward with his elbows on his knees, a wry "
                'half-smile, his eyes on Gromov'},
    'office_am_ots_oper': {
        'oper': "sits on the visitor's chair facing the camera, talking, one open hand turned up; his eyes on Gromov, just left "
                'of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge, out of focus'},
    'office_am_phone': {
        'sledak': 'sits behind the desk holding the black receiver of the rotary telephone to his right ear, a pencil in his '
                  "other hand, listening; his eyes turned right toward Sayko's shoulder",
        'oper': 'only the back of his head and his shoulder at the RIGHT edge in the foreground, out of focus'},
    'car_wide': {
        'oper': 'drives on the LEFT, one hand on the wheel, glancing right at Gromov',
        'sledak': 'sits in the passenger seat on the RIGHT, his eyes down on the papers in the open case folder on his knees'},
    'car_ots_oper': {
        'oper': 'drives, in three-quarter view, a crooked grin, one hand on the wheel; his eyes on Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'flat_wide': {
        'oper': 'leans on the hallway door frame at the LEFT edge in the foreground, in profile, looking at the glass doors of the '
                'sideboard',
        'buyer': 'stands in front of the sideboard LEFT of centre, papers held to his chest, his eyes on Gromov',
        'sledak': 'stands RIGHT of centre, seen from behind, the case folder under his arm, looking at Lapin',
        'lapin_wife': 'stands in the kitchen doorway on the RIGHT, drying her hands on a tea towel, watching her husband'},
    'flat_ots_buyer': {
        'buyer': 'stands in front of the sideboard facing the camera, papers in both hands, talking fast, defensive; his eyes on '
                 'Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'flat_ots_wife': {
        'lapin_wife': 'stands facing the camera, the tea towel twisted in her hands, worried and tired; her eyes on Gromov, just '
                      'left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge'},
    'flat_photo': {
        'sledak': 'only his head in three-quarter view from behind, his short sleeve and his hand at the RIGHT, holding the '
                  'half-open glass door of the sideboard; his eyes on the framed photograph'},
    'flat_inspect': {},
}
GAZE = ('Every person keeps the pose, head turn and gaze of image 1: each looks at another person or an object as written, '
        'never into the lens. The turnaround sheets give only face, hair and clothing — ignore their head poses and their '
        'gaze toward the viewer.')
# Общий план места, уже перерисованный, — образец рисунка для остальных кадров сета (одна рука, одна палитра).
STYLE_REF = {'office_am_ots_oper': 'office_am_wide', 'office_am_phone': 'office_am_wide', 'car_ots_oper': 'car_wide',
             'flat_ots_buyer': 'flat_wide', 'flat_ots_wife': 'flat_wide', 'flat_photo': 'flat_wide', 'flat_inspect': 'flat_wide'}


def shot_info(sid: str) -> tuple[str, str, list[str]]:
    """Исходный кадр «Реализма», сет и кто виден в кадре (по STAGING: у вставки с фото в эпизоде состава нет, а Громов есть)."""
    if sid in EXTRA:
        return f'assets/ep01/hod/{EXTRA[sid]}/{sid}.webp', EXTRA[sid], list(STAGING[sid])
    s = SHOT[sid]
    return s['file'], s['set'], list(STAGING[sid])


def people(cast: list[str], first: int) -> tuple[str, list[str]]:
    """Листы голов тех, кто в кадре (утверждённые развёртки), и как сказать модели, кто есть кто."""
    who = [w for w in cast if w in CHARS]
    files = [os.path.join(RAW, 'sheets', f'{w}_head.png') for w in who]
    text = '; '.join(f'image {first + i} — {CHARS[w]["name"]} ({CLOTHES[w]})' for i, w in enumerate(who))
    return text, files


def scene_inputs(sid: str) -> tuple[str, list[str]]:
    """Промпт кадра и картинки к нему: исходный кадр, листы голов, общий план сета в новом стиле (если уже есть)."""
    src, set_, cast = shot_info(sid)
    im = Image.open(os.path.join(ROOT, src)).convert('RGB')
    pad = Image.new('RGB', (1920, 1088))
    pad.paste(im, (0, 4))
    pad.paste(im.crop((0, 0, 1920, 4)), (0, 0))
    pad.paste(im.crop((0, 1076, 1920, 1080)), (0, 1084))
    os.makedirs(os.path.join(RAW, 'src'), exist_ok=True)
    src_png = os.path.join(RAW, 'src', f'{sid}.png')
    pad.save(src_png)
    who, sheets = people(cast, 2)
    images = [src_png, *sheets]
    intro = ('IMAGES. Image 1 is the source film frame to redraw: keep its composition, framing and every person and object '
             'exactly where they are, in the same state.')
    if sheets:
        intro += (f' Approved character turnaround sheets in the target style: {who}. Draw each person with exactly that face, '
                  f'hair and clothing.')
    wide = os.path.join(RAW, 'scenes', f'{STYLE_REF[sid]}.png') if sid in STYLE_REF else ''
    if wide and os.path.exists(wide):
        images.append(wide)
        intro += (f' Image {len(images)} is the already approved illustrated wide frame of this same place: match its drawing '
                  f'style, line weight, palette and the way the room and the people are drawn; take nothing else from it — the '
                  f'composition comes from image 1.')
    parts = [intro, *where(sid, cast)] if cast else [intro, 'There are no people in this frame.']
    return '\n\n'.join(parts) + f'\n\n{style(SCENE_STYLE, header=True)}', images


def where(sid: str, cast: list[str]) -> list[str]:
    """Кто где и куда смотрит + правило взгляда (общие для кадра и квадрата)."""
    return ['WHO IS WHERE (exactly as in image 1): ' + ' '.join(f'{CHARS[w]["name"]}: {STAGING[sid][w]}.' for w in cast), GAZE]


def scene(sid: str) -> None:
    prompt, images = scene_inputs(sid)
    gen(sid, prompt, images, '1920x1088', os.path.join(RAW, 'scenes'))


def square(sid: str) -> None:
    _, _, cast = shot_info(sid)
    base = os.path.join(RAW, 'scenes', f'{sid}.png')
    who, sheets = people(cast, 2)
    refs = f' Approved character turnaround sheets for identity: {who}.' if sheets else ''
    parts = [SQUARE + refs, *(where(sid, cast) if cast else [])]
    gen(f'{sid}.square', '\n\n'.join(parts) + f'\n\n{style(SQUARE_STYLE, header=False)}', [base, *sheets], '1536x1536',
        os.path.join(RAW, 'squares'))


def fix(target: str, box: str, what: str) -> None:
    """Правка по маске (sunburst): перерисовать только прямоугольник box кадра (<кадр> или <кадр>.square), остальное —
    пиксель в пиксель; первый вариант кадра сохраняется рядом как .orig.png."""
    import shutil
    from PIL import ImageDraw, ImageFilter
    sid = target.removesuffix('.square')
    raw = os.path.join(RAW, 'squares' if target.endswith('.square') else 'scenes', f'{target}.png')
    orig = raw[:-4] + '.orig.png'
    if not os.path.exists(orig):
        shutil.copy(raw, orig)
    x0, y0, x1, y1 = (int(v) for v in box.split(','))
    src = Image.open(raw).convert('RGB')
    mask = Image.new('RGBA', src.size, (0, 0, 0, 255))
    ImageDraw.Draw(mask).rectangle((x0, y0, x1, y1), fill=(0, 0, 0, 0))  # прозрачное — что перерисовать
    os.makedirs(os.path.join(RAW, 'fix'), exist_ok=True)
    mpath = os.path.join(RAW, 'fix', f'{target}.mask.png')
    mask.save(mpath)
    who, sheets = people(shot_info(sid)[2], 2)
    prompt = (f'Edit only the transparent masked rectangle of image 1; everything outside it stays exactly as it is. Inside the '
              f'rectangle: {what} Keep exactly the same drawing style, ink line weight, cel shading, palette and light as the '
              f'rest of image 1, so the edit is invisible.' + (f' Character turnaround sheets for identity: {who}.' if sheets else ''))
    out = gen(f'{target}.fix', prompt, [raw, *sheets], f'{src.size[0]}x{src.size[1]}', os.path.join(RAW, 'fix'), mask=mpath)
    fixed = Image.open(out).convert('RGB').resize(src.size)
    soft = Image.new('L', src.size, 0)
    ImageDraw.Draw(soft).rectangle((x0 + 6, y0 + 6, x1 - 6, y1 - 6), fill=255)
    Image.composite(fixed, src, soft.filter(ImageFilter.GaussianBlur(4))).save(raw)
    print('исправлено', raw)


def accept(sid: str) -> None:
    """Принятые кадры → assets/ep01/hod_memory/<сет>/<кадр>.webp (1920×1080) и .square.webp (1200×1200)."""
    _, set_, _ = shot_info(sid)
    out = os.path.join(ROOT, f'assets/ep01/hod_memory/{set_}')
    os.makedirs(out, exist_ok=True)
    wide = Image.open(os.path.join(RAW, 'scenes', f'{sid}.png')).convert('RGB').resize((1920, 1088), Image.LANCZOS).crop((0, 4, 1920, 1084))
    wide.save(os.path.join(out, f'{sid}.webp'), 'WEBP', quality=86, method=6)
    sq = os.path.join(RAW, 'squares', f'{sid}.square.png')
    if os.path.exists(sq):
        Image.open(sq).convert('RGB').resize((1200, 1200), Image.LANCZOS).save(os.path.join(out, f'{sid}.square.webp'), 'WEBP',
                                                                             quality=86, method=6)
    print('принято', sid, '→', out)


if __name__ == '__main__':
    cmd, *args = sys.argv[1:] or ['cost']
    if cmd == 'sheets':
        for w in args:
            sheets(w)
    elif cmd in ('scene', 'square', 'accept'):
        for sid in args:
            {'scene': scene, 'square': square, 'accept': accept}[cmd](sid)
    elif cmd == 'fix':  # fix <кадр>[.square] x0,y0,x1,y1 "что исправить"
        fix(args[0], args[1], args[2])
    elif cmd == 'prompt':  # prompt <кадр> — промпт кадра и картинки; prompt <персонаж> head|body — лист
        if args[0] in STAGING:
            text, files = scene_inputs(args[0])
            print(text, '\n\nIMAGES:', *[os.path.relpath(f, ROOT) for f in files], sep='\n')
        else:
            print(sheet_prompt(args[0], args[1]))
    elif cmd == 'cost':
        print(f'потрачено ${spent():.2f}')
