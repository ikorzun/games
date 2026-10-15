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
AGENCY_STREET = (
    'THE PLACE — a quiet old street on Presnya, Moscow, August 1993: across the road a two-storey yellow plastered building '
    'of a former newspaper office with tall windows; over its double wooden entrance door with three steps hangs a long blue '
    'enamel sign with a white stylised house and white capital letters «АГЕНТСТВО НЕДВИЖИМОСТИ» — clearly readable; lime '
    'trees along the pavement; a grey GAZ-24 Volga with round headlights and a chrome grille of vertical bars stands by the '
    'entrance.')
AGENCY = (
    "THE ROOM — Murashov's office inside the agency, the same room in every frame of this set: a big polished desk with ONE "
    'cream-coloured rotary telephone, a crystal carafe and two glasses, a desk fan; behind the desk a window with white '
    'venetian blinds and a view of old Presnya roofs and a distant Stalinist high-rise; on the left wall shelves of '
    'labelled ring binders; on the wall a framed old newspaper front page, its headline too small to read; a leather office '
    'chair. There is only ONE telephone in the room.')
OP = ('THE PLACE — the same street on Presnya at night, 23:40: the yellow building of the agency in darkness, only one window '
      'lit on the first floor; the blue sign «АГЕНТСТВО НЕДВИЖИМОСТИ» over the entrance dim but readable under a streetlight; '
      'the grey GAZ-24 Volga by the entrance; wet asphalt after rain reflecting the streetlight.')
COURT = (
    "THE ROOM — a courtroom of the Moscow City Court, 1994: on the left the defendants' cage of thin vertical steel bars set "
    'close together — the gaps only about a hand\'s width, far too narrow for a head — continuous from the floor rail to the '
    'top rail; inside it Murashov in a dark grey suit stands a full step back from the bars, his whole body and head behind '
    'them; two militiamen in uniform stand OUTSIDE the cage; at the far wall the judges\' bench under the Russian coat of arms '
    'and flag: the presiding judge in a black robe reads the verdict from a sheet, flanked by two people\'s assessors in dark '
    'civilian clothes — a grey-haired man and a middle-aged woman, neither resembling the defendant; in the foreground the '
    'backs of the public on wooden benches.')
FIELD = (
    'THE PLACE — a strip of birch trees between a mown field and a dirt country road near Aprelevka, outside Moscow, 7:20 in '
    'the morning in August 1993: mist over the field, low sun through the birch trunks, dew on the tall grass. A red-and-white '
    'striped tape is stretched between the birch trunks. BEYOND the tape is an excavation: trenches of dark freshly turned '
    'earth along the tree line, with six small wooden stakes, each with a numbered white tag (1 to 6); militiamen in grey-blue '
    'uniform shirts dig with spades. A blue-and-white militia UAZ van stands on the dirt road OUTSIDE the tape.')
CAR = ("THE CAR — Sayko's own old Zhiguli (VAZ-2106): worn grey seat covers, a cracked dashboard, a small icon and a pine "
       'air freshener hanging from the rear-view mirror; Sayko drives on the left, Gromov sits in the passenger seat on the '
       'right.')
