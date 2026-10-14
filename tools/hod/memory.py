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
    # Остальные места (решение владельца 2026-10-13: «все сцены в стиле воспоминания»). Внешность и костюм — как у
    # реалистичных кадров (tools/hod/shots.py); вырезки — по маскам Vision на принятых кадрах «Реализма».
    'expert': {
        'name': 'forensic expert Nina Levina',
        'look': 'woman, 45, a sharp angular face with high cheekbones, a long straight nose, a thin ironic mouth, dark attentive eyes '
                'behind rimless glasses on a thin chain, dark hair with the first grey pulled into a tight bun, no makeup',
        'costume': 'a beige short-sleeved summer dress with a small print under an unbuttoned white lab coat, glasses on a chain',
        'refs': [('assets/ep01/faces/expert.webp', None), (H + 'hod_office_eve/office_eve_ots_expert.webp', (566, 125, 1493, 1079)),
                 (H + 'hod_office_night/office_night_wide.webp', (983, 125, 1396, 1056))],
    },
    'boss': {
        'name': 'Valentin Pavlovich, head of the investigation department',
        'look': 'man, 55, heavy and tall, a broad jowly face with a strong nose, tired hooded eyes with heavy lids, thick grey hair '
                'combed straight back, a small old scar on the chin',
        'costume': 'a white short-sleeved shirt with a dark tie, dark suit trousers, black shoes; no jacket',
        'refs': [('assets/ep01/faces/boss.webp', None), (H + 'hod_office_d2/office_d2_ots_boss.webp', (747, 58, 1561, 1079)),
                 (H + 'hod_office_d2/office_d2_wide.webp', (1419, 119, 1733, 980))],
    },
    'neighbor': {
        'name': 'Galina, the neighbour',
        'look': 'woman, 60, sturdy and broad, a square face with a heavy chin, small sharp dark eyes, thick eyebrows, a wide mouth '
                'with a gold tooth at the side, dyed chestnut hair under a kerchief tied at the back of the neck',
        'costume': 'a faded flowered blue-and-white cotton house dress with short sleeves, a kitchen apron, felt slippers, hair under '
                   'a light cotton kerchief tied at the back of the neck; no cardigan',
        'refs': [('assets/ep01/faces/neighbor.webp', None), (H + 'hod_landing_open/landing_open_ots.webp', (359, 99, 1176, 1079)),
                 (H + 'hod_landing_open/landing_open_wide.webp', (227, 149, 413, 901))],
    },
    'notary': {
        'name': 'notary Kovrigin',
        'look': 'man, 55, soft and heavy, a round face with a double chin, pouches under small wary brown eyes, a bulbous nose with '
                'broken capillaries, thinning hair combed over a bald crown, a damp forehead',
        'costume': 'a rumpled light-grey summer suit, a white shirt, a loosened tie, a gold signet ring',
        'refs': [('assets/ep01/faces/notary.webp', None), (H + 'hod_notary/notary_ots_notary.webp', (347, 276, 1273, 1051)),
                 (H + 'hod_notary/notary_wide.webp', (568, 387, 1010, 792))],
    },
    'assistant': {
        'name': "Lyuda, the notary's assistant",
        'look': 'woman, 23, slim, a pale oval face with light freckles, light-brown hair in a low ponytail, thin plucked eyebrows, '
                'nervous grey eyes',
        'costume': 'a white short-sleeved blouse, a dark straight skirt, a thin chain necklace',
        'refs': [(H + 'hod_notary_stairs/stairs_ots_assistant.webp', (273, 88, 1012, 1079)),
                 (H + 'hod_notary_stairs/stairs_wide.webp', (875, 120, 1125, 845))],
    },
    'passport_clerk': {
        'name': 'the passport clerk of the housing office',
        'look': 'woman, 52, plump, a round face, a tight perm of reddish-dyed hair, coral lipstick, heavy reading glasses on a cord',
        'costume': 'a short-sleeved floral blouse',
        'refs': [(H + 'hod_zhek/zhek_ots_clerk.webp', (649, 73, 1612, 928))],
    },
    'clerk': {
        'name': 'Raisa Lvovna, the archivist',
        'look': 'woman, 60, a small sharp face with a pointed chin, lively dark eyes behind large plastic-framed glasses on a cord, '
                'a mocking stern mouth with thin lips, short grey hair cut straight, a pencil behind her ear',
        'costume': 'a light short-sleeved blouse with a brooch, a thin grey knitted cardigan over her shoulders, glasses on a cord',
        'refs': [('assets/ep01/faces/clerk.webp', None), (H + 'hod_bti/bti_ots_clerk.webp', (212, 59, 1148, 1079)),
                 (H + 'hod_bti/bti_wide.webp', (78, 158, 685, 1079))],
    },
    'zoya': {
        'name': 'Zoya Pavlovna',
        'look': 'woman, 74, small and slight with a slight stoop, a thin lined face with sunken cheeks and a small sharp chin, faded '
                'watery pale-blue eyes with heavy lids, a small nose, a thin pale mouth without lipstick, sparse white hair',
        'costume': 'a light floral summer dress with a beige knitted cardigan, a light cotton kerchief over her hair, a cloth '
                   'handbag on her arm',
        'refs': [('assets/ep01/faces/zoya.webp', None), (H + 'hod_recon/recon_ots_zoya.webp', (399, 125, 1172, 1079)),
                 (H + 'hod_recon/recon_wide.webp', (650, 294, 932, 1079))],
    },
    # Дни 3–5 (docs/season1/ep01-hod-finale.md): внешность и костюм — как в tools/hod/shots.py, вырезки — по принятым
    # кадрам «Реализма» (assets/ep01/hod, 1920×1080).
    'murashov': {
        'name': 'Sergei Murashov, the apartment dealer',
        'look': 'man, 38, tall and neat, a smooth oval face with soft features that are hard to remember, pale blue calm eyes, a '
                'well-groomed dark moustache, dark hair parted on the left and combed flat, a clean-shaven jaw, good skin; '
                'deliberately ordinary, polite, not charismatic',
        'costume': 'a light beige summer jacket over a pale-blue shirt, a narrow patterned tie with a tie pin, light trousers, '
                   'polished brown shoes',
        'refs': [('assets/ep01/faces/murashov.webp', None), (H + 'hod_agency/agency_ots_murashov.webp', (1180, 60, 1920, 1080)),
                 (H + 'hod_op/op_stairs.webp', (1040, 150, 1480, 1080))],
    },
    'accomplice': {
        'name': 'Dmitry Shmelyov (Shmel), the driver',
        'look': 'man, 30, a thick neck, a boxer\'s build and a flattened boxer\'s nose, small deep-set eyes, a low forehead, a '
                'cauliflower ear, short dark hair with a razor fade, a scar through one eyebrow; a scared, uncomprehending look',
        'costume': 'a navy tracksuit top with three white stripes unzipped over a white T-shirt, a thin gold chain, dark trousers, '
                   'worn white trainers; no padded jacket',
        'refs': [('assets/ep01/faces/accomplice.webp', None), (H + 'hod_op/op_metro.webp', (290, 350, 1125, 1080))],
    },
    'klava': {
        'name': 'Klavdia Semyonovna, the neighbour of the missing old man',
        'look': 'woman, 74, small and lean, a sharp wrinkled face, bright watchful dark eyes behind big old-fashioned glasses with '
                'thick lenses, thin grey hair pinned in a bun, a mole on her left cheek',
        'costume': 'a brown short-sleeved house dress with a small white check and a white collar, felt slippers',
        'refs': [(H + 'hod_second/second_ots_klava.webp', (650, 100, 1500, 1080)),
                 (H + 'hod_second/second_wide.webp', (1200, 200, 1575, 1040))],
    },
    'landlady': {
        'name': 'the landlady',
        'look': 'woman, 58, stout, a broad tired face with plump cheeks, short dyed chestnut hair with grey roots, small gold '
                'earrings',
        'costume': 'a sleeveless floral summer house dress, a kitchen towel over her shoulder, rubber slippers',
        'refs': [(H + 'hod_chertanovo/chertanovo_wide.webp', (960, 200, 1300, 1080))],
    },
    'sledak_old': {
        'name': 'Andrei Gromov in 2004, eleven years later',
        'look': 'the same man as Investigator Andrei Gromov at 40: the face heavier and broader, grey at the temples and in the '
                'stubble, deep lines from the nose to the mouth, the same grey eyes and heavy brows; quiet grief without self-pity',
        'costume': 'a charcoal blazer over a black open-collar shirt, no tie, a wedding ring',
        'period': '2004',
        'refs': [('assets/ep01/faces/sledak_old.webp', None), (H + 'hod_2004/gromov_2004.webp', (75, 150, 950, 1080))],
    },
    # Лица в кадре нет никогда — листа нет, рисунок держит исходный кадр.
    'murashov_sil': {
        'name': 'the polite man',
        'look': 'a neat man of about 38 seen only from behind: medium height, narrow shoulders, short tidy dark hair with a straight '
                'parting',
        'costume': 'a light beige summer jacket, light trousers, a brown leather briefcase',
        'refs': [],
        'sheet': False,
    },
}

