"""realism.py: «Реализм» на high — пересъёмка черновых кадров «Хода следствия» с сохранением композиции.

Все 61 кадр «Реализма» сняты черновиками (GPT Image 2.5 flare, quality low, 1536×864 — отсюда пальцы, лишние руки и
кривые стаканы). Владелец: кадры с людьми — на high. Пересъёмка: картинка 1 — нынешний кадр (композиция, камера, кто
где), фото лиц assets/ep01/faces/<кто>.webp, общий план сета (уже переснятый) — образец комнаты; правила и карта места —
docs/production/ep01_hod-staging.md (здесь — их английский пересказ в ROOMS, RULES, FIX). Модель — GPT Image 2.5 sunburst,
high, 1920×1088; расходы — в общий журнал assets/ep01/_hod/memory/ledger.json.

  python3 tools/hod/realism.py prompt office_eve_wide            # промпт и картинки — проверить до кредитов
  python3 tools/hod/realism.py shoot office_eve_wide office_…    # снять (по 3 параллельно) → assets/ep01/_hod/hq/<кадр>.png
  python3 tools/hod/realism.py sheet office_eve_wide …           # черновик и новый кадр рядом → assets/ep01/_hod/hq/sheet/
  python3 tools/hod/realism.py accept office_eve_wide …          # принять → assets/ep01/hod/<сет>/<кадр>.webp (1920×1080)

Новый кадр (которого ещё нет в эпизоде) снимается по NEW: сет, состав и образец композиции — другой кадр.
После приёмки: «Воспоминания» — memory.py scene/square/accept, маски — masks.py (оба режима).
"""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memory  # noqa: E402  (STAGING, CHARS, gen, журнал расходов)

ROOT = memory.ROOT
HQ = os.path.join(ROOT, 'assets/ep01/_hod/hq')
FACES = os.path.join(ROOT, 'assets/ep01/faces')

_md = open(os.path.join(ROOT, 'docs/production/prompts/ep01-final-prompts.md'), encoding='utf-8').read()
_i = _md.index('## 1.')
_j = _md.index('```', _i) + 4
BASE = _md[_j:_md.index('```', _j)].strip()

RULES = (
    'CONTINUITY RULES — they must hold in this frame:\n'
    '- Every person has exactly two arms and two hands with five fingers each; hands are anatomically correct, every hand '
    'belongs to a visible person and holds things plausibly; no extra, merged or detached hands or fingers.\n'
    '- Investigator Gromov wears a cheap wristwatch on a cracked dark leather strap on his LEFT wrist only; no bracelets, '
    'no rings. Detective Sayko wears a steel wristwatch on his LEFT wrist. Valentin Pavlovich wears a steel watch on his '
    'LEFT wrist. Nobody else wears a watch.\n'
    '- A smoker holds exactly one cigarette, in one hand.\n'
    '- Furniture is at true human scale: chair seats at knee height, chair backs below the shoulders of a seated person.\n'
    '- Faces are natural and symmetric with straight natural noses; no distortions.\n'
    '- Any writing is either too small or too far away to read, or exactly the Russian text written in this prompt; no '
    'pseudo-letters.')

# Карты мест (docs/production/ep01_hod-staging.md) — по сетам.
OFFICE = (
    "THE ROOM — the same office in every frame of this set; furniture never moves: Gromov's small office in a district "
    'investigation department, Moscow, August 1993. In the far wall a tall double window with a net curtain on its left '
    'half, a radiator under it, a potted plant on the sill. On the left wall a Kremlin wall calendar; in the far left '
    "corner by the window a grey steel safe with a stack of string-tied folders on top. Gromov's wooden desk stands along "
    'the left wall with its long side to the room; on it a green-shaded desk lamp by his left hand, stacks of folders at '
    'the near end, ONE black rotary telephone and a typewriter at the far end by the window. A plain wooden visitor\'s chair '
    'stands at the window end of the desk. The door to the corridor is on the right near the camera, with a grey jacket on '
    'a hook and a wooden coat stand beside it. There is no second desk, no side table and no second telephone in the room.')
