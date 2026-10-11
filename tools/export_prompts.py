#!/usr/bin/env python3
"""Промты для финальной генерации всех картинок эпизода (решение владельца, 2026-10-11: финальную генерацию
делает владелец; ему нужен промт на каждую картинку с описанием сцены и героя, чтобы держать одни и те же лица).

    python3 tools/export_prompts.py episodes/s1/ep01_murylev.json --out docs/production/prompts/ep01-final-prompts.md

Пишет главный файл (как пользоваться, базовый промпт, лица и спрайты персонажей, фоны, CG, документы, UI) и по
файлу на сет кадров покрытия (`<out>-shots-<set>.md`): в каждом кадре — какой референс кто и блок SCENE из пяти
полей по стайл-библии §3. Базовый промпт (§1) к каждому блоку приписывается целиком, он один на все картинки.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shot_plan as sp  # noqa: E402

ROOT = sp.ROOT

# Время действия фона для поля «Location and time» (по титрам-датам сцен и сезону картинки).
BG_WHEN = {
    "bg_yard_summer": "Moscow, July 1993, dusk",
    "bg_moscow_1993": "Moscow, summer 1993, daytime",
    "bg_moscow_1994": "Moscow, winter 1994, daytime",
    "bg_office_now": "Moscow, 2004, daytime",
    "bg_street_night": "Moscow, October 1993, night in rain",
    "bg_stairwell": "Moscow, August 1993, evening",
    "bg_apartment_zoya": "Moscow, August 1993, daytime",
    "bg_notary_office": "Moscow, summer 1993, daytime",
    "bg_murashov_flat": "Moscow, October 1993, night",
    "bg_courtroom": "Moscow, winter 1994, daytime",
}

# Психотип для портрета-референса (по docs/season1/ep01-voices.md, коротко и по-английски — для модели).
PSYCHO = {
    "sledak": "an introvert who trusts paperwork and patience and is ashamed of pressing people; tired grey eyes, a face that listens more than it speaks",
    "sledak_old": "the same man as Investigator Andrei Gromov eleven years later: heavier, grey at the temples, lines around the eyes, quiet grief without self-pity",
    "oper": "an extrovert street detective who can talk to anyone; a teasing half-smile held back, a face that has been hit and did not mind",
    "expert": "a rational observer with dry irony, tired of expert reports being read only after verdicts; sharp attentive eyes behind glasses on a chain",
    "boss": "not a villain: a department head who keeps the place afloat, fatherly and tired; heavy jowls, eyes that have made many compromises",
    "murashov": "a narcissistic rationalizer who calls himself an orderly; polite, calm, with an editor's composure; a pleasant, instantly forgettable face",
    "notary": "a cowardly accomplice hiding behind the law; soft, balding, sweating, eyes that avoid contact",
    "zoya": "trusting but worn down by years of living alone, shy of being a burden, used to not being listened to; a small faded face that becomes younger for a moment at the thought of her grandson and then tired again, nothing picture-book or sweet about it",
    "neighbor": "observant and pushy until it concerns herself, then afraid of being involved; a sturdy face used to talking in stairwells",
    "buyer": "an honest man under a steamroller: polite confusion turning into panic; thin, anxious, early lines on the face",
    "lapin_wife": "a mother defending her home: she holds longer than her husband and breaks deeper; pale, tired eyes, hair pulled back",
    "clerk": "the mistress of the archive: strictness as a form of care, a mocking mouth; short grey hair, glasses",
    "accomplice": "an empty executor who only drove and believed he was helping people move; thick neck, boxer's build, a scared, uncomprehending look",
}

FACE_FRAME = "Square composition 1:1, one frame, without borders."

# Характерный портрет-референс (не «паспорт у стены»): у каждого своё место, момент, взгляд, свет и один-два предмета.
# Лицо целиком в кадре и в фокусе — файл идёт первым референсом спрайтов и кадров; характер — в моменте и взгляде.
PORTRAITS = {
    "sledak": {
        "where": "Moscow, October 1993, late afternoon. The investigator's desk by the window of a modest prosecutor's office: a typewriter, stacks of case folders, a glass of cold tea.",
        "moment": "He has just looked up from a page at someone who came in, the pen still in his hand, and is already listening: tired attention in the eyes, the brows drawn a little, a faint apologetic half-smile that does not reach the mouth, the eyes to the lens as to the visitor.",
        "camera": "A television camera at the visitor's eye level, three-quarter view from the side of the door, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the typewriter and the window soft behind.",
        "light": "overcast daylight from the window on one side of the face and a desk lamp already on; no separate face lighting.",
        "objects": "the typewriter, the case folder under his hand.",
    },
    "sledak_old": {
        "where": "Moscow, 2004, daytime. A small modern office with vertical blinds, where the former investigator is interviewed for television.",
        "moment": "A pause after a question he did not expect: he looks straight into the lens, the mouth closed, the jaw set, quiet grief without self-pity and the half-smile of a man who knows how the story ends.",
        "camera": "A television interview camera slightly below his eye level, almost frontal, an 85 mm-equivalent field of view, a medium close-up: head and shoulders, the blinds softly striped behind.",
        "light": "soft daylight through the blinds on one side and a small interview lamp on the other; nothing dramatic.",
        "objects": "the vertical blinds, the edge of the interview chair.",
    },
    "oper": {
        "where": "Moscow, October 1993, daytime. The corridor of a district police station by a hot radiator and a notice board with pinned sheets.",
        "moment": "He has just said something funny and waits for the reaction, chin slightly up, a cigarette behind his ear: a teasing half-smile held back at one corner of the mouth, the small eyes narrowed with amusement, straight into the lens.",
        "camera": "A television camera at his eye level, three-quarter view, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the radiator and the notice board soft behind.",
        "light": "a bare ceiling bulb and grey daylight from a corridor window at the end; ordinary, slightly blunt shadows.",
        "objects": "the cigarette behind his ear, the notice board.",
    },
    "expert": {
        "where": "Moscow, October 1993, evening. The forensic laboratory: a desk lamp, a microscope, labelled jars on a shelf, a report in her hand.",
        "moment": "She has lowered the report and looks at the person over her glasses: dry irony, one eyebrow slightly raised, the thin mouth about to say something exact, the eyes to the lens over the rims.",
        "camera": "A television camera at her eye level, almost frontal, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the microscope and the jars soft behind.",
        "light": "the desk lamp from the side and cool fluorescent ceiling light; no separate face lighting.",
        "objects": "the glasses on their chain, the report in her hand, the microscope.",
    },
    "murashov": {
        "where": "Moscow, November 1993, daytime. The interrogation room: a bare table, a chair, a pale wall.",
        "moment": "He has folded his hands on the table and waits politely, the face relaxed: a courteous half-smile, the eyes attentive, completely calm and empty, to the lens as to an interviewer; the ordinariness itself is unsettling.",
        "camera": "A television camera at his eye level, frontal, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the pale wall behind.",
        "light": "flat daylight from a high window and a fluorescent tube; even, unflattering.",
        "objects": "the folded hands on the table edge, the tie pin.",
    },
    "notary": {
        "where": "Moscow, August 1993, daytime. The notary's office: a desk with a stamp and an ink pad, a desk lamp, a window with net curtains.",
        "moment": "He dabs his damp forehead with a handkerchief and has stopped mid-gesture, the small eyes sliding away from the lens to the side: wet fright hidden under the dignity of office, the mouth pressed into a polite line.",
        "camera": "A television camera slightly above his eye level, three-quarter view across the desk, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the lamp and the curtains soft behind.",
        "light": "diffused daylight through the net curtains and the warm desk lamp; a shine on the damp skin.",
        "objects": "the handkerchief in his hand, the stamp on the desk.",
    },
    "zoya": {
        "where": "Moscow, August 1993, daytime. The kitchen of an old Moscow apartment: a window with a geranium, a tea glass in a metal holder, a framed photograph on the sill.",
        "moment": "She has mentioned her grandson and waits to see whether the visitor is really listening: a shy, uncertain half-smile that is already fading, the faded eyes watchful and tired, the hands holding the handbag on her lap a little too tightly; a lonely old woman who has learned not to expect much, with no rosy cheeks, no lipstick and no beaming kindness, the skin pale and papery.",
        "camera": "A television camera at her eye level, slightly three-quarter, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the window and the geranium soft behind.",
        "light": "soft daylight from the kitchen window on one side; the rest of the room a little darker.",
        "objects": "the tea glass in its holder, the framed photograph on the sill.",
    },
    "neighbor": {
        "where": "Moscow, August 1993, evening. The landing of an old stairwell: her door with a peephole and a door chain, a dim bulb, a mailbox.",
        "moment": "She has leaned out through the gap of the chained door to see who is asking, the milk bottle in her hand: pushy curiosity with a shadow of fear of being involved, the small sharp eyes measuring the visitor, straight into the lens.",
        "camera": "A television camera at her eye level, three-quarter view from the stairs, a 40 mm-equivalent field of view, a medium close-up: head and shoulders in the door gap, the dark hallway behind her.",
        "light": "the dim stairwell bulb above and warmer light from inside her apartment behind her.",
        "objects": "the door chain, the glass milk bottle.",
    },
    "buyer": {
        "where": "Moscow, October 1993, daytime. The interrogation room: a bare table with his plastic folder of documents in front of him.",
        "moment": "He has just understood that his papers mean nothing and tries to smile politely: polite confusion turning into panic, the eyebrows up, the mouth half open, the large eyes behind the glasses to the lens.",
        "camera": "A television camera at his eye level, frontal, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the pale wall behind.",
        "light": "flat daylight from a high window and a fluorescent tube; even, unflattering.",
        "objects": "the plastic folder of documents under his hands, the too-tight tie.",
    },
    "boss": {
        "where": "Moscow, October 1993, daytime. The office of the head of the investigative department: a big desk, a telephone with several lines, a map of the city on the wall.",
        "moment": "He has taken off his glasses and rubs the bridge of his nose, looking at the visitor: fatherly fatigue, the hooded eyes of a man who has made many compromises and keeps the place afloat, to the lens.",
        "camera": "A television camera slightly below his eye level, three-quarter view across the desk, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the map soft behind.",
        "light": "grey daylight from a large window behind the camera and a green-shaded desk lamp; no separate face lighting.",
        "objects": "the glasses in his hand, the multi-line telephone.",
    },
    "lapin_wife": {
        "where": "Moscow, October 1993, evening. The hallway of the disputed apartment: moving boxes along the wall, a child's coat on a hook, a bare bulb.",
        "moment": "She stands with her arms crossed, holding herself together: a mother defending her home, the jaw set, the eyes wet but not crying, a challenge in the look straight into the lens.",
        "camera": "A television camera at her eye level, frontal, a 40 mm-equivalent field of view, a medium close-up: head and shoulders, the boxes and the child's coat soft behind.",
        "light": "the bare hallway bulb above and cold light from the kitchen doorway on one side.",
        "objects": "the child's coat on the hook, a moving box.",
    },
    "accomplice": {
        "where": "Moscow, November 1993, daytime. A bench in the corridor of the district police station, a grille on the window, a radiator.",
        "moment": "He has been asked a question he does not understand and looks for help: scared and uncomprehending, the mouth slightly open, the brows drawn together over the small deep-set eyes, the look to the lens.",
        "camera": "A television camera at his eye level, frontal, a 40 mm-equivalent field of view, a medium close-up: head and shoulders, the grille and the wall soft behind.",
        "light": "grey daylight through the barred window and a fluorescent tube; ordinary blunt shadows.",
        "objects": "the gold chain at the collar of the tracksuit, the window grille.",
    },
    "clerk": {
        "where": "Moscow, September 1993, daytime. The BTI archive: card-index cabinets with brass handles on both sides, a green-shaded lamp, a counter.",
        "moment": "She has put the box of index cards on the counter and looks over her glasses at someone who came without a request form: strictness as a form of care, a mocking half-smile, the eyebrows up, the eyes to the lens.",
        "camera": "A television camera at her eye level, three-quarter view across the counter, a 50 mm-equivalent field of view, a medium close-up: head and shoulders, the cabinets soft behind.",
        "light": "the green-shaded lamp from below the shoulder and dusty daylight from a high window; no separate face lighting.",
        "objects": "the box of index cards on the counter, the pencil behind her ear.",
    },
}
PORTRAIT_DEFAULT = {
    "where": "Moscow, autumn 1993, daytime. The person's own everyday place in the story.",
    "moment": "A small pause inside a conversation, the face turned to the camera as to the other person, the expression true to the character.",
    "camera": "A television camera at the eye level of the person, three-quarter view, a 50 mm-equivalent field of view, a medium close-up: head and shoulders.",
    "light": "the actual light of the place: a window or a plain fixture; no separate face lighting.",
    "objects": "one everyday object of the place.",
}


def parse_tables(md: str) -> dict[str, list[tuple[str, list[str]]]]:
    """Таблицы «| `id` | … |» по разделам файла промптов картинок."""
    out: dict[str, list[tuple[str, list[str]]]] = {}
    cur = ""
    for line in md.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip()
            out[cur] = []
            continue
        m = re.match(r"\| `([a-z0-9_.]+)` \| (.*) \|\s*$", line)
        if m and cur:
            out[cur].append((m.group(1), [c.strip() for c in m.group(2).split(" | ")]))
    return out


def split_fields(text: str) -> dict[str, str]:
    """«SUBJECT: … COMPOSITION: … LIGHT: … MOOD: …» → словарь."""
    parts = re.split(r"\s*(SUBJECT|COMPOSITION|LIGHT|MOOD|СЕЗОН): ", " " + text)
    out: dict[str, str] = {}
    for i in range(1, len(parts) - 1, 2):
        out[parts[i]] = parts[i + 1].strip().rstrip(".")
    return out


def face_name_look(cast_id: str, name: str, look: str) -> tuple[str, str]:
    """Имя и облик для портрета/спрайта: без повтора скобки имени, если облик сам начинается с «the same man»."""
    if look.startswith("the same"):
        return re.sub(r"\s*\([^)]*\)\s*$", "", name), look
    return name, look


def face_scene(cast_id: str, name: str, look: str) -> str:
    """Блок SCENE характерного портрета-референса: своё место, момент, взгляд и гардероб у каждого (не «паспорт у стены»)."""
    psycho = PSYCHO.get(cast_id, "an ordinary face of the period")
    psycho = psycho[0].upper() + psycho[1:]
    p = PORTRAITS.get(cast_id, PORTRAIT_DEFAULT)
    return "\n".join([
        "SCENE",
        "",
        f"Location and time: {p['where']}",
        f"People and action: {name} ({look}), alone. {psycho}. {p['moment']} The face is fully visible, in focus and "
        "turned to the camera, not covered by hands or objects: this is the casting reference for the face. A specific, "
        "imperfect face of a non-professional actor in a 1990s Russian television series, instantly different from every "
        "other character of the story; the clothes exactly as described, in their own colours and materials. Exactly one "
        "person, head and shoulders, nobody else in the picture.",
        f"Camera position: {p['camera']}",
        f"Light sources: {p['light']}",
        f"Essential objects: {p['objects']}",
    ])


def sprite_scene(name: str, look: str) -> str:
    return "\n".join([
        "SCENE",
        "",
        "Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).",
        f"People and action: Full-body portrait for a visual novel character sprite: {name} ({look}). The person stands in a "
        "three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face "
        "a partner), in natural, unposed posture, whole body in frame including shoes, neutral expression, mouth closed. The "
        "face is exactly the face of the reference portrait.",
        "Camera position: a television camera at chest height, a 40 mm-equivalent field of view, the whole figure in frame with headroom.",
        "Light sources: soft overcast window light from the front-left.",
        "Essential objects: none.",
    ])


def bg_scene(bg_id: str, cell: str) -> str:
    f = split_fields(cell)
    subj = f.get("SUBJECT", cell)
    when = BG_WHEN.get(bg_id, "Moscow, autumn 1993, daytime")
    comp = f.get("COMPOSITION", "")
    light = f.get("LIGHT", "available light")
    return "\n".join([
        "SCENE",
        "",
        f"Location and time: {when}. {subj}.",
        "People and action: The place is empty: no people anywhere in the frame; the centre of the frame is left free for the characters.",
        f"Camera position: {comp}; a television camera at the eye level of a standing person, a 32–40 mm-equivalent field of view, "
        "the horizon straight, the surroundings in focus, the lower third of the frame free of small details (the text box lives there).",
        f"Light sources: {light}.",
        f"Essential objects: {sp.essential_objects('SUBJECT: ' + subj)}; nothing else.",
    ])


def cg_scene(cell: str) -> str:
    f = split_fields(cell)
    subj = f.get("SUBJECT", cell)
    return "\n".join([
        "SCENE",
        "",
        f"Location and time: Moscow, 1993–1994. {subj}.",
        "People and action: as described in the location: people, if any, are small, turned away or hidden by distance and weather; "
        "faces of named characters are the faces of their reference portraits.",
        f"Camera position: {f.get('COMPOSITION', 'eye level')}; a television camera, 32–45 mm-equivalent, the horizon straight.",
        f"Light sources: {f.get('LIGHT', 'available light')}.",
        f"Essential objects: {sp.essential_objects('SUBJECT: ' + subj)}; nothing else.",
    ])


def shot_block(shot: dict) -> str:
    """Референсы и SCENE кадра из промпта планировщика (без базового промпта и блока CONTINUITY)."""
    p = shot["prompt"]
    i = p.find("REFERENCE IMAGES")
    j = p.find("CONTINUITY")
    k = p.find("SCENE\n\nLocation and time:")
    refs = p[i:j].strip() if i >= 0 and j > i else ""
    scene = p[k:].strip() if k >= 0 else ""
    return refs + "\n\n" + scene


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=os.path.join(ROOT, "assets/ep01/manifest.json"))
    a = ap.parse_args()

    ep = sp.load_json(a.episode)
    ru = sp.load_json(os.path.join(ROOT, "locales/ru", f"{ep['id']}.json"))
    cast_info = {c["id"]: c for c in ep["cast"]}
    jobs = sp.ref_jobs(sp.load_json(a.manifest))
    base, continuity = sp.load_prompt_parts()
    sp.LOOKS.update(sp.load_cast_looks())
    subjects = sp.load_bg_subjects()
    md = open(os.path.join(ROOT, "docs/production/prompts/ep01-images.md"), encoding="utf-8").read()
    tables = parse_tables(md)

    def names(who):
        if not who:
            return "someone"
        return sp.NAMES.get(who) or ru.get(f"{ep['id']}.cast.{who}", who)

    def sprite_set_of(who):
        return cast_info.get(who, {}).get("sprite_set") or who

    def ru_name(cid: str) -> str:
        c = cast_info.get(cid)
        return ru.get(c["name_key"], cid) if c else cid

    sets = sp.analyse_sets(ep)
    chosen = [d for d in sets.values() if d["lines"] > 0]
    plans = {d["set"]: sp.plan_set(d, ep, subjects, jobs, base, continuity, names, sprite_set_of) for d in chosen}

    out_main = a.out
    stem = out_main[:-3] if out_main.endswith(".md") else out_main
    L: list[str] = []
    L.append(f"# Промты финальной генерации — эпизод 1 «{ru.get(ep['title_key'], ep['id'])}»")
    L.append("")
    L.append("Сгенерировано `tools/export_prompts.py` (не править руками: правки — в `docs/production/prompts/ep01-images.md`, "
             "`style-bible.md`, `tools/shot_plan.py`, затем перегенерировать). Для каждой картинки промт = **базовый промпт** "
             "(§1 ниже, дословно) + блок из раздела картинки (REFERENCE IMAGES, CONTINUITY, SCENE). Модель: gpt_image_2_5, "
             "quality medium, 2k; фоны, CG и кадры — 16:9, лица — 1:1, документы — 3:4, спрайты — 3:4 с ровным фоном под вырезку.")
    L.append("")
    L.append("## 0. Порядок работы (чтобы лица были одни и те же)")
    L.append("")
    L.append("1. **Лица** (§2): по одному портрету на персонажа без референсов; принятый портрет — `assets/ep01/faces/<id>.webp` — "
             "дальше идёт первым референсом персонажа во всех его картинках (спрайты, кадры, CG). Черновые портреты этой сессии "
             "лежат там же; финальные — заменить файлы, не меняя имён.")
    L.append("2. **Спрайты** (§2, блок SPRITE): база с портретом как Reference 1, затем выражения от базы (стайл-библия §4).")
    L.append("3. **Фоны** (§3) без людей; **CG** (§4); **документы** и **UI** (§5) — по `objects.md`.")
    L.append("4. **Кадры покрытия** по сетам (файлы `*-shots-<set>.md`): сначала `wide_1` с фоном как Reference 1 и портретами "
             "людей; принятый `wide_1` — референс комнаты для ots, вставок и ракурсов; кроп принятого `wide_1` без нижней трети — "
             "референс средних планов и ракурсов; первый принятый крупный план — референс остальных крупных планов и реакций "
             "(порядок референсов в каждом кадре расписан в его блоке REFERENCE IMAGES).")
    L.append("5. Каждый кадр просматривается по стайл-библии §1a; брак перегенерируется тем же промтом.")
    L.append("")
    L.append("## 1. Базовый промпт (стайл-библия §1, подстановки планировщика уже сделаны)")
    L.append("")
    base_ep = base.replace(sp.PERIOD_SOURCE, sp.PERIOD_EPISODE, 1).replace(sp.FRAME_SOURCE, sp.FRAME_EPISODE, 1)
    base_head = base_ep.split("SCENE\n\nLocation and time:")[0].rstrip()
    L.append("```")
    L.append(base_head)
    L.append("```")
    L.append("")
    L.append("Блок CONTINUITY (вставляется после REFERENCE IMAGES, перед SCENE, во все кадры с людьми):")
    L.append("")
    L.append("```")
    L.append(continuity.rstrip("\n"))
    L.append("```")
    L.append("")

    # Персонажи
    L.append("## 2. Персонажи: лица и спрайты")
    L.append("")
    L.append("| id | Имя | Описание (CHARACTER, во все промты персонажа) | Психотип в портрете | Файл лица | Выражения спрайта |")
    L.append("|---|---|---|---|---|---|")
    char_rows = tables.get("Персонажи (базовый кадр по §4 стайл-библии, затем выражения)", [])
    char_desc = {cid: cells[0] for cid, cells in char_rows}
    char_expr = {cid: cells[1] for cid, cells in char_rows}
    for cid, desc in char_desc.items():
        name = names(cid)
        L.append(f"| `{cid}` | {ru_name(cid)} | {desc} | {PSYCHO.get(cid, '—')} | `assets/ep01/faces/{cid}.webp` | {char_expr.get(cid, '')} |")
    L.append("")
    for cid, desc in char_desc.items():
        name, desc = face_name_look(cid, names(cid), desc)
        L.append(f"### `{cid}` — {ru_name(cid)}")
        L.append("")
        L.append("FACE (характерный портрет-референс: своё место, момент и взгляд, лицо целиком в фокусе; 1:1, без референсов; "
                 f"в базовом промпте строка про 16:9 заменяется на «{FACE_FRAME}»):")
        L.append("")
        L.append("```")
        L.append(face_scene(cid, name, desc))
        L.append("```")
        L.append("")
        L.append("SPRITE (база для выражений; Reference 1 — файл лица):")
        L.append("")
        L.append("```")
        L.append(f"REFERENCE IMAGES\nReference 1 is the face of {name}: keep this exact face, hair and build.\n")
        L.append(sprite_scene(name, desc))
        L.append("```")
        L.append("")

    # Фоны
    L.append("## 3. Фоны (без людей, 16:9)")
    L.append("")
    for bg_id, cells in tables.get("Фоны", []):
        L.append(f"### `{bg_id}` — `assets/ep01/bg/{bg_id[3:]}.webp`")
        L.append("")
        L.append("```")
        L.append(bg_scene(bg_id, cells[0]))
        L.append("```")
        L.append("")

    # CG
    L.append("## 4. CG (16:9)")
    L.append("")
    for cg_id, cells in tables.get("CG", []):
        L.append(f"### `{cg_id}`")
        L.append("")
        L.append("```")
        L.append(cg_scene(cells[0]))
        L.append("```")
        L.append("")

    # Документы и UI
    L.append("## 5. Документы и UI (промпт `objects.md`, OBJECT BRIEF)")
    L.append("")
    for sec in ("Документы (без текста, 3:4)", "UI"):
        for did, cells in tables.get(sec, []):
            L.append(f"- `{did}`: {cells[0]}")
    L.append("")
    L.append("Для документов текст накладывает рантайм (`text_key`); бриф по `objects.md`: реальный бланк эпохи как "
             "construction reference, вывод — flat scan 3:4 без читаемых букв.")
    L.append("")

    # Сеты
    L.append("## 6. Кадры покрытия по сетам")
    L.append("")
    L.append("| сет | фон | время | сцены | кадров | файл промтов |")
    L.append("|---|---|---|---|---|---|")
    for d in chosen:
        L.append(f"| {d['set']} | `{d['bg']}` | {d['tod']} | {', '.join(d['scenes'])} | {len(plans[d['set']])} | `{os.path.basename(stem)}-shots-{d['set']}.md` |")
    L.append("")
    with open(out_main, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("main:", out_main)

    for d in chosen:
        S: list[str] = []
        S.append(f"# Кадры покрытия — сет `{d['set']}` (`{d['bg']}`, {d['tod']}; сцены {', '.join(d['scenes'])})")
        S.append("")
        S.append(f"Промт каждого кадра = базовый промпт (`{os.path.basename(out_main)}` §1) + блок ниже; между REFERENCE IMAGES и "
                 "SCENE вставляется блок CONTINUITY (§1). Референсы: «the room» — фон сета или принятый wide_1 / его кроп; "
                 "персонаж — файл лица из §2 (или принятый спрайт). Порядок медиа — как перечислены референсы.")
        S.append("")
        for s in plans[d["set"]]:
            cast = ", ".join(f"{c['who']} ({c.get('expression') or 'neutral'})" for c in s["cast"]) or "без людей"
            S.append(f"## `{s['id']}` — {s['kind']} / {s['angle']} — {cast} → `{s['file']}`")
            S.append("")
            S.append("```")
            S.append(shot_block(s))
            S.append("```")
            S.append("")
        path = f"{stem}-shots-{d['set']}.md"
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(S) + "\n")
        print("set:", path, len(plans[d["set"]]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
