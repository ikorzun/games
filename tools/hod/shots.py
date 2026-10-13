"""shots.py: листы мизансцен «Хода следствия» (дни 1–2) → план генерации и лист для проверки.

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
}
NEW_LOOKS = {  # новые лица без портрета: описание достаточно точное, дальше лицо держит принятый общий план
    'assistant': 'woman, 23, slim, a pale oval face with light freckles, light-brown hair in a low ponytail, thin plucked eyebrows, nervous grey eyes',
    'passport_clerk': 'woman, 52, plump, a round face, a tight perm of reddish-dyed hair, coral lipstick, heavy reading glasses on a cord',
    'murashov_sil': 'a neat man of about 38 seen only from behind: medium height, narrow shoulders, short tidy dark hair with a straight parting',
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


def shot(id, set, kind, loc, time, season, people, camera, light, objects, refs, size='1536x864', note=''):
    S.append(dict(id=id, set=set, kind=kind, loc=loc, time=time, season=season, people=people, camera=camera,
                  light=light, objects=objects, refs=refs, size=size, note=note))


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


def people_text(p: dict) -> str:
    out = []
    for who, act in p.items():
        look = f' ({NEW_LOOKS[who]})' if who in NEW_LOOKS else ''
        out.append(f'{NAMES[who]}{look}, wearing {COSTUME[who]}: {act}.')
    return ' '.join(out)


plan, sheet = [], ['# Черновые кадры «Хода следствия» (дни 1–2): листы мизансцен', '',
                   'Сгенерировано `tools/hod/shots.py`. Проверка каждого кадра: кто где стоит, куда смотрит, что держит, '
                   'одежда по сезону (лето 1993-го), время суток и свет, одинаковость предметов в кадрах одной сцены.', '']
for s in S:
    refs, medias = ref_text(s['refs'])
    scene = '\n'.join([
        'SCENE', '',
        f"Location and time: Moscow, {s['time']}. {LOC[s['loc']]}",
        f"Season: {s['season']}",
        f"People and action: {people_text(s['people'])}",
        f"Camera position: {s['camera']}",
        f"Light sources: {s['light']}.",
        f"Essential objects: {s['objects']}; nothing added that is not described.",
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
print(f'plan: {len(plan)} кадров; волны: {[len(w) for w in WAVES]} + doc_statement')
