#!/usr/bin/env python3
"""Линтер дела (режим поиска улик, docs/architecture/09-case-mode.md): schemas/case.schema.json + ссылки на эпизод.

Вызывается из tools/validate_episode.py для файлов *.case.json (CI гоняет линтер по всем JSON в episodes/):
  python3 tools/validate_episode.py episodes/s1/ep01_murylev.case.json

Проверяет: схему; фоны, актёров, спрайты и мини-игры — по эпизоду рядом; шаги разговоров — схемой шага эпизода, без
переходов (переход в конце дописывает рантайм); задачи — ссылки, порядок requires, бесплатный старт главы; предметы
сцен — улики и pick; ключи локали — в ru (ошибка) и в en/es/pt (предупреждение).
"""
from __future__ import annotations

import os

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASE_SCHEMA = os.path.join(ROOT, "schemas", "case.schema.json")
EPISODE_SCHEMA = os.path.join(ROOT, "schemas", "episode.schema.json")
LANGS = ("ru", "en", "es", "pt")
TRANSITIONS = {"jump", "branch", "choice", "minigame", "end"}


def collect_keys(o, out: set[str]) -> set[str]:
    """Все ключи локали: поля key и *_key."""
    if isinstance(o, dict):
        for k, v in o.items():
            if (k == "key" or k.endswith("_key")) and isinstance(v, str):
                out.add(v)
            else:
                collect_keys(v, out)
    elif isinstance(o, list):
        for x in o:
            collect_keys(x, out)
    return out


def case_keys(case_path: str, load_json) -> set[str]:
    """Ключи дела — чтобы линтер эпизода не считал их неиспользуемыми."""
    return collect_keys(load_json(case_path), set()) if os.path.exists(case_path) else set()