ROOMS.update({s_: AGENCY_STREET for s_ in ('hod_agency_street', 'hod_agency_closed', 'hod_watch')})
ROOMS.update({s_: AGENCY for s_ in ('hod_agency', 'hod_search')})
ROOMS.update({'hod_op': OP, 'hod_court': COURT, 'hod_field': FIELD})
ROOMS.update({s_: CAR for s_ in ('hod_car', 'hod_car_d2', 'hod_car_d3')})
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
    'notary_alone_wide': ('The same office as image 1, the next day; the camera is in the same place as in image 1. Lyuda is '
                          'not here: her small typing desk by the window is abandoned — the typewriter stands OPEN with a '
                          "sheet of paper still sticking out of the roller, her chair pushed back askew, nobody at it. "
                          "Kovrigin's grey jacket hangs on the coat rack. The visitor's chair is an ordinary bentwood chair at "
                          'true human scale. In the corridor beyond the open door a queue still sits on the bench. Nobody '
                          'looks at the camera.'),
    # Реестр — сверху, строки строго горизонтальны: под углом модель сдвигала колонки на строку (запись 1187 попадала
    # к «договору дарения»). Кадр снят отдельным промптом с прежним кадром как образцом стола и руки.
    'notary_register': (
        'The camera looks STRAIGHT DOWN at the open register from above; the ruled lines run perfectly horizontal. The '
        'page is ruled into four columns — «№», «Дата», «Кто обратился», «Что удостоверено», headers on the top line — '
        'and below it exactly five entry rows, each ONE ruled line with its four cells aligned straight across, in neat '
        'legible Russian handwriting: «1184 | 10.06.93 | Орлов В. Н. | доверенность на гараж»; «1185 | 11.06.93 | '
        'Петрова А. И. | копия диплома»; «1186 | 11.06.93 | Белов С. С. | договор дарения»; «1187 | 14.06.93 | С. З. П. | '
        'доверенность на продажу кв. Мурашову С. В.»; «1188 | 15.06.93 | Гусев А. А. | согласие на выезд». Row 1187 is '
        "entirely in brighter, fresher blue ink; the rest in faded violet. Kovrigin's plump hand with a gold signet ring "
        'rests on the desk at the top edge: one hand, five fingers.'),
    'zhek_ots_clerk': ('The clerk sits inside the service window facing the camera: her right hand lies on the open house '
                       'register with the index finger tracing one line, her left hand holds the edge of the register; both '
                       'hands anatomically correct, five fingers each, nothing else in her hands.'),
    'recon_wide': ('Zoya Pavlovna holds the cardboard folder to her chest with BOTH hands, fingers natural. The polite man '
                   '(back to the camera) points at the folder with ONE hand — his right index finger — and holds his '
                   'briefcase by the handle in his other hand. Exactly two hands each, every hand belongs to its person.'),
})