ROOMS = {set_: OFFICE for set_ in ('hod_office_am', 'hod_office_call_am', 'hod_office_eve', 'hod_office_lens',
                                   'hod_office_lens_am', 'hod_office_call_eve', 'hod_office_d2', 'hod_office_night')}
FLAT = (
    "THE ROOM — the same room in every frame of this set; furniture never moves: Zoya Pavlovna's former room in a 1960s "
    'block of flats on Molodogvardeyskaya Street, August 1993, half-renovated by the new owners. On the left a polished dark '
    'wooden sideboard with glass doors in its upper part: behind the glass, crystal and crockery on glass shelves and ONE '
    "small framed colour snapshot of her grandson standing on a shelf; a patterned rug hangs on the wall beside it. In the "
    'centre the window with a net curtain and a cast-iron radiator under it; by the window an ordinary wooden step-ladder '
    'and a bucket of whitewash on the floor. On the right a small TV on a stand, the doorway to the kitchen and a bed with a '
    'green bedspread. Faded patterned wallpaper, partly stripped; a worn rug on the floor.')
LADDER = ('The step-ladder is an ordinary wooden A-frame step-ladder standing upright on the floor: straight side rails, '
          'evenly spaced flat steps, all four feet on the floor, nothing passing through it; the bucket stands on the floor '
          'beside it, not under or through a leg.')
PHOTO = ('Behind the glass doors of the sideboard stands one small framed colour snapshot of the grandson — exactly the '
         'photograph of the reference image; there are no other portraits or photographs anywhere in the room.')
LANDING = (
    'THE PLACE — the same landing in every frame of this set: the landing of a nine-storey panel block, August 1993, walls '
    'painted green below and whitewashed above. On the left the door of flat No. 33 (Galina\'s), upholstered in brown '
    'quilted leatherette with brass studs, hinged so that it opens INTO her flat; in the centre a painted grey electrical '
    "panel on the wall; on the right the new brown steel door of flat No. 34 (Zoya Pavlovna's) with a doormat; at the right "
    'edge the stair railing with green-painted balusters and a wooden handrail.')
CHAIN_ON = ('THE DOOR CHAIN is mounted on the INSIDE: its slide plate is screwed to the inner face of the door and its other '
            'end to the inner side of the door frame, so from the landing only the chain itself is seen, stretched across the '
            'narrow gap behind the door edge, inside the flat. Nothing at all is screwed to the outer leatherette face of the '
            'door or to the outside of the frame.')
CHAIN_OFF = ('THE DOOR CHAIN is mounted on the INSIDE: the door is wide open into the flat and the unhooked chain hangs down '
             'loosely from its plate on the inner side of the door frame, by the lock, inside the flat. Nothing is screwed to '
             'the outer leatherette face of the door.')
NOTARY = (
    "THE ROOM — the same office in every frame of this set: notary Kovrigin's office in an old pre-war building on "
    "Presnya, August 1993. On the left by the window Lyuda's small typing desk with a typewriter; in the centre Kovrigin's "
    'big desk with the open register, a green lamp, a pen stand and a round notary seal; behind him a glass-fronted '
    'bookcase and a bentwood coat stand; on the right the open door to the corridor. In front of his desk a plain '
    'bentwood visitor\'s chair at true human scale: its seat at the height of a standing man\'s knee.')
ZHEK = ('THE PLACE — the passport desk of a housing office (ЖЭК), August 1993: a corridor with green-painted walls, a '
        'wooden bench on the left, a window at the far end; in the right wall a service window with wooden shutters; behind '
        "it the clerk's small office with shelves of house registers and a desk fan.")
BTI = ('THE PLACE — the archive of the city technical inventory bureau (БТИ), August 1993: long rows of grey steel and '
       'wooden card-index cabinets with small drawers, a reading desk with a green lamp, a tall window at the far end, '
       'fluorescent ceiling lamps.')
ROOMS.update({s_: FLAT for s_ in ('hod_flat', 'hod_flat_photo', 'hod_flat_inspect')})
ROOMS.update({s_: LANDING for s_ in ('hod_landing_chain', 'hod_landing_open')})
ROOMS.update({s_: NOTARY for s_ in ('hod_notary', 'hod_notary_alone', 'hod_notary_register')})
ROOMS.update({'hod_zhek': ZHEK, 'hod_recon': ZHEK, 'hod_bti': BTI})