def lint_case(path: str, locales_dir: str, rep, load_json) -> dict:
    case = load_json(path)
    v = Draft202012Validator(load_json(CASE_SCHEMA))
    for e in sorted(v.iter_errors(case), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in e.absolute_path) or "<root>"
        rep.err(f"schema {where}: {e.message[:300]}")
    if rep.errors:
        return case

    ep_path = os.path.join(os.path.dirname(path), f"{case['episode']}.json")
    if not os.path.exists(ep_path):
        rep.err(f"эпизод {case['episode']}: нет файла {ep_path}")
        return case
    ep = load_json(ep_path)
    bgs = {b["id"] for b in ep.get("assets", {}).get("backgrounds", [])}
    cast = {c["id"] for c in ep.get("cast", [])}
    sprites = {s["id"]: s for s in ep.get("assets", {}).get("sprites", [])}
    minigames = ep.get("minigames", {})

    traits = {t["id"] for t in case["traits"]}
    suspects = {s["id"]: s for s in case["suspects"]}
    clues = {c["id"] for c in case["clues"]}
    facts = {f["id"]: f for f in case.get("facts", [])}
    for kind, items in (("traits", case["traits"]), ("suspects", case["suspects"]), ("clues", case["clues"]), ("facts", case.get("facts", []))):
        ids = [x["id"] for x in items]
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            rep.err(f"{kind}: повтор id {dup}")
    for s in case["suspects"]:
        if s.get("who") and s["who"] not in cast:
            rep.err(f"suspects.{s['id']}: актёра {s['who']} нет в эпизоде")
    for f in case.get("facts", []):
        if f.get("suspect") and f["suspect"] not in suspects:
            rep.err(f"facts.{f['id']}: подозреваемого {f['suspect']} нет")

    # сцены поиска
    for sid, sc in case["scenes"].items():
        where = f"scenes.{sid}"
        if sc["bg"] not in bgs:
            rep.err(f"{where}: фона {sc['bg']} нет в эпизоде")
        ids = [it["id"] for it in sc["items"]]
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            rep.err(f"{where}: повтор предмета {dup}")
        clue_items = [it for it in sc["items"] if it.get("clue")]
        for it in clue_items:
            if it["clue"] not in clues:
                rep.err(f"{where}.{it['id']}: улики {it['clue']} нет в clues")
        if sc["pick"] > len(sc["items"]):
            rep.err(f"{where}: pick {sc['pick']} больше числа предметов {len(sc['items'])}")
        if len(clue_items) > sc["pick"]:
            rep.err(f"{where}: улик-предметов {len(clue_items)} больше pick {sc['pick']}")
        if len(sc["items"]) - sc["pick"] < 3:
            rep.warn(f"{where}: предметов всего на {len(sc['items']) - sc['pick']} больше pick — повтор сцены почти не меняет список")
        if sc["star_time_ms"] >= sc["time_limit_ms"]:
            rep.warn(f"{where}: star_time_ms не меньше time_limit_ms — ★ за скорость даётся всегда")
        for it in sc["items"]:
            x, y, w, h = it["rect"]
            if x + w > 1.0001 or y + h > 1.0001:
                rep.err(f"{where}.{it['id']}: рамка выходит за кадр")

    # разговоры: шаги эпизода без переходов
    ep_schema = load_json(EPISODE_SCHEMA)
    step_v = Draft202012Validator({"$ref": "#/$defs/step", "$defs": ep_schema["$defs"]})
    stage_v = Draft202012Validator({"$ref": "#/$defs/stage", "$defs": ep_schema["$defs"]})
    for tid, talk in case["talks"].items():
        where = f"talks.{tid}"
        for e in stage_v.iter_errors(talk["stage"]):
            rep.err(f"{where}.stage: {e.message[:200]}")
        if talk["stage"].get("bg") not in bgs:
            rep.err(f"{where}.stage: фона {talk['stage'].get('bg')} нет в эпизоде")
        for i, st in enumerate(talk["steps"]):
            errs = list(step_v.iter_errors(st))
            if errs:
                e = best_match(errs[0].context or errs) if errs[0].context else errs[0]
                rep.err(f"{where}.steps[{i}] ({st.get('do')}): {e.message[:200]}")
                continue
            if st["do"] in TRANSITIONS:
                rep.err(f"{where}.steps[{i}]: переход {st['do']} — в разговоре дела переходы не нужны, конец дописывает рантайм")
            who = st.get("who")
            if who and who not in cast:
                rep.err(f"{where}.steps[{i}]: актёра {who} нет в эпизоде")
            expr = st.get("expression")
            if who and expr and who in sprites and expr not in sprites[who].get("expressions", []):
                rep.warn(f"{where}.steps[{i}]: у {who} нет спрайта {expr}")
        n_lines = sum(1 for st in talk["steps"] if st["do"] in ("say", "narrate"))
        if n_lines > 4:
            rep.warn(f"{where}: {n_lines} реплик — в разговоре дела не больше 4 (09-case-mode.md)")

    # главы и задачи
    seen_tasks: set[str] = set()
    given: dict[str, set[str]] = {"clues": set(), "suspects": set(), "traits": set(), "facts": set()}
    refs = {"clues": clues, "suspects": set(suspects), "traits": traits, "facts": set(facts)}
    talks_used: set[str] = set()
    for ch in case["chapters"]:
        cw = f"chapters.{ch['id']}"
        for t in ("intro", "outro"):
            if ch.get(t):
                talks_used.add(ch[t])
                if ch[t] not in case["talks"]:
                    rep.err(f"{cw}.{t}: разговора {ch[t]} нет")
        if ch.get("locked"):
            continue
        ch_tasks: set[str] = set()
        for task in ch["tasks"]:
            tw = f"{cw}.{task['id']}"
            if task["id"] in seen_tasks:
                rep.err(f"{tw}: повтор id задачи")
            for r in task["requires"]:
                if r not in ch_tasks:
                    rep.err(f"{tw}: requires {r} — не задача этой главы выше по списку")
            seen_tasks.add(task["id"])
            ch_tasks.add(task["id"])
            kind = task["kind"]
            if task.get("scene") and task["scene"] not in case["scenes"]:
                rep.err(f"{tw}: сцены {task['scene']} нет")
            if kind == "photo" and task.get("scene") in case["scenes"]:
                if task["item"] not in {it["id"] for it in case["scenes"][task["scene"]]["items"]}:
                    rep.err(f"{tw}: предмета {task['item']} нет в сцене {task['scene']}")
            if task.get("talk"):
                talks_used.add(task["talk"])
                if task["talk"] not in case["talks"]:
                    rep.err(f"{tw}: разговора {task['talk']} нет")
            if kind == "minigame" and task["minigame"] not in minigames:
                rep.err(f"{tw}: мини-игры {task['minigame']} нет в эпизоде")
            for what, ids in task.get("gives", {}).items():
                for i in ids:
                    if i not in refs[what]:
                        rep.err(f"{tw}.gives.{what}: {i} не объявлен")
                    given[what].add(i)
        starts = [t for t in ch["tasks"] if not t["requires"]]
        if not starts:
            rep.err(f"{cw}: нет задачи без requires — главу не начать")
        elif not any(t["cost"] == 0 for t in starts):
            rep.err(f"{cw}: стартовые задачи платные, а ★ в начале нет — главу не начать")
        if ch["tasks"] and not any(t["kind"] == "search" for t in ch["tasks"]):
            rep.warn(f"{cw}: нет сцены поиска — ★ на платные задачи взять неоткуда")
    for tid in case["talks"]:
        if tid not in talks_used:
            rep.warn(f"talks.{tid}: разговор нигде не используется")
    for sid, sc in case["scenes"].items():
        for it in sc["items"]:
            if it.get("clue") and it["clue"] not in given["clues"]:
                rep.warn(f"scenes.{sid}.{it['id']}: улику {it['clue']} не выдаёт ни одна задача — предмет останется обязательным навсегда")

    # локализация
    keys = collect_keys(case, set())
    for lang in LANGS:
        found: set[str] = set()
        for name in (f"{case['episode']}.json", "ui.json"):
            p = os.path.join(locales_dir, lang, name)
            if os.path.exists(p):
                found |= {k for k, val in load_json(p).items() if lang == "ru" or str(val).strip()}
        missing = sorted(k for k in keys if k not in found)
        if missing:
            (rep.err if lang == "ru" else rep.warn)(f"локализация {lang}: нет {len(missing)} ключей, напр. {missing[:5]}")
    return case
