#!/usr/bin/env python3
"""Линтер эпизодов: schema + ссылочная целостность + достижимость + локализация + ассеты.

Использование:
  python3 tools/validate_episode.py episodes/examples/ep01_murylev.json [--locales locales] [--strict]

Коды выхода: 0 — ок (возможны warnings), 1 — есть ошибки (или warnings при --strict).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vnexpr  # noqa: E402

try:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import best_match
except ImportError:  # pragma: no cover
    print("нужен пакет jsonschema: pip install jsonschema", file=sys.stderr)
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "schemas", "episode.schema.json")
LANGS = ("ru", "en", "es", "pt")
TERMINAL = {"jump", "branch", "choice", "minigame", "end"}
AD_BREAK_TYPES = {"title_card", "epilogue", "archive_break", "editorial"}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def schema_check(ep: dict, rep: Report) -> None:
    schema = load_json(SCHEMA_PATH)
    v = Draft202012Validator(schema)
    for e in sorted(v.iter_errors(ep), key=lambda e: list(e.absolute_path)):
        # oneOf на step даёт шумные сообщения — берём наиболее подходящую подошибку
        if e.context:
            do = e.instance.get("do") if isinstance(e.instance, dict) else None
            cands = [c for c in e.context if do is None or _matches_do(c, do)] or list(e.context)
            e = best_match(cands)
        path = "/".join(str(p) for p in e.absolute_path) or "<root>"
        msg = e.message if len(e.message) < 300 else e.message[:300] + "…"
        rep.err(f"schema {path}: {msg}")


def _matches_do(err, do: str) -> bool:
    # подошибка относится к ветке oneOf, чья const do совпадает со значением шага
    sch = err.schema if isinstance(err.schema, dict) else {}
    # ошибки внутри ветки: поднимаемся по родителям до схемы ветки
    e = err
    while e.parent is not None and e.parent.validator != "oneOf":
        e = e.parent
    branch = e.schema if isinstance(e.schema, dict) else {}
    props = branch.get("properties", {})
    d = props.get("do", {})
    return d.get("const") == do or do in d.get("enum", [])


def iter_steps(ep: dict):
    for sid, scene in ep.get("scenes", {}).items():
        for i, step in enumerate(scene.get("steps", [])):
            yield sid, i, step


def collect_targets(step: dict) -> list[str]:
    do = step.get("do")
    if do == "jump":
        return [step["scene"]]
    if do == "branch":
        return [c["goto"] for c in step["cases"]] + [step["default"]]
    if do == "choice":
        return [o["goto"] for o in step["options"]]
    return []


def integrity(ep: dict, rep: Report) -> None:
    scenes = ep.get("scenes", {})
    blocks = ep.get("blocks", [])
    cast = {c["id"]: c for c in ep.get("cast", [])}
    variables = set(ep.get("variables", {}).keys())
    minigames = ep.get("minigames", {})
    endings = {e["id"]: e for e in ep.get("endings", [])}
    archive = {a["id"] for a in ep.get("archive_items", [])}
    assets = ep.get("assets", {})
    asset_ids = {k: {a["id"] for a in assets.get(k, [])} for k in
                 ("backgrounds", "cg", "documents", "music", "sfx", "ambient", "voice")}
    sprites = {s["id"]: s for s in assets.get("sprites", [])}

    # scene.id == key
    for sid, scene in scenes.items():
        if scene.get("id") != sid:
            rep.err(f"scenes.{sid}: поле id ({scene.get('id')}) не совпадает с ключом")

    # blocks
    block_ids = [b["id"] for b in blocks]
    if len(block_ids) != len(set(block_ids)):
        rep.err("blocks: дублирующиеся id")
    block_set = set(block_ids)
    for b in blocks:
        es = b["entry_scene"]
        if es not in scenes:
            rep.err(f"block {b['id']}: entry_scene {es} не существует")
        elif scenes[es].get("block") != b["id"]:
            rep.err(f"block {b['id']}: entry_scene {es} принадлежит блоку {scenes[es].get('block')}")
        for sid in b.get("scenes", []):
            if sid not in scenes:
                rep.err(f"block {b['id']}: сцена {sid} из списка scenes не существует")
            elif scenes[sid].get("block") != b["id"]:
                rep.err(f"block {b['id']}: сцена {sid} помечена блоком {scenes[sid].get('block')}")
        if b.get("ad_break_allowed") and b["type"] not in AD_BREAK_TYPES and not b.get("act"):
            rep.warn(f"block {b['id']}: ad_break_allowed на блоке типа {b['type']} без act — реклама не в естественной паузе")
        if b.get("when"):
            for m in vnexpr.check(b["when"], variables):
                rep.err(f"block {b['id']}.when: {m}")
    if blocks and blocks[0]["type"] not in ("cold_open", "title_card", "chronicle"):
        rep.warn(f"первый блок имеет тип {blocks[0]['type']}; ожидается cold_open/title_card/chronicle")
    if blocks and blocks[-1]["type"] != "epilogue":
        rep.warn(f"последний блок имеет тип {blocks[-1]['type']}; ожидается epilogue")

    for sid, scene in scenes.items():
        if scene.get("block") not in block_set:
            rep.err(f"scene {sid}: блок {scene.get('block')} не объявлен")
        st = scene.get("stage", {})
        if st.get("bg") not in asset_ids["backgrounds"]:
            rep.err(f"scene {sid}: фон {st.get('bg')} отсутствует в assets.backgrounds")
        for key in ("music", "ambient"):
            if scene.get(key) and scene[key] not in asset_ids[key]:
                rep.err(f"scene {sid}: {key} {scene[key]} отсутствует в assets.{key}")
        steps = scene.get("steps", [])
        if not steps:
            continue
        if steps[-1].get("do") not in TERMINAL:
            rep.err(f"scene {sid}: последний шаг должен быть одним из {sorted(TERMINAL)} (явный переход)")
        for i, step in enumerate(steps[:-1]):
            if step.get("do") in ("jump", "end", "branch"):
                rep.warn(f"scene {sid} step {i}: безусловный {step['do']} не в конце сцены — следующие шаги недостижимы")

    # steps
    ending_refs: set[str] = set()
    for sid, i, step in iter_steps(ep):
        where = f"scene {sid} step {i} ({step.get('do')})"
        do = step.get("do")
        if do in ("say", "show", "hide"):
            who = step.get("who")
            if who not in cast:
                rep.err(f"{where}: персонаж {who} не в cast")
            else:
                ss = cast[who].get("sprite_set")
                expr = step.get("expression")
                if do in ("say", "show") and expr:
                    if not ss:
                        rep.err(f"{where}: expression без sprite_set у персонажа {who}")
                    elif ss not in sprites:
                        rep.err(f"{where}: sprite_set {ss} не найден в assets.sprites")
                    elif expr not in sprites[ss]["expressions"]:
                        rep.err(f"{where}: expression {expr} нет в наборе {ss}")
                if do == "show" and not ss and not step.get("silhouette"):
                    rep.warn(f"{where}: show персонажа {who} без sprite_set")
        if do in ("say", "narrate") and step.get("voice") and step["voice"] not in asset_ids["voice"]:
            rep.err(f"{where}: voice {step['voice']} отсутствует в assets.voice")
        if do == "bg" and step["bg"] not in asset_ids["backgrounds"]:
            rep.err(f"{where}: фон {step['bg']} отсутствует в assets.backgrounds")
        if do == "cg" and step["cg"] not in asset_ids["cg"]:
            rep.err(f"{where}: cg {step['cg']} отсутствует в assets.cg")
        if do == "document":
            if step["doc"] not in asset_ids["documents"]:
                rep.err(f"{where}: документ {step['doc']} отсутствует в assets.documents")
            if step.get("adds_to_archive") and step["adds_to_archive"] not in archive:
                rep.err(f"{where}: adds_to_archive {step['adds_to_archive']} не в archive_items")
        if do in ("music", "sfx", "ambient"):
            if not step.get("id"):
                rep.err(f"{where}: нет id аудио")
            elif step["id"] not in asset_ids[do]:
                rep.err(f"{where}: {do} {step['id']} отсутствует в assets.{do}")
        if do == "choice":
            oids = [o["id"] for o in step["options"]]
            if len(oids) != len(set(oids)):
                rep.err(f"{where}: дублирующиеся id опций")
            if step.get("timer_ms") and not step.get("default_option"):
                rep.err(f"{where}: timer_ms без default_option")
            if step.get("default_option") and step["default_option"] not in oids:
                rep.err(f"{where}: default_option {step['default_option']} не среди опций")
            if step.get("timer_ms") and step.get("kind") not in ("tactical", "dialogue"):
                rep.warn(f"{where}: таймер на выборе типа {step.get('kind')} — таймеры только для tactical/dialogue")
            for o in step["options"]:
                if o.get("when"):
                    for m in vnexpr.check(o["when"], variables):
                        rep.err(f"{where} option {o['id']}.when: {m}")
                for eff in o.get("effects", []):
                    check_effect(eff, variables, ep, f"{where} option {o['id']}", rep)
        if do == "set":
            for eff in step["effects"]:
                check_effect(eff, variables, ep, where, rep)
        if do == "branch":
            for c in step["cases"]:
                for m in vnexpr.check(c["when"], variables):
                    rep.err(f"{where}.when: {m}")
        if do in ("say", "narrate") and step.get("when"):
            for m in vnexpr.check(step["when"], variables):
                rep.err(f"{where}.when: {m}")
        for t in collect_targets(step):
            if t not in scenes:
                rep.err(f"{where}: переход на несуществующую сцену {t}")
        if do == "minigame":
            mg = step["minigame"]
            if mg not in minigames:
                rep.err(f"{where}: мини-игра {mg} не объявлена")
        if do == "archive_unlock" and step["item"] not in archive:
            rep.err(f"{where}: archive item {step['item']} не объявлен")
        if do == "end":
            ending_refs.add(step["ending"])
            if step["ending"] not in endings:
                rep.err(f"{where}: концовка {step['ending']} не объявлена")

    # minigames
    for mid, mg in minigames.items():
        if mg.get("id") != mid:
            rep.err(f"minigames.{mid}: id не совпадает с ключом")
        cfg_schema = os.path.join(ROOT, "schemas", "minigames", f"{mg['type']}.schema.json")
        if os.path.exists(cfg_schema):
            for e in Draft202012Validator(load_json(cfg_schema)).iter_errors(mg.get("config", {})):
                path = "/".join(str(p) for p in e.absolute_path) or "<config>"
                rep.err(f"minigame {mid} config {path}: {e.message[:200]}")
        elif mg["type"] != "custom":
            rep.warn(f"minigame {mid}: нет схемы конфига schemas/minigames/{mg['type']}.schema.json")
        for name, oc in mg.get("outcomes", {}).items():
            if oc["goto"] not in scenes:
                rep.err(f"minigame {mid}.outcomes.{name}: сцена {oc['goto']} не существует")
            for eff in oc.get("effects", []):
                check_effect(eff, variables, ep, f"minigame {mid}.outcomes.{name}", rep)
            if oc.get("archive_unlock") and oc["archive_unlock"] not in archive:
                rep.err(f"minigame {mid}.outcomes.{name}: archive item {oc['archive_unlock']} не объявлен")
        if not mg.get("skip", {}).get("allowed", False):
            rep.warn(f"minigame {mid}: skip.allowed=false — нарушает требование доступности «режим только история»")
        used = any(s.get("do") == "minigame" and s.get("minigame") == mid for _, _, s in iter_steps(ep))
        if not used:
            rep.warn(f"minigame {mid}: не вызывается ни в одной сцене")

    # endings
    for eid, e in endings.items():
        if e.get("epilogue_scene") and e["epilogue_scene"] not in scenes:
            rep.err(f"ending {eid}: epilogue_scene {e['epilogue_scene']} не существует")
        if eid not in ending_refs:
            rep.warn(f"ending {eid}: ни один шаг end не ведёт к этой концовке")
    if not any(e.get("kind") == "canonical" for e in endings.values()):
        rep.err("endings: нет концовки kind=canonical (реальный исход дела обязателен)")

    # cast sprite sets
    for cid, c in cast.items():
        if c.get("sprite_set") and c["sprite_set"] not in sprites:
            rep.err(f"cast {cid}: sprite_set {c['sprite_set']} не найден")
        if c.get("real_person") and ep["based_on"]["fictionalization"].get("legal_review", "none") == "none":
            rep.warn(f"cast {cid}: real_person=true, а legal_review=none")

    # reachability
    if blocks:
        start = blocks[0]["entry_scene"]
        seen: set[str] = set()
        q = deque([start])
        while q:
            s = q.popleft()
            if s in seen or s not in scenes:
                continue
            seen.add(s)
            for step in scenes[s].get("steps", []):
                for t in collect_targets(step):
                    q.append(t)
                if step.get("do") == "minigame" and step["minigame"] in minigames:
                    for oc in minigames[step["minigame"]]["outcomes"].values():
                        q.append(oc["goto"])
        for sid in scenes:
            if sid not in seen:
                rep.warn(f"scene {sid}: недостижима из {start}")

    # content warnings
    if ep["archetype"] in ("serial_killer", "cannibal", "family_murder") and not ep.get("content_warnings"):
        rep.warn("content_warnings пусты для тяжёлого архетипа")


def check_effect(eff: dict, variables: set[str], ep: dict, where: str, rep: Report) -> None:
    v = eff["var"]
    if v not in variables:
        rep.err(f"{where}: effect на необъявленную переменную {v}")
        return
    vt = ep["variables"][v]["type"]
    op = eff["op"]
    val = eff.get("value")
    if op == "toggle" and vt != "bool":
        rep.err(f"{where}: toggle на переменной типа {vt}")
    if op in ("add", "sub") and vt != "int":
        rep.err(f"{where}: {op} на переменной типа {vt}")
    if op in ("set", "add", "sub") and val is None:
        rep.err(f"{where}: {op} без value")
    if op == "set" and val is not None:
        ok = {"bool": isinstance(val, bool), "int": isinstance(val, int) and not isinstance(val, bool),
              "string": isinstance(val, str)}[vt]
        if not ok:
            rep.err(f"{where}: set {v}={val!r} не соответствует типу {vt}")


def collect_loc_keys(ep: dict) -> set[str]:
    keys: set[str] = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "key" or k.endswith("_key"):
                    if isinstance(v, str):
                        keys.add(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(ep)
    return keys


LENGTH_LIMITS = {  # роль строки -> максимум символов (любой язык); см. docs/architecture/05-localization.md §4
    "option": 60, "date_stamp": 32, "location": 56, "lower_third": 48, "chapter": 40, "fact": 120, "say": 220, "narrate": 240,
}


def key_roles(ep: dict) -> dict[str, str]:
    """Ключ -> роль строки (для проверки длины)."""
    roles: dict[str, str] = {}
    for scene in ep.get("scenes", {}).values():
        for st in scene.get("steps", []):
            do = st.get("do")
            if do == "caption":
                roles[st["key"]] = st["style"]
            elif do in ("say", "narrate"):
                roles[st["key"]] = do
            elif do == "choice":
                for o in st["options"]:
                    roles[o["key"]] = "option"
    return roles


def localization(ep: dict, locales_dir: str, rep: Report) -> None:
    ns = ep["id"].split("_")[0]
    keys = collect_loc_keys(ep)
    roles = key_roles(ep)
    for k in sorted(keys):
        head = k.split(".")[0]
        if head not in (ns, "ui", "common"):
            rep.warn(f"loc key {k}: ожидается пространство имён {ns}.*, ui.* или common.*")
    for lang in LANGS:
        path = os.path.join(locales_dir, lang, f"{ep['id']}.json")
        if not os.path.exists(path):
            (rep.err if lang == "ru" else rep.warn)(f"локализация {lang}: файл {path} отсутствует")
            continue
        data = load_json(path)
        if not isinstance(data, dict):
            rep.err(f"локализация {lang}: ожидается объект ключ→строка")
            continue
        ep_keys = {k for k in keys if k.split(".")[0] == ns}
        missing = sorted(k for k in ep_keys if k not in data)
        extra = sorted(k for k in data if k.split(".")[0] == ns and k not in ep_keys)
        empty = sorted(k for k, v in data.items() if not str(v).strip())
        if missing:
            msg = f"локализация {lang}: нет {len(missing)} ключей, напр. {missing[:5]}"
            (rep.err if lang in ("ru", "en") else rep.warn)(msg)
        if extra:
            rep.warn(f"локализация {lang}: {len(extra)} неиспользуемых ключей, напр. {extra[:5]}")
        if empty:
            rep.warn(f"локализация {lang}: {len(empty)} пустых строк, напр. {empty[:5]}")
        for k, v in data.items():
            role = roles.get(k)
            lim = LENGTH_LIMITS.get(role or "")
            if lim and len(str(v)) > lim:
                rep.warn(f"локализация {lang}: {k} [{role}] {len(str(v))} символов > {lim}")
        # грубая проверка плейсхолдеров {name} и тегов
        if lang != "ru":
            ru_path = os.path.join(locales_dir, "ru", f"{ep['id']}.json")
            if os.path.exists(ru_path):
                ru = load_json(ru_path)
                import re
                ph = re.compile(r"\{[a-z_]+\}")
                for k, v in data.items():
                    if k in ru and set(ph.findall(str(ru[k]))) != set(ph.findall(str(v))):
                        rep.err(f"локализация {lang}: плейсхолдеры в {k} не совпадают с ru")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--locales", default=os.path.join(ROOT, "locales"))
    ap.add_argument("--strict", action="store_true", help="warnings считаются ошибками")
    ap.add_argument("--no-loc", action="store_true", help="не проверять локализацию")
    a = ap.parse_args()

    rep = Report()
    ep = load_json(a.episode)
    schema_check(ep, rep)
    if not rep.errors:
        integrity(ep, rep)
        if not a.no_loc:
            localization(ep, a.locales, rep)

    for w in rep.warnings:
        print(f"WARN  {w}")
    for e in rep.errors:
        print(f"ERROR {e}")
    n_scenes = len(ep.get("scenes", {}))
    n_steps = sum(len(s.get("steps", [])) for s in ep.get("scenes", {}).values())
    print(f"-- {a.episode}: блоков {len(ep.get('blocks', []))}, сцен {n_scenes}, шагов {n_steps}, "
          f"мини-игр {len(ep.get('minigames', {}))}, концовок {len(ep.get('endings', []))}; "
          f"ошибок {len(rep.errors)}, предупреждений {len(rep.warnings)}")
    if rep.errors or (a.strict and rep.warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
