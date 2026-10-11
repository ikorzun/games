#!/usr/bin/env python3
"""Шот-лист и план генерации кадров покрытия по сетам (docs/architecture/08-shot-grammar.md §5).

Сет = фон × время суток. Для каждого сета из сцен эпизода собираются составы персонажей, пары собеседников
и выражения, по ним строится список кадров (wide / medium / ots / close / reaction / insert / angle) с
промптами по стайл-библии (§1, §1a, блоки PHOTOGRAPHIC REALISM и CONTINUITY) и референсами из манифеста
(job id фона и спрайтов). Результат: Markdown-шот-лист и plan.json для генерации.

    python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --md docs/production/ep01-shot-list.md \
        --plan assets/ep01/shots/plan.json [--set office_day]
    python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --apply assets/ep01/shots/plan.json --sets office_day
        # записать assets.shots и coverage сцен в эпизод по готовым (скачанным) кадрам
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ───────────────────────────── справочники (русские пометки — для команды) ─────────────────────────────

SET_NAMES = {
    ("bg_office_prosecutor", "day"): "office_day",
    ("bg_office_prosecutor", "evening"): "office_evening",
    ("bg_office_prosecutor", "night"): "office_night",
    ("bg_interrogation", "day"): "interrogation",
    ("bg_apartment_zoya", "day"): "apartment_zoya",
    ("bg_notary_office", "day"): "notary",
    ("bg_stairwell", "evening"): "stairwell",
    ("bg_street_night", "night"): "street_night",
    ("bg_bti_archive", "day"): "bti",
    ("bg_street_day", "day"): "street_day",
    ("bg_murashov_flat", "night"): "murashov_flat",
    ("bg_zhek", "day"): "zhek",
    ("bg_yard_summer", "evening"): "yard",
    ("bg_office_now", "day"): "office_now",
}

# Английские имена для промптов (в игре имена берутся из локали).
NAMES = {
    "sledak": "Investigator Andrei Gromov",
    "sledak_old": "Andrei Gromov in 2004 (the same man at 40)",
    "oper": "Detective Viktor Sayko",
    "expert": "forensic expert Nina Levina",
    "boss": "Valentin Pavlovich, head of the investigative department",
    "murashov": "Sergei Murashov",
    "murashov_sil": "Sergei Murashov (face never shown)",
    "notary": "notary Kovrigin",
    "zoya": "Zoya Pavlovna, an elderly pensioner",
    "neighbor": "Galina, the neighbour",
    "buyer": "Lapin, the new tenant",
    "buyer_unknown": "the new tenant (Lapin)",
    "lapin_wife": "Irina Lapina",
    "clerk": "Raisa Lvovna, the BTI archive clerk",
    "accomplice": "Dmitry Shmelyov (Shmel), the accomplice",
}

EXPRESSIONS = {
    "neutral": "calm face, mouth closed",
    "tense": "jaw set, eyes narrowed, wary",
    "tired": "heavy eyelids, slumped shoulders, exhausted",
    "firm": "steady hard stare, chin down",
    "grin": "lopsided half-smile, teasing",
    "angry": "flushed, hard eyes, lips pressed",
    "hurt": "pale, wincing, holding his arm",
    "focused": "attentive, reading, brows slightly drawn",
    "stern": "cold authority, unblinking",
    "smile": "polite thin smile that does not reach the eyes",
    "cold": "flat emotionless stare",
    "cornered": "trapped, sweating, eyes darting",
    "nervous": "fidgeting, sweating, avoiding eye contact",
    "warm": "gentle trusting face, soft eyes",
    "worried": "anxious, brows drawn together",
    "scared": "frightened, pale, lips parted",
    "sad": "quiet grief, eyes down",
}

LIGHTING = {
    "day": "flat overcast daylight from the window plus the warm desk lamp",
    "evening": "low warm evening light from the window, long shadows, the desk lamp on",
    "night": "night: the window is black, the room lit only by the desk lamp and a bare ceiling bulb",
}

# Свет по фонам: общий словарь LIGHTING написан для кабинета (окно плюс настольная лампа); у других фонов свои
# источники — иначе модель дорисовывает лампу, которой в комнате нет (apartment_zoya, пилот). Тексты — из столбца
# LIGHT таблицы фонов `docs/production/prompts/ep01-images.md`, для ночных сетов переписаны под время суток.
# SUBJECT для крупных планов и реакций там, где люди сидят внутри описанного в фоне предмета: по общему SUBJECT
# «улица с припаркованной «Волгой»» модель рисовала вторую «Волгу» за окном машины, в которой сидят герои
# (street_night, волна 68). Ключ — id фона; остальные сеты используют SUBJECT фона.
CLOSE_SUBJECT = {
    "bg_street_day": ("SUBJECT: inside the parked Lada 2109 by day on Presnya street: the people sit in this car in its "
                      "front seats; beyond the windscreen and the side windows the grey overcast street, the notary office "
                      "opposite with its heavy dark door and the black Volga parked at its kerb blur softly; the camera is "
                      "inside this car and no other car is in the foreground."),
    "bg_street_night": ("SUBJECT: inside the parked dark Volga at night in October rain: the people sit in this car; "
                        "rain streaks the windscreen and the side windows, and beyond the glass only the sodium street "
                        "lamp, the wet asphalt and the warm lit office window with its dim doorway blur softly; no other "
                        "car anywhere in the picture."),
}

# Сеты, где сам фон снят изнутри машины: камера общих, средних планов, ракурсов и вставок — в салоне (CAMERA в салоне,
# предметы салона в Essential objects); референс комнаты у них остаётся (фон или кроп принятого общего плана).
CAR_SETS = {"bg_street_day"}
# Что видно за стёклами в ots изнутри машины (по времени суток сета).
INSIDE_STREET = {
    "bg_street_night": "the street is only a wet blur beyond the windows",
    "bg_street_day": "the grey overcast street beyond the windows is pale and soft, brighter than the cabin",
}

# Пары собеседников, которые сидят внутри описанного в фоне предмета (машина на street_night): их ots снимаются
# изнутри — по SUBJECT крупных планов, без LAYOUT улицы и без референса комнаты. С фоном «улица из-за дороги»
# модель ставила обоих на тротуар рядом с пустой «Волгой» (волна 70).
INSIDE_PAIRS = {
    "bg_street_day": {frozenset({"oper", "sledak"})},
    "bg_street_night": {frozenset({"oper", "sledak"})},
}
# Кто в этом сете сидит внутри (крупные планы и реакции по SUBJECT салона и салонному референсу); остальные —
# снаружи, по SUBJECT фона и без референса комнаты (салонный референс посадил бы их в машину).
INSIDE_PEOPLE = {
    "bg_street_day": {"oper", "sledak"},
    "bg_street_night": {"oper", "sledak"},
}
# SUBJECT для крупных планов и реакций тех, кто в сете снаружи, когда сам фон — вид изнутри машины
# (street_day: через лобовое стекло «Лады»): иначе Мурашова у двери конторы модель снимала бы сквозь стекло.
OUTSIDE_SUBJECT = {
    "bg_street_day": ("SUBJECT: Presnya street in Moscow by day, 1993, on the pavement outside the ground-floor notary "
                      "office with a brass plate and a heavy dark double door, a black Volga sedan parked at the kerb, a "
                      "newspaper kiosk, bare trees, slush and yellow leaves at the kerb; the camera stands on the pavement, "
                      "not inside any car."),
}
# Дополнение к тексту ots снаружи (для сета с машиной): иначе модель сажает в «Волгу» лишние лица.
OTS_EXTRA = {
    "bg_street_night": " The parked Volga behind them is empty: its windows are dark, with no face and no silhouette inside it.",
}
# Постоянная примета персонажа в тексте сцены (ключ — id персонажа): словесные приметы в REFERENCE IMAGES
# модель читает не всегда — в close_expert_neutral (office_evening, волна 81) эксперт вышла без очков при цепочке
# на шее, хотя во всех остальных кадрах сета она в очках. Добавляется после выражения лица в «People in frame».
CHAR_ALWAYS = {
    "expert": ", her glasses on her nose with the chain hanging from the temples",
}

# Дополнение к крупным планам и реакциям снаружи (для сета с машиной): по описанию «в освещённом дверном проёме»
# модель ставила героя на тротуар, а в проём за его спиной — лишнего человека (волна 76). `{who}` — имя героя.
CLOSE_EXTRA = {
    "bg_street_night": (" {who} is the only person in the picture: the lit doorway and the pavement behind are empty, "
                        "nobody stands in the doorway, and the parked Volga's windows are dark."),
}

LIGHTING_BY_BG = {
    "bg_apartment_zoya": {"day": "flat overcast daylight through the tulle curtains; no lamp is on"},
    "bg_notary_office": {"day": "the warm green-shaded desk lamp against grey daylight from the window"},
    "bg_stairwell": {"evening": "a bare bulb overhead plus grey dusk light from the stairwell window"},
    "bg_street_night": {"night": "night in October rain: one sodium street lamp, the warm lit office window, wet asphalt "
                                 "reflecting both"},
    "bg_bti_archive": {"day": "fluorescent tubes overhead, dusty air, the green reading lamp on"},
    "bg_street_day": {"day": "flat overcast daylight"},  # «через лобовое стекло» задаёт SUBJECT, не свет
    "bg_murashov_flat": {"night": "night: the window is dark over the street lamps below, the desk lamp and the ceiling "
                                  "light on"},
    "bg_zhek": {"day": "a fluorescent tube on the ceiling plus grey daylight from the window"},
    "bg_yard_summer": {"evening": "July dusk: warm lit windows against a blue-grey sky, one street lamp just on"},
    "bg_office_now": {"day": "soft daylight through the blinds"},
}


def light_now(bg_id: str, tod: str) -> str:
    return LIGHTING_BY_BG.get(bg_id, {}).get(tod) or LIGHTING.get(tod, LIGHTING["day"])


# Где кто стоит в сете (мизансцена по умолчанию).
STAGING = {
    "bg_office_prosecutor": {
        "sledak": "at his desk behind the typewriter",
        "oper": "by the window, leaning against the radiator",
        "expert": "on the chair across the desk with folders on her knees",
        "boss": "standing behind the desk by the safe, hands behind his back",
        "lapin_wife": "on the visitor's chair by the door, handbag on her lap",
    },
    "bg_interrogation": {
        "sledak": "seated on the chair at the RIGHT end of the table, facing the suspect across it, a folder in front of him",
        "oper": "standing apart from the table by the grey steel door at the right wall, arms folded",
        "buyer": "on the chair under the lamp, hands on the table",
        "murashov": "on the chair under the lamp, hands folded on the table",
        # Словарь по выражению: платок в работе только у «нервного» нотариуса, иначе нейтральный крупный план
        # получает нервное действие (interrogation, волна 34).
        "notary": {
            "*": "at the LEFT end of the table beside the suspect's chair, a folded handkerchief in his hand",
            "nervous": "at the LEFT end of the table beside the suspect's chair, wiping his forehead with a handkerchief",
        },
    },
    "bg_apartment_zoya": {
        "zoya": "by the sideboard, touching the framed photo",
        "murashov_sil": "in the doorway, seen from behind, face hidden",
        "sledak": "in the middle of the room, notebook in hand",
        "expert": "crouched by the bedside table, examining medicine bottles",
        "oper": "by the window, looking down at the yard",
        "buyer": "by the window, uneasy",
        "lapin_wife": "sitting on the edge of the bed, handbag on her lap",  # в LOOKS у неё кардиган, пальто нет
    },
    "bg_notary_office": {
        "notary": "behind his desk with the stamp and ink pad",
        "zoya": "on the visitor's chair in front of the desk",
        "murashov_sil": "standing beside her chair, seen from behind, face hidden",
        "sledak": "standing in front of the desk with a folder",
        "oper": "leaning in the doorway",
    },
    "bg_stairwell": {
        "neighbor": "by her apartment door at the railing, a bottle of milk in her hand",
        "buyer_unknown": "by the lift door with keys",
        "buyer": "by the lift door with keys",
        "sledak": "on the landing by the mailboxes",
        "oper": "on the stairs a step below",
    },
    "bg_street_night": {
        "sledak": "in the driver's seat of the parked car, seen through the wet windscreen",
        "oper": "in the passenger seat, collar up",
        "accomplice": "in the lit doorway across the street, glancing around",
    },
    "bg_bti_archive": {
        "clerk": "at the counter between the card drawers, a box of index cards in her hands",
        "sledak": "at the reading table under the green lamp",
        "expert": "at the reading table, cards spread before her",
    },
    "bg_street_day": {
        "sledak": "in the driver's seat of the parked Lada, seen from inside the car",
        "oper": "in the passenger seat with a thermos",
        "murashov": "across the street at the notary office door, briefcase in hand",
        "accomplice": "across the street by the kiosk",
    },
    "bg_murashov_flat": {
        "sledak": "at the desk with the three telephones, going through folders",
        "expert": "by the shelves, photographing documents",
    },
    "bg_zhek": {
        "zoya": "in the queue by the service window, papers in her hands",
        "murashov_sil": "beside her in the queue, seen from behind, face hidden",
    },
    "bg_yard_summer": {"neighbor": "on the courtyard path with a bottle of milk, looking up at the dark window"},
    "bg_office_now": {"sledak_old": "in the office chair facing the camera, blinds behind him"},
}

# Расположение в кадре с точки зрения камеры у двери (как снят фон): чтобы кадры не пересекали линию действия.
LAYOUT = {
    "bg_interrogation": ("Seen from the door end of the room: the bare table in the CENTRE under the small barred window, "
                         "the lamp at the table's LEFT end, one chair at the LEFT end and one at the RIGHT end of the table, "
                         "the dark-green half-wall and the radiator behind the table, the grey steel door on the RIGHT. "
                         "The camera never crosses to the window side."),
    "bg_apartment_zoya": ("Seen from the entrance door: the dark sideboard with glass doors and the framed photo on the LEFT, "
                          "the wall carpet behind it and a chair beside it, the window with lace curtains and the radiator in "
                          "the CENTRE, the small TV on a stool to the right of the window, the bedside table with the medicine "
                          "bottles and the bed under an olive-green chenille bedspread on the RIGHT. The camera never "
                          "crosses to the window side."),  # цвет покрывала закреплён: в angle_high модель нарисовала другое
    "bg_notary_office": ("Seen from the visitors' side: the window on the LEFT, the notary's desk with the green lamp, the "
                         "round stamp and the stacks of papers across the lower LEFT and CENTRE with the notary's chair behind "
                         "it, the glass-fronted bookcase behind the desk, the coat rack to its right, and the open door to the "
                         "corridor with the waiting queue on the RIGHT. The camera never crosses behind the desk."),
    "bg_stairwell": ("Seen from the apartment doors' end of the landing: the window with the radiator and the stairs going "
                     "down behind the railing on the LEFT, the row of dented metal mailboxes on the wall LEFT of CENTRE, the "
                     "lift door in the CENTRE, the padded apartment door with the new brass lock on the RIGHT, a bare bulb on "
                     "the ceiling. The camera never goes down the stairs."),
    "bg_street_night": ("Seen from across the street: the street lamp and the bare tree on the LEFT, the parked dark Volga "
                        "sedan at the kerb in the CENTRE, the doorway with its small canopy and the lit office window to its "
                        "RIGHT, more parked cars at both edges. The camera stays on the far pavement."),
    "bg_office_prosecutor": ("Seen from the door: the investigator's desk with the green lamp and the chair behind it on the LEFT, "
                             "the grey safe behind the desk, the window with the radiator in the CENTRE, the visitor's chair and the "
                             "coat rack on the RIGHT. The camera never crosses to the window side. The typewriter stands uncovered "
                             "with a sheet of paper in it, exactly as in the reference."),
}

# Порядок мест слева направо с точки зрения камеры у двери (как снят фон): явные стороны экрана в ots/medium,
# чтобы кадры не пересекали линию действия. Ключ — фон, значение — who → позиция (меньше — левее).
ORDER = {
    "bg_office_prosecutor": {"sledak": 0, "boss": 0.4, "oper": 1, "expert": 2, "lapin_wife": 2.2},
    "bg_interrogation": {"buyer": 0, "murashov": 0, "notary": 0, "sledak": 1, "oper": 2},
    "bg_apartment_zoya": {"murashov_sil": 0, "zoya": 0.3, "sledak": 1, "oper": 1.4, "buyer": 1.5, "expert": 2, "lapin_wife": 2.3},
    "bg_notary_office": {"notary": 0, "zoya": 1, "murashov_sil": 1.2, "sledak": 1.5, "oper": 2},
    "bg_stairwell": {"oper": 0, "sledak": 0.5, "buyer_unknown": 1, "buyer": 1, "neighbor": 2},
    "bg_street_night": {"sledak": 0.8, "oper": 1.2, "accomplice": 2},
}


def screen_sides(bg: str, a: str, b: str) -> tuple[str, str] | None:
    """Стороны экрана для пары: (сторона a, сторона b) или None, если порядок не задан."""
    o = ORDER.get(bg, {})
    if a not in o or b not in o or o[a] == o[b]:
        return None
    return ("LEFT", "RIGHT") if o[a] < o[b] else ("RIGHT", "LEFT")


# Референс комнаты для medium / close / reaction: принятый кадр того же сета, снятый ближе. Если референс — общий
# план фона, модель повторяет его кадрирование и «крупный план» выходит общим; с близким референсом она держит
# крупность. Ключ — сет, значение — id кадра из манифеста (его job id подставляется первым референсом).
REF_SHOTS = {
    "office_day": {"medium": "sh_office_day_medium_2", "close": "sh_office_day_close_sledak_tense",
                   "reaction": "sh_office_day_close_sledak_tense", "angle": "sh_office_day_medium_2"},
    # Ночной сет той же комнаты: пока нет принятого ночного близкого кадра, референс — дневной; промпт
    # говорит, что свет теперь другой (LIGHT NOW). После первого принятого ночного кадра — заменить.
    # "room" — принятый общий план сета вместо фона как референс комнаты (wide, ots, insert): для ночного
    # сета это даёт чёрное окно и включённые лампы без оговорок.
    "office_night": {"room": "sh_office_night_wide_1", "medium": "sh_office_night_medium_1",
                     "close": "sh_office_night_close_sledak_tense", "reaction": "sh_office_night_close_sledak_tense",
                     "angle": "sh_office_night_medium_1"},
    # Вечерний сет: пилот (волна 78) по дневным референсам с оговоркой о свете принят целиком; дальше, как и
    # ночной сет, ссылается на свои принятые кадры (wide_1 как комната: закатное окно и включённая лампа).
    "office_evening": {"room": "sh_office_evening_wide_1", "medium": "sh_office_evening_medium_1",
                       "close": "sh_office_evening_close_sledak_tense", "reaction": "sh_office_evening_close_sledak_tense",
                       "angle": "sh_office_evening_medium_1",
                       "medium_solo": "media:c788bc53-1cec-4b42-9e45-98520a8c42c5"},  # кроп wide_3, следователь один
    # Первый принятый крупный план сета сделан без референса комнаты (волна 26); средние — пока по фону.
    "interrogation": {"close": "sh_interrogation_close_sledak_firm", "reaction": "sh_interrogation_close_sledak_firm",
                      "medium": "sh_interrogation_medium_1", "angle": "sh_interrogation_medium_1"},
    # Пилот (волна 39): wide ×2 и крупный план приняты, medium_1 по фону вышел общим планом. Для средних и ракурсов
    # референс — кроп принятого wide_1 по пояс (`assets/ep01/refs/apartment_zoya_medium.jpg`), загруженный в
    # Higgsfield по публичному URL: значение `media:<id>` — готовый media id, а не кадр из манифеста.
    "apartment_zoya": {"close": "sh_apartment_zoya_close_zoya_warm", "reaction": "sh_apartment_zoya_close_zoya_warm",
                       "medium": "media:bd6b1bbb-f06d-43df-9aa0-d9a706ededdb",
                       "angle": "media:bd6b1bbb-f06d-43df-9aa0-d9a706ededdb"},
    # Пилот (волна 51): wide ×2 и крупный план нотариуса без референса комнаты приняты; кроп wide_1 по пояс —
    # для средних и ракурсов (media id добавляется после импорта по URL).
    "notary": {"close": "sh_notary_close_notary_nervous", "reaction": "sh_notary_close_notary_nervous",
               "medium": "media:8baf6d62-ebed-4954-bc99-7e35b599ec3c", "angle": "media:8baf6d62-ebed-4954-bc99-7e35b599ec3c"},
    # Пилот (волны 60–61): wide ×3 по фону и крупные планы без референса комнаты приняты; кроп wide_1 по колени
    # (`assets/ep01/refs/stairwell_medium.jpg`) — для средних и ракурсов.
    # Вставки — тоже по кропу: с фоном первым референсом обе вышли общими планами площадки (волна 66).
    "stairwell": {"close": "sh_stairwell_close_neighbor_worried", "reaction": "sh_stairwell_close_neighbor_worried",
                  "medium": "media:b86a8159-36a5-48f5-9ffd-34ddf0393b36", "angle": "media:b86a8159-36a5-48f5-9ffd-34ddf0393b36",
                  "insert": "media:b86a8159-36a5-48f5-9ffd-34ddf0393b36",
                  "medium_solo": "media:66b20696-cb0a-4481-b5a0-7d22fd2f52f5"},
    # Пилот (волна 68): wide ×2 приняты, крупные планы отбракованы (вторая «Волга» за окном — см. CLOSE_SUBJECT);
    # кроп wide_1 («Волга», подъезд, окно) — для средних и ракурсов.
    # Пилот bti (волна 86): wide_1 по фону и три крупных плана без референса комнаты приняты; комната для ots и
    # вставок — wide_1, средние и ракурсы — кроп wide_1 (`refs/bti_medium.jpg`, media id после импорта по URL).
    "bti": {"room": "sh_bti_wide_1", "close": "sh_bti_close_sledak_tense", "reaction": "sh_bti_close_sledak_tense",
            "medium": "media:ed4e6075-2e97-4f32-bf4a-e27b6dd57db3", "angle": "media:ed4e6075-2e97-4f32-bf4a-e27b6dd57db3"},
    "street_night": {"medium": "media:5ac38ac0-c807-44a4-a268-f35164a2438f", "angle": "media:5ac38ac0-c807-44a4-a268-f35164a2438f",
                     "close": "sh_street_night_close_oper_neutral", "reaction": "sh_street_night_close_oper_neutral"},
    # Первый сет по новому базовому промпту владельца (волна 92): пилот принят целиком. Комната для ots, вставок и
    # ракурсов — wide_1 (вид с заднего сиденья); крупные планы и реакции внутри — по close_sledak_tense; средние и
    # ракурсы — кроп wide_1 без приборной панели (`refs/street_day_medium.jpg`, media id после импорта по URL).
    "street_day": {"room": "sh_street_day_wide_1", "close": "sh_street_day_close_sledak_tense",
                   "reaction": "sh_street_day_close_sledak_tense",
                   "medium": "media:aea785fc-78b6-459e-97ad-36dfd3965407", "angle": "media:aea785fc-78b6-459e-97ad-36dfd3965407"},
}
# Для ракурсов (angle) референс — принятый средний план, а не общий: с общим планом модель дважды
# меняла людей местами (office_day, волна 18), со средним оба ракурса вышли с первого раза.

# Время суток каждого сета (заполняется в analyse_sets) — чтобы сказать модели, что референс снят при другом свете.
SET_TOD: dict[str, str] = {}


def ref_shot_tod(shot_id: str) -> str | None:
    """Время суток сета, которому принадлежит референс-кадр (по префиксу id)."""
    for name, tod in SET_TOD.items():
        if shot_id.startswith(f"sh_{name}_"):
            return tod
    return None

INSERTS = {
    "bg_office_prosecutor": [
        "hands on the desk: a document with a round violet stamp, a glass of tea in a metal holder, a cigarette",
        "the black rotary telephone and a hand resting on the receiver, case folders tied with string beside it",
    ],
    "bg_interrogation": [
        "two pairs of hands across the bare table under the lamp: one pair folded, one holding a pen over a protocol",
        "an ashtray, a pack of cigarettes and a glass of water on the table edge",
    ],
    "bg_apartment_zoya": [
        "the framed photo behind the sideboard glass and a hand in a glove lifting a folded pair of glasses",
        "medicine bottles and a cup on the bedside table, a key ring beside them",
    ],
    "bg_notary_office": [
        "the notary's hand in the sleeve of his brown tweed suit pressing a round stamp onto a document, the ink pad open",
        "a signature page and an elderly hand holding a pen uncertainly",
    ],
    "bg_stairwell": [
        "the new brass lock of the padded apartment door and a paper seal with an ink stamp glued across the door frame beside it; the lock and the seal fill the frame",
        "the row of dented metal mailboxes fills the frame, one of them stuffed with unopened newspapers",
    ],
    "bg_street_night": [
        "a wristwatch on a sleeve in the dim car, rain on the windscreen beyond",
        "a hand wiping fog from the car window, the lit doorway across the street in the drops",
    ],
    "bg_bti_archive": ["index cards spread on the reading table under the green lamp, a hand with a pencil marking one", "a card drawer pulled open, fingers walking along the tabs"],
    "bg_street_day": ["the dashboard and wipers of the car, a hand holding a cold cup, the office door across the street beyond the glass", "a pair of binoculars on the passenger seat beside a notebook"],
    "bg_murashov_flat": ["three telephones on the desk and a hand lifting a folder with photographs", "a drawer with bundles of passports and powers of attorney"],
    "bg_zhek": ["papers clutched in an elderly woman's hands, the queue blurred behind", "the service window with its wooden shutter half open"],
    "bg_yard_summer": ["a dark third-floor window with new bright curtains, the rest of the facade lit"],
    "bg_office_now": ["an old case folder on the desk next to a beige computer keyboard"],
}

# Неожиданные ракурсы (08 §2). Описание должно быть физически конкретным: где стоит камера, куда наклонена и
# что закрывает передний план. С общими словами («низкий ракурс», «из дверного проёма») модель повторяет
# общий план референса (office_day: angle_low и angle_doorway отбракованы как копии wide). Для фона без своей
# записи берутся ANGLES_DEFAULT; для каждого нового сета ракурсы описываются по картинке фона, как LAYOUT.
ANGLES_DEFAULT = [
    ("low", "the camera is near the floor at knee height, tilted up: the people are seen from below, the ceiling or "
            "the sky takes the upper third of the frame, the floor is not visible"),
    ("high", "the camera is above head height in a corner of the space, tilted down at the people and the floor "
             "between them"),
    ("foreground", "the camera looks past an object in the near foreground, out of focus, that covers the lower third "
                   "of the frame; the people beyond it are in focus"),
]
ANGLES = {
    "bg_office_prosecutor": [
        ("low", "the camera lies on the desktop at the height of the papers, beside the typewriter, tilted up: the "
                "underside of the green lamp shade and the typewriter carriage loom in the near foreground, the person "
                "at the desk is seen from below, chin first, and the cracked plaster ceiling with the top of the grey "
                "safe fill the upper half of the frame; the floor is not visible"),
        ("high", "high angle from the top of the cabinet, looking down at the people in the room"),
        ("foreground", "the camera is at the door end of the desk, at the height of the desktop, looking along the desk "
                       "toward the window: the stacks of tied case folders and the green lamp shade stand in the near "
                       "foreground, out of focus, covering the lower left of the frame; beyond them, in focus, the "
                       "people at the desk and by the window; the door is behind the camera"),
    ],
    "bg_interrogation": [
        ("low", "the camera is on the table top at its near end, at the height of the wood, tilted up: the lamp's metal "
                "shade at the left looms in the near foreground, the person across the table is seen from below against "
                "the dark-green wall, and the barred window and the grey ceiling fill the upper half of the frame"),
        ("high", "the camera is high in the corner above the door, tilted down: the table with the lamp, the two chairs, "
                 "the heads of the people and the dark floor around them"),
        # «Из-за края двери» (волна 36), «через окошко двери из коридора» (38) и «пепельница на переднем плане» (40):
        # модель дорисовала вторую дверь, вторую дверь и второй стол. Четвёртый вариант — передний план из того, что
        # в комнате точно есть: спинка стула подозреваемого и его плечо.
        ("foreground", "the camera is low behind the suspect's chair at the LEFT end of the table, at the height of the "
                       "chair's back: the back of his chair and his shoulder fill the near foreground at the left, out of "
                       "focus; beyond them, in focus, the length of the table with the lamp, the investigator facing the "
                       "camera at the far end and Detective Sayko standing by the door at the right wall; one table, two "
                       "chairs, nothing else added"),
    ],
    "bg_apartment_zoya": [
        ("low", "the camera is on the floor just inside the door, tilted up: the dark sideboard towers on the left, the "
                "lace curtain glows in the centre, the plain ceiling fills the upper third, the people are seen from below"),
        ("high", "the camera is high in the corner above the door, tilted down at the room: the top of the sideboard on "
                 "the left, the bed on the right, the people and the floor between them"),
        ("foreground", "the camera is low at the foot of the bed, looking past the green bedspread and the bedside table "
                       "with the medicine bottles in the near foreground, out of focus, toward the sideboard and the "
                       "window; the people beyond are in focus"),
    ],
    "bg_notary_office": [
        ("low", "the camera lies on the desktop among the papers beside the round stamp, tilted up: the green lamp shade "
                "looms in the near foreground, the person behind the desk is seen from below with the bookcase behind, "
                "the ceiling fills the upper third"),
        ("high", "the camera is above the bookcase in the corner, tilted down at the desk with the lamp, the heads of the "
                 "people and the floor toward the open door"),
        ("foreground", "the camera is in the corridor at the open door, looking past the door's edge and the shoulders of "
                       "the waiting queue in the near foreground, out of focus, into the office: the desk with the lamp "
                       "and the people beyond, in focus"),
    ],
    "bg_stairwell": [
        ("low", "the camera is on the stairs two steps below the landing, at the level of the top step, tilted up through "
                "the railing bars that cross the lower foreground: the people on the landing are seen from below, the "
                "bare bulb and the ceiling fill the upper third"),
        ("high", "the camera is on the flight above, at the turn of the stairs, tilted down at the landing: the heads of "
                 "the people, the mailboxes, the lift door and the terrazzo floor"),
        ("foreground", "the camera is at the window end of the landing, looking past the radiator and the end post of the "
                       "railing in the near foreground, out of focus, along the landing toward the lift and the apartment "
                       "door; the people beyond are in focus"),
    ],
    "bg_street_day": [
        ("low", "the camera is down on the dashboard at the base of the windscreen, tilted up at the two faces in the "
                "front seats: the roof lining and the rear-view mirror in the upper part of the frame, the grey street only "
                "in the side windows; the camera is inside the car"),
        ("high", "the camera is up under the roof lining at the back of the cabin, tilted down over the two front seats: "
                 "the heads and shoulders from above, the dashboard and the windscreen with the notary office across the "
                 "street in the lower half of the frame"),
        ("foreground", "the camera is on the back seat, looking past the two headrests and the thermos on the seat in the "
                       "near foreground, out of focus, at the windscreen and the notary office door across the street, in "
                       "focus; the two people are seen from behind and in profile"),
    ],
    "bg_street_night": [
        ("low", "the camera is at kerb height on the wet asphalt across the street, tilted up: the reflections of the "
                "street lamp in the puddles fill the lower third, the parked Volga and the facade rise above, rain crosses "
                "the lamp light"),
        ("high", "the camera is at a second-floor window across the street, tilted down at the roof of the Volga, the wet "
                 "asphalt and the lit doorway"),
        ("foreground", "the camera is low beside the next parked car, looking past its wet wing and rain-streaked side "
                       "window in the near foreground, out of focus, at the Volga and the lit doorway beyond, in focus"),
    ],
}

SHOT_LIMITS = {"wide": 4, "medium": 4, "ots": 8, "close": 16, "reaction": 5, "insert": 2, "angle": 3}

HIDDEN_FACE = {"murashov_sil"}


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fenced_blocks(md: str) -> list[str]:
    return re.findall(r"```\n(.*?)```", md, flags=re.S)


def load_prompt_parts() -> tuple[str, str]:
    """Базовый промпт владельца (§1, телевизионная драма конца 1990-х) и блок CONTINUITY (§1a) из стайл-библии."""
    md = open(os.path.join(ROOT, "docs/production/prompts/style-bible.md"), encoding="utf-8").read()
    blocks = fenced_blocks(md)
    base = next(b for b in blocks if b.startswith("Create one original fictional live-action television drama still"))
    continuity = next(b for b in blocks if b.startswith("CONTINUITY"))
    return base, continuity


def load_bg_subjects() -> dict[str, str]:
    md = open(os.path.join(ROOT, "docs/production/prompts/ep01-images.md"), encoding="utf-8").read()
    out = {}
    for line in md.splitlines():
        m = re.match(r"\| `(bg_[a-z0-9_]+)` \| (SUBJECT: .*?)\s*\|\s*$", line)
        if m:
            # COMPOSITION, LIGHT и MOOD фона описывают кадр фона; у кадра покрытия своя камера, свет и действие
            subj = re.sub(r"\s*(?:COMPOSITION|LIGHT|MOOD): .*?(?=\s[A-Z]{3,}: |$)", "", m.group(2))
            subj = re.sub(r"\s*СЕЗОН: .*$", "", subj)
            out[m.group(1)] = subj.strip()
    return out


def load_cast_looks() -> dict[str, str]:
    """Словесные приметы персонажей (таблицы «| `id` | CHARACTER | выражения |» в docs/production/prompts/*.md):
    дублируют референс словами, чтобы модель не меняла людей местами и не путала одежду."""
    out: dict[str, str] = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "docs/production/prompts/*.md"))):
        for line in open(path, encoding="utf-8").read().splitlines():
            m = re.match(r"\| `([a-z0-9_]+)` \| ((?:man|woman|the same)[^|]*?) \| [^|]*\|\s*$", line)
            if m and m.group(1) not in out:
                desc = m.group(2).strip()
                # приметы: до третьей точки с запятой (возраст, внешность; одежда), без роли
                parts = [x.strip() for x in desc.split(";")]
                out[m.group(1)] = "; ".join(parts[:2])
    return out


LOOKS: dict[str, str] = {}


def ref_jobs(manifest: list[dict]) -> dict[str, str]:
    return {it["id"]: it["job"] for it in manifest if it.get("job") and it["kind"] in ("bg", "sprite", "shot")}


def camera_block(kind: str, angle: str, cast: list[dict], focus: str | None, from_who: str | None, names,
                 inside: bool = False, bg_id: str | None = None) -> str:
    """Поле «Camera position» блока SCENE (стайл-библия §1a): практическая точка съёмки, уровень глаз участника,
    32–45 мм, задний план узнаваем с умеренной мягкостью — язык базового промпта владельца. `inside` — люди сидят
    в машине (CLOSE_SUBJECT): камера тоже в салоне, «комната» — салон и улица за стёклами."""
    if inside and kind == "wide":
        n_in = sum(1 for c in cast if c["who"] in INSIDE_PEOPLE.get(bg_id or "", set()))
        n_out = len(cast) - n_in
        seats = ("the people in the front seats seen from behind and in profile" if n_in > 1 else
                 "one person in a front seat seen from behind and in profile" if n_in == 1 else "the empty front seats")
        far = (", and beyond the windscreen, small and pale, the people across the street at the notary office door and "
               "by the kiosk" if n_out else "")
        return (f"The camera is on the back seat of the parked car at the eye level of a seated person, a 32 mm-equivalent "
                f"field of view: {seats}, the windscreen with the street and the notary office door beyond{far}, the "
                f"dashboard and the wipers in the lower part of the frame; the cabin darker than the overcast street outside")
    if inside and kind == "medium":
        return (f"The camera is inside the car, at the eye level of a seated person, a 40 mm-equivalent field of view: "
                f"{len(cast)} people in the front seats from the chest up, the door pillar or a headrest overlapping the edge "
                f"of the frame, the grey street readable through the windows behind them")
    if inside and kind == "ots":
        return (f"The camera is on the back seat just behind {names(from_who)}'s shoulder, a 45 mm-equivalent field of view: "
                f"the back of {names(from_who)}'s head and shoulder overlap the near edge of the frame, {names(focus)} in the "
                f"other front seat is turned toward the camera, readable, the side window and the street behind with modest "
                f"softness. It is a left-hand-drive car: the steering wheel is in front of the driver on the left")
    if inside and kind in ("close", "reaction"):
        verb = "speaking" if kind == "close" else "listening, not speaking"
        return (f"The camera is inside the car, in the other front seat at the eye level of {names(focus)}, a 45 mm-equivalent "
                f"field of view: a medium close-up of {names(focus)} {verb}, head and shoulders, the door pillar or the "
                f"window frame overlapping the edge, the overcast street through the side window behind, brighter than the "
                f"cabin, with modest softness")
    if inside and kind == "insert":
        return ("The camera is inside the car at the eye level of a seated person, a 45 mm-equivalent field of view at arm's "
                "length: the detail fills the frame, no faces, the street beyond the glass pale and soft")
    if kind == "wide":
        return ("The camera stands at the door end of the room at the eye level of a standing person, a 32 mm-equivalent "
                "field of view: the whole room with everyone in it, people small inside the space, surroundings in focus; "
                "the lower third of the frame is kept free of faces (the text box lives there), headroom above the tallest "
                "person. The viewer should feel the room is bigger than the people in it")
    if kind == "medium":
        return (f"The camera is inside the room, a few steps from the people, at the eye level of a seated participant, a "
                f"40 mm-equivalent field of view: {len(cast)} people from the waist up, the nearest shoulder or the desk edge "
                f"overlapping the frame, each head about one fifth of the frame height, little floor and ceiling; people keep "
                f"the same left-to-right order as seen from the door. This is NOT the wide view of Reference 1, which is only "
                f"the source of the room's furniture and light. A conversation in progress, nothing staged")
    if kind == "ots":
        return (f"The camera is just behind {names(from_who)}'s shoulder at that person's eye level, a 45 mm-equivalent field "
                f"of view: the back of {names(from_who)}'s head and shoulder overlap the near edge of the frame, {names(focus)} "
                f"faces the camera beyond, both readable, the background recognizable with modest optical softness; the "
                f"180-degree axis of the conversation is kept, people stay on the same sides as seen from the door. We listen "
                f"from one side of the conversation")
    if kind == "close":
        return (f"The camera is two or three steps in front of {names(focus)} at that person's eye level, a 45 mm-equivalent "
                f"field of view: a medium close-up, head and shoulders filling the frame, eyes on the upper third line, the "
                f"surroundings recognizable behind with modest optical softness, no very shallow depth of field. Every "
                f"flicker of expression counts")
    if kind == "reaction":
        return (f"The camera is at the eye level of {names(focus)}, a 45 mm-equivalent field of view: a medium close-up of "
                f"{names(focus)} listening, not speaking, slightly off-centre, the edge of the speaker's shoulder overlapping "
                f"the side of the frame, the surroundings recognizable behind with modest softness. The listener's face "
                f"tells the truth the speaker will not")
    if kind == "insert":
        return ("The camera looks down at the detail from the eye level of a seated participant, a 45 mm-equivalent field of "
                "view at arm's length: the detail fills the frame, no full room, no floor, no ceiling, no faces. A pause on "
                "the evidence")
    # angle: ракурс описан физически конкретно в тексте действия (ANGLES), build_prompt дописывает его сюда.
    return "A cutaway from an unexpected but physically available vantage point, where the camera never stood in the wide view"


GARMENT_WORDS = ("coat", "jacket", "suit", "cardigan", "dress", "sweater", "shirt", "blouse", "uniform", "overalls",
                 "robe", "jumper", "raincoat", "anorak", "tracksuit", "housecoat", "shawl", "scarf")


def key_garment(look: str) -> str:
    """Главный предмет одежды из словесной приметы («man, 29, …; grey wool coat over a dark sweater, folder…»)."""
    for seg in look.split(";"):
        for chunk in seg.split(","):
            c = chunk.strip()
            if any(w in c for w in GARMENT_WORDS):
                return c
    return ""


def scene_subject(shot: dict, bg_id: str, bg_subject: str) -> str:
    """SUBJECT сцены: салон для тех, кто внутри; улица с тротуара — для крупных планов тех, кто снаружи, если сам
    фон снят изнутри машины; иначе SUBJECT фона."""
    if shot.get("inside"):
        return CLOSE_SUBJECT.get(bg_id, bg_subject)
    if bg_id in INSIDE_PEOPLE and shot["kind"] in ("close", "reaction"):
        return OUTSIDE_SUBJECT.get(bg_id, bg_subject)
    return bg_subject


# Подстановки в базовый промпт владельца (стайл-библия §1, пометки): город и период эпизода вместо стилевой
# отсылки к Петербургу; формат кадра игры вместо «approximately 5:3».
PERIOD_SOURCE = "St Petersburg in the late 1990s."
PERIOD_EPISODE = "Moscow in the early 1990s."
FRAME_SOURCE = "Landscape composition approximately 5:3, one frame, without borders."
FRAME_EPISODE = "Landscape composition 16:9, the frame of the game, one frame, without borders."
SCENE_TEMPLATE_RE = re.compile(r"SCENE\n\nLocation and time: \[.*\Z", re.S)
TOD_WORDS = {"day": "daytime", "evening": "evening", "night": "night"}
# Время действия сета для поля «Location and time» (титры-даты сцен эпизода); по умолчанию — осень 1993.
WHEN_BY_SET = {
    "yard": "Moscow, July 1993, hot summer dusk",
    "apartment_zoya": "Moscow, August 1993, daytime",
    "notary": "Moscow, August 1993, daytime",
    "stairwell": "Moscow, August 1993, evening",
    "office_now": "Moscow, 2004, daytime",
}


# Предметы сцены для сетов, где SUBJECT не делится на «место: предметы» (салон машины и тротуар): ключ — (фон, inside).
ESSENTIAL_OBJECTS = {
    ("bg_street_day", True): ("the Lada's dashboard and steering wheel on the left, the rear-view mirror, a thermos on the "
                              "passenger side, the wipers; beyond the glass the notary office's heavy dark door with a brass "
                              "plate and the black Volga at the kerb"),
    ("bg_street_day", False): ("the notary office's heavy dark double door with a brass plate, the black Volga sedan at the "
                               "kerb, a newspaper kiosk, bare trees, slush and yellow leaves at the kerb"),
    ("bg_street_night", True): ("the Volga's dashboard and steering wheel on the left, rain on the windscreen and the side "
                                "windows; beyond the glass the sodium street lamp, the wet asphalt and the warm lit office "
                                "window with its dim doorway"),
    ("bg_street_night", False): ("the lit doorway with its small canopy, the warm office window, the parked dark Volga at the "
                                 "kerb, wet asphalt reflecting the sodium lamp, the bare tree"),
}


def essential_objects(subject: str) -> str:
    """Список предметов из SUBJECT фона: всё после первого двоеточия (описания фонов построены как «место, год: предметы»)."""
    body = re.sub(r"^SUBJECT:\s*", "", subject).strip()
    if ": " in body:
        body = body.split(": ", 1)[1]
    body = body.rstrip(".")
    return body[0].lower() + body[1:] if body else "only the objects named in the location"


def build_prompt(base: str, continuity: str, shot: dict, bg_subject: str, tod: str, bg_id: str, names, present: list[str]) -> str:
    """Собрать промпт кадра: базовый промпт владельца (§1) с подстановками периода и формата + REFERENCE IMAGES +
    CONTINUITY + блок SCENE из пяти полей (§3), где «Camera position» описывает конкретный кадр."""
    # Камера в салоне: все кадры сетов, где сам фон снят изнутри машины (CAR_SETS), и кадры людей внутри (inside).
    cam_inside = bool(shot.get("inside")) or (bg_id in CAR_SETS and shot["kind"] in ("wide", "medium", "angle", "insert"))
    cam = camera_block(shot["kind"], shot["angle"], shot["cast"], shot.get("focus"), shot.get("from"), names,
                       inside=cam_inside, bg_id=bg_id)
    body = base.replace(PERIOD_SOURCE, PERIOD_EPISODE, 1).replace(FRAME_SOURCE, FRAME_EPISODE, 1)
    # референсы
    closer = shot["kind"] in ("medium", "close", "reaction", "angle") and REF_SHOTS.get(shot["set"], {}).get(shot["kind"])
    ref_tod = ref_shot_tod(closer) if closer else None
    if closer and shot["kind"] == "angle":
        ref1 = ("Reference 1 is the same room seen from closer: keep its furniture, light and colours and who sits "
                "where, but do not copy its framing: the camera of this shot stands where the scene text says.")
        if ref_tod and ref_tod != tod:
            ref1 = ref1[:-1] + f"; it was photographed by {ref_tod}, and the light is now as LIGHT NOW in the scene text says."
    elif closer and ref_tod and ref_tod != tod:
        ref1 = (f"Reference 1 is the same room seen from closer, photographed by {ref_tod}: keep its furniture and "
                "colours and stand the camera at least as close, but the light is now different, exactly as LIGHT NOW "
                "in the scene text says.")
    elif closer:
        ref1 = ("Reference 1 is the same room seen from closer: keep its furniture, light and colours; frame this shot "
                "at least as close as Reference 1.")
    else:
        ref1 = "Reference 1 is the room itself: keep its furniture, window, lamps and props exactly where they are."
    room_ref = shot.get("has_room", bool(closer) or shot["kind"] not in ("close", "reaction"))
    if not room_ref:
        ref1 = None
    refs = [ref1] if ref1 else []
    # Референсы людей — в том же порядке слева направо, что и список People (interrogation, волна 28: при порядке
    # референсов «подозреваемый, опер, следователь» модель сажала опера за стол, хотя текст говорил обратное).
    cast_lr = sorted(shot["cast"], key=lambda c: ORDER.get(bg_id, {}).get(c["who"], 1))
    for i, c in enumerate(cast_lr, start=2 if room_ref else 1):
        who = c["who"]
        tail = "; this person's face is never shown clearly: back to the camera, turned away or in shadow" if who in HIDDEN_FACE else ""
        look = LOOKS.get(who) or LOOKS.get(shot.get("_sets", {}).get(who, ""), "")
        desc = f" ({look})" if look else ""
        refs.append(f"Reference {i} is {names(who)}{desc}: keep this exact face, hair, build and clothing{tail}.")
    ref_block = "REFERENCE IMAGES\n" + " ".join(refs)
    if not room_ref:
        ref_block += (" There is no reference image of the room: build the softly rendered background from the scene "
                      "text (Location and time, Light sources, Essential objects) alone.")
    staging = STAGING.get(bg_id, {})
    people = []
    # Люди перечисляются слева направо по ORDER: модель читает порядок списка как порядок на экране
    # (interrogation, волна 26: при списке «подозреваемый, опер, следователь» опер сел за стол, следователь встал к двери).
    order = ORDER.get(bg_id, {})
    for c in sorted(shot["cast"], key=lambda c: order.get(c["who"], 1)):
        who = c["who"]
        expr = EXPRESSIONS.get(c.get("expression") or "neutral", "calm face")
        place = staging.get(who, "in the room")
        if isinstance(place, dict):  # мизансцена зависит от выражения: ключ выражения или "*"
            place = place.get(c.get("expression") or "neutral", place.get("*", "in the room"))
        look = LOOKS.get(who) or LOOKS.get(shot.get("_sets", {}).get(who, ""), "")
        garment = key_garment(look)
        tag = f" (the one in the {garment})" if garment else ""
        people.append(f"{names(who)}{tag} {place}, {expr}{CHAR_ALWAYS.get(who, '')}")
    if shot["kind"] == "insert":
        action = shot["detail"]
        people_txt = "No faces in frame."
    else:
        people_txt = "People in frame: " + "; ".join(people) + "." if people else "The room is empty."
        action = shot.get("action", "")
    layout = LAYOUT.get(bg_id, "") if shot["kind"] in ("wide", "medium", "ots", "angle") and not shot.get("inside") else ""
    subject = scene_subject(shot, bg_id, bg_subject)
    when = WHEN_BY_SET.get(shot["set"], f"Moscow, autumn 1993, {TOD_WORDS.get(tod, tod)}")
    place = re.sub(r"^SUBJECT:\s*", "", subject).strip()
    place = place[0].upper() + place[1:] if place else place
    if shot["kind"] == "angle":
        cam = (f"{cam}: {action[0].lower() + action[1:].rstrip('.')}; the framing is clearly different from Reference 1, a "
               f"32 mm-equivalent field of view without fisheye distortion, the horizon straight, most of the space still "
               f"visible, people inside it. Pressure, surveillance: the system is bigger than the people")
        action = ""
    objects = ESSENTIAL_OBJECTS.get((bg_id, cam_inside)) or essential_objects(subject)
    scene_lines = [
        "SCENE",
        "",
        f"Location and time: {when}. {place}{' ' + layout if layout else ''}",
        f"People and action: {(people_txt + ' ' + action).strip()}",
        f"Camera position: {cam}.",
        f"Light sources: {light_now(bg_id, tod)}.",
        f"Essential objects: {objects}; nothing added that is not in the room reference.",
    ]
    scene = "\n".join(scene_lines)
    assert SCENE_TEMPLATE_RE.search(body), "базовый промпт без блока SCENE (стайл-библия §1)"
    body = SCENE_TEMPLATE_RE.sub(lambda _m: ref_block + "\n\n" + continuity.rstrip("\n") + "\n\n" + scene + "\n", body)
    return body


def analyse_sets(ep: dict) -> "OrderedDict[str, dict]":
    """Сеты: сцены, составы на репликах, пары собеседников, выражения."""
    cast_info = {c["id"]: c for c in ep["cast"]}
    sets: OrderedDict[str, dict] = OrderedDict()
    for sid, sc in ep["scenes"].items():
        st = sc.get("stage", {})
        bg = st.get("bg")
        tod = st.get("time_of_day") or "day"
        name = SET_NAMES.get((bg, tod), f"{bg[3:]}_{tod}" if bg else None)
        if not bg or bg == "bg_black":
            continue
        d = sets.setdefault(name, {"set": name, "bg": bg, "tod": tod, "scenes": [], "comps": Counter(), "pairs": Counter(), "closes": Counter(), "present": Counter(), "lines": 0})
        SET_TOD[name] = tod
        d["scenes"].append(sid)
        onstage: OrderedDict[str, str] = OrderedDict()
        prev_speaker = None
        for step in sc.get("steps", []):
            do = step.get("do")
            if do == "show" and not str(step.get("position", "")).startswith("offscreen"):
                onstage[step["who"]] = step.get("expression") or onstage.get(step["who"], "neutral")
            elif do == "show":
                onstage.pop(step["who"], None)
            elif do == "hide":
                onstage.pop(step["who"], None)
            elif do == "say":
                who = step["who"]
                if who not in onstage and cast_info.get(who, {}).get("sprite_set"):
                    onstage[who] = step.get("expression") or "neutral"
                if step.get("expression"):
                    onstage[who] = step["expression"]
                if who in onstage:
                    d["lines"] += 1
                    comp = tuple(sorted(onstage.keys()))
                    d["comps"][comp] += 1
                    for w in comp:
                        d["present"][w] += 1
                    d["closes"][(who, onstage.get(who, "neutral"))] += 1
                    if prev_speaker and prev_speaker != who and prev_speaker in onstage:
                        d["pairs"][(prev_speaker, who)] += 1
                    prev_speaker = who
            elif do == "narrate":
                pass
    return sets


def plan_set(d: dict, ep: dict, bg_subjects, jobs, base, realism, names, sprite_set_of) -> list[dict]:
    """Список кадров сета с промптами и референсами."""
    bg = d["bg"]
    tod = d["tod"]
    set_name = d["set"]
    subject = bg_subjects.get(bg, "")
    shots: list[dict] = []

    def ref_media(cast: list[dict], kind: str, inside: bool = False) -> list[str]:
        # Средний план с одним человеком: кроп общего плана с другими людьми тянет их в кадр (stairwell medium_3
        # дважды), поэтому для одиночных средних планов — отдельный референс без людей рядом, если он задан.
        if kind == "medium" and len(cast) == 1 and REF_SHOTS.get(set_name, {}).get("medium_solo"):
            kind = "medium_solo"
        ref_shot = REF_SHOTS.get(set_name, {}).get(kind)
        if ref_shot and ref_shot.startswith("media:"):  # загруженный кроп (assets/ep01/refs), не кадр из манифеста
            out = [ref_shot[len("media:"):]]
        else:
            out = [jobs.get(ref_shot) if ref_shot else None]
            if ref_shot and not jobs.get(ref_shot):
                print(f"нет job id у референс-кадра {ref_shot} в манифесте — взят фон", file=sys.stderr)
                out = [jobs.get(bg)]
        if not out[0]:
            room = REF_SHOTS.get(set_name, {}).get("room")
            out = [jobs.get(room) or jobs.get(bg)]
        # Крупный план и реакция в сете без принятого близкого кадра: без референса комнаты вовсе — с общим
        # планом первым референсом модель повторяет его кадрирование (office_day: 11 из 12); комната в крупном
        # плане и так размыта, её задаёт текст SUBJECT. Принятый крупный план затем становится REF_SHOTS[set].
        has_room = True
        if kind in ("close", "reaction"):
            if not ref_shot or (bg in INSIDE_PEOPLE and not inside):
                has_room = False
        elif inside:
            has_room = False
        if not has_room:
            out = []
        # Порядок спрайтов — как в тексте REFERENCE IMAGES: слева направо по ORDER.
        for c in sorted(cast, key=lambda c: ORDER.get(bg, {}).get(c["who"], 1)):
            ss = sprite_set_of(c["who"])
            expr = c.get("expression") or "neutral"
            out.append(jobs.get(f"{ss}.{expr}") or jobs.get(f"{ss}.neutral"))
        return [m for m in out if m], has_room

    def add(kind: str, name: str, cast: list[dict], **extra) -> None:
        shot = {"id": f"sh_{set_name}_{name}", "set": set_name, "bg": bg, "kind": kind, "angle": extra.pop("angle", "eye"), "cast": cast, "file": f"assets/ep01/shots/{set_name}/{name}.webp"}
        shot.update(extra)
        shot["medias"], shot["has_room"] = ref_media(cast, kind, bool(shot.get("inside")))
        shot["_sets"] = {c["who"]: sprite_set_of(c["who"]) for c in cast}
        shot["prompt"] = build_prompt(base, realism, shot, subject, tod, bg, names, [c["who"] for c in cast])
        del shot["_sets"]
        shots.append(shot)

    comps = [c for c, _ in d["comps"].most_common(SHOT_LIMITS["wide"]) if c]
    # Устойчивость к правкам текста: если сет уже применён к эпизоду, номера wide_N/medium_N (и ракурсы по comps[0])
    # сохраняют состав принятых кадров — иначе новая реплика меняет порядок составов по числу реплик, и имена
    # кадров разъезжаются с файлами в репозитории (office_night после отголосков nerves в s42c).
    applied = {}
    for s in ep.get("assets", {}).get("shots", []):
        if s.get("set") == set_name and s.get("kind") == "wide" and s["id"].rsplit("_", 1)[-1].isdigit():
            applied[tuple(sorted(c["who"] for c in s["cast"]))] = int(s["id"].rsplit("_", 1)[-1])
    if applied:
        all_comps = [c for c, _ in d["comps"].most_common() if c]
        slots: list = [None] * max(max(applied.values()), SHOT_LIMITS["wide"])
        for comp, n in applied.items():
            if comp in all_comps:
                slots[n - 1] = comp
        rest = iter(c for c in all_comps if c not in applied)
        comps = [c for c in (slot if slot is not None else next(rest, None) for slot in slots) if c is not None][: SHOT_LIMITS["wide"]]
    for i, comp in enumerate(comps, start=1):
        cast = [{"who": w, "expression": "neutral"} for w in comp]
        add("wide", f"wide_{i}", cast, action="Nobody speaks; a pause in the room.")
    for i, comp in enumerate(comps[: SHOT_LIMITS["medium"]], start=1):
        cast = [{"who": w, "expression": "neutral"} for w in comp]
        o = ORDER.get(bg, {})
        ordered = sorted((c["who"] for c in cast), key=lambda w: o.get(w, 1))
        order_txt = (" Left to right in the frame: " + ", ".join(names(w) for w in ordered) + ".") if len(cast) > 1 and all(w in o for w in ordered) else ""
        # Один человек в кадре: без «ровно один» модель дорисовывает второго из кроп-референса (stairwell medium_3).
        solo_txt = (f" {names(cast[0]['who'])} is alone: exactly one person in the frame, nobody else anywhere in the picture."
                    if len(cast) == 1 else "")
        add("medium", f"medium_{i}", cast, action="They are mid-conversation; one has just stopped talking." + order_txt + solo_txt)
    for (a, b), _ in d["pairs"].most_common(SHOT_LIMITS["ots"]):
        cast = [{"who": b, "expression": "neutral"}, {"who": a, "expression": "neutral"}]
        sides = screen_sides(bg, a, b)
        side_txt = (f" In the frame, {names(a)}'s shoulder is at the {sides[0]} edge and {names(b)} is on the {sides[1]}, "
                    f"exactly as they stand left-to-right in the wide view from the door." if sides else "")
        # Дальний человек с «лицом, которого не показывают» (силуэт Мурашова): не «лицом к объективу», а лицо
        # спрятано — опущено и отвёрнуто, в тени дверного проёма.
        far = (f"{names(b)} is the person farther from the camera, turned toward {names(a)}, but his face is never shown: "
               f"the head is bowed and turned away, lost in shadow, speaking to {names(a)}."
               if b in HIDDEN_FACE else
               f"{names(b)} is the person farther from the camera, face to the lens, speaking to {names(a)}.")
        inside = frozenset({a, b}) in INSIDE_PAIRS.get(bg, set())
        inside_txt = (f" Both of them sit inside the car and the camera is inside the car with them, on the back seat "
                      f"just behind {names(a)}'s shoulder; {INSIDE_STREET.get(bg, 'the street is only a soft blur beyond the windows')}. "
                      f"It is a left-hand-drive car: the steering wheel is in front of the driver on the left." if inside
                      else OTS_EXTRA.get(bg, ""))
        add("ots", f"ots_{a}_{b}", cast, **{"from": a, "focus": b, "inside": inside},
            action=(f"{names(a)} is seen only from behind: the back of the head and the shoulder overlap the near edge of "
                    f"the frame, {names(a)} is not seen from the front. {far} Do not swap the two people. Exactly two "
                    f"people are in the frame and each of them appears once: {names(a)} is only the shoulder in the "
                    f"foreground, not also somewhere in the room.{side_txt}{inside_txt}"))
    def outside_extra(who: str) -> str:
        """Крупный план/реакция человека, который в этом сете снаружи (не в INSIDE_PEOPLE): см. CLOSE_EXTRA."""
        if who in INSIDE_PEOPLE.get(bg, set()):
            return ""
        return CLOSE_EXTRA.get(bg, "").format(who=names(who))

    for (who, expr), _ in d["closes"].most_common(SHOT_LIMITS["close"]):
        if who in HIDDEN_FACE:
            continue
        add("close", f"close_{who}_{expr}", [{"who": who, "expression": expr}], focus=who,
            inside=who in INSIDE_PEOPLE.get(bg, set()),
            action=(f"{names(who)} is speaking to someone just off frame; {EXPRESSIONS.get(expr, '')}. Exactly one person in "
                    f"the frame, head and shoulders; no full figure." + outside_extra(who)))
    for who, _ in d["present"].most_common(SHOT_LIMITS["reaction"]):
        if who in HIDDEN_FACE:
            continue
        add("reaction", f"reaction_{who}", [{"who": who, "expression": "neutral"}], focus=who,
            inside=who in INSIDE_PEOPLE.get(bg, set()),
            action=(f"{names(who)} is listening to someone off frame, silent, a small pause before answering. Exactly one "
                    f"person in the frame, head and shoulders; the edge of the speaker's shoulder may overlap the side of "
                    f"the frame." + outside_extra(who)))
    for i, detail in enumerate(INSERTS.get(bg, [])[: SHOT_LIMITS["insert"]], start=1):
        # Вставки в сете с SUBJECT салона (машина): деталь внутри машины — без референса улицы, по SUBJECT салона.
        add("insert", f"insert_{i}", [], detail=detail, inside=bg in CLOSE_SUBJECT)
    main_comp = comps[0] if comps else ()
    for ang, desc in ANGLES.get(bg, ANGLES_DEFAULT)[: SHOT_LIMITS["angle"]]:
        cast = [{"who": w, "expression": "neutral"} for w in main_comp]
        add("angle", f"angle_{ang}", cast, angle=ang, action=desc[0].upper() + desc[1:] + ".")
    return shots


def write_md(path: str, sets: list[dict], plans: dict[str, list[dict]]) -> None:
    lines = ["# Шот-лист эпизода 1 по сетам", "",
             "Сгенерировано `tools/shot_plan.py` по эпизоду: сет = фон × время суток; состав, пары собеседников и выражения —",
             "из сцен. Промпты — `assets/ep01/shots/plan.json` (базовый промпт владельца, стайл-библия §1: телевизионная драма",
             "конца 1990-х, аналоговое ТВ; блок SCENE из пяти полей по §3, камера кадра — поле «Camera position» по §1a;",
             "REFERENCE IMAGES и CONTINUITY — референсы комнаты и спрайтов). Каждый кадр после генерации просматривается;",
             "брак перегенерируется.", ""]
    total = 0
    for d in sets:
        shots = plans.get(d["set"], [])
        total += len(shots)
        lines.append(f"## {d['set']} — `{d['bg']}`, {d['tod']}: сцены {', '.join(d['scenes'])}; реплик {d['lines']}; кадров {len(shots)}")
        lines.append("")
        lines.append("| id | kind | angle | состав (выражение) | from → focus |")
        lines.append("|---|---|---|---|---|")
        for s in shots:
            cast = ", ".join(f"{c['who']} ({c.get('expression') or '-'})" for c in s["cast"]) or "—"
            ff = f"{s.get('from') or '—'} → {s.get('focus') or '—'}" if s["kind"] in ("ots", "close", "reaction") else "—"
            lines.append(f"| `{s['id']}` | {s['kind']} | {s['angle']} | {cast} | {ff} |")
        lines.append("")
    lines.insert(2, f"Всего кадров по плану: {total}; по кредиту за кадр (gpt_image_2_5 medium/2k).")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def apply_to_episode(ep_path: str, plan: list[dict], set_names: list[str]) -> None:
    """assets.shots и coverage сцен — только для кадров, чьи файлы уже лежат в репозитории."""
    ep = load_json(ep_path)
    shots_by_id = {s["id"]: s for s in ep.setdefault("assets", {}).setdefault("shots", [])}
    added = 0
    sets_done: set[str] = set()
    for s in plan:
        if s["set"] not in set_names:
            continue
        if not os.path.exists(os.path.join(ROOT, s["file"])):
            continue
        entry = {"id": s["id"], "set": s["set"], "bg": s["bg"], "kind": s["kind"], "angle": s["angle"], "cast": [{k: v for k, v in c.items() if k in ("who", "expression")} for c in s["cast"]], "file": s["file"]}
        if s.get("from"):
            entry["from"] = s["from"]
        if s.get("focus"):
            entry["focus"] = s["focus"]
        if s["id"] in shots_by_id:
            shots_by_id[s["id"]].update(entry)
        else:
            ep["assets"]["shots"].append(entry)
            shots_by_id[s["id"]] = entry
            added += 1
        sets_done.add(s["set"])
    sets_meta = analyse_sets(ep)
    for name in sets_done:
        for sid in sets_meta[name]["scenes"]:
            ep["scenes"][sid]["coverage"] = name
    with open(ep_path, "w", encoding="utf-8") as f:
        json.dump(ep, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"эпизод: добавлено кадров {added}, сеты с покрытием: {sorted(sets_done)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--manifest", default=os.path.join(ROOT, "assets/ep01/manifest.json"))
    ap.add_argument("--md", default="")
    ap.add_argument("--plan", default="")
    ap.add_argument("--set", default="", help="только этот сет (для печати и плана)")
    ap.add_argument("--apply", default="", help="plan.json: записать assets.shots и coverage в эпизод")
    ap.add_argument("--sets", default="", help="для --apply: сеты через запятую")
    a = ap.parse_args()

    ep = load_json(a.episode)
    if a.apply:
        apply_to_episode(a.episode, load_json(a.apply), [s for s in a.sets.split(",") if s])
        return 0
    ru = load_json(os.path.join(ROOT, "locales/ru", f"{ep['id']}.json"))
    cast_info = {c["id"]: c for c in ep["cast"]}

    def names(who: str | None) -> str:
        if not who:
            return "someone"
        return NAMES.get(who) or ru.get(f"{ep['id']}.cast.{who}", who)

    def sprite_set_of(who: str) -> str:
        return cast_info.get(who, {}).get("sprite_set") or who

    jobs = ref_jobs(load_json(a.manifest))
    base, realism = load_prompt_parts()
    LOOKS.update(load_cast_looks())
    missing = sorted({c["id"] for c in ep["cast"] if c.get("sprite_set")} - set(LOOKS) - {c["id"] for c in ep["cast"] if LOOKS.get(c.get("sprite_set") or "")})
    if missing:
        print("без словесных примет (нет строки в docs/production/prompts):", ", ".join(missing), file=sys.stderr)
    subjects = load_bg_subjects()
    sets = analyse_sets(ep)
    chosen = [d for d in sets.values() if d["lines"] > 0 and (not a.set or d["set"] == a.set)]
    plans = {d["set"]: plan_set(d, ep, subjects, jobs, base, realism, names, sprite_set_of) for d in chosen}
    for d in chosen:
        print(f"{d['set']}: сцен {len(d['scenes'])}, реплик {d['lines']}, кадров {len(plans[d['set']])} "
              f"(составов {min(len(d['comps']), SHOT_LIMITS['wide'])}, пар {min(len(d['pairs']), SHOT_LIMITS['ots'])}, крупных {min(len(d['closes']), SHOT_LIMITS['close'])})")
    print(f"всего кадров: {sum(len(p) for p in plans.values())}")
    if a.md:
        write_md(a.md, chosen, plans)
        print("md:", a.md)
    if a.plan:
        flat = [s for d in chosen for s in plans[d["set"]]]
        os.makedirs(os.path.dirname(a.plan), exist_ok=True)
        with open(a.plan, "w", encoding="utf-8") as f:
            json.dump(flat, f, ensure_ascii=False, indent=1)
        print("plan:", a.plan, len(flat))
    return 0


if __name__ == "__main__":
    sys.exit(main())