FIX.update({
    'agency_street_wide': 'The sign over the entrance reads exactly «АГЕНТСТВО НЕДВИЖИМОСТИ», white letters on blue, readable.',
    'agency_closed': ('The sign over the entrance reads exactly «АГЕНТСТВО НЕДВИЖИМОСТИ». On the glass of the entrance door a '
                      'sheet of paper with the handwritten word «РЕМОНТ». No Volga by the entrance.'),
    'watch_wide': ('Through the windscreen, across the road: the agency entrance with the blue sign «АГЕНТСТВО НЕДВИЖИМОСТИ» and '
                   'the grey GAZ-24 Volga (round headlights, chrome grille of vertical bars), its driver in a navy tracksuit '
                   'leaning on the wing. Sayko\'s steel watch on his LEFT wrist; Gromov\'s watch on his LEFT wrist.'),
    'agency_wide': 'Exactly ONE cream rotary telephone on the desk — no other telephones anywhere.',
    'agency_ots_murashov': ('Exactly ONE cream rotary telephone on the desk — no other telephones anywhere. The framed newspaper '
                            'on the wall has a headline too small to read.'),
    'op_wide': 'The sign over the entrance reads «АГЕНТСТВО НЕДВИЖИМОСТИ», dim under the streetlight; one window lit.',
    'search_wide': (
        "Thursday night, the search, in Murashov's office — the same room: the window with white venetian blinds, the shelves "
        'of ring binders, the big desk with ONE cream telephone, the framed newspaper. Dawn light through the blinds, the '
        'ceiling lamp on. Gromov stands at the desk pulling open a drawer; at the open door stand two attesting witnesses — an '
        'elderly man and an elderly woman in light summer clothes — and a young militia sergeant.'),
    'search_keys': (
        "Close insert at Murashov's desk: Gromov's LEFT hand, with his wristwatch on that wrist, lifts a ring of keys with "
        'small paper tags out of an open desk drawer; in the drawer, old Soviet passports in red covers and a worn handbag. '
        'The fingers hold only the key ring; nothing is wrapped around the fingers.'),
    'search_papers': ("Gromov stands at Murashov's desk turning the pages of an open folder of documents; behind him the "
                      'window with venetian blinds and the shelves of ring binders; ONE cream telephone on the desk.'),
    'court_wide': ('Murashov stands a full step back inside the cage, every bar in front of him; his head never passes '
                   'between the bars. Exactly three people sit at the judges\' bench.'),
    'field_wide': ('Gromov stands in the RIGHT foreground OUTSIDE the tape by the militia UAZ, seen from the side, hands in his '
                   'pockets, watching. Levina, in rubber boots and a light raincoat with a notebook, walks among the trenches '
                   'beyond the tape, left of centre. Three militiamen dig.'),
    'field_ots_expert': ('Levina stands just inside the tape facing the camera, her notebook against her chest; behind her the '
                         'trenches of turned earth with the numbered stakes and the militiamen with spades.'),
    'field_oper': ('Sayko leans on the bonnet of the militia UAZ OUTSIDE the tape, smoking ONE cigarette, unsmiling, looking '
                   'toward the dig; his steel watch on his LEFT wrist; behind him the tape, the trenches and the numbered stakes.'),
    'chertanovo_wide': ('The window at the end of the landing is an old wooden double frame painted white, with a small '
                        'ventilation pane — not a plastic window.'),
    'bio_zoya': ('A black-and-white amateur family photograph from about 1985, slightly faded, with a narrow white border, '
                 'filling the frame: Zoya Pavlovna at about sixty-six — the woman of the identity photo, but eight years '
                 'younger: a fuller face with fewer wrinkles, grey hair in a neat bun, no headscarf, a lively look — '
                 'in a light summer dress and a cardigan sits on a courtyard bench with her arm around her grandson, a boy of '
                 'about twelve, laughing at something he says; they look at each other, not at the camera; lilac bushes and a '
                 'panel block behind. Exactly two people, each with two hands. No writing.'),
    'bio_pyotr': ('A black-and-white factory photograph from about 1975, slightly faded, with a narrow white border, filling '
                  'the frame: Pyotr Ilyich, a lean man of about sixty in a work smock and a cap, stands at his lathe measuring '
                  'a freshly turned steel part with a caliper, absorbed in the work, not looking at the camera; exactly two '
                  'hands — one holds the caliper, the other the part; nobody else; other machines soft behind. No writing.'),
    'field_find': (
        'The same morning and the same camera as the wide frame of image 1, but nobody stands in the foreground: beyond the '
        'red-and-white tape, inside the trench of turned earth by the numbered stake «3», one deceased adult lies diagonally — '
        'represented ENTIRELY by an opaque, coarse-pixelated deep brick-red silhouette of square blocks, with no face, hair, '
        'skin, clothing or any detail visible inside or around it; the red fill is flat, matte, not transparent, not a tint, '
        'and of true adult size for that distance. The militiamen stand still by the trench, spades lowered, backs half-turned '
        'to the camera. Levina stands by the stake with her notebook, looking down. Non-graphic; nothing else is red except '
        'the tape.'),
    'op_wounded': ('Sayko sits on the wet asphalt against the rear wheel of the grey Volga under the streetlight; his LEFT hand '
                   'presses his RIGHT shoulder, a dark patch on the sleeve under his fingers; a crooked grin. Gromov crouches '
                   'beside him, seen in profile, his hand on Sayko\'s unhurt LEFT shoulder; Gromov\'s watch on his LEFT wrist. '
                   'Non-graphic: no blood pooling, no open wound.'),
    'op_metro': ("The grey Volga is a GAZ-24 with round headlights and a chrome grille of vertical bars, the same car as by the "
                 "agency. The young sergeant's cap badge is the Soviet-style militia cockade (a red star in a golden wreath), "
                 'not an eagle. Shmel has exactly two hands, both behind his back at the small of his back, wrists crossed.'),
    'op_stairs': ('Murashov stands on the steps above holding out both empty hands, wrists together, palms up; Gromov below '
                  'holds open handcuffs in his RIGHT hand, his watch on his LEFT wrist. Night: through the open entrance door '
                  'only darkness and a distant streetlight.'),
})
# Пересъёмка с новой мизансценой: картинка 1 — только место, люди и свет; камера и расстановка — по FIX.
RESTAGE = {'notary_alone_wide', 'search_wide', 'search_keys', 'search_papers', 'field_wide', 'field_ots_expert', 'field_oper', 'field_find', 'bio_zoya'}