# Что исправить в черновике (замечания владельца 2026-10-14 и карта места).
FIX = {
    'office_am_phone': (
        'Gromov is ALONE in this frame: nobody else, no shoulder or head of anyone at the edges. He sits behind his desk, '
        'holding the black receiver to his LEFT ear with his LEFT hand (the wristwatch on that wrist) and writing with a '
        "pencil in his RIGHT hand in the open register. The telephone's cradle is empty; the coiled cord runs from the "
        'receiver to the one black telephone at the far end of his desk. Behind him the wall with the calendar, the safe and '
        'the edge of the window; nothing stands behind the telephone — no second table, no typewriter table.'),
    'office_eve_phone': (
        'Evening, low warm sun. Gromov is ALONE in this frame: nobody else, no shoulder of anyone at the edges. He sits '
        'behind his desk holding the black receiver to his LEFT ear with his LEFT hand (the wristwatch on that wrist) and '
        "rubs his closed eyes with the fingers of his RIGHT hand, tired. The telephone's cradle is empty; the coiled cord "
        'runs to the one black telephone on his desk. One glass of tea in a metal holder stands by the telephone. The '
        'typewriter under a grey cover stands at the far end of the same desk. Behind him the wall with the calendar, the '
        'safe and the edge of the window; there is no second table and nothing standing behind the telephone.'),
    'office_eve_wide': (
        'Evening, low warm sun. Exactly three identical glasses of tea in identical metal holders: Levina holds one out to '
        'Gromov across the desk corner, her own glass stands on the desk by her other hand, the third stands on the '
        "windowsill next to Sayko. Gromov's hands are free: his right hand reaches for the glass Levina holds out, his left "
        'rests on the open notebook. Levina sits on the plain wooden visitor\'s chair at the window end of the desk, legs '
        'crossed, exactly two hands: one holding out the glass, the other resting on the desk edge — nothing on her lap. '
        'Sayko stands at the open window, solid and opaque, smoking one cigarette. The typewriter is under a grey cover. '
        'The chairs are ordinary wooden office chairs with straight backs, correctly drawn.'),
    'office_eve_ots_expert': (
        "Evening, low warm sun. Levina sits on the plain wooden visitor's chair at the window end of Gromov's desk — the same "
        'place as in the wide frame — facing the camera: a glass of tea in a metal holder in her right hand, ONE cigarette '
        'between two fingers of her left hand raised near her shoulder; both hands anatomically correct; a natural straight '
        'nose. Behind her at the open window stands Sayko, solid and fully opaque like everyone else, half-turned to the '
        'room, smoking; his steel watch on his left wrist.'),
    'office_eve_lens': (
        'Evening: the green desk lamp is on. Two typed papers lie side by side under the lamp — a power of attorney and a '
        'sale contract. Levina bends over them holding a round magnifying glass by its handle in her LEFT hand over the date '
        'line and pointing at it with a pencil held correctly between thumb and fingers of her RIGHT hand. Gromov leans in '
        'beside her on his forearms, his hands relaxed and apart, not clasped; his wristwatch on his LEFT wrist.'),
    'office_am_lens': (
        'Wednesday morning: daylight from the window, the green desk lamp is off. Two typed papers lie side by side on the '
        'desk — a power of attorney and a sale contract. Levina bends over them holding a round magnifying glass by its '
        'handle in her LEFT hand over the date line and pointing at it with a pencil held correctly in her RIGHT hand. '
        'Gromov leans in beside her on his forearms, his hands relaxed and apart; his wristwatch on his LEFT wrist. Fresh '
        'morning look: tidy desk, a glass of tea in a holder at the edge.'),
    'office_d2_wide': (
        "Reverse angle of the office: the camera stands behind Gromov's desk by the far wall and looks across the room to "
        'the door. The open door to the corridor is in the right part of the frame with the wooden coat stand beside it; the '
        'window is at the left edge; the wall between them is plain painted green with nothing on it — no safe and no '
        'calendar on this wall (they are behind the camera). Gromov has stood up behind his desk on the LEFT, three-quarter '
        "from behind; Sayko sits on the visitor's chair between them turned toward the door; Valentin Pavlovich stands in "
        'the doorway holding a sheet of paper, his steel watch on his left wrist.'),
    'office_d2_ots_boss': (
        'Valentin Pavlovich stands in the open doorway facing the camera, a hand at his collar; behind him the corridor. '
        'The wall beside the door is plain painted green with only the wooden coat stand — no calendar.'),
    'office_night_wide': (
        'Night: dark window with city lights, the green lamp is on. Gromov sits behind the desk under the lamp with papers '
        'in neat stacks and one open folder in front of him and ONE glass of tea in a metal holder; his hands rest naturally '
        'on the papers, the wristwatch on his left wrist. Levina stands at the open dark window smoking one cigarette. '
        "Sayko sits on the visitor's chair at the window end of the desk, elbows on his knees. The typewriter is under a "
        'grey cover.'),
    'office_night_ots_expert': (
        'Night: Levina stands at the open dark window facing the camera, ONE cigarette between two fingers of her right '
        'hand, her left arm folded across her waist; both hands anatomically correct.'),
}