def ref_text(who: str) -> str:
    """Что взять с каждого референса: портрет из faces — только лицо (одежда там зимняя); кадры — лицо, одежда, фигура."""
    return ' '.join(
        f'Reference {i} is an identity portrait: take only the face, age and hair from it and ignore its clothing, head pose '
        f'and gaze.' if '/faces/' in path else
        f'Reference {i} shows the same person in a summer film frame: face, hair, clothing and build.'
        for i, (path, _) in enumerate(CHARS[who]['refs'], 1))

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
    return (f'{SHEETS[kind].format(name=c["name"])}\n\nWho: {c["look"]}. Clothing ({c.get("period", "summer 1993")}): {c["costume"]}. '
            f'{ref_text(who)} All views must show exactly the same person: the same face, age, proportions, hairstyle and '
            f'clothes as in the references.\n\n{style(SHEET_STYLE, header=False)}')


# ───────────────────────────── генерация и расходы ─────────────────────────────

def ledger_lock():
    """Журнал пишут несколько генераций сразу (кадры идут параллельно) — запись под блокировкой файла."""
    import fcntl
    f = open(os.path.join(RAW, 'ledger.lock'), 'w')
    fcntl.flock(f, fcntl.LOCK_EX)
    return f


def ledger_add(name: str, usage: dict) -> float:
    path = os.path.join(RAW, 'ledger.json')
    det_in = usage.get('input_tokens_details') or {}
    det_out = usage.get('output_tokens_details') or {}
    cost = (det_in.get('text_tokens', 0) * PRICE['text'] + det_in.get('image_tokens', 0) * PRICE['image_in']
            + det_out.get('image_tokens', usage.get('output_tokens', 0)) * PRICE['image_out']) / 1e6
    with ledger_lock():
        rows = json.load(open(path)) if os.path.exists(path) else []
        rows.append({'name': name, 'usage': usage, 'cost': round(cost, 4)})
        json.dump(rows, open(path + '.tmp', 'w'), indent=1)
        os.replace(path + '.tmp', path)
    return cost