# Кто в кадре, если людей нет в CHARS / STAGING (фото на экранах биографий): описано в FIX.
WHO = {'bio_zoya': 'WHO IS WHERE: as described in the FIX below.', 'bio_pyotr': 'WHO IS WHERE: as described in the FIX below.'}

# Предметы-образцы (картинка после лиц): что именно нарисовать.
GRANDSON = (os.path.join(HQ, 'props', 'prop_grandson_photo.png'),
            'the framed colour snapshot of the grandson that stands behind the glass of the sideboard — wherever it is '
            'visible, draw exactly this photograph in a thin frame')
PROPS = {sid: [GRANDSON] for sid in ('flat_wide', 'flat_ots_buyer', 'flat_ots_wife', 'flat_photo')}
PROPS['epi_grandson'] = [(GRANDSON[0], 'the snapshot of the grandson: the young man in the frame is this same person, a year '
                                        'older — the same face, hair and build')]

# Новые кадры: сет, кто в кадре (STAGING) и чей кадр — образец места (картинка 1); fix — что в кадре.
NEW = {
    'office_am_lens': {'set': 'hod_office_lens_am', 'from': 'office_eve_lens',
                       'staging': {'expert': 'bends over the two papers with the magnifying glass and the pencil; her eyes on the paper',
                                   'sledak': 'leans in from the left on his forearms; his eyes on the same spot'}},
    # машина по дням (владелец 2026-10-14: «разные дни — одни и те же положения героев выглядят уныло») и вид из окна
    'car_view': {'set': 'hod_car', 'from': 'car_wide', 'staging': {}, 'fix': (
        "A view out of Sayko's moving Zhiguli on a sunny Monday morning in August 1993, from the passenger seat: through the "
        'windscreen and the open side window a wide Moscow avenue, a blue-and-white trolleybus, Soviet high-rise blocks, '
        'lime trees in full leaf; the dashboard edge and the windscreen pillar frame the bottom and the left; nobody in the '
        'frame.')},
    'car_d2_wide': {'set': 'hod_car_d2', 'from': 'car_wide', 'staging': {
        'oper': 'drives on the LEFT with one hand on the wheel, a cigarette in his other hand by the open driver\'s window, '
                'talking; his eyes on the road',
        'sledak': 'sits in the passenger seat on the RIGHT, the folder closed on his knees, looking out of his side window, '
                  'thoughtful'}, 'fix': (
        'Tuesday, early afternoon, overcast and grey; the same car and the same camera as image 1 (from the back seat between '
        'the front seats), but a different moment: Sayko smokes one cigarette by his open window, Gromov looks out of his '
        'window. Outside: an old street of Presnya with pre-revolutionary brick houses and a tram.')},
    'car_d2_ots_oper': {'set': 'hod_car_d2', 'from': 'car_ots_oper', 'staging': {
        'oper': 'drives in three-quarter view, one hand on the wheel, the other holding a cigarette by the open window, talking '
                'drily; his eyes on Gromov, just right of the camera',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'}, 'fix': (
        'Tuesday, overcast grey daylight; through the windows the old streets of Presnya. One cigarette in Sayko\'s hand.')},
    'car_d2_view': {'set': 'hod_car_d2', 'from': 'car_wide', 'staging': {}, 'fix': (
        "A view out of the passenger window of Sayko's moving Zhiguli on an overcast Tuesday afternoon in August 1993: an old "
        'street of Presnya — pre-revolutionary brick houses, a red-and-yellow tram, a kiosk, people with umbrellas folded; '
        'the door frame and the side mirror at the edge; nobody in the car in the frame.')},
    'car_d3_wide': {'set': 'hod_car_d3', 'from': 'car_wide', 'staging': {
        'oper': 'drives on the LEFT with both hands on the wheel, serious, silent; his eyes on the road',
        'sledak': 'sits in the passenger seat on the RIGHT holding a typed list of addresses on his knees, reading it'}, 'fix': (
        'Wednesday, late afternoon, low warm sun across the dashboard; the same car and camera as image 1 but a tense, silent '
        'moment: Sayko holds the wheel with both hands, Gromov reads a typed list. Outside: a wide highway with Soviet '
        'apartment blocks in low sun.')},
    'car_d3_ots_oper': {'set': 'hod_car_d3', 'from': 'car_ots_oper', 'staging': {
        'oper': 'drives, both hands on the wheel, unsmiling; his face in three-quarter view toward the camera, fully visible, '
                'his eyes on the road ahead',
        'sledak': 'only the back of his head and his shoulder at the RIGHT edge'}, 'fix': (
        'The camera is exactly where it is in image 1: in the passenger seat just behind Gromov\'s right shoulder, looking '
        'across the cabin at the driver, as in the Monday and Tuesday frames of this conversation — NOT from the back seat '
        '(аудит владельца 2026-10-15: на прежнем кадре Сайко был виден со спины). Sayko\'s face is seen in three-quarter '
        'view, never his back or the back of his head. Image 4 only gives the Wednesday light, the icon and the air freshener. '
        'Wednesday, late afternoon, low warm sun; through his side window and the windscreen the Khoroshevskoye highway and '
        'long apartment blocks.')},
    'notary_alone_ots': {'set': 'hod_notary_alone', 'from': 'notary_ots_notary', 'staging': memory.STAGING['notary_alone_ots'], 'fix': (
        "The camera exactly as in image 1 — over Gromov's shoulder at the RIGHT edge on Kovrigin behind his desk — but Gromov "
        'now sits on the visitor\'s chair, so the camera is at the eye level of a seated person. Kovrigin is in a white shirt '
        'with rolled-up sleeves and a loosened tie, no jacket, both hands clasped on the open register, tense and unsmiling. '
        'On the LEFT by the window the abandoned typing desk: the typewriter OPEN with a sheet of paper sticking out of it, '
        'nobody at it. Nobody looks at the camera.')},
    'car_d3_view': {'set': 'hod_car_d3', 'from': 'car_wide', 'staging': {}, 'fix': (
        "A view through the windscreen of Sayko's moving Zhiguli on a Wednesday evening in August 1993: the Khoroshevskoye "
        'highway, a few Soviet cars and a bus, a very long apartment block in low warm sun, poplars; the dashboard edge at the '
        'bottom; nobody in the frame.')},
    # как Сайко получил пулю (владелец 2026-10-14: «не понятно как Сайко получил пулю, а это важные кадры»)
    'op_draw': {'set': 'hod_op', 'from': 'op_wide', 'staging': {}, 'fix': (
        'From the dark pavement a few steps from the agency, at eye level: under the streetlight by the grey GAZ-24 Volga the '
        'driver — a big man in a navy tracksuit top — has turned toward the camera and his right hand is going into the heavy '
        'right pocket of the tracksuit top; his face is in deep shadow, unreadable, lit only from behind by the streetlight. '
        'The lit window above the entrance. No weapon visible yet.')},
    'op_shot': {'set': 'hod_op', 'from': 'op_wide', 'staging': {
        'oper': 'in the foreground, seen three-quarter from behind, lurches as if hit in his RIGHT shoulder, his left hand '
                'flying to it'}, 'fix': (
        'The next instant, the same place: Sayko in the foreground, seen three-quarter from behind, lurches as if hit in the '
        'right shoulder. A few metres ahead by the Volga the driver is a dark faceless silhouette against the streetlight '
        'with a short bright muzzle flash at his outstretched hand. Non-graphic: no blood, no wound visible, no gun detail.')},
}
# Эпилог, Москва 1994–1997 (владелец 2026-10-14: «последние сцены с историей очень скучно, нужно иначе с разными
# сценами»): свой кадр на каждую группу реплик развязки. Зима — своя одежда (clothes), люди — свободным текстом (who).
WINTER = 'Winter 1994, grey snowy daylight, people in winter clothes; '
NEW.update({
    'epi_grandson': {'set': 'hod_epilogue', 'from': 'flat_wide', 'staging': {}, 'who': (
        'WHO IS WHERE: the grandson — a slim young man of about twenty-one, exactly the person of the reference snapshot, '
        'in a dark winter coat and a knitted scarf — stands in the middle of the emptied room by the window, holding a ring '
        'of keys in one hand and looking down at the small framed snapshot in his other hand. In the doorway a middle-aged '
        'woman from the housing office in a fur hat and a winter coat holds an open folder.'), 'fix': (
        WINTER + 'the same room as image 1 but emptied after the court: the sideboard stands empty, no crockery, the rug '
        'is gone from the wall, no ladder, no bucket, no bed; outside the window snow on the trees and roofs.')},
    'epi_lapins': {'set': 'hod_epilogue', 'from': None, 'was': 'flat_ots_wife', 'staging': {
        'lapin_wife': 'sits at a small kitchen table holding a printed court summons in both hands, reading it, worried',
        'buyer': 'sits beside her, his elbows on the table, rubbing his forehead with one hand'},
        'fix': WINTER + 'evening in a small Soviet kitchen with a lamp over the table, frost on the window, a teapot.'},
    'epi_galina_home': {'set': 'hod_epilogue', 'from': None, 'was': 'landing_open_ots', 'staging': {
        'neighbor': 'stands at the window of her small kitchen holding a cup of tea, looking out at the snowy yard, thoughtful'},
        'fix': WINTER + 'her small kitchen: a net curtain, a radiator, plants on the sill, snow and the yard outside.'},
    'epi_galina_station': {'set': 'hod_epilogue', 'from': None, 'was': 'landing_open_ots', 'staging': {
        'neighbor': 'stands on a snowy railway platform beside a green long-distance train carriage, a suitcase and a string '
                    'bag at her feet, looking back over her shoulder'},
        'fix': (WINTER + 'the Kursky railway station platform in Moscow: a green Soviet passenger carriage with a white route '
                'board reading exactly «МОСКВА — ТУЛА», steam from the train, a few passengers with bags.')},
    'epi_lyuda': {'set': 'hod_epilogue', 'from': None, 'was': 'stairs_ots_assistant', 'staging': {
        'assistant': 'walks down the snowy steps of a university building hugging a stack of textbooks to her chest, smiling '
                     'slightly'},
        'fix': (WINTER + 'the steps of the law faculty building of Moscow University on Vorobyovy Gory, other students in '
                'winter coats around; no signs or lettering.')},
    'epi_klava': {'set': 'hod_epilogue', 'from': None, 'was': 'second_ots_klava', 'staging': {
        'klava': 'sits alone on a wooden bench in a court corridor, a handbag on her knees, waiting, her face set'},
        'fix': (WINTER + 'a corridor of the Moscow City Court: tall doors, a wooden bench along a pale green wall, a tall '
                'window with snow outside.')},
    'epi_sayko': {'set': 'hod_epilogue', 'from': None, 'was': 'field_oper', 'staging': {
        'oper': 'stands at the entrance of the district militia department, lighting a cigarette with his left hand, his '
                'right hand in his coat pocket, his breath steaming'},
        'fix': (WINTER + 'the porch of a two-storey district militia department building, a blue sign over the door too '
                'far to read, a militia car parked in the snow.')},
    'epi_boss': {'set': 'hod_epilogue', 'from': None, 'was': 'office_d2_wide', 'staging': {
        'boss': 'stands at the head of a long office table holding a bouquet of red carnations and a cut-glass vase, an '
                'awkward half-smile, listening to a toast',
        'expert': 'stands among the colleagues at the table raising a glass, a dry smile'},
        'fix': (WINTER + 'a farewell party in the investigation department in the evening: a table with a cake, sandwiches '
                'and glasses, five or six colleagues in suits and cardigans raising glasses; snow outside the window.')},
    'epi_gromov': {'set': 'hod_epilogue', 'from': 'office_am_wide', 'staging': {
        'sledak': 'sits alone behind his desk writing in a new folder, a fresh stack of case folders at his elbow, tired '
                  'and calm'},
        'fix': (WINTER + 'the same office as image 1 in winter: snow on the windowsill outside and on the trees, the green '
                'lamp on, a glass of tea; nobody else in the room.')},
    'epi_field_spring': {'set': 'hod_epilogue', 'from': 'field_wide', 'staging': {}, 'who': (
        'WHO IS WHERE: three militiamen in grey-blue uniform and caps dig with spades beyond the tape; nobody in the '
        'foreground.'), 'fix': (
        'Spring 1994: the same birch strip as image 1 in early April — patches of melting snow on the brown grass, bare '
        'birches with the first green haze, a grey sky; the red-and-white tape between the trunks; beyond it militiamen '
        'dig; a militia UAZ on the muddy road. No bodies.')},
    # колония — в сете суда: в fin_court на реплике о замене приговора (кадр того же места, что суд)
    'epi_prison': {'set': 'hod_court', 'from': None, 'was': 'court_wide', 'staging': {}, 'who': 'There are no people in this frame.',
                   'fix': ('Winter: a high grey concrete wall of a remote prison colony with barbed wire and a watchtower, '
                           'snow on the ground and on the wall top, a dark iron gate, a bare tree; a grey sky; no people, no '
                           'lettering.')},
    # для реплик без своего кадра: Галина уехала летом; помощница не вернулась и журнал решений про Ковригина; операция
    'epi_galina_summer': {'set': 'hod_epilogue', 'from': None, 'was': 'landing_open_ots', 'staging': {
        'neighbor': 'stands on a sunny railway platform beside a green long-distance train carriage, a suitcase and a string '
                    'bag at her feet, looking back over her shoulder'},
        'fix': ('August 1993, a hot sunny morning: the Kursky railway station platform in Moscow, a green Soviet passenger '
                'carriage with a white route board reading exactly «МОСКВА — ТУЛА», passengers in summer clothes with bags, '
                'lime trees beyond the platform.')},
    'epi_notary_closed': {'set': 'hod_epilogue', 'from': 'notary_wide', 'staging': {}, 'who': 'There are no people in this frame.',
                          'fix': (WINTER + 'the same notary office as image 1, closed and empty: the typewriter on the small '
                                  'desk by the window under a grey cover, the big desk bare — no register, no papers, the '
                                  'chair pushed in; a paper seal strip with a round violet stamp across the doors of the '
                                  'glass bookcase; the door to the corridor shut; snow outside the window; dusty winter '
                                  'light. No people.')},
    'epi_agency_winter': {'set': 'hod_epilogue', 'from': 'agency_street_wide', 'staging': {}, 'who': 'There are no people in this frame.',
                          'fix': (WINTER + 'the same yellow two-storey building as image 1, abandoned: the blue sign over '
                                  'the entrance is gone, a paler rectangle and four bolt holes on the plaster where it hung; '
                                  'the ground-floor windows boarded up with planks; untouched snow on the entrance steps; no '
                                  'car, no people; the bare lime trees along the pavement.')},
})

