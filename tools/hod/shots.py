"""shots.py: листы мизансцен «Хода следствия» (дни 1–5) → план генерации и лист для проверки.

Черновые кадры под сцены docs/season1/ep01-hod.md. Каждый кадр описан тем, что проверяет владелец: кто где стоит,
куда смотрит, что держит, во что одет (лето 1993-го, не пальто со старых портретов), откуда свет и какое время суток.
Промпт = базовый стиль (docs/production/prompts/ep01-final-prompts.md §1) + референсы + непрерывность + сцена.

  python3 tools/hod/shots.py            # → assets/ep01/_hod/plan.json и docs/production/prompts/ep01-hod-shots.md
  PLAN=assets/ep01/_hod/plan.json REGEN_DIR=assets/ep01/_hod python3 tools/regen/gpt_wave.py <id>... --q medium --size 1536x864

Референсы-кадры (`shot:<id>`) — уже принятые кадры этого же плана (assets/ep01/_hod/out/<id>.png): общий план задаёт
комнату, людей и свет остальным кадрам сцены. Порядок волн — WAVES.
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = 'assets/ep01/_hod'
FACES = 'assets/ep01/faces'

md = open(os.path.join(ROOT, 'docs/production/prompts/ep01-final-prompts.md'), encoding='utf-8').read()
_i = md.index('## 1.')
_j = md.index('```', _i) + 4
BASE = md[_j:md.index('```', _j)].strip()

# Внешность (до первой «;» в таблице персонажей §2): лицо, возраст, телосложение — без одежды старых портретов.
LOOKS: dict[str, str] = {}
for row in md[md.index('## 2.'):].splitlines():
    m = re.match(r'\|\s*`([a-z_]+)`\s*\|[^|]*\|\s*([^|]+)\|', row)
    if m:
        LOOKS[m.group(1)] = m.group(2).split(';')[0].strip()

# Имена в промптах и летняя одежда (август 1993-го; у Зои — июнь).
NAMES = {
    'sledak': 'Investigator Andrei Gromov', 'oper': 'Detective Viktor Sayko', 'expert': 'forensic expert Nina Levina',
    'boss': 'Valentin Pavlovich, head of the investigation department', 'neighbor': 'Galina, the neighbour',
    'buyer': 'Lapin, the new owner of the flat', 'lapin_wife': 'Irina Lapina, his wife', 'notary': 'notary Kovrigin',
    'assistant': "Lyuda, the notary's assistant", 'passport_clerk': 'the passport clerk of the housing office',
    'clerk': 'Raisa Lvovna, the archivist', 'zoya': 'Zoya Pavlovna', 'murashov_sil': 'the polite man',
    # дни 3–5 и развязка
    'murashov': 'Sergei Murashov, the apartment dealer', 'accomplice': 'Dmitry Shmelyov (Shmel), his driver',
    'klava': 'Klavdia Semyonovna, the neighbour of the missing old man', 'landlady': 'the landlady',
    'sledak_old': 'Andrei Gromov in 2004, eleven years later', 'pyotr': 'Pyotr Ilyich, a lathe operator',
    'grandson': "Zoya Pavlovna's grandson",
}
NEW_LOOKS = {  # новые лица без портрета: описание достаточно точное, дальше лицо держит принятый общий план
    'assistant': 'woman, 23, slim, a pale oval face with light freckles, light-brown hair in a low ponytail, thin plucked eyebrows, nervous grey eyes',
    'passport_clerk': 'woman, 52, plump, a round face, a tight perm of reddish-dyed hair, coral lipstick, heavy reading glasses on a cord',
    'murashov_sil': 'a neat man of about 38 seen only from behind: medium height, narrow shoulders, short tidy dark hair with a straight parting',
    'klava': 'woman, 74, small and lean, a sharp wrinkled face, bright watchful dark eyes behind big old-fashioned glasses with thick lenses, thin grey hair pinned in a bun, a mole on her left cheek',
    'landlady': 'woman, 58, stout, a broad tired face with plump cheeks, short dyed chestnut hair with grey roots, small gold earrings',
    'pyotr': 'man, about 60, a lean strong face with deep lines, a short grey crew cut, big work-worn hands, a calm concentrated look',
    'grandson': 'a boy of about 13, thin, a short fringe of light-brown hair, a wide grin',
}
COSTUME = {
    'sledak': 'a pale-blue short-sleeved cotton shirt, a narrow dark-navy tie loosened at the collar, grey suit trousers, a cheap wristwatch on a cracked strap; no jacket, no coat, no sweater',
    'oper': 'a faded blue-grey checked short-sleeved shirt worn open over a grey cotton T-shirt, faded blue jeans; no leather jacket, no sweater',
    'expert': 'a beige short-sleeved summer dress with a small print under an unbuttoned white lab coat, glasses on a chain',
    'boss': 'a white short-sleeved shirt with a dark tie, dark suit trousers, a folded handkerchief in his hand; no jacket',
    'neighbor': 'a faded flowered blue-and-white cotton house dress with short sleeves, a kitchen apron, felt slippers, hair under a light cotton kerchief tied at the back of the neck; no cardigan',
    'buyer': 'an old short-sleeved shirt with specks of white paint, rolled-up old trousers, thin-rimmed glasses',
    'lapin_wife': 'a simple faded cotton summer dress with short sleeves and an apron, hair tied back',
    'notary': 'a rumpled light-grey summer suit, a white shirt, a loosened tie, a damp handkerchief, a gold signet ring',
    'assistant': 'a white short-sleeved blouse, a dark straight skirt, a thin chain necklace',
    'passport_clerk': 'a short-sleeved floral blouse',
    'clerk': 'a light short-sleeved blouse with a brooch, a thin grey knitted cardigan over her shoulders, glasses',
    'zoya': 'a light floral summer dress with a beige knitted cardigan, a cotton kerchief, a cloth handbag on her arm',
    'murashov_sil': 'a light beige summer jacket, light trousers, a brown leather briefcase in his hand',
    # дни 3–5: Мурашов в том же летнем, что и в реконструкции; Шмелёв — без зимней куртки с портрета
    'murashov': 'a light beige summer jacket over a pale-blue shirt, a narrow patterned tie with a tie pin, light trousers, polished brown shoes',
    'accomplice': 'a navy tracksuit top with three white stripes, unzipped over a white T-shirt, a thin gold chain, dark trousers, worn white trainers; no padded jacket',
    'klava': 'a brown short-sleeved house dress with a small white check and a white collar, felt slippers',
    'landlady': 'a sleeveless floral summer house dress, a kitchen towel over her shoulder, rubber slippers',
    'sledak_old': 'a charcoal blazer over a black open-collar shirt, no tie, a wedding ring',
    'pyotr': 'a dark work smock over a checked shirt, a flat cap pushed back on his head',
    'grandson': 'a white short-sleeved shirt and dark shorts',
}

SUMMER = ('It is summer, August 1993: warm weather, green leafy trees outside, everyone in light summer clothes; '
          'no coats, no hats, no scarves, no snow, no bare trees, no autumn leaves, no coats on the hooks.')
JUNE = ('It is early summer, June 1993: warm weather, fresh green trees outside, everyone in light summer clothes; '
        'no coats, no hats, no snow, no bare trees, no coats on the hooks.')

# ───────────────────────────── места ─────────────────────────────

LOC = {
    'office': ("A small investigator's office in the Kuntsevo district prosecutor's building, Moscow: a heavy dark-wood desk with a "
               "green glass banker's lamp, a typewriter, stacks of cardboard case folders and a black rotary telephone; a grey "
               "steel safe in the corner behind the desk; a tall window in the back wall with a thin net curtain, a radiator "
               "below and a potted plant on the sill; a 1993 wall calendar; a coat rack by the door with only a grey summer "
               "jacket on it; herringbone parquet; pale green walls."),
    'flat': ("Zoya Pavlovna's one-room flat on Molodogvardeyskaya Street, third floor, now bought by the Lapins and under "
             "renovation: on the LEFT wall her tall dark polished sideboard with glass doors (porcelain cups, a crystal vase, "
             "a framed black-and-white photograph of a young man in a Soviet army uniform behind the glass) and a patterned "
             "wall rug next to it; in the CENTRE of the back wall a window with the tulle half taken down and a radiator; "
             "the old wallpaper torn off around the window down to the newspapers glued underneath, rolls of new wallpaper, "
             "a bucket of paste and a wooden stepladder by the window; a television on a stool; on the RIGHT, beyond a bed "
             "with a green bedspread, the open doorway to the kitchen; a child's red toy truck on the rug."),
    'landing': ("The third-floor landing of a nine-storey Moscow panel apartment block: in the back wall, LEFT, Galina's "
                "door No. 33 with old brown leatherette padding and brass studs; RIGHT, Zoya Pavlovna's door No. 34 — new, "
                "faced with brown-painted steel sheet, a shiny new lock; between the doors a dusty electricity cabinet; walls "
                "painted green to shoulder height and whitewashed above; a worn doormat at each door; on the RIGHT edge the "
                "top of the stair railing; daylight comes from the stairwell window behind the camera."),
    'notary': ("A notary's office in an old building on Presnya: a heavy desk in the centre with a green glass lamp, rubber "
               "stamps, a big open register ledger and papers; a tall window on the LEFT with a potted plant and, under it, a "
               "small typing desk with a typewriter; a glass-fronted bookcase with law books behind the desk and a small "
               "electric fan turning on top of it; an empty coat rack; on the RIGHT the door stands open to a corridor where "
               "people in summer clothes sit in a queue on chairs."),
    'notary_stairs': ("The staircase of the same old building on Presnya: wide worn stone steps, a cast-iron railing with a "
                      "wooden handrail, a tall window on the landing with summer sunlight and green treetops outside, a tin "
                      "can used as an ashtray on the wide windowsill."),
    'zhek': ("The corridor of a housing office (ZhEK) in Kuntsevo, Moscow: pale green painted walls, a cork notice board "
             "with papers, a service window with open wooden shutters in the RIGHT wall, a wooden bench along the LEFT "
             "wall, empty coat hooks, a window at the far end with daylight and green trees, a fluorescent tube on the "
             "ceiling, a worn linoleum floor."),
    'bti': ("The archive of the Moscow Bureau of Technical Inventory (BTI): long rows of grey steel filing cabinets and "
            "wooden card-index drawers up to the ceiling, a reading desk with a green lamp, a window at the far end of the "
            "aisle with summer daylight, fluorescent tubes, a potted plant on a cabinet."),
    'car': ("Inside a VAZ-2109 'Samara' car: worn grey seat covers, a cracked dashboard, a small paper icon and a pine air "
            "freshener hanging from the mirror, both front windows rolled down; through the windscreen a sunny Moscow street "
            "with green trees, panel apartment blocks and a trolleybus."),
}

# ───────────────────────────── кадры ─────────────────────────────
# who: {who: что делает, где стоит и куда смотрит}; refs: room:<путь> | shot:<id> | face:<who> (лица — в порядке cast)

S = []


def shot(id, set, kind, loc, time, season, people, camera, light, objects, refs, size='1536x864', note='', costume=None, extra=''):
    S.append(dict(id=id, set=set, kind=kind, loc=loc, time=time, season=season, people=people, camera=camera,
                  light=light, objects=objects, refs=refs, size=size, note=note, costume=costume or {}, extra=extra))


MORNING = 'a sunny Monday morning, 9 August 1993, about 9 a.m.'
MORNING2 = 'a sunny Tuesday morning, 10 August 1993, about 9:30 a.m.'
DAY = 'a sunny August day, 1993, early afternoon'
EVENING = 'a warm August evening, 1993, about 7:40 p.m., an hour before sunset'
NIGHT = 'a warm August night, 1993, about 10:40 p.m.'
SUN_AM = 'bright morning sunlight through the window: sunny patches on the desk and the parquet, the rest of the room in soft shade'
SUN_DAY = 'bright summer daylight through the window; the room lit by the window alone'
WIDE_DOOR = ('The camera stands in the corner by the door at the eye level of a standing person, a 32 mm-equivalent field '
             'of view: the whole room with everyone in it, people small inside the space; the lower third of the frame is '
             'kept free of faces (the text box lives there), headroom above the tallest person.')


def ots(near, far, edge, extra=''):
    return (f'The camera is just behind {NAMES[near]}\'s shoulder at eye level, a 45 mm-equivalent field of view: the back of '
            f'{NAMES[near]}\'s head and shoulder overlap the near {edge} edge of the frame, out of focus; {NAMES[far]} faces the '
            f'camera beyond, their face in the upper half of the frame (the text box covers the lower third); the background '
            f'recognizable with modest optical softness; the 180-degree axis of the conversation is kept. {extra}').strip()


# Кабинет Громова, понедельник, утро: Сайко принёс заявления.
shot('office_am_wide', 'hod_office_am', 'wide', 'office', MORNING, SUMMER,
     {'sledak': 'sits behind the desk on the LEFT of the frame, his face in three-quarter view turned right toward Sayko, his eyes on Sayko, not toward the camera, one hand on an open folder with four handwritten statements, tired and attentive',
      'oper': 'sits on the visitor\'s chair at the RIGHT end of the desk, turned left toward Gromov, leaning forward with his elbows on his knees, a wry half-smile'},
     WIDE_DOOR + ' The desk runs across the left half of the frame, the safe behind it, the window in the centre of the back wall between the two men.',
     SUN_AM, 'the desk, the green lamp (switched off), the typewriter, the telephone, the folder of statements, the safe, the window with the net curtain',
     ['room:assets/ep01/bg/office_prosecutor.webp', 'face:oper', 'face:sledak'],
     note='Гаже: Громов и Сайко смотрят друг на друга. Окно — зелёные деревья, солнце; на вешалке нет пальто.')
shot('office_am_ots_oper', 'hod_office_am', 'ots', 'office', MORNING, SUMMER,
     {'oper': 'sits on the visitor\'s chair, facing the camera, talking, one open hand turned up as if saying "and that\'s all of it"',
      'sledak': 'seen only from behind at the LEFT edge, listening'},
     ots('sledak', 'oper', 'LEFT', 'The window with the net curtain and green trees outside is behind Sayko.'),
     SUN_AM, 'the edge of the desk with the folder of statements in the foreground, the window behind Sayko',
     ['shot:office_am_wide', 'face:oper', 'face:sledak'])
shot('office_am_phone', 'hod_office_call_am', 'medium', 'office', MORNING, SUMMER,
     {'sledak': 'sits behind the desk holding the black receiver of the rotary telephone to his right ear, eyes down on the statements, a pencil in his other hand, his face closed and dutiful: he is listening to his boss',
      'oper': 'only his shoulder, out of focus, at the RIGHT edge of the frame in the foreground'},
     'The camera is at the visitor\'s chair, at the eye level of a seated person, a 45 mm-equivalent field of view: Gromov from the waist up behind the desk, the safe and the calendar behind him, his face in the upper half of the frame.',
     SUN_AM, 'the black rotary telephone with its cord, the statements, the green lamp (off)',
     ['shot:office_am_wide', 'face:sledak'])

# Кабинет, понедельник, вечер: Левина с чаем; Сайко курит у окна.
shot('office_eve_wide', 'hod_office_eve', 'wide', 'office', EVENING, SUMMER,
     {'sledak': 'sits behind the desk on the LEFT in the same place as in the morning, reaching for a glass of tea Levina holds out to him',
      'expert': 'sits on the RIGHT corner of the desk, half-turned toward Gromov, holding out a glass of tea in a metal glass-holder, a second glass beside her',
      'oper': 'stands at the open window in the centre of the back wall, smoking, half-turned to the room, his eyes on Gromov and Levina at the desk (toward the left of the frame), not toward the camera'},
     WIDE_DOOR + ' The same view as the morning: the desk across the left half, the window in the centre.',
     'low golden evening sunlight through the open window, long warm shadows across the parquet; the green desk lamp is switched on',
     'two glasses of tea in metal glass-holders, the green lamp (on), the folders, the open window',
     ['place:office_am_wide', 'face:expert', 'face:oper', 'face:sledak'],
     note='Тот же кабинет, что утром; свет — низкое золотое солнце, лампа включена.')
shot('office_eve_ots_expert', 'hod_office_eve', 'ots', 'office', EVENING, SUMMER,
     {'expert': 'sits on the desk corner facing the camera, a glass of tea in one hand, a cigarette in the other, looking at Gromov over her glasses, dry and calm',
      'sledak': 'seen only from behind at the LEFT edge'},
     ots('sledak', 'expert', 'LEFT', 'The open window with golden light and Sayko\'s silhouette behind her.'),
     'low golden evening sunlight from the window behind her; the green desk lamp is on',
     'the glass of tea in a metal glass-holder, the cigarette, the green lamp',
     ['shot:office_eve_wide', 'face:expert', 'face:sledak'])
shot('office_eve_lens', 'hod_office_lens', 'insert', 'office', EVENING, SUMMER,
     {'expert': 'bends over a typed document under the green desk lamp, a round magnifying glass in her hand, pointing with the tip of a pencil at the date line',
      'sledak': 'leans in from the left, looking at the same spot on the paper'},
     'The camera is at the edge of the desk at seated eye level, a 45 mm-equivalent field of view: the document, the magnifying glass and both faces bent over it under the lamp; nothing readable on the paper.',
     'the green desk lamp is the main light, golden evening light from the window on the left side of their faces',
     'one typed document (a copy of a power of attorney, unreadable), a round magnifying glass, a pencil, the green lamp',
     ['shot:office_eve_wide', 'face:expert', 'face:sledak'])
shot('office_eve_phone', 'hod_office_call_eve', 'medium', 'office', EVENING, SUMMER,
     {'sledak': 'sits behind the desk with the telephone receiver at his ear, rubbing his eyes with his other hand, tired',
      'expert': 'only her white lab-coat shoulder, out of focus, at the RIGHT edge in the foreground'},
     'The camera is at the right corner of the desk at the eye level of a seated person, a 45 mm-equivalent field of view: Gromov from the waist up, his face in the upper half of the frame.',
     'low golden evening sunlight across the wall behind him; the green desk lamp is on',
     'the black rotary telephone, the green lamp, the glass of tea',
     ['shot:office_eve_wide', 'face:sledak'])

# Кабинет, вторник, утро: начальник в дверях.
shot('office_d2_wide', 'hod_office_d2', 'wide', 'office', MORNING2, SUMMER,
     {'boss': 'stands in the open doorway on the RIGHT, one hand on the door handle, a handkerchief in the other, looking at Gromov with heavy disapproval',
      'sledak': 'has stood up behind his desk on the LEFT, seen three-quarter from behind, facing the boss',
      'oper': 'sits on the visitor\'s chair between them, turned toward the door, looking at the boss'},
     'The camera now stands by the window looking back into the room toward the door, at the eye level of a standing person, a 32 mm-equivalent field of view: the desk on the LEFT, the open door with the coat rack on the RIGHT; the lower third of the frame is kept free of faces.',
     'bright morning sun from the window behind the camera falling into the room',
     'the desk with the green lamp (off), folders, the telephone; the open door; the coat rack with a grey summer jacket',
     ['place:office_am_wide', 'face:boss', 'face:sledak', 'face:oper'],
     note='Камера у окна смотрит на дверь; тот же кабинет и мебель, что в утреннем общем плане.')
shot('office_d2_ots_boss', 'hod_office_d2', 'ots', 'office', MORNING2, SUMMER,
     {'boss': 'stands in the doorway facing the camera, mopping his neck with a handkerchief, speaking firmly',
      'sledak': 'seen only from behind at the LEFT edge, standing'},
     ots('sledak', 'boss', 'LEFT', 'The corridor of the prosecutor\'s office behind the boss.'),
     'bright morning daylight', 'the open door, the coat rack',
     ['shot:office_d2_wide', 'face:boss', 'face:sledak'])

# Кабинет, вторник, ночь: версия.
shot('office_night_wide', 'hod_office_night', 'wide', 'office', NIGHT, SUMMER,
     {'sledak': 'sits behind the desk on the LEFT under the green lamp, papers and the four statements spread out in front of him, looking up at Levina',
      'expert': 'stands at the open window in the centre of the back wall, smoking, half-turned toward Gromov',
      'oper': 'sits on the visitor\'s chair at the RIGHT end of the desk, tired, elbows on his knees, looking at Gromov'},
     WIDE_DOOR + ' The same view as the morning: the desk across the left half, the window in the centre.',
     'night: the black open window with distant city lights; the only light is the green desk lamp, the corners of the room in darkness',
     'the green lamp (on), papers spread on the desk, two empty tea glasses, the dark window',
     ['place:office_am_wide', 'face:expert', 'face:oper', 'face:sledak'],
     note='Ночь: за окном темно, огни города; свет только от лампы.')
shot('office_night_ots_expert', 'hod_office_night', 'ots', 'office', NIGHT, SUMMER,
     {'expert': 'stands at the open dark window facing the camera, a cigarette in her fingers, asking a question, eyes narrowed',
      'sledak': 'seen only from behind at the LEFT edge, under the lamp light'},
     ots('sledak', 'expert', 'LEFT', 'The black window with city lights behind her.'),
     'the green desk lamp lights her from below and the side; the window behind her is black with city lights',
     'the cigarette, the window frame, the edge of the desk with papers',
     ['shot:office_night_wide', 'face:expert', 'face:sledak'])

# Квартира Зои Павловны у Лапиных, день.
shot('flat_wide', 'hod_flat', 'wide', 'flat', DAY, SUMMER,
     {'buyer': 'stands in front of the sideboard, LEFT of centre, facing Gromov, a plastic document folder held against his chest, anxious',
      'lapin_wife': 'stands in the kitchen doorway on the RIGHT, drying her hands on a tea towel, watching her husband, guarded',
      'sledak': 'stands in the middle of the room, RIGHT of centre, seen from behind and slightly from the side, his case folder under his arm, looking at Lapin',
      'oper': 'leans on the frame of the hallway door at the LEFT edge of the frame in the foreground, in profile, looking at the glass doors of the sideboard'},
     'The camera stands in the hallway doorway at the eye level of a standing person, a 32 mm-equivalent field of view: the whole room with everyone in it; the lower third of the frame is kept free of faces.',
     SUN_DAY + '; dusty sunlight through the half-taken-down tulle', 'the sideboard with the photograph behind the glass, the wall rug, the window, rolls of wallpaper, the bucket, the stepladder, the television, the red toy truck',
     ['room:assets/ep01/bg/apartment_zoya.webp', 'face:buyer', 'face:lapin_wife', 'face:sledak', 'face:oper'],
     note='Лапин у серванта смотрит на Громова; Ирина — на мужа; Сайко — на стекло серванта (намёк на фото).')
shot('flat_ots_buyer', 'hod_flat', 'ots', 'flat', DAY, SUMMER,
     {'buyer': 'stands in front of the sideboard facing the camera, holding out the plastic folder of papers, talking fast, defensive',
      'sledak': 'seen only from behind at the RIGHT edge'},
     ots('sledak', 'buyer', 'RIGHT', 'The glass doors of the sideboard behind Lapin, the framed photograph of the young soldier visible behind the glass.'),
     SUN_DAY, 'the plastic folder, the sideboard with porcelain and the photograph',
     ['shot:flat_wide', 'face:buyer', 'face:sledak'])
shot('flat_ots_wife', 'hod_flat', 'ots', 'flat', DAY, SUMMER,
     {'lapin_wife': 'stands in the kitchen doorway facing the camera, the tea towel twisted in her hands, speaking, worried and tired',
      'sledak': 'seen only from behind at the LEFT edge'},
     ots('sledak', 'lapin_wife', 'LEFT', 'The small kitchen behind her: a gas stove, a pot, a child\'s drawing on the fridge.'),
     SUN_DAY, 'the tea towel, the kitchen doorway',
     ['shot:flat_wide', 'face:lapin_wife', 'face:sledak'])
shot('flat_photo', 'hod_flat_photo', 'insert', 'flat', DAY, SUMMER,
     {'sledak': 'only his hand and the short pale-blue sleeve: he holds the half-open glass door of the sideboard'},
     'Close insert at standing eye level: the sideboard shelf behind the half-open glass door — porcelain cups, a crystal vase and a framed black-and-white photograph of a young man in a Soviet army uniform; reflections of the window in the glass.',
     SUN_DAY, 'one framed photograph, porcelain cups, a crystal vase, the glass door; no writing visible',
     ['shot:flat_wide'])

# Осмотр квартиры (мини-игра crime_scene_search): фон для поиска — три улики крупно и врозь, людей нет.
shot('flat_inspect', 'hod_flat_inspect', 'search', 'flat', DAY, SUMMER,
     {},
     'No people in the frame. The camera stands in the middle of the room at the eye level of a standing person, a '
     '35 mm-equivalent field of view, facing the LEFT wall with the sideboard and the window corner: Gromov\'s point of view '
     'while he inspects the room. Three objects are the point of the frame; each is clearly visible, well apart from the '
     'others and from the frame edges, all in the upper two thirds of the frame: (1) behind the glass door of the dark '
     'sideboard on the LEFT, on the middle shelf at eye level, one framed black-and-white photograph of a young man in a '
     'Soviet army uniform, about one tenth of the frame width; (2) on the waist-high wooden top of the sideboard below the '
     'glass doors, a pair of old horn-rimmed reading glasses lying folded on a worn brown spectacle case, about one tenth '
     'of the frame width; (3) on the windowsill in the RIGHT half of the frame, a small brown glass medicine bottle with a '
     'strip of white tablets next to it, about one twelfth of the frame width. Nothing else on the shelves, the sideboard '
     'top or the windowsill that could be mistaken for a clue.',
     SUN_DAY, 'the sideboard with porcelain cups and a crystal vase behind the glass, the framed photograph, the reading '
     'glasses on the spectacle case, the medicine bottle with the tablet strip on the windowsill, the wall rug, newspapers '
     'pasted over the half-stripped walls; nothing on the floor in the middle of the frame',
     ['place:flat_wide'],
     note='Мини-игра «Осмотр квартиры»: фото внука за стеклом серванта (слева, на уровне глаз), очки на футляре на '
          'столешнице серванта, таблетки на подоконнике справа. Каждая улика ≥ 6 % ширины кадра, врозь, в верхних двух '
          'третях; людей нет; ничего похожего на улику рядом (ведро, стремянка, игрушка — не в зонах).')

# Площадка третьего этажа: Галина на цепочке → Галина вышла.
shot('landing_chain_wide', 'hod_landing_chain', 'wide', 'landing', DAY, SUMMER,
     {'neighbor': 'only her face and a strip of her house dress in the gap of her door No. 33, which is open a hand\'s width on a door chain; one suspicious eye on Gromov',
      'sledak': 'stands in front of Galina\'s door, LEFT of centre, seen from behind, his case folder in his hand',
      'oper': 'leans on the stair railing at the RIGHT edge in the foreground, looking at Zoya\'s new steel door No. 34'},
     'The camera stands on the top step of the stairs at the eye level of a standing person, a 32 mm-equivalent field of view: both doors and the people; the lower third of the frame is kept free of faces.',
     'summer daylight from the stairwell window behind the camera; the bulb is off', 'the door chain, both doors, the electricity cabinet, the doormats, the railing',
     ['face:neighbor', 'face:sledak', 'face:oper'],
     note='Новая площадка (третий этаж, не первый с почтовыми ящиками); лето, дневной свет; Галина за цепочкой.')
shot('landing_chain_ots', 'hod_landing_chain', 'ots', 'landing', DAY, SUMMER,
     {'neighbor': 'her face in the gap of the door behind the stretched chain, facing the camera, distrustful, a gold tooth at the side of her mouth',
      'sledak': 'seen only from behind at the RIGHT edge'},
     ots('sledak', 'neighbor', 'RIGHT', 'Her leatherette-padded door fills the frame around the gap.'),
     'summer daylight from behind the camera', 'the door chain, the padded door',
     ['shot:landing_chain_wide', 'face:neighbor', 'face:sledak'])
shot('landing_open_wide', 'hod_landing_open', 'wide', 'landing', DAY, SUMMER,
     {'neighbor': 'stands on the threshold of her wide-open door No. 33, the door chain unhooked and hanging loose down the door edge, in her house dress, apron and felt slippers, leaning toward Gromov and speaking quietly, glancing sideways at Zoya\'s new steel door',
      'sledak': 'stands close in front of her, LEFT of centre, seen from behind, listening',
      'oper': 'leans on the stair railing at the RIGHT edge in the foreground, now looking at Galina'},
     'The same camera as the first view of the landing: from the top step at the eye level of a standing person, 32 mm-equivalent; the lower third of the frame is kept free of faces.',
     'summer daylight from the stairwell window behind the camera', 'both doors, Galina\'s door wide open with the chain hanging loose, the railing',
     ['place:landing_chain_wide', 'face:neighbor', 'face:sledak', 'face:oper'])
shot('landing_open_ots', 'hod_landing_open', 'ots', 'landing', DAY, SUMMER,
     {'neighbor': 'stands on the landing facing the camera, one hand pressed to her chest, speaking low and frightened, her eyes flicking to the side toward the neighbouring door',
      'sledak': 'seen only from behind at the RIGHT edge'},
     ots('sledak', 'neighbor', 'RIGHT', 'Her open door and the dim hallway of her flat behind her.'),
     'summer daylight from behind the camera', 'her open padded door, the loose chain',
     ['shot:landing_open_wide', 'face:neighbor', 'face:sledak'])

# Нотариус Ковригин, Пресня.
shot('notary_wide', 'hod_notary', 'wide', 'notary', DAY, SUMMER,
     {'notary': 'sits behind the desk in the centre, facing the visitors and the camera, dabbing his forehead with a handkerchief, the open register in front of him, a strained polite smile',
      'assistant': 'sits at the small typing desk by the window on the LEFT, her hands frozen above the typewriter keys, glancing over her right shoulder at Gromov\'s back (right of centre), not toward the camera',
      'sledak': 'stands in front of the desk, RIGHT of centre, seen from behind, his case folder in his hand',
      'oper': 'leans on the frame of the open door on the RIGHT, arms crossed, looking at Lyuda'},
     'The camera stands behind the visitors near the wall opposite the desk, at the eye level of a standing person, a 32 mm-equivalent field of view: the whole office with everyone in it; the lower third of the frame is kept free of faces.',
     'summer daylight from the tall window on the left; the green lamp is off', 'the register ledger, the stamps, the typewriter, the fan turning on the bookcase, the queue visible through the open door',
     ['room:assets/ep01/bg/notary_office.webp', 'face:notary', 'face:sledak', 'face:oper'],
     note='Вешалка пустая (лето); вентилятор — примета жары; в коридоре очередь в летнем.')
shot('notary_ots_notary', 'hod_notary', 'ots', 'notary', DAY, SUMMER,
     {'notary': 'sits behind the desk facing the camera, his hand flat on the open register, looking up at Gromov, sweating, a polite strained smile',
      'sledak': 'seen only from behind at the RIGHT edge, standing'},
     ots('sledak', 'notary', 'RIGHT', 'The bookcase and the turning fan behind him.'),
     'summer daylight from the window on the left', 'the open register, the stamps, the handkerchief',
     ['shot:notary_wide', 'face:notary', 'face:sledak'])
shot('notary_register', 'hod_notary_register', 'insert', 'notary', DAY, SUMMER,
     {'notary': 'only his plump hand with the gold signet ring resting at the edge of the page'},
     'Close insert from above at a slight angle: the open register ledger on the desk, ruled columns of handwritten entries; one row is written in noticeably brighter blue ink than the rows around it; all writing too small and soft to read.',
     'summer daylight from the left', 'the register, one hand, the edge of a rubber stamp',
     ['shot:notary_wide'])

# Нотариус на второй день, когда помощницу отправили в отпуск: стол у окна пуст, машинка под чехлом.
shot('notary_alone_wide', 'hod_notary_alone', 'wide', 'notary', 'a sunny Tuesday, 10 August 1993, early afternoon', SUMMER,
     {'notary': 'sits behind the desk in the centre, facing the visitors and the camera, a handkerchief in his hand, the open register in front of him, a cautious polite smile',
      'sledak': 'stands in front of the desk, RIGHT of centre, seen from behind, his case folder in his hand',
      'oper': 'leans on the frame of the open door on the RIGHT, arms crossed, looking at the empty typing desk'},
     'The same camera as the first view of this office: behind the visitors near the wall opposite the desk, at the eye level of a standing person, a 32 mm-equivalent field of view; the lower third of the frame is kept free of faces.',
     'summer daylight from the tall window on the left; the green lamp is off',
     'the small typing desk under the window is EMPTY, its typewriter covered with a grey dust cover, the chair pushed in; the register, the stamps, the fan turning on the bookcase, the queue through the open door',
     ['place:notary_wide', 'face:notary', 'face:sledak', 'face:oper'],
     note='Тот же кабинет на следующий день: помощницы нет, машинка под чехлом.')

# Лестница у нотариуса: Люда курит.
shot('stairs_wide', 'hod_notary_stairs', 'wide', 'notary_stairs', DAY, SUMMER,
     {'assistant': 'stands at the window on the landing, arms crossed, a cigarette between two fingers, looking down at the floor, frightened',
      'oper': 'leans on the windowsill next to her, relaxed, holding out his lighter, looking at her kindly',
      'sledak': 'stands three steps below in the foreground LEFT, seen from behind, looking up at them'},
     'The camera stands on the stairs below the landing, just behind Gromov, at his eye level, a 32 mm-equivalent field of view: the landing with the window and the two people at it; the lower third of the frame is kept free of faces.',
     'summer sunlight through the tall landing window, warm reflections on the worn stone', 'the window, the tin-can ashtray, the railing, the lighter, the cigarette',
     ['person:notary_wide:assistant', 'face:oper', 'face:sledak'],
     note='Лицо Люды — с общего плана конторы (Reference 1).')
shot('stairs_ots_assistant', 'hod_notary_stairs', 'ots', 'notary_stairs', DAY, SUMMER,
     {'assistant': 'stands by the sunlit window facing the camera, speaking quickly and quietly, the cigarette trembling in her fingers',
      'oper': 'seen only from behind at the RIGHT edge'},
     ots('oper', 'assistant', 'RIGHT', 'The tall window with green treetops behind her.'),
     'summer sunlight from the window behind her', 'the cigarette, the windowsill with the tin-can ashtray',
     ['shot:stairs_wide', 'face:oper'])

# ЖЭК, август: паспортистка.
shot('zhek_wide', 'hod_zhek', 'wide', 'zhek', DAY, SUMMER,
     {'passport_clerk': 'sits behind the open service window in the RIGHT wall, reading glasses on, a pile of house registers in front of her, looking up at Gromov',
      'sledak': 'stands at the service window, leaning slightly toward it, seen from the side and behind',
      'oper': 'stands by the bench on the LEFT, hands in his pockets, looking at the clerk'},
     'The camera stands at the entrance end of the corridor at the eye level of a standing person, a 32 mm-equivalent field of view: the corridor with the service window, the bench and the far window; two elderly women in light summer dresses sit on the bench waiting; the lower third of the frame is kept free of faces.',
     'summer daylight from the window at the far end plus the fluorescent tube', 'the service window with wooden shutters, the notice board, the bench, the house registers, a desk fan behind the clerk',
     ['room:assets/ep01/bg/zhek.webp', 'face:sledak', 'face:oper'],
     note='Крючки пустые (лето). Паспортистка — новое лицо.')
shot('zhek_ots_clerk', 'hod_zhek', 'ots', 'zhek', DAY, SUMMER,
     {'passport_clerk': 'inside the service window facing the camera, glasses on her nose, a finger on an open house register, answering curtly',
      'sledak': 'seen only from behind at the LEFT edge'},
     ots('sledak', 'passport_clerk', 'LEFT', 'The wooden shutters frame her; shelves with registers and a turning desk fan behind her.'),
     'fluorescent light inside the office and daylight from the corridor', 'the open register, the shutters, the fan',
     ['shot:zhek_wide', 'face:sledak'])

# Архив БТИ.
shot('bti_wide', 'hod_bti', 'wide', 'bti', 'a sunny Tuesday, 10 August 1993, late morning', SUMMER,
     {'clerk': 'stands at an open card-index drawer on the LEFT, holding a record card up to the light, looking over her glasses at Gromov',
      'sledak': 'stands at the reading desk on the RIGHT, turned toward her, his folder open on the desk'},
     'The camera stands down the aisle at the eye level of a standing person, a 32 mm-equivalent field of view: the rows of cabinets, the two people and the window at the end; the lower third of the frame is kept free of faces.',
     'summer daylight from the window at the end of the aisle plus the green desk lamp', 'the card-index drawers, the record card, the reading desk with the green lamp',
     ['room:assets/ep01/bg/bti_archive.webp', 'face:clerk', 'face:sledak'])
shot('bti_ots_clerk', 'hod_bti', 'ots', 'bti', 'a sunny Tuesday, 10 August 1993, late morning', SUMMER,
     {'clerk': 'stands at the card drawers facing the camera, a record card in her hand, peering at Gromov over her glasses, speaking',
      'sledak': 'seen only from behind at the RIGHT edge'},
     ots('sledak', 'clerk', 'RIGHT', 'The wall of card-index drawers behind her.'),
     'daylight from the far window and the green desk lamp', 'the record card, the drawers',
     ['shot:bti_wide', 'face:clerk', 'face:sledak'])

# Машина Сайко.
shot('car_wide', 'hod_car', 'wide', 'car', DAY, SUMMER,
     {'oper': 'drives on the LEFT, one hand on the wheel, his other elbow on the open window, glancing at Gromov',
      'sledak': 'sits in the passenger seat on the RIGHT, his case folder open on his knees, looking at the papers'},
     'The camera is on the back seat between the front seats, at the eye level of a seated passenger, a 32 mm-equivalent field of view: both men from behind and from the side, the windscreen and the street ahead; their faces in the upper half of the frame.',
     'bright summer daylight outside; the car interior in shade', 'the dashboard, the mirror with the paper icon and the pine air freshener, the open windows, the street with green trees',
     ['face:oper', 'face:sledak'])
shot('car_ots_oper', 'hod_car', 'ots', 'car', DAY, SUMMER,
     {'oper': 'drives, seen in three-quarter profile facing the camera side, talking with a crooked grin, one hand on the wheel',
      'sledak': 'only the back of his head and his shoulder at the RIGHT edge'},
     ots('sledak', 'oper', 'RIGHT', 'The open driver\'s window with the sunny street and green trees moving past behind Sayko.'),
     'bright daylight outside the car, Sayko\'s face in the soft shade of the cabin', 'the steering wheel, the open window',
     ['shot:car_wide', 'face:oper'])

# Реконструкция: ЖЭК, июнь 1993-го.
shot('recon_wide', 'hod_recon', 'wide', 'zhek', 'a sunny June day, 1993, morning', JUNE,
     {'zoya': 'stands near the service window, LEFT of centre, holding a cardboard folder of papers to her chest, looking up at the polite man with cautious gratitude',
      'murashov_sil': 'stands RIGHT of centre with his back to the camera, leaning slightly toward Zoya Pavlovna, pointing at the papers in her folder; his face is never visible'},
     'The camera stands at the entrance end of the corridor at the eye level of a standing person, a 32 mm-equivalent field of view: the corridor, a queue of five elderly people in light summer clothes on the bench and along the wall; the lower third of the frame is kept free of faces.',
     'June daylight from the far window and the fluorescent tube', 'the service window, the bench, the notice board, the cardboard folder, the briefcase',
     ['place:zhek_wide', 'face:zoya'],
     note='Мурашов только со спины; Зоя в летнем платье и кофте, не в зимнем пальто с портрета.')
shot('recon_ots_zoya', 'hod_recon', 'ots', 'zhek', 'a sunny June day, 1993, morning', JUNE,
     {'zoya': 'faces the camera, looking up at the polite man with a shy grateful smile, the cardboard folder held to her chest',
      'murashov_sil': 'only the back of his neat dark head and the shoulder of his light beige jacket at the RIGHT edge; his face is never visible'},
     ots('murashov_sil', 'zoya', 'RIGHT', 'The queue on the bench behind her, out of focus.'),
     'June daylight', 'the cardboard folder, her cloth handbag',
     ['shot:recon_wide', 'face:zoya'])


# ───────────────────────────── дни 3–5 и развязка (docs/season1/ep01-hod-finale.md) ─────────────────────────────
# Сайко в эпизоде может не быть (не пробил «Волгу») или он ранен: в новых местах его нет на общих планах, а где он
# говорит — у него свой кадр. Людей, которых по тексту сцены нет, в кадре нет.

LOC.update({
    'street_walk': ("A sunny street of panel apartment blocks in western Moscow: a trolleybus stop in the shade of a big lime "
                    "tree, a round blue sign on a pole, a bench, an old ZiU trolleybus approaching along the wires, a kvass "
                    "barrel-cart on the far pavement, people in light summer clothes at a distance."),
    'khoroshevka': ("The third-floor landing of a five-storey brick block of flats on Khoroshevskoye Shosse, Moscow: walls painted "
                    "light blue to shoulder height and whitewashed above, a worn tiled floor; in the back wall, LEFT, the door of "
                    "the missing old man's flat — new, faced with brown-painted steel sheet with a shiny new lock, exactly like "
                    "the one in the first case; RIGHT, the neighbour's old wooden door painted brown, with a peephole; a window "
                    "on the half-landing with an aloe in a pot on the sill; the stair railing on the RIGHT edge."),
    'chertanovo': ("The landing of a sixteen-storey 1980s tower block in Chertanovo, Moscow: beige-painted walls, brown floor "
                   "tiles, the closed doors of a lift in the back wall, two flat doors with padded leatherette and numbers, a "
                   "rubbish chute hatch, a window at the end of the landing with daylight and green trees far below."),
    'presnya_street': ("A quiet street on Presnya, Moscow: across the road a three-storey pre-revolutionary building with tall "
                       "windows and peeling ochre plaster; by its entrance a fresh signboard of a real-estate agency, and old "
                       "letters still visible on the glass of the door (all writing too small and soft to read); old lime trees "
                       "along the pavement."),
    'agency': ("A room in the former newspaper office on Presnya, now a small real-estate agency: a high ceiling with old plaster "
               "moulding, two tall windows with half-open venetian blinds, old wooden shelves with neat rows of ring binders and "
               "cardboard folders, a big desk with three telephones (two grey, one red), a glass water decanter with a glass, "
               "a desk fan, a framed yellowed newspaper front page on the wall (unreadable), a visitor's chair facing the desk."),
    'presnya_night': ("The same quiet street on Presnya at night: across the road the three-storey pre-revolutionary building, all "
                      "windows dark except ONE lit window on the second floor; a single street lamp; old lime trees."),
    'stairwell_old': ("The staircase of the same old building on Presnya at night: worn stone steps, a cast-iron railing with a "
                      "wooden handrail, a dim bare bulb on the landing, peeling ochre walls, the half-open street door below."),
    'metro': ("The forecourt of the 'Ulitsa 1905 Goda' metro station, Moscow, at night: the lit red letter M on a pole, the "
              "station's glass doors glowing, a kiosk with its shutter down, wet asphalt after a short summer rain."),
    'dacha': ("A room in a tidy two-storey country house near Moscow: a desk under the window with three telephones (two grey, one "
              "red), shelves of ring binders and folders labelled by year (unreadable), a ficus in a pot on the windowsill, a "
              "wardrobe with a mirror, a rug on a painted wooden floor, a door to the hall on the RIGHT."),
    'field': ("A strip of birch trees between a mown field and a dirt country road near Aprelevka, outside Moscow: red-and-white "
              "striped tape stretched between the birch trunks; two spades leaning against a birch at the tape; beyond the tape "
              "only tall grass, low mist and the backs of three militiamen in short-sleeved grey-blue uniform shirts; a blue-and-"
              "white militia UAZ van parked on the road in the foreground. Nothing on the ground beyond the tape is visible."),
    'interrog': ("An interrogation room of the district militia temporary detention unit, Moscow: walls painted grey-green to "
                 "shoulder height, a barred window with frosted lower panes and summer daylight in the upper panes, a bare metal "
                 "table bolted to the floor, three wooden chairs, a protocol form, a pen and a plain glass ashtray on the table, a "
                 "steel door with a peephole on the RIGHT."),
    'court': ("A hall of the Moscow City Court, 1994: tall windows with heavy curtains, wood-panelled walls, the judges' bench with "
              "three high-backed chairs at the far end (out of focus), the metal defendants' cage on the LEFT, wooden benches for "
              "the public with a few people seen from behind."),
    'office2004': ("A small office in Moscow, 2004: vertical office blinds on the window behind with a grey city outside, a beige "
                   "computer with a CRT monitor on the desk, a leather office chair, a bookcase with binders."),
    'photo': 'An old photograph.',
})

WED = 'a sunny Wednesday, 11 August 1993'
THU_NIGHT = 'a warm August night, Thursday 12 August 1993, about 11:40 p.m.'
DAWN = 'the first light of a summer dawn, Friday 13 August 1993, about 5:30 a.m.'
FIELD_AM = 'early morning, Friday 13 August 1993, about 7:20 a.m.: a low sun through the birches, mist over the field, dew'
FRIDAY = 'a sunny Friday, 13 August 1993, late morning'

# Среда, без Сайко: Громов один, на троллейбусе.
shot('walk_wide', 'hod_walk', 'wide', 'street_walk', f'{WED}, late morning', SUMMER,
     {'sledak': 'stands alone at the trolleybus stop LEFT of centre, holding a slip of paper with an address in BOTH hands and reading it, not looking at the camera; a brown shoulder bag hangs on its long strap from his right shoulder against his hip with no hand on it; he has exactly two arms and two hands'},
     'The camera stands on the other side of the pavement at the eye level of a standing person, a 35 mm-equivalent field of view: Gromov full-figure and small in the frame, the street and the approaching trolleybus behind him; the lower third of the frame is kept free of faces.',
     'bright summer daylight, the stop in the patchy shade of the lime tree', 'the stop sign, the bench, the trolleybus, the lime tree, the slip of paper',
     ['face:sledak'], note='Сайко нет: Громов в среду один (без доверия Сайко). Две руки: обе на бумажке, сумка на ремне через плечо (2026-10-14: была третья рука).')

# А. Хорошёвка: соседка Петра Ильича. Сайко ждёт внизу в машине — на площадке двое.
shot('second_wide', 'hod_second', 'wide', 'khoroshevka', f'{WED}, early afternoon', SUMMER,
     {'klava': 'stands in her open doorway on the RIGHT, one hand on the door frame, the other pointing across at the steel door of the missing neighbour, her eyes on Gromov',
      'sledak': 'stands on the landing LEFT of centre between the two doors, seen three-quarter from behind, turned toward the old woman, listening'},
     'The camera stands on the top step of the stairs at the eye level of a standing person, a 32 mm-equivalent field of view: both doors in the back wall, the window of the half-landing out of frame behind the camera; the lower third of the frame is kept free of faces.',
     'summer daylight from the stairwell window behind the camera', 'the brown steel door with the shiny lock on the LEFT, her old wooden door open on the RIGHT, the railing',
     ['face:sledak'], note='Сайко остался в машине. Дверь Петра Ильича — железная, новая, как у Зои Павловны; у соседки старая деревянная.')
shot('second_ots_klava', 'hod_second', 'ots', 'khoroshevka', f'{WED}, early afternoon', SUMMER,
     {'klava': 'stands in her doorway facing the camera, speaking with bitter certainty, one hand lifted slightly as if showing a little wave of the hand, her eyes on Gromov',
      'sledak': 'seen only from behind at the LEFT edge'},
     ots('sledak', 'klava', 'LEFT', 'The dim hallway of her flat with a coat rack (summer things only) behind her.'),
     'summer daylight from behind the camera', 'her open wooden door, the door frame',
     ['shot:second_wide', 'face:sledak'])

# Б. Чертаново: квартира по прописке сдана, хозяйка поднялась с нижнего этажа. Сайко внизу.
shot('chertanovo_wide', 'hod_chertanovo', 'wide', 'chertanovo', f'{WED}, early afternoon', SUMMER,
     {'landlady': 'stands by the closed lift doors RIGHT of centre, arms folded over her house dress, talking readily, her eyes on Gromov',
      'sledak': 'stands LEFT of centre facing her, seen three-quarter from behind, his folder in his hand'},
     'The camera stands at the end of the landing by the window at the eye level of a standing person, a 32 mm-equivalent field of view; the lower third of the frame is kept free of faces.',
     'flat summer daylight from the window behind the camera and a fluorescent tube', 'the lift doors, the two padded flat doors, the rubbish chute hatch',
     ['face:sledak'], note='Жильцы открыли и ушли в квартиру; на площадке только хозяйка и Громов.')

# Б. Пресня: агентство в бывшей редакции. Водитель — спиной (лицо Громов видит позже).
shot('agency_street_wide', 'hod_agency_street', 'wide', 'presnya_street', f'{WED}, afternoon', SUMMER,
     {'sledak': 'stands on the near pavement in the LEFT foreground, seen from behind and slightly from the side, looking across the road at the agency entrance'},
     'The camera stands behind Gromov on the near pavement at the eye level of a standing person, a 32 mm-equivalent field of view: across the road the building and its entrance; parked at the entrance a grey GAZ-24 Volga, and leaning on its wing a big crew-cut man in a navy tracksuit top, smoking, his back to the camera (an extra: his face is never visible).',
     'bright afternoon sunlight, the building facade in sun, Gromov\'s side of the street in the shade of the lime trees',
     'the grey Volga at the entrance, the signboard and the door glass with old letters (unreadable), the lime trees',
     ['face:sledak'], note='Водитель только со спины; «Волга» серая ГАЗ-24 — та же во всех кадрах.')
shot('agency_wide', 'hod_agency', 'wide', 'agency', f'{WED}, afternoon', SUMMER,
     {'murashov': 'sits behind the big desk on the RIGHT, upright, hands folded on the desk, a polite attentive half-smile, his calm pale eyes on Gromov',
      'sledak': 'sits on the visitor\'s chair facing the desk on the LEFT, seen three-quarter from behind, playing an ordinary buyer, his folder on his knees'},
     'The camera stands by the door at the eye level of a standing person, a 32 mm-equivalent field of view: the room with its high ceiling, the windows behind the desk; the lower third of the frame is kept free of faces.',
     'afternoon sunlight through the half-open blinds in warm stripes across the desk and the shelves',
     'the three telephones, the glass decanter, the desk fan, the binders, the framed old newspaper page',
     ['face:murashov', 'face:sledak'], note='Мурашов впервые в лицо: вежливый, бесцветный, без харизмы; смотрит на Громова, не в объектив.')
shot('agency_ots_murashov', 'hod_agency', 'ots', 'agency', f'{WED}, afternoon', SUMMER,
     {'murashov': 'sits behind the desk facing the camera, a pen held lightly in his fingers, smiling politely, his pale calm eyes resting on Gromov a moment too long',
      'sledak': 'seen only from behind at the LEFT edge'},
     ots('sledak', 'murashov', 'LEFT', 'The shelves of binders and the striped light of the blinds behind him.'),
     'warm stripes of afternoon light from the blinds', 'the telephones, the decanter, the pen',
     ['shot:agency_wide', 'face:murashov'])
# Б, с Сайко: три часа в машине через дорогу.
shot('watch_wide', 'hod_watch', 'wide', 'car', f'{WED}, about 5:50 p.m.', SUMMER,
     {'oper': 'sits in the driver\'s seat on the LEFT, slumped back, one wrist on the top of the wheel, watching the agency entrance through the windscreen',
      'sledak': 'sits in the passenger seat on the RIGHT, the folder closed on his knees, his eyes on the agency entrance across the road, not on the papers'},
     'The camera is on the back seat between the front seats, at the eye level of a seated passenger, a 32 mm-equivalent field of view: both men from behind and slightly from the side; through the windscreen, across the road, exactly the building of Reference 2 — the same ochre facade, the same blue signboard over the same entrance with steps, the same grey GAZ-24 Volga parked to the right of the entrance — and a big crew-cut man in a navy tracksuit top leaning on the Volga, small in the distance.',
     'low evening sun on the building across the road; the car interior in shade',
     'the dashboard, the mirror with the paper icon and the pine air freshener, the windows rolled down, the Volga across the road',
     ['place:car_wide', 'place:agency_street_wide', 'face:oper', 'face:sledak'],
     note='Та же машина Сайко, что в днях 1–2; через дорогу — то же здание и та же «Волга», что на общем плане агентства.')

# Четверг, ночь: операция. Общий план — из тёмной машины, людей в ней не видно (годится и с Сайко, и без него).
shot('op_wide', 'hod_op', 'wide', 'presnya_night', THU_NIGHT, SUMMER,
     {},
     'The camera is inside a dark parked car across the road, low, over the dashboard: the dark windscreen frame and the silhouette of the dashboard in the foreground, nobody visible inside the car; across the road the building with the ONE lit window on the second floor, the grey GAZ-24 Volga at the entrance under the street lamp, and a big man leaning on it, a glowing cigarette, his face lost in shadow.',
     'night: the street lamp, the one lit window, the glow of the cigarette; everything else dark blue', 'the lit window, the Volga, the street lamp, the dashboard silhouette',
     ['place:agency_street_wide'], note='Людей в машине не видно: кадр общий для ветки с Сайко и без него.')
shot('op_wounded', 'hod_op', 'medium', 'presnya_night', THU_NIGHT, SUMMER,
     {'oper': 'sits on the asphalt facing the camera, leaning back against the rear wheel of the grey Volga; the wound is in his RIGHT shoulder, which is on the LEFT side of the frame: his left hand crosses his chest and presses that shoulder, a dark patch on the checked sleeve under his fingers; his other shoulder, on the RIGHT side of the frame, is unhurt; he grimaces into a crooked grin, looking up at Gromov',
      'sledak': 'crouches beside him on the RIGHT of the frame, seen in profile, his hand resting on Sayko\'s unhurt shoulder on the RIGHT side of the frame (never on the wound), looking at the wound'},
     'The camera is low at the level of a crouching person, a 40 mm-equivalent field of view; the two men fill the middle of the frame, their faces in the upper half.',
     'night: the street lamp from above and the blue flashing light of a militia car falling across them', 'the Volga\'s rear wheel and door, the wet asphalt',
     ['face:oper', 'face:sledak'], note='Ранение — последствием: рука на плече, тёмное пятно на рукаве; без крови крупно.')
shot('op_stairs', 'hod_op', 'medium', 'stairwell_old', THU_NIGHT, SUMMER,
     {'murashov': 'stands two steps above Gromov with both feet on the step, holding out both EMPTY hands toward him, wrists together, ready for the handcuffs — calm and tidy, the way one holds out a passport at a counter; nothing in his hands, no papers; his eyes on Gromov\'s hands',
      'sledak': 'stands below on the LEFT, seen three-quarter from behind, handcuffs in his hand'},
     'The camera stands on the stairs below Gromov at eye level, a 40 mm-equivalent field of view; Murashov\'s face in the upper half of the frame.',
     'the dim bare bulb on the landing above, deep shadows', 'the handcuffs, the railing, the stone steps',
     ['face:murashov', 'face:sledak'], note='Мурашов не бежит и не спрашивает: протягивает руки, «как в очереди за справкой».')
shot('op_metro', 'hod_op', 'medium', 'metro', 'a warm August night, Friday 13 August 1993, about 1:30 a.m.', SUMMER,
     {'accomplice': 'is pinned face-down on the bonnet of the grey Volga: his cheek pressed flat against the wet metal, his body bent over the front of the car, BOTH of his hands behind his back at the small of his back with the wrists crossed — neither hand is in front of him or on the car; scared and uncomprehending, his eyes off to the side, not into the lens',
      'oper': 'stands right behind him, RIGHT of centre, and leans in with his whole weight: his left hand clamps both of Shmel\'s crossed wrists at the small of his back, his right forearm presses down between Shmel\'s shoulder blades; teeth clenched, his eyes on Shmel'},
     'The camera stands low at the front corner of the car at eye level with the bonnet, a 35 mm-equivalent field of view; the moment of the seizure, full of force and pressure. On the LEFT, on the far side of the bonnet, a young militia sergeant in a short-sleeved grey-blue uniform shirt and cap presses Shmel\'s left shoulder down onto the bonnet with both hands — he does not hold Shmel\'s hands. The lit metro sign behind them out of focus.',
     'night: the red glow of the metro letter and the glass doors, a street lamp, reflections on the wet asphalt',
     'the grey GAZ-24 Volga with ALL its doors closed, the metro sign',
     ['face:accomplice', 'face:oper'], note='Ветка «ждать»: Шмелёва берут у метро, руку из кармана он вынуть не успевает. 2026-10-14: руки за спиной, натиск и захват, сержант, двери закрыты.')

# Обыск в доме Мурашова за городом, рассвет. Сайко на общем плане нет (ранен или в машине).
shot('search_wide', 'hod_search', 'wide', 'dacha', DAWN, SUMMER,
     {'sledak': 'stands at the desk in the centre, pulling open a drawer, looking down into it'},
     'The camera stands by the door at the eye level of a standing person, a 32 mm-equivalent field of view; in the doorway on the RIGHT edge two attesting witnesses — an elderly man and woman, neighbours in summer clothes — and a young militiaman in a short-sleeved uniform shirt, all looking at the desk; the lower third of the frame is kept free of faces.',
     'the first grey-pink light of dawn through the window and a ceiling lamp on', 'the three telephones, the binders, the ficus, the wardrobe',
     ['face:sledak'], note='Понятые и милиционер — массовка; Мурашова здесь нет (он в отделе).')
shot('search_keys', 'hod_search', 'insert', 'dacha', DAWN, SUMMER,
     {'sledak': 'only his hand and the short pale-blue sleeve: he lifts a bunch of keys out of the open drawer'},
     'Close insert from above at standing eye level: the open desk drawer; a bunch of door keys, each with a small cardboard tag tied on with string (handwriting too small to read); beneath them several Soviet passports in dark red covers and a woman\'s worn cloth handbag.',
     'dawn light and the ceiling lamp', 'the keys with tags, the passports, the cloth handbag; no readable writing',
     ['shot:search_wide'])
shot('search_papers', 'hod_search', 'insert', 'dacha', DAWN, SUMMER,
     {'sledak': 'only his hands: he turns the pages of an open folder'},
     'Close insert from above at standing eye level: cardboard folders with cloth ties open on the desk, typed powers of attorney with round violet notary stamps and signatures (all too small and soft to read).',
     'dawn light and the ceiling lamp', 'the folders, the typed documents, the stamps; no readable writing',
     ['shot:search_wide'])

# Пятница, утро: лесополоса. Последствие, без тел (этика §4): лента, лопаты, милиция спиной, Левина в сапогах.
shot('field_wide', 'hod_field', 'wide', 'field', FIELD_AM, SUMMER,
     {'expert': 'walks slowly along the tape in the middle distance, LEFT of centre, in rubber boots and a light raincoat over her dress, looking down at the grass, a notebook in her hand',
      'sledak': 'stands in the RIGHT foreground by the militia van, seen from the side, his hands in his pockets, looking toward the tape'},
     'The camera stands on the dirt road at the eye level of a standing person, a 32 mm-equivalent field of view: the birches with the tape across the middle of the frame, the field and the mist beyond; the lower third of the frame is kept free of faces.',
     'low morning sun through the birch trunks, long shadows, mist, dew', 'the tape between the birches, the two spades leaning on a birch, the militia van, three militiamen beyond the tape seen from behind',
     ['face:expert', 'face:sledak'], costume={'expert': 'a light beige raincoat over her summer dress, black rubber boots, glasses on a chain'},
     note='Никаких тел и ям: за лентой трава, туман и спины милиционеров.')
shot('field_ots_expert', 'hod_field', 'ots', 'field', FIELD_AM, SUMMER,
     {'expert': 'stands at the tape facing the camera, her notebook closed against her chest, speaking quietly and flatly, her eyes on Gromov',
      'sledak': 'seen only from behind at the RIGHT edge'},
     ots('sledak', 'expert', 'RIGHT', 'The birches with the tape and the mist behind her; nothing on the ground is visible.'),
     'low morning sun from the side, mist', 'the tape, the birches',
     ['shot:field_wide', 'face:expert'], costume={'expert': 'a light beige raincoat over her summer dress, black rubber boots, glasses on a chain'})
shot('field_oper', 'hod_field', 'medium', 'field', FIELD_AM, SUMMER,
     {'oper': 'leans on the bonnet of the militia van, smoking, looking away toward the birches, unsmiling, his shoulders hunched'},
     'The camera stands on the road at eye level, a 40 mm-equivalent field of view: Sayko alone, the birches and the tape soft behind him.',
     'low morning sun from the side, mist', 'the van bonnet, the cigarette',
     ['shot:field_wide', 'face:oper'], note='Только если Сайко цел.')

# Пятница: допрос и очная ставка.
shot('interrog_wide', 'hod_interrog', 'wide', 'interrog', FRIDAY, SUMMER,
     {'murashov': 'sits on the chair at the far side of the table facing Gromov, straight-backed, adjusting a shirt cuff, calm and polite, his eyes on Gromov\'s writing hand',
      'sledak': 'sits at the near LEFT end of the table, seen three-quarter from behind, writing the protocol by hand'},
     'The camera stands in the corner by the door at the eye level of a standing person, a 32 mm-equivalent field of view: the table across the middle of the frame, the barred window behind Murashov; the lower third of the frame is kept free of faces.',
     'summer daylight through the upper panes of the barred window, a dim ceiling lamp', 'the metal table, the protocol, the pen, the ashtray, the steel door',
     ['face:murashov', 'face:sledak'],
     costume={'murashov': 'the same light beige summer jacket and pale-blue shirt, now without a tie and without a belt (taken at the detention), light trousers'},
     note='После задержания: без галстука и ремня. Харизмы нет — протокольная вежливость.')
shot('interrog_ots_murashov', 'hod_interrog', 'ots', 'interrog', FRIDAY, SUMMER,
     {'murashov': 'faces the camera across the table, calm, a faint polite smile, his eyes lowered to the protocol under Gromov\'s hand, not to the lens',
      'sledak': 'seen only from behind at the LEFT edge, writing'},
     ots('sledak', 'murashov', 'LEFT', 'The barred window and the grey-green wall behind him.'),
     'daylight from the barred window behind him, the dim ceiling lamp', 'the protocol, the pen, the ashtray',
     ['shot:interrog_wide', 'face:murashov'],
     costume={'murashov': 'the same light beige summer jacket and pale-blue shirt, now without a tie, light trousers'})
shot('confront_wide', 'hod_interrog', 'wide', 'interrog', f'{FRIDAY}, about 1 p.m.', SUMMER,
     {'murashov': 'sits on the RIGHT side of the table, turned toward Kovrigin, looking at him calmly and expectantly',
      'notary': 'sits on the LEFT side of the table facing Murashov, but staring down at the table, sweating, a damp handkerchief in his fist',
      'sledak': 'sits at the far end of the table between them, facing the camera, writing, glancing up at Kovrigin'},
     'The camera stands by the door at the eye level of a standing person, a 32 mm-equivalent field of view: the table lengthwise into the frame, the barred window behind Gromov; the lower third of the frame is kept free of faces.',
     'summer daylight through the barred window, the dim ceiling lamp', 'the metal table, the protocol, the ashtray, the steel door',
     ['place:interrog_wide', 'face:murashov', 'face:notary', 'face:sledak'],
     costume={'murashov': 'the same light beige summer jacket and pale-blue shirt, now without a tie, light trousers'},
     note='Очная ставка: Ковригин смотрит в стол, Мурашов — на Ковригина.')

# Развязка.
shot('court_wide', 'hod_court', 'wide', 'court', 'Moscow, 1994, a grey daytime', 'Indoors; the season is not visible: the tall windows show only a pale grey sky.',
     {'murashov': 'stands INSIDE a closed defendants\' cage on the LEFT, fully behind its front bars, hands folded in front of him, neat and expressionless, looking toward the judges\' bench, not at the camera'},
     'The camera stands among the public benches at seated eye level, a 32 mm-equivalent field of view: the cage on the LEFT is a closed box of vertical steel bars on every visible side — front, side and top rail — with a closed barred door; the bars run unbroken in front of Murashov\'s whole body; no opening, gap or missing bars anywhere. Two militiamen stand OUTSIDE the cage beside it. The judges\' bench far away out of focus, the backs of a few people on the benches in the foreground; the lower third of the frame is kept free of faces.',
     'flat grey daylight from the tall windows', 'the cage, the bench, the curtains, the wood panelling',
     ['face:murashov'], costume={'murashov': 'a dark grey suit, a white shirt, no tie'}, note='Суд 1994-го: только Мурашов в клетке; судья вдали, не в фокусе.')
shot('bio_zoya', 'hod_bio', 'insert', 'photo', 'a summer day, about 1985', 'Summer in the photograph: leafy trees.',
     {'zoya': 'about 66, in a light summer dress and a cardigan, sits on a courtyard bench with her arm around her grandson, laughing at something he says, looking at him',
      'grandson': 'sits beside her, grinning up at her'},
     'A black-and-white amateur photograph from about 1985, slightly faded, with a narrow white border and soft focus, filling the frame: an ordinary family snapshot in a Moscow courtyard, the two of them on a bench, lilac bushes and a panel block behind.',
     'soft summer daylight in the photograph', 'the bench, the lilac bushes, the white border of the print; no writing',
     ['face:zoya'], note='Экран Зои Павловны (этика §4.2): кто она была, без подробностей смерти; смотрят друг на друга, не в объектив.')
shot('bio_pyotr', 'hod_bio', 'insert', 'photo', 'a working day, about 1975', 'Indoors, a factory workshop.',
     {'pyotr': 'stands at his lathe, measuring a freshly turned steel part with a caliper, absorbed in the work, not looking at the camera'},
     'A black-and-white factory photograph from about 1975, slightly faded, with a narrow white border, filling the frame: the man at his lathe in a big workshop, other machines soft behind him.',
     'daylight from the tall factory windows in the photograph', 'the lathe, the caliper, the steel part; no writing',
     [], note='Пётр Ильич — только на этом фото; одна деталь жизни: токарь.')
shot('gromov_2004', 'hod_2004', 'medium', 'office2004', 'an overcast day, 2004', 'Indoors; a grey city outside the blinds.',
     {'sledak_old': 'sits in the leather office chair, turned three-quarter to the RIGHT, talking to an unseen interviewer off-camera on the right, his eyes on the interviewer, not on the lens; quiet, tired, restrained'},
     'A television interview frame: the camera at seated eye level, a 50 mm-equivalent field of view, a medium shot from the chest up, his face in the upper half of the frame; the lower third is kept free (a name caption is overlaid there).',
     'soft grey daylight through the vertical blinds and a warm desk lamp', 'the blinds, the CRT monitor, the bookcase',
     ['face:sledak_old'], note='«Говорящая голова» 2004 года; одна реплика в финале.')
RED_FIGURE = '''THE DECEASED: one adult lying in the grass is shown ONLY as an opaque, coarse-pixelated red silhouette — the television documentary convention. The red silhouette occupies the correct projected footprint of a realistically proportioned adult lying diagonally on the ground at this distance, judged against the birch trunks, the spades and the tape at the same depth; believable foreshortening; the broad relationship of head, torso, arms and legs is readable only through the overall shape. No face, hair, skin, clothing, shoes or fingers anywhere inside or outside the red shape; it is an opaque matte brick-red fill, not a red tint over a person; only two or three neighbouring red tones; no highlights, no internal shadows, no blood, no stains, no glow. The red shape is built from large hard-edged square blocks on one screen-space grid, about 20–30 blocks from head to foot, with pronounced square steps along the whole outline; nothing else in the frame is pixelated. Not a small floor marker, not a giant shape, not a puddle, not a rectangular censorship box.'''
shot('field_find', 'hod_field', 'insert', 'field', FIELD_AM, SUMMER,
     {},
     'No living people in the frame. The camera stands at the tape by the road at the eye level of a standing person, a 40 mm-equivalent field of view, looking over the tape into the tall grass between the birches: the red-and-white tape across the frame in the foreground, the two spades leaning on a birch, the field and the mist beyond.',
     'low morning sun through the birch trunks, long shadows, mist, dew; daylight stays visibly present', 'the tape, the birches, the two spades, the tall grass',
     ['place:field_wide'], extra=RED_FIGURE,
     note='Находка (решение владельца 2026-10-14): тело — красная пиксельная замена, как в передаче; модель рисует только замену.')
shot('agency_closed', 'hod_agency_closed', 'wide', 'presnya_street', FRIDAY, SUMMER,
     {'sledak': 'stands at the closed door of the agency RIGHT of centre, seen from the side, looking at a handwritten paper sign taped to the glass'},
     'The camera stands on the same side of the road a few steps away, at the eye level of a standing person, a 32 mm-equivalent field of view: the entrance of the building, the dark windows of the agency on the second floor, the empty kerb with no car; the lower third of the frame is kept free of faces.',
     'bright late-morning sun on the facade', 'the closed door with the paper sign (unreadable), the dark windows, the empty kerb, the lime trees',
     ['place:agency_street_wide', 'face:sledak'], note='Ветка без санкции: агентство закрыто, «Волги» нет.')

WAVES_D345 = [  # первая волна — без ссылок на новые кадры; вторая — через плечо и вставки по принятым общим планам
    ['walk_wide', 'second_wide', 'chertanovo_wide', 'agency_street_wide', 'agency_wide', 'watch_wide', 'search_wide',
     'field_wide', 'interrog_wide', 'court_wide', 'bio_zoya', 'bio_pyotr', 'gromov_2004', 'op_wounded', 'op_stairs', 'op_metro'],
    ['second_ots_klava', 'agency_ots_murashov', 'op_wide', 'search_keys', 'search_papers', 'field_ots_expert', 'field_oper',
     'interrog_ots_murashov', 'confront_wide', 'agency_closed'],
]

WAVES = [
    ['office_am_wide', 'flat_wide', 'landing_chain_wide', 'notary_wide', 'zhek_wide', 'bti_wide', 'car_wide'],
    ['office_am_ots_oper', 'office_am_phone', 'office_eve_wide', 'office_d2_wide', 'office_night_wide', 'flat_ots_buyer',
     'flat_ots_wife', 'flat_photo', 'landing_chain_ots', 'landing_open_wide', 'notary_ots_notary', 'notary_register',
     'stairs_wide', 'zhek_ots_clerk', 'bti_ots_clerk', 'car_ots_oper', 'recon_wide'],
    ['office_eve_ots_expert', 'office_eve_lens', 'office_eve_phone', 'office_d2_ots_boss', 'office_night_ots_expert',
     'landing_open_ots', 'stairs_ots_assistant', 'recon_ots_zoya'],
    ['flat_inspect'],
]

CONTINUITY = """CONTINUITY AND INTEGRITY (mandatory)
- Each person is exactly the referenced character: same face, age, hair and build. The clothes in the face references
  belong to another season: ignore them and dress each person exactly as written below.