FIX.update({
    'flat_wide': f'{LADDER} {PHOTO}',
    'flat_ots_buyer': f'{LADDER} {PHOTO}',
    'flat_ots_wife': f'{LADDER} {PHOTO}',
    'flat_photo': ('Close insert: behind the half-open glass door of the sideboard, on a glass shelf next to a crystal vase, '
                   'stands the small framed colour snapshot of the grandson — exactly the photograph of the reference image '
                   '(the young man in a checked shirt on the Volga embankment, the orange date imprint in its corner), in a '
                   "thin frame behind glass. Gromov's LEFT hand holds the edge of the glass door; his wristwatch is on that "
                   'left wrist. ' + LADDER),
    'landing_chain_wide': CHAIN_ON + " Galina's face and a strip of her house dress are seen in the gap.",
    'landing_chain_ots': CHAIN_ON + " Galina's face is seen in the gap behind the stretched chain.",
    'landing_open_wide': CHAIN_OFF,
    'landing_open_ots': CHAIN_OFF + ' Galina stands on her threshold, one hand pressed to her chest — both hands '
                                    'anatomically correct.',
    'notary_wide': ("The visitor's chair in front of the desk is an ordinary bentwood chair at true human scale: its seat at "
                    "the height of Gromov's knee, its back below his waist. In the corridor beyond the door a queue sits on "
                    'a bench: mostly elderly men and women in light summer clothes, in different natural poses.'),
    'notary_alone_wide': ('Tuesday: the typewriter on the small desk by the window is completely covered by a grey cover, '
                          'with no sheet of paper; nobody sits at that desk.'),
    'notary_register': (
        'The register page fills the frame: a big ledger ruled into columns — №, date, who applied, what was certified — '
        'filled in by hand in violet ink with neat, legible Russian handwriting. The entries read exactly, one per line: '
        '«1183 · 10.06.93 · Кузнецова М. П. · завещание»; «1184 · 10.06.93 · Орлов В. Н. · доверенность на гараж»; '
        '«1185 · 11.06.93 · Петрова А. И. · копия диплома»; «1186 · 11.06.93 · Белов С. С. · договор дарения»; '
        '«1187 · 14.06.93 · С. З. П. · доверенность на продажу кв. Мурашову С. В.»; «1188 · 15.06.93 · Гусев А. А. · '
        'согласие на выезд». Entry 1187 is written in noticeably brighter blue ink than its neighbours, as if added later. '
        "Kovrigin's plump hand with a gold signet ring rests at the top edge of the page: one hand, five fingers."),
    'zhek_ots_clerk': ('The clerk sits inside the service window facing the camera: her right hand lies on the open house '
                       'register with the index finger tracing one line, her left hand holds the edge of the register; both '
                       'hands anatomically correct, five fingers each, nothing else in her hands.'),
    'recon_wide': ('Zoya Pavlovna holds the cardboard folder to her chest with BOTH hands, fingers natural. The polite man '
                   '(back to the camera) points at the folder with ONE hand — his right index finger — and holds his '
                   'briefcase by the handle in his other hand. Exactly two hands each, every hand belongs to its person.'),
})