# Лицо по кадру, если фото лица нет: вырезка из принятого кадра.
FACE_CROPS = {'assistant': ('assets/ep01/hod/hod_notary_stairs/stairs_ots_assistant.webp', (300, 120, 1100, 1080)),
              'klava': ('assets/ep01/hod/hod_second/second_ots_klava.webp', (900, 80, 1700, 1080))}

# Общий план сета — образец комнаты (берётся уже переснятый: assets/ep01/_hod/hq/<план>.png).
ROOM_REF = {'office_am_ots_oper': 'office_am_wide', 'office_am_phone': 'office_am_wide', 'office_eve_wide': 'office_am_wide',
            'office_eve_ots_expert': 'office_eve_wide', 'office_eve_lens': 'office_eve_wide', 'office_am_lens': 'office_am_wide',
            'office_eve_phone': 'office_eve_wide', 'office_d2_wide': 'office_am_wide', 'office_d2_ots_boss': 'office_d2_wide',
            'office_night_wide': 'office_am_wide', 'office_night_ots_expert': 'office_night_wide',
            'flat_ots_buyer': 'flat_wide', 'flat_ots_wife': 'flat_wide', 'flat_photo': 'flat_wide',
            'landing_chain_ots': 'landing_chain_wide', 'landing_open_wide': 'landing_chain_wide',
            'landing_open_ots': 'landing_open_wide', 'notary_ots_notary': 'notary_wide', 'notary_alone_wide': 'notary_wide',
            'notary_register': 'notary_wide', 'stairs_ots_assistant': 'stairs_wide', 'zhek_ots_clerk': 'zhek_wide',
            'recon_wide': 'zhek_wide', 'recon_ots_zoya': 'recon_wide', 'bti_ots_clerk': 'bti_wide',
            'agency_ots_murashov': 'agency_wide', 'agency_closed': 'agency_street_wide', 'op_wide': 'agency_street_wide',
            'watch_wide': 'car_wide', 'search_wide': 'agency_wide', 'search_keys': 'search_wide', 'search_papers': 'search_wide',
            'field_ots_expert': 'field_wide', 'field_oper': 'field_wide', 'field_find': 'field_wide', 'op_draw': 'op_wide', 'op_shot': 'op_draw',
            'op_wounded': 'op_wide', 'op_stairs': 'op_wide', 'car_ots_oper': 'car_wide', 'car_view': 'car_wide',
            'car_d2_wide': 'car_wide', 'car_d2_ots_oper': 'car_d2_wide', 'car_d2_view': 'car_d2_wide',
            'car_d3_wide': 'car_wide', 'car_d3_ots_oper': 'car_d3_wide', 'car_d3_view': 'car_d3_wide',
            'second_ots_klava': 'second_wide', 'interrog_ots_murashov': 'interrog_wide', 'confront_wide': 'interrog_wide'}


