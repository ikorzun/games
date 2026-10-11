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
    "zoya": "trusting and kind, shy of being a burden, lonely; a small bright face that lights up at the thought of her grandson",
    "neighbor": "observant and pushy until it concerns herself, then afraid of being involved; a sturdy face used to talking in stairwells",
    "buyer": "an honest man under a steamroller: polite confusion turning into panic; thin, anxious, early lines on the face",
    "lapin_wife": "a mother defending her home: she holds longer than her husband and breaks deeper; pale, tired eyes, hair pulled back",
    "clerk": "the mistress of the archive: strictness as a form of care, a mocking mouth; short grey hair, glasses",
    "accomplice": "an empty executor who only drove and believed he was helping people move; thick neck, boxer's build, a scared, uncomprehending look",
}

FACE_FRAME = "Square composition 1:1, one frame, without borders."

# Облик для портрета и спрайта там, где базовое описание из таблицы персонажей повторяет имя или задаёт позу
# (следователь 2004 года в таблице «сидит на интервью» — портрет и спрайт снимаются стоя).
FACE_LOOK = {
    "sledak_old": "the same man at 40: heavier, grey at the temples, lines around the eyes; dark blazer, open collar",
}


def face_name_look(cast_id: str, name: str, look: str) -> tuple[str, str]:
    """Имя и облик для портрета/спрайта: без повтора скобки из имени и без позы интервью."""
    if cast_id in FACE_LOOK:
        return re.sub(r"\s*\([^)]*\)\s*$", "", name), FACE_LOOK[cast_id]
    return name, look


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


def face_scene(cast_id: str, name: str, look: str) -> str:
    """Блок SCENE портрета-референса лица (одно лицо на все картинки персонажа)."""
    psycho = PSYCHO.get(cast_id, "an ordinary face of the period")
    psycho = psycho[0].upper() + psycho[1:]
    return "\n".join([
        "SCENE",
        "",
        "Location and time: Moscow, autumn 1993, daytime. An identity portrait made by the television crew for continuity: "
        "the person stands against a plain, evenly lit beige wall of an ordinary office corridor; nothing else is in the frame.",
        f"People and action: {name} ({look}), alone. {psycho}. The face is straight to the camera, neutral, mouth closed, "
        "eyes to the lens, hair and clothing exactly as described; a real, ordinary, slightly asymmetrical face, not a model's. "
        "Exactly one person, head and shoulders.",
        "Camera position: A television camera at the eye level of the person, a 50 mm-equivalent field of view, a medium "
        "close-up: the head and shoulders fill the frame with a little headroom, the horizon straight, the wall in focus behind.",
        "Light sources: soft overcast window light from the front-left and a plain ceiling fixture; no separate face lighting.",
        "Essential objects: none: the plain wall only.",
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
        L.append("FACE (портрет-референс, 1:1, без референсов; в базовом промпте строка про 16:9 заменяется на "
                 f"«{FACE_FRAME}»):")
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
