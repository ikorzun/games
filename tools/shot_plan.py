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
        "sledak": "seated across the table with his back to the barred window",
        "oper": "standing by the door with arms folded",
        "buyer": "on the chair under the lamp, hands on the table",
        "murashov": "on the chair under the lamp, hands folded on the table",
        "notary": "on the chair under the lamp, wiping his forehead",
    },
    "bg_apartment_zoya": {
        "zoya": "by the sideboard, touching the framed photo",
        "murashov_sil": "in the doorway, seen from behind, face hidden",
        "sledak": "in the middle of the room, notebook in hand",
        "expert": "crouched by the bedside table, examining medicine bottles",
        "oper": "by the window, looking down at the yard",
        "buyer": "by the window, uneasy",
        "lapin_wife": "sitting on the edge of the bed, coat still on",
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
        "the notary's hand pressing a round stamp onto a document, the ink pad open",
        "a signature page and an elderly hand holding a pen uncertainly",
    ],
    "bg_stairwell": [
        "a padded apartment door with a new brass lock and a paper seal across the frame",
        "dented metal mailboxes, one stuffed with unopened newspapers",
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

ANGLES = [
    ("low", "low angle from the height of the desk, the ceiling and the top of the safe in frame"),
    ("high", "high angle from the top of the cabinet, looking down at the people in the room"),
    ("doorway", "from the corridor through the half-open door, the door frame as a frame within the frame"),
]

SHOT_LIMITS = {"wide": 4, "medium": 4, "ots": 8, "close": 16, "reaction": 5, "insert": 2, "angle": 3}

HIDDEN_FACE = {"murashov_sil"}


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fenced_blocks(md: str) -> list[str]:
    return re.findall(r"```\n(.*?)```", md, flags=re.S)


def load_prompt_parts() -> tuple[str, str]:
    """Базовый промпт (§1) и блок реализма/непрерывности из стайл-библии."""
    md = open(os.path.join(ROOT, "docs/production/prompts/style-bible.md"), encoding="utf-8").read()
    blocks = fenced_blocks(md)
    base = next(b for b in blocks if b.startswith("Create a photorealistic cinematic still"))
    realism = next(b for b in blocks if b.startswith("PHOTOGRAPHIC REALISM"))
    return base, realism


def load_bg_subjects() -> dict[str, str]:
    md = open(os.path.join(ROOT, "docs/production/prompts/ep01-images.md"), encoding="utf-8").read()
    out = {}
    for line in md.splitlines():
        m = re.match(r"\| `(bg_[a-z0-9_]+)` \| (SUBJECT: .*?)\s*\|\s*$", line)
        if m:
            # COMPOSITION и LIGHT фона описывают кадр фона; у кадра покрытия своя камера и свой свет
            subj = re.sub(r"\s*(?:COMPOSITION|LIGHT): .*?(?=\s[A-Z]{3,}: |$)", "", m.group(2))
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
    return {it["id"]: it["job"] for it in manifest if it.get("job") and it["kind"] in ("bg", "sprite")}


def camera_block(kind: str, angle: str, cast: list[dict], focus: str | None, from_who: str | None, names) -> str:
    """Блок CAMERA (this shot) по стайл-библии §1a."""
    if kind == "wide":
        size = "wide establishing shot, the whole room, people small inside the space"
        lens = "35mm, deep focus"
        comp = "everyone visible in full, lower third of the frame kept free of faces (the text box lives there), headroom above the tallest person"
        feel = "the viewer should feel the room is bigger than the people in it"
    elif kind == "medium":
        size = f"medium shot, waist up, {len(cast)} people"
        lens = "40mm, moderate depth of field"
        comp = "people share the frame at a natural distance from each other, faces in the upper two thirds"
        feel = "a conversation in progress, nothing staged"
    elif kind == "ots":
        size = f"over-the-shoulder shot: the back of {names(from_who)}'s head and shoulder in the near foreground, {names(focus)} facing the camera beyond"
        lens = "50mm, shallow depth of field, the foreground shoulder soft"
        comp = f"{names(focus)} framed in the right or left two thirds with looking room toward the foreground shoulder; the 180-degree axis of the conversation is kept"
        feel = "we listen from one side of the conversation"
    elif kind == "close":
        size = f"close-up of {names(focus)}, face and shoulders"
        lens = "85mm portrait, very shallow depth of field, background softly blurred"
        comp = "the face in the upper two thirds of the frame, eyes on the upper third line, little headroom"
        feel = "every flicker of expression counts"
    elif kind == "reaction":
        size = f"reaction shot: {names(focus)} listening, not speaking, medium close-up"
        lens = "85mm, shallow depth of field"
        comp = "the listener slightly off-centre, a soft edge of the speaker's shoulder in the near foreground"
        feel = "the listener's face tells the truth the speaker will not"
    elif kind == "insert":
        size = "insert, extreme close-up of a detail"
        lens = "85mm macro-like, very shallow depth of field"
        comp = "the detail fills the frame, no faces"
        feel = "a pause on the evidence"
    else:  # angle
        size = "cutaway from an unexpected angle, the whole room"
        lens = "28mm, deep focus, no fisheye distortion"
        comp = "people inside the space, unusual vantage point"
        feel = "pressure, surveillance: the system is bigger than the people"
    a = {
        "eye": "eye level",
        "low": "low angle from desk height, part of the ceiling in frame",
        "high": "high angle from the top of the cabinet",
        "doorway": "from the corridor through the half-open door",
        "reflection": "reflection in the window glass",
        "foreground": "with objects on the near foreground partly covering the frame",
    }[angle]
    return (
        "CAMERA (this shot)\n"
        f"- Shot size: {size}.\n"
        f"- Angle and height: {a}.\n"
        f"- Lens: {lens}.\n"
        f"- Composition: {comp}.\n"
        f"- Framing is motivated by the moment: {feel}."
    )


def build_prompt(base: str, realism: str, shot: dict, bg_subject: str, tod: str, bg_id: str, names, present: list[str]) -> str:
    """Собрать промпт кадра: база §1 с заменённым CAMERA + реализм + референсы + сцена."""
    cam = camera_block(shot["kind"], shot["angle"], shot["cast"], shot.get("focus"), shot.get("from"), names)
    # заменить блок CAMERA базового промпта
    body = re.sub(r"CAMERA\n(?:- [^\n]*\n)+", cam + "\n", base, count=1)
    body = body.replace("IMPORTANT RESTRICTIONS", realism.rstrip("\n") + "\n\nIMPORTANT RESTRICTIONS", 1)
    # референсы
    refs = ["Reference 1 is the room itself: keep its furniture, window, lamps and props exactly where they are."]
    for i, c in enumerate(shot["cast"], start=2):
        who = c["who"]
        tail = "; this person's face is never shown clearly: back to the camera, turned away or in shadow" if who in HIDDEN_FACE else ""
        look = LOOKS.get(who) or LOOKS.get(shot.get("_sets", {}).get(who, ""), "")
        desc = f" ({look})" if look else ""
        refs.append(f"Reference {i} is {names(who)}{desc}: keep this exact face, hair, build and clothing{tail}.")
    ref_block = "REFERENCE IMAGES\n" + " ".join(refs)
    staging = STAGING.get(bg_id, {})
    people = []
    for c in shot["cast"]:
        who = c["who"]
        expr = EXPRESSIONS.get(c.get("expression") or "neutral", "calm face")
        place = staging.get(who, "in the room")
        people.append(f"{names(who)} {place}, {expr}")
    if shot["kind"] == "insert":
        action = shot["detail"]
        people_txt = "No faces in frame."
    else:
        people_txt = "People in frame: " + "; ".join(people) + "." if people else "The room is empty."
        action = shot.get("action", "")
    scene = (
        "SCENE TO DEPICT:\n"
        f"Moscow, 1993. {bg_subject} LIGHT NOW: {LIGHTING.get(tod, LIGHTING['day'])}. "
        f"{people_txt} {action}".strip()
    )
    body = body.replace("SCENE TO DEPICT:\n[insert specific scene description here]", ref_block + "\n\n" + scene)
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

    def ref_media(cast: list[dict]) -> list[str]:
        out = [jobs.get(bg)]
        for c in cast:
            ss = sprite_set_of(c["who"])
            expr = c.get("expression") or "neutral"
            out.append(jobs.get(f"{ss}.{expr}") or jobs.get(f"{ss}.neutral"))
        return [m for m in out if m]

    def add(kind: str, name: str, cast: list[dict], **extra) -> None:
        shot = {"id": f"sh_{set_name}_{name}", "set": set_name, "bg": bg, "kind": kind, "angle": extra.pop("angle", "eye"), "cast": cast, "file": f"assets/ep01/shots/{set_name}/{name}.webp"}
        shot.update(extra)
        shot["medias"] = ref_media(cast)
        shot["_sets"] = {c["who"]: sprite_set_of(c["who"]) for c in cast}
        shot["prompt"] = build_prompt(base, realism, shot, subject, tod, bg, names, [c["who"] for c in cast])
        del shot["_sets"]
        shots.append(shot)

    comps = [c for c, _ in d["comps"].most_common(SHOT_LIMITS["wide"]) if c]
    for i, comp in enumerate(comps, start=1):
        cast = [{"who": w, "expression": "neutral"} for w in comp]
        add("wide", f"wide_{i}", cast, action="Nobody speaks; a pause in the room.")
    for i, comp in enumerate(comps[: SHOT_LIMITS["medium"]], start=1):
        cast = [{"who": w, "expression": "neutral"} for w in comp]
        add("medium", f"medium_{i}", cast, action="They are mid-conversation; one has just stopped talking.")
    for (a, b), _ in d["pairs"].most_common(SHOT_LIMITS["ots"]):
        cast = [{"who": b, "expression": "neutral"}, {"who": a, "expression": "neutral"}]
        add("ots", f"ots_{a}_{b}", cast, **{"from": a, "focus": b},
            action=(f"The camera stands just behind {names(a)}: the back of {names(a)}'s head and shoulder fill the near "
                    f"foreground out of focus, and {names(a)} is not seen from the front. {names(b)} is the person farther "
                    f"from the camera, face to the lens, speaking to {names(a)}. Do not swap the two people."))
    for (who, expr), _ in d["closes"].most_common(SHOT_LIMITS["close"]):
        if who in HIDDEN_FACE:
            continue
        add("close", f"close_{who}_{expr}", [{"who": who, "expression": expr}], focus=who, action=f"{names(who)} is speaking; {EXPRESSIONS.get(expr, '')}.")
    for who, _ in d["present"].most_common(SHOT_LIMITS["reaction"]):
        if who in HIDDEN_FACE:
            continue
        add("reaction", f"reaction_{who}", [{"who": who, "expression": "neutral"}], focus=who, action=f"{names(who)} is listening to someone off frame, silent.")
    for i, detail in enumerate(INSERTS.get(bg, [])[: SHOT_LIMITS["insert"]], start=1):
        add("insert", f"insert_{i}", [], detail=detail)
    main_comp = comps[0] if comps else ()
    for ang, desc in ANGLES[: SHOT_LIMITS["angle"]]:
        cast = [{"who": w, "expression": "neutral"} for w in main_comp]
        add("angle", f"angle_{ang}", cast, angle=ang, action=desc + ".")
    return shots


def write_md(path: str, sets: list[dict], plans: dict[str, list[dict]]) -> None:
    lines = ["# Шот-лист эпизода 1 по сетам", "",
             "Сгенерировано `tools/shot_plan.py` по эпизоду: сет = фон × время суток; состав, пары собеседников и выражения —",
             "из сцен. Промпты — `assets/ep01/shots/plan.json` (база стайл-библии §1 с блоком CAMERA §1a, PHOTOGRAPHIC REALISM,",
             "CONTINUITY и референсами фона и спрайтов). Каждый кадр после генерации просматривается; брак перегенерируется.", ""]
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