# Предметы-образцы (картинка после лиц): что именно нарисовать.
GRANDSON = (os.path.join(HQ, 'props', 'prop_grandson_photo.png'),
            'the framed colour snapshot of the grandson that stands behind the glass of the sideboard — wherever it is '
            'visible, draw exactly this photograph in a thin frame')
PROPS = {sid: [GRANDSON] for sid in ('flat_wide', 'flat_ots_buyer', 'flat_ots_wife', 'flat_photo')}

# Новые кадры: сет, кто в кадре (STAGING) и чей кадр — образец композиции (картинка 1).
NEW = {
    'office_am_lens': {'set': 'hod_office_lens_am', 'from': 'office_eve_lens',
                       'staging': {'expert': 'bends over the two papers with the magnifying glass and the pencil; her eyes on the paper',
                                   'sledak': 'leans in from the left on his forearms; his eyes on the same spot'}},
}

# Общий план сета — образец комнаты (берётся уже переснятый: assets/ep01/_hod/hq/<план>.png).
ROOM_REF = {'office_am_ots_oper': 'office_am_wide', 'office_am_phone': 'office_am_wide', 'office_eve_wide': 'office_am_wide',
            'office_eve_ots_expert': 'office_eve_wide', 'office_eve_lens': 'office_eve_wide', 'office_am_lens': 'office_am_wide',
            'office_eve_phone': 'office_eve_wide', 'office_d2_wide': 'office_am_wide', 'office_d2_ots_boss': 'office_d2_wide',
            'office_night_wide': 'office_am_wide', 'office_night_ots_expert': 'office_night_wide',
            'flat_ots_buyer': 'flat_wide', 'flat_ots_wife': 'flat_wide', 'flat_photo': 'flat_wide',
            'landing_chain_ots': 'landing_chain_wide', 'landing_open_wide': 'landing_chain_wide',
            'landing_open_ots': 'landing_open_wide', 'notary_ots_notary': 'notary_wide', 'notary_alone_wide': 'notary_wide',
            'notary_register': 'notary_wide', 'stairs_ots_assistant': 'stairs_wide', 'zhek_ots_clerk': 'zhek_wide',
            'recon_wide': 'zhek_wide', 'recon_ots_zoya': 'recon_wide', 'bti_ots_clerk': 'bti_wide'}


def info(sid: str) -> tuple[str, str, dict]:
    """Файл-образец композиции, сет и кто где."""
    if sid in NEW:
        n = NEW[sid]
        src, _, _ = memory.shot_info(n['from'])
        return src, n['set'], n['staging']
    src, set_, _ = memory.shot_info(sid)
    return src, set_, memory.STAGING.get(sid, {})