- When Reference 1 is an earlier frame of this scene, it is the same scene from another camera position: the same room,
  the same people in the same clothes, the same props and light; only the camera and what is written below changed.
- People are never swapped; every person appears once; the left-to-right order is exactly as written.
- Anatomy and props are coherent even in the soft television image: five fingers on each hand, hands grip objects
  naturally, two eyes looking in one direction; every object appears once; nothing floats, melts or merges.
- Each person looks exactly where the scene says: at another person or an object in the room, never into the lens.
- Any writing on papers, stamps, signs or calendars is out of focus or too small to read; no invented letters.
- Period accuracy, Moscow 1993: no modern phones, cars, LED lights or plastic windows."""


def ref_text(refs: list[str]) -> tuple[str, list[str]]:
    lines, medias = [], []
    for n, r in enumerate(refs, 1):
        kind, val = r.split(':', 1)
        if kind == 'room':
            lines.append(f'Reference {n} shows the layout of the room: keep the furniture, the window and the door where they '
                         f'are. It was photographed on a grey winter-looking day; the scene below happens in its own season and '
                         f'light, so change the weather outside, the light and the clothes on the hooks as the scene says.')
            medias.append(f'file:{val}')
        elif kind == 'shot':
            lines.append(f'Reference {n} is an earlier frame of this same scene: the same room, the same people in the same '
                         f'clothes, the same props and light; where the camera stands and where people are now is written below.')
            medias.append(f'file:{OUT}/out/{val}.png')
        elif kind == 'place':
            lines.append(f'Reference {n} is a frame of the same room at another moment: keep the room, its furniture, window '
                         f'and door exactly; the people, their clothes, the light and the time of day are as written below.')
            medias.append(f'file:{OUT}/out/{val}.png')
        elif kind == 'person':
            src, who = val.split(':')
            lines.append(f'Reference {n} is an earlier frame in which {NAMES[who]} appears: keep her exact face, hair, build '
                         f'and clothes; ignore the rest of that frame.')
            medias.append(f'file:{OUT}/out/{src}.png')
        else:
            look = LOOKS.get(val) or NEW_LOOKS.get(val, '')
            lines.append(f'Reference {n} is {NAMES[val]} ({look}): keep this exact face, hair and build; ignore the clothes, '
                         f'the background, the head pose and the direction of the gaze of the reference.')
            medias.append(f'file:{FACES}/{val}.webp')
    return '\n'.join(lines), medias


def people_text(p: dict, costume: dict) -> str:
    out = []
    for who, act in p.items():
        look = f' ({NEW_LOOKS[who]})' if who in NEW_LOOKS else ''
        out.append(f'{NAMES[who]}{look}, wearing {costume.get(who, COSTUME[who])}: {act}.')
    return ' '.join(out)


plan, sheet = [], ['# Черновые кадры «Хода следствия» (дни 1–5): листы мизансцен', '',
                   'Сгенерировано `tools/hod/shots.py`. Проверка каждого кадра: кто где стоит, куда смотрит, что держит, '
                   'одежда по сезону (лето 1993-го), время суток и свет, одинаковость предметов в кадрах одной сцены.', '']
for s in S:
    refs, medias = ref_text(s['refs'])
    scene = '\n'.join([
        'SCENE', '',
        f"Location and time: Moscow, {s['time']}. {LOC[s['loc']]}",
        f"Season: {s['season']}",
        f"People and action: {people_text(s['people'], s['costume']) or 'nobody in the frame.'}",
        f"Camera position: {s['camera']}",
        f"Light sources: {s['light']}.",
        f"Essential objects: {s['objects']}; nothing added that is not described.",
        *([s['extra']] if s.get('extra') else []),
    ])
    prompt = f"{BASE}\n\nREFERENCE IMAGES\n{refs}\n\n{CONTINUITY}\n\n{scene}"
    plan.append({'id': s['id'], 'set': s['set'], 'kind': s['kind'], 'cast': list(s['people']), 'prompt': prompt,
                 'medias': medias, 'api_size': s['size']})
    sheet += [f"## `{s['id']}` — {s['kind']}, сет `{s['set']}`", '',
              f"- Время: {s['time']}. Место: {s['loc']}.",
              *[f"- {NAMES[w]}: {a}." for w, a in s['people'].items()],
              f"- Камера: {s['camera']}", f"- Свет: {s['light']}.", f"- Предметы: {s['objects']}.",
              *([f"- Пометка: {s['note']}"] if s['note'] else []),
              f"- Референсы: {', '.join(s['refs'])}", '']

# Бланк заявления Галины: пустой лист в линейку, текст накладывает игра.
plan.append({'id': 'doc_statement', 'set': '', 'kind': 'doc', 'cast': [], 'api_size': '1152x1536', 'medias': [], 'prompt': (
    'A flat, evenly lit top-down scan of a single sheet of lined school exercise-book paper, Moscow 1993, filling the frame '
    'edge to edge, portrait 3:4: thin pale-blue rules, a pale red margin line, slightly yellowed cheap paper, one soft fold '
    'across the middle, a steel paperclip at the top left corner, a small pale violet rectangular incoming-mail stamp of a '
    'prosecutor\'s office near the top right corner — text only, no emblem, no coat of arms, no eagle — with a '
    'handwritten incoming number, both soft and unreadable. The '
    'lines are EMPTY: the game overlays the handwritten statement on top of this image. No hands, no desk, no other '
    'objects, no readable words, no invented letters.')})

os.makedirs(os.path.join(ROOT, OUT, 'out'), exist_ok=True)
json.dump(plan, open(os.path.join(ROOT, OUT, 'plan.json'), 'w'), ensure_ascii=False, indent=1)
open(os.path.join(ROOT, 'docs/production/prompts/ep01-hod-shots.md'), 'w', encoding='utf-8').write('\n'.join(sheet) + '\n')
print(f'plan: {len(plan)} кадров; волны: {[len(w) for w in WAVES]} + doc_statement; дни 3–5: {[len(w) for w in WAVES_D345]}')