def info(sid: str) -> tuple[str, str, dict]:
    """Файл-образец композиции, сет и кто где."""
    if sid in NEW:
        n = NEW[sid]
        src = memory.shot_info(n['from'])[0] if n.get('from') else ''
        return src, n['set'], n['staging']
    src, set_, _ = memory.shot_info(sid)
    return src, set_, memory.STAGING.get(sid, {})


def inputs(sid: str) -> tuple[str, list[str]]:
    src, set_, staging = info(sid)
    os.makedirs(os.path.join(HQ, 'src'), exist_ok=True)
    images = []
    if src:
        im = Image.open(os.path.join(ROOT, src)).convert('RGB').resize((1920, 1080), Image.LANCZOS)
        pad = Image.new('RGB', (1920, 1088))
        pad.paste(im, (0, 4)); pad.paste(im.crop((0, 0, 1920, 4)), (0, 0)); pad.paste(im.crop((0, 1076, 1920, 1080)), (0, 1084))
        src_png = os.path.join(HQ, 'src', f'{sid}.png')
        pad.save(src_png)
        images.append(src_png)
    faces = []
    for who in staging:
        f = os.path.join(FACES, f'{who}.webp')
        if not os.path.exists(f) and who in FACE_CROPS:
            path, box = FACE_CROPS[who]
            f = os.path.join(HQ, 'src', f'face_{who}.png')
            Image.open(os.path.join(ROOT, path)).convert('RGB').crop(box).save(f)
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
    if not src:
        lead = 'IMAGES.'
    elif sid in NEW or sid in RESTAGE:
        lead = ('IMAGES. Image 1 is a frame of this same place: take from it the location, the light, the look of the people '
                'and objects — but the camera, the moment and the staging are new, exactly as described in the FIX below.')
    else:
        lead = ('IMAGES. Image 1 is the draft of this very frame: a low-resolution draft. Keep its composition, camera '
                'position, framing, the room and where every person and object is, unless the FIX below says otherwise. '
                'Redraw it as a clean, high-quality, anatomically correct frame with the analog television look described '
                'below.')
    intro = (lead
             + (f' Identity photos: {"; ".join(faces)} — keep exactly these faces, hair and builds.' if faces else '')
             + (f' Reference objects: {"; ".join(props)}.' if props else '')
             + room)
    clothes = {**memory.CLOTHES, **memory.CLOTHES_BY_SHOT.get(sid, {})}
    who = NEW.get(sid, {}).get('who') or WHO.get(sid) or (
        ('WHO IS WHERE: ' + ' '.join(f'{memory.CHARS[w]["name"]} ({clothes.get(w, "")}): {t}.' for w, t in staging.items()
                                     if w in memory.CHARS)) if staging else 'There are no people in this frame.')
    fix = FIX.get(sid) or NEW.get(sid, {}).get('fix')
    parts = [intro, ROOMS.get(set_, ''), who, f'FIX: {fix}' if fix else '', RULES, BASE]
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