def spent() -> float:
    path = os.path.join(RAW, 'ledger.json')
    with ledger_lock():
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
           'buyer': 'thin-rimmed glasses and a beige paint-spattered checked shirt', 'lapin_wife': 'blue-grey print dress and an apron',
           'expert': 'white lab coat over a beige dress, glasses on a chain', 'boss': 'white short-sleeved shirt and a dark tie',
           'neighbor': 'flowered house dress, apron and kerchief', 'notary': 'rumpled light-grey suit and a loosened tie',
           'assistant': 'white blouse and a dark skirt', 'passport_clerk': 'floral blouse and reading glasses on a cord',
           'clerk': 'light blouse with a brooch and a grey cardigan', 'zoya': 'floral summer dress, beige cardigan and a kerchief',
           'murashov': 'light beige summer jacket and a pale-blue shirt', 'accomplice': 'navy tracksuit top with white stripes',
           'klava': 'brown checked house dress with a white collar, thick glasses', 'landlady': 'sleeveless floral house dress',
           'sledak_old': 'charcoal blazer over a black shirt'}
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
    # Остальные места — по описаниям принятых кадров «Реализма» (tools/hod/shots.py), взгляд — как на них.
    'office_eve_wide': {
        'sledak': 'sits behind the desk on the LEFT, reaching for a glass of tea Levina holds out to him; his eyes on Levina',
        'oper': 'stands at the open window in the centre of the back wall, smoking, half-turned to the room; his eyes on Gromov and '
                'Levina at the desk',
        'expert': 'sits on the RIGHT corner of the desk, half-turned toward Gromov, holding out a glass of tea in a metal '
                  'glass-holder; her eyes on Gromov'},
    'office_eve_ots_expert': {
        'expert': 'sits on the desk corner facing the camera, a glass of tea in one hand, a cigarette in the other, dry and calm; '
                  'her eyes on Gromov over her glasses, just left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge'},
    'office_eve_lens': {
        'expert': 'bends over a typed document under the green desk lamp, a round magnifying glass in her hand, pointing with the '
                  'tip of a pencil at the date line; her eyes on the paper',
        'sledak': 'leans in from the left, his eyes on the same spot on the paper'},
    'office_eve_phone': {
        'sledak': 'sits behind the desk with the telephone receiver at his ear, rubbing his eyes with his other hand, tired',
        'expert': 'only her white lab-coat shoulder at the RIGHT edge in the foreground, out of focus'},
    'office_d2_wide': {
        'sledak': 'has stood up behind his desk on the LEFT, seen three-quarter from behind, facing the boss',
        'oper': "sits on the visitor's chair between them, turned toward the door; his eyes on the boss",
        'boss': 'stands in the open doorway on the RIGHT, one hand on the door handle; his eyes on Gromov, heavy disapproval'},
    'office_d2_ots_boss': {
        'boss': 'stands in the doorway facing the camera, a hand at his collar, speaking firmly; his eyes on Gromov, just left of '
                'the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge, standing'},
    'office_night_wide': {
        'sledak': 'sits behind the desk on the LEFT under the green lamp, papers spread out in front of him; his eyes up on Levina',
        'expert': 'stands at the open window in the centre of the back wall, smoking, half-turned toward Gromov',
        'oper': "sits on the visitor's chair at the RIGHT end of the desk, tired, elbows on his knees; his eyes on Gromov"},
    'office_night_ots_expert': {
        'expert': 'stands at the open dark window facing the camera, a cigarette in her fingers, asking a question, eyes narrowed; '
                  'her eyes on Gromov, just left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge, in the lamp light'},
    'landing_chain_wide': {
        'neighbor': "only her face and a strip of her house dress in the gap of her door No. 33, open a hand's width on a door "
                    'chain; one suspicious eye on Gromov',
        'sledak': "stands in front of Galina's door, LEFT of centre, seen from behind, his case folder in his hand",
        'oper': "leans on the stair railing at the RIGHT edge in the foreground; his eyes on Zoya's steel door No. 34"},
    'landing_chain_ots': {
        'neighbor': 'her face in the gap of the door behind the stretched chain, distrustful; her eyes on Gromov, just right of '
                    'the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'landing_open_wide': {
        'neighbor': 'stands on the threshold of her wide-open door No. 33, the chain hanging loose, in her house dress, apron and '
                    'slippers, leaning toward Gromov and speaking quietly; her eyes on Gromov',
        'sledak': 'stands close in front of her, LEFT of centre, seen from behind, listening',
        'oper': 'leans on the stair railing at the RIGHT edge in the foreground; his eyes on Galina'},
    'landing_open_ots': {
        'neighbor': 'stands on the landing facing the camera, one hand pressed to her chest, speaking low and frightened; her eyes '
                    'flick to the side toward the neighbouring door',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'notary_wide': {
        'assistant': "sits at the small typing desk by the window on the LEFT, her hands frozen above the typewriter keys; her "
                     "eyes over her shoulder on Gromov's back",
        'notary': 'sits behind the desk in the centre, dabbing his forehead with a handkerchief, the open register in front of '
                  'him, a strained polite smile; his eyes on Gromov',
        'sledak': 'stands in front of the desk, RIGHT of centre, seen from behind, his case folder in his hand',
        'oper': 'leans on the frame of the open door on the RIGHT, arms crossed; his eyes on Lyuda'},
    'notary_ots_notary': {
        'notary': 'sits behind the desk facing the camera, his hand flat on the open register, sweating, a polite strained smile; '
                  'his eyes up on Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge, standing'},
    'notary_register': {
        'notary': 'only his plump hand with the gold signet ring resting at the edge of the page'},
    'notary_alone_wide': {
        'notary': 'sits behind the desk in the centre, a handkerchief in his hand, the open register in front of him, a cautious '
                  'polite smile; his eyes on Gromov',
        'sledak': 'stands in front of the desk, RIGHT of centre, seen from behind, his case folder in his hand',
        'oper': 'leans on the frame of the open door on the RIGHT, arms crossed; his eyes on the empty typing desk'},
    'stairs_wide': {
        'sledak': 'stands three steps below in the foreground on the LEFT, seen from behind, looking up at them',
        'assistant': 'stands at the window on the landing, arms crossed, a cigarette between two fingers; her eyes down on the '
                     'floor, frightened',
        'oper': 'leans on the windowsill next to her, relaxed, holding out his lighter; his eyes on her, kindly'},
    'stairs_ots_assistant': {
        'assistant': 'stands by the sunlit window facing the camera, speaking quickly and quietly, the cigarette trembling in her '
                     'fingers; her eyes on Sayko, just right of the camera',
        'oper': 'only the back of his head and his shoulder at the RIGHT edge'},
    'zhek_wide': {
        'oper': 'stands by the bench on the LEFT, hands in his pockets; his eyes on the clerk',
        'sledak': 'stands at the service window, leaning slightly toward it, seen from the side and behind',
        'passport_clerk': 'sits behind the open service window in the RIGHT wall, reading glasses on, a pile of house registers '
                          'in front of her; her eyes up on Gromov'},
    'zhek_ots_clerk': {
        'passport_clerk': 'inside the service window facing the camera, glasses on her nose, a finger on an open house register, '
                          'answering curtly; her eyes on Gromov, just left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge'},
    'bti_wide': {
        'clerk': 'stands at an open card-index drawer on the LEFT, holding a record card up to the light; her eyes over her '
                 'glasses on Gromov',
        'sledak': 'stands at the reading desk on the RIGHT, turned toward her, his folder open on the desk; his eyes on Raisa '
                  'Lvovna'},
    'bti_ots_clerk': {
        'clerk': 'stands at the card drawers facing the camera, a record card in her hand, speaking; her eyes over her glasses on '
                 'Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'recon_wide': {
        'zoya': 'stands near the service window, LEFT of centre, holding a cardboard folder of papers to her chest; her eyes up on '
                'the polite man, cautious gratitude',
        'murashov_sil': 'stands RIGHT of centre with his back to the camera, leaning slightly toward Zoya Pavlovna, pointing at '
                        'the papers in her folder; his face is never visible'},
    'recon_ots_zoya': {
        'zoya': 'faces the camera, looking up at the polite man with a shy grateful smile, the cardboard folder held to her chest; '
                'her eyes on him, just right of the camera',
        'murashov_sil': 'only the back of his neat dark head and the shoulder of his light beige jacket at the RIGHT edge; his '
                        'face is never visible'},    # дни 3–5 — по принятым кадрам «Реализма» (tools/hod/shots.py); взгляды проверены на кадрах 2026-10-14
    'walk_wide': {'sledak': 'stands alone at the trolleybus stop LEFT of centre, holding a slip of paper in both hands and reading '
                            'it; a brown shoulder bag hangs on its long strap from his right shoulder against his hip, no hand '
                            'on it; exactly two arms and two hands; his eyes on the paper'},
    'second_wide': {
        'sledak': 'stands on the landing LEFT of centre, seen three-quarter from behind, turned toward the old woman; his eyes on her',
        'klava': 'stands in her open doorway on the RIGHT, one hand on the door frame, the other pointing across at the steel door on the LEFT; her eyes on Gromov'},
    'second_ots_klava': {
        'klava': 'stands in her doorway facing the camera, one hand lifted, speaking with bitter certainty; her eyes on Gromov, just left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge'},
    'chertanovo_wide': {
        'sledak': 'stands LEFT of centre, seen three-quarter from behind, a folder in his hand, facing her; his eyes on her',
        'landlady': 'stands by the closed lift doors RIGHT of centre, arms folded, talking readily; her eyes on Gromov'},
    'agency_street_wide': {'sledak': 'stands on the near pavement in the LEFT foreground, seen from behind, looking across the road at the agency entrance and the grey Volga'},
    'agency_wide': {
        'sledak': "sits on the visitor's chair on the LEFT, seen three-quarter from behind, a folder on his knees; his eyes on Murashov",
        'murashov': 'sits behind the big desk on the RIGHT, hands folded on the desk, a polite attentive half-smile; his eyes on Gromov'},
    'agency_ots_murashov': {
        'murashov': 'sits behind the desk facing the camera, a pen in his fingers, smiling politely; his pale calm eyes on Gromov, just left of the camera',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge'},
    'watch_wide': {
        'oper': "sits in the driver's seat on the LEFT, seen from behind, a hand on the wheel; his eyes on the agency entrance across the road",
        'sledak': 'sits in the passenger seat on the RIGHT, seen from behind, the folder closed on his knees; his eyes on the agency entrance'},
    'op_wide': {},
    'op_wounded': {
        'oper': "sits on the wet asphalt against the rear wheel of the grey Volga; his left hand crosses his chest and presses his RIGHT shoulder (on the LEFT side of the frame), a dark patch on the sleeve; a crooked grin; his eyes on Gromov",
        'sledak': "crouches on the RIGHT, seen in profile, his hand on Sayko's unhurt shoulder; his eyes on the wound"},
    'op_stairs': {
        'sledak': 'stands below on the LEFT, seen three-quarter from behind, handcuffs in his hand; his eyes on Murashov',
        'murashov': 'stands on the steps above, holding out both empty hands, wrists together, palms up; calm; his eyes on Gromov'},
    'op_metro': {
        'accomplice': "is pinned face-down on the bonnet of the grey Volga, his cheek pressed to the metal, BOTH hands behind "
                      "his back at the small of his back with the wrists crossed, neither hand in front of him; scared and "
                      "uncomprehending; his eyes off to the side, not into the lens",
        'oper': "leans his whole weight on him from behind on the RIGHT: his left hand clamps Shmel's crossed wrists at the "
                "small of his back, his right forearm presses between his shoulder blades; his eyes on Shmel. On the LEFT, on "
                "the far side of the bonnet, a young militia sergeant in a short-sleeved grey-blue uniform shirt and cap "
                "presses Shmel's left shoulder down with both hands and does not hold his hands; all doors of the Volga are closed"},
    'search_wide': {'sledak': 'stands at the desk in the centre, pulling open a drawer; his eyes down in the drawer'},
    'search_keys': {'sledak': 'only his hand and short pale-blue sleeve, lifting the bunch of tagged keys out of the drawer'},
    'search_papers': {'sledak': 'stands at the desk turning the pages of an open folder; his eyes on the papers'},
    'field_wide': {
        'expert': 'walks slowly along the tape in the middle distance, LEFT of centre, in rubber boots and a light raincoat, a notebook in her hand; her eyes down on the grass',
        'sledak': 'stands in the RIGHT foreground by the militia van, seen from the side, hands in his pockets; his eyes on the tape'},
    'field_ots_expert': {
        'expert': 'stands at the tape facing the camera, her notebook against her chest, speaking quietly; her eyes on Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
    'field_oper': {'oper': 'leans on the bonnet of the militia van, smoking, unsmiling; his eyes away toward the birches'},
    'interrog_wide': {
        'sledak': 'sits at the near LEFT end of the table, seen three-quarter from behind, writing the protocol; his eyes on the protocol',
        'murashov': "sits across the table, adjusting a shirt cuff, no tie; his eyes on Gromov's writing hand"},
    'interrog_ots_murashov': {
        'murashov': 'faces the camera across the table, no tie, a faint polite smile; his eyes lowered to the protocol under Gromov\'s hand',
        'sledak': 'only the back of his head and his shoulder at the LEFT edge, writing'},
    'confront_wide': {
        'notary': 'sits on the LEFT side of the table, staring down at the table, a damp handkerchief in his fist; his eyes on the table',
        'sledak': 'sits at the far end of the table, writing; his eyes on Kovrigin',
        'murashov': 'sits on the RIGHT side of the table, turned toward Kovrigin, calm and expectant; his eyes on Kovrigin'},
    'court_wide': {'murashov': "stands INSIDE a closed defendants' cage on the LEFT, fully behind its front bars, hands folded, "
                               "in a dark grey suit; the vertical steel bars run unbroken in front of his whole body, the cage "
                               "has no opening and no missing bars; the two militiamen stand OUTSIDE the cage; his eyes toward "
                               "the judges' bench, where the presiding judge in a black robe reads the verdict between two people's "
                               "assessors in dark suits"},
    'field_find': {},
    'agency_closed': {'sledak': 'stands at the closed agency door RIGHT of centre, small in the frame, seen from the side; his eyes on the paper sign on the glass'},
    'gromov_2004': {'sledak_old': 'sits in a leather office chair, turned three-quarter to the RIGHT; his eyes on an unseen interviewer off-camera on the right, never into the lens'},
}
GAZE = ('Every person keeps the pose, head turn and gaze of image 1: each looks at another person or an object as written, '
        'never into the lens. The turnaround sheets give only face, hair and clothing — ignore their head poses and their '
        'gaze toward the viewer.')
# Общий план места, уже перерисованный, — образец рисунка для остальных кадров сета (одна рука, одна палитра).
STYLE_REF = {'office_am_ots_oper': 'office_am_wide', 'office_am_phone': 'office_am_wide', 'car_ots_oper': 'car_wide',
             'flat_ots_buyer': 'flat_wide', 'flat_ots_wife': 'flat_wide', 'flat_photo': 'flat_wide', 'flat_inspect': 'flat_wide',
             # кабинет вечером, утром второго дня и ночью — тот же кабинет, рисунок держит утренний общий план
             'office_eve_wide': 'office_am_wide', 'office_eve_ots_expert': 'office_eve_wide', 'office_eve_lens': 'office_eve_wide',
             'office_eve_phone': 'office_eve_wide', 'office_d2_wide': 'office_am_wide', 'office_d2_ots_boss': 'office_d2_wide',
             'office_night_wide': 'office_am_wide', 'office_night_ots_expert': 'office_night_wide',
             'landing_chain_ots': 'landing_chain_wide', 'landing_open_wide': 'landing_chain_wide', 'landing_open_ots': 'landing_open_wide',
             'notary_ots_notary': 'notary_wide', 'notary_register': 'notary_wide', 'notary_alone_wide': 'notary_wide',
             'stairs_ots_assistant': 'stairs_wide', 'zhek_ots_clerk': 'zhek_wide', 'bti_ots_clerk': 'bti_wide',
             # реконструкция — тот же коридор ЖЭКа в июне
             'recon_wide': 'zhek_wide', 'recon_ots_zoya': 'recon_wide',
             # дни 3–5
             'second_ots_klava': 'second_wide', 'agency_ots_murashov': 'agency_wide', 'agency_closed': 'agency_street_wide',
             'op_wide': 'agency_street_wide', 'watch_wide': 'car_wide', 'search_keys': 'search_wide', 'search_papers': 'search_wide',
             'field_ots_expert': 'field_wide', 'field_oper': 'field_wide', 'interrog_ots_murashov': 'interrog_wide',
             'confront_wide': 'interrog_wide'}


def shot_info(sid: str) -> tuple[str, str, list[str]]:
    """Исходный кадр «Реализма», сет и кто виден в кадре (по STAGING: у вставки с фото в эпизоде состава нет, а Громов есть)."""
    if sid in EXTRA:
        return f'assets/ep01/hod/{EXTRA[sid]}/{sid}.webp', EXTRA[sid], list(STAGING[sid])
    s = SHOT[sid]
    return s['file'], s['set'], list(STAGING[sid])


def people(cast: list[str], first: int) -> tuple[str, list[str]]:
    """Листы голов тех, кто в кадре (утверждённые развёртки), и как сказать модели, кто есть кто."""
    who = [w for w in cast if w in CHARS and CHARS[w].get('sheet', True)]
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


def keep_mask(raw: str, keep: list[str]) -> Image.Image:
    """Что правка по маске не трогает: 'people' — все люди на кадре (Apple Vision локально, с запасом 8 px вокруг силуэта),
    'x0,y0,x1,y1' — прямоугольник (предмет перед правкой: ведро, папка в руке)."""
    import tempfile
    from PIL import ImageChops, ImageDraw, ImageFilter
    size = Image.open(raw).size
    out = Image.new('L', size, 0)
    for k in keep:
        if k == 'people':
            with tempfile.TemporaryDirectory() as tmp:
                subprocess.run(['swift', os.path.join(ROOT, 'tools/hod/person_masks.swift'), raw, tmp], check=True, capture_output=True)
                for name in os.listdir(tmp):
                    m = Image.open(os.path.join(tmp, name)).convert('L').resize(size)
                    out = ImageChops.lighter(out, m.point(lambda v: 255 if v > 64 else 0).filter(ImageFilter.MaxFilter(17)))
        else:
            ImageDraw.Draw(out).rectangle(tuple(int(v) for v in k.split(',')), fill=255)
    return out


def fix(target: str, box: str, what: str, keep: list[str] = (), ref: str = '', raw: str = '', realism: bool = False) -> None:
    """Правка по маске (sunburst): перерисовать только прямоугольник box кадра (<кадр> или <кадр>.square), остальное —
    пиксель в пиксель; первый вариант кадра сохраняется рядом как .orig.png. keep — что внутри прямоугольника не трогать
    (keep_mask); ref — картинка-образец предмета (тот же предмет в другом кадре сета). raw и realism — правка кадра
    «Реализма» (rfix): свой файл и фотографический, а не рисованный стиль."""
    import shutil
    from PIL import ImageChops, ImageDraw, ImageFilter, ImageOps
    sid = target.removesuffix('.square')
    raw = raw or os.path.join(RAW, 'squares' if target.endswith('.square') else 'scenes', f'{target}.png')
    orig = raw[:-4] + '.orig.png'
    if not os.path.exists(orig):
        shutil.copy(raw, orig)
    x0, y0, x1, y1 = (int(v) for v in box.split(','))
    src = Image.open(raw).convert('RGB')
    kept = keep_mask(raw, list(keep)) if keep else None
    mask = Image.new('RGBA', src.size, (0, 0, 0, 255))
    ImageDraw.Draw(mask).rectangle((x0, y0, x1, y1), fill=(0, 0, 0, 0))  # прозрачное — что перерисовать
    if kept:
        mask.paste((0, 0, 0, 255), mask=kept)
    os.makedirs(os.path.join(RAW, 'fix'), exist_ok=True)
    mpath = os.path.join(RAW, 'fix', f'{target}.mask.png')
    mask.save(mpath)
    # Люди под защитой — лица не перерисовываются, листы персонажей не нужны.
    who, sheets = ('', []) if 'people' in keep else people(shot_info(sid)[2], 2)
    look = ('photographic look — film grain, lens softness, palette and light —' if realism else
            'drawing style, ink line weight, cel shading, palette and light')
    prompt = (f'Edit only the transparent masked area of image 1; everything outside it stays exactly as it is. Inside the '
              f'area: {what} Keep exactly the same {look} as the rest of image 1, so the edit is invisible.'
              + (' People and objects that stay outside the area are in front: paint behind them, never over them.' if kept else '')
              + (' Image 2 shows the same object in this room from another shot: draw it exactly like that, seen from this '
                 'camera.' if ref else '')
              + (f' Character turnaround sheets for identity: {who}.' if sheets else ''))
    out = gen(f'{target}.fix', prompt, [raw, *([ref] if ref else []), *sheets], f'{src.size[0]}x{src.size[1]}',
              os.path.join(RAW, 'fix'), mask=mpath)
    fixed = Image.open(out).convert('RGB').resize(src.size)
    soft = Image.new('L', src.size, 0)
    ImageDraw.Draw(soft).rectangle((x0 + 6, y0 + 6, x1 - 6, y1 - 6), fill=255)
    soft = soft.filter(ImageFilter.GaussianBlur(4))
    if kept:
        soft = ImageChops.multiply(soft, ImageOps.invert(kept.filter(ImageFilter.GaussianBlur(2))))
    Image.composite(fixed, src, soft).save(raw)
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
    elif cmd == 'fix':  # fix <кадр>[.square] x0,y0,x1,y1 "что исправить" [--keep people|x0,y0,x1,y1 ...] [--ref картинка]
        rest, keep, ref = args[3:], [], ''
        while rest:
            flag, val, rest = rest[0], rest[1], rest[2:]
            if flag == '--keep':
                keep.append(val)
            elif flag == '--ref':
                ref = val
            else:
                sys.exit(f'fix: непонятный ключ {flag}')
        fix(args[0], args[1], args[2], keep, ref)
    elif cmd == 'rfix':  # rfix <сет>/<кадр> x0,y0,x1,y1 "что исправить" [--keep …] — кадр «Реализма», координаты 1920×1088
        set_, sid = args[0].split('/')
        rest, keep = args[3:], ['people']  # людей на кадрах «Реализма» не перерисовываем: их маски подсветки остаются верными
        while rest:
            flag, val, rest = rest[0], rest[1], rest[2:]
            if flag != '--keep':
                sys.exit(f'rfix: непонятный ключ {flag}')
            keep.append(val)
        src = os.path.join(ROOT, f'assets/ep01/hod/{set_}/{sid}.webp')
        raw = os.path.join(RAW, 'realism', f'{sid}.png')
        if not os.path.exists(raw):  # API — кратно 16: 1080 → 1088, по 4 px повторённого края сверху и снизу
            os.makedirs(os.path.dirname(raw), exist_ok=True)
            im = Image.open(src).convert('RGB')
            pad = Image.new('RGB', (1920, 1088))
            pad.paste(im, (0, 4)); pad.paste(im.crop((0, 0, 1920, 4)), (0, 0)); pad.paste(im.crop((0, 1076, 1920, 1080)), (0, 1084))
            pad.save(raw)
        fix(f'r_{sid}', args[1], args[2], keep, raw=raw, realism=True)
        Image.open(raw).convert('RGB').crop((0, 4, 1920, 1084)).save(src, 'WEBP', quality=82, method=6)
        print('принято', src)
    elif cmd == 'prompt':  # prompt <кадр> — промпт кадра и картинки; prompt <персонаж> head|body — лист
        if args[0] in STAGING:
            text, files = scene_inputs(args[0])
            print(text, '\n\nIMAGES:', *[os.path.relpath(f, ROOT) for f in files], sep='\n')
        else:
            print(sheet_prompt(args[0], args[1]))
    elif cmd == 'cost':
        print(f'потрачено ${spent():.2f}')