def inputs(sid: str) -> tuple[str, list[str]]:
    src, set_, staging = info(sid)
    os.makedirs(os.path.join(HQ, 'src'), exist_ok=True)
    im = Image.open(os.path.join(ROOT, src)).convert('RGB').resize((1920, 1080), Image.LANCZOS)
    pad = Image.new('RGB', (1920, 1088))
    pad.paste(im, (0, 4)); pad.paste(im.crop((0, 0, 1920, 4)), (0, 0)); pad.paste(im.crop((0, 1076, 1920, 1080)), (0, 1084))
    src_png = os.path.join(HQ, 'src', f'{sid}.png')
    pad.save(src_png)
    images = [src_png]
    faces = []
    for who in staging:
        f = os.path.join(FACES, f'{who}.webp')
        if os.path.exists(f) and who in memory.CHARS:
            images.append(f)
            faces.append(f'image {len(images)} — {memory.CHARS[who]["name"]}')
    props = []
    for path, what in PROPS.get(sid, []):
        images.append(path)
        props.append(f'image {len(images)} — {what}')
    room = ''
    ref = ROOM_REF.get(sid)
    if ref and os.path.exists(os.path.join(HQ, f'{ref}.png')):
        images.append(os.path.join(HQ, f'{ref}.png'))
        room = (f' Image {len(images)} is the already approved high-quality wide frame of this same room: match its room, '
                f'furniture, props, palette and light exactly, seen from this camera.')
    first = 'the draft of this very frame' if sid not in NEW else 'a frame of the same room and people to take the camera and staging from'
    intro = (f'IMAGES. Image 1 is {first}: a low-resolution draft. Keep its composition, camera position, framing, the room '
             'and where every person and object is, unless the FIX below says otherwise. Redraw it as a clean, high-quality, '
             'anatomically correct frame with the analog television look described below.'
             + (f' Identity photos: {"; ".join(faces)} — keep exactly these faces, hair and builds.' if faces else '')
             + (f' Reference objects: {"; ".join(props)}.' if props else '')
             + room)
    who = (('WHO IS WHERE: ' + ' '.join(f'{memory.CHARS[w]["name"]} ({memory.CLOTHES.get(w, "")}): {t}.' for w, t in staging.items()
                                        if w in memory.CHARS)) if staging else 'There are no people in this frame.')
    parts = [intro, ROOMS.get(set_, ''), who, f'FIX: {FIX[sid]}' if sid in FIX else '', RULES, BASE]
    return '\n\n'.join(p for p in parts if p), images


def shoot(sid: str) -> str:
    prompt, images = inputs(sid)
    return memory.gen(f'hq_{sid}', prompt, images, '1920x1088', HQ)


def sheet(sid: str) -> None:
    src, _, _ = info(sid)
    a = Image.open(os.path.join(ROOT, src)).convert('RGB').resize((960, 540))
    b = Image.open(os.path.join(HQ, f'hq_{sid}.png' if os.path.exists(os.path.join(HQ, f'hq_{sid}.png')) else f'{sid}.png')).convert('RGB')
    b = b.resize((960, 544)).crop((0, 2, 960, 542))
    out = Image.new('RGB', (1930, 540), (20, 20, 20))
    out.paste(a, (0, 0)); out.paste(b, (970, 0))
    os.makedirs(os.path.join(HQ, 'sheet'), exist_ok=True)
    out.save(os.path.join(HQ, 'sheet', f'{sid}.jpg'), quality=88)
    print('лист', os.path.join(HQ, 'sheet', f'{sid}.jpg'))


def accept(sid: str) -> None:
    _, set_, _ = info(sid)
    raw = os.path.join(HQ, f'hq_{sid}.png')
    final = os.path.join(HQ, f'{sid}.png')
    os.replace(raw, final) if os.path.exists(raw) else None
    out = os.path.join(ROOT, f'assets/ep01/hod/{set_}/{sid}.webp')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    hq = Image.open(final).convert('RGB').resize((1920, 1088), Image.LANCZOS)
    hq.crop((0, 4, 1920, 1084)).save(out, 'WEBP', quality=82, method=6)
    # Правки по маске (memory.py rfix) берут сырьё из _hod/memory/realism/<кадр>.png: там может лежать старый черновик —
    # заменяем его новым кадром, иначе правка легла бы на черновик и вернула бы его в эпизод.
    raw = os.path.join(memory.RAW, 'realism', f'{sid}.png')
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    hq.save(raw)
    if os.path.exists(raw[:-4] + '.orig.png'):
        os.remove(raw[:-4] + '.orig.png')
    print('принято', sid, '→', os.path.relpath(out, ROOT))


if __name__ == '__main__':
    cmd, *ids = sys.argv[1:] or ['prompt']
    if cmd == 'prompt':
        for sid in ids:
            text, files = inputs(sid)
            print(text, '\n\nIMAGES:', *[os.path.relpath(f, ROOT) for f in files], sep='\n')
    elif cmd == 'shoot':
        with ThreadPoolExecutor(3) as pool:
            for path in pool.map(shoot, ids):
                print('снято', os.path.relpath(path, ROOT))
    elif cmd == 'sheet':
        for sid in ids:
            sheet(sid)
    elif cmd == 'accept':
        for sid in ids:
            accept(sid)
    else:
        sys.exit(f'непонятная команда {cmd}')
