#!/usr/bin/env python3
"""Слияние черновиков сцен от агентов-сценаристов в мастер-файл эпизода.

Черновик: episodes/<season>/_drafts/<episode_id>/<part>.json
{
  "part": "act1",
  "scenes": { "<scene_id>": { ...сцена по schemas/episode.schema.json... } },
  "locale_ru": { "<ключ>": "текст" },
  "assets_needed": { "backgrounds": [{"id": "...", "notes": "..."}], "sprites": [...] },  (опционально)
  "block_scenes": { "<block_id>": ["s11", "s12", "s12b", "s13"] },   (опционально: новый порядок сцен блока —
                                                                       надмножество старого, старые сцены в прежнем порядке)
  "variables": { "<var>": {"type": "int", "default": 0, "doc": "..."} }   (опционально: новые переменные эпизода)
}

  python3 tools/merge_drafts.py episodes/s1/ep01_murylev.json            # слить все черновики
  python3 tools/merge_drafts.py episodes/s1/ep01_murylev.json --part act1
  python3 tools/merge_drafts.py episodes/s1/ep01_murylev.json --master   # взять скелет из _drafts/<id>/_master.json
  python3 tools/merge_drafts.py episodes/s1/ep01_murylev.json --check --part act1   # самопроверка черновика без записи

Правила: сцена попадает в мастер только если её block объявлен и id сцены есть в block.scenes
(иначе ошибка); ключи locale_ru добавляются/обновляются в locales/ru/<episode_id>.json;
коллизии сцен между черновиками — ошибка. После слияния запускается линтер.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(p, d):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")


def check_drafts(ep: dict, ru: dict) -> list[str]:
    """Валидация слитых сцен по schema $defs/scene и проверка ссылок (cast, ассеты, переменные, ключи)."""
    from jsonschema import Draft202012Validator
    schema = load(os.path.join(ROOT, "schemas", "episode.schema.json"))
    scene_schema = {"$schema": schema["$schema"], "$ref": "#/$defs/scene", "$defs": schema["$defs"]}
    v = Draft202012Validator(scene_schema)
    errs: list[str] = []
    cast = {c["id"]: c for c in ep["cast"]}
    sprites = {s["id"]: s for s in ep["assets"].get("sprites", [])}
    ids = {k: {x["id"] for x in ep["assets"].get(k, [])} for k in ("backgrounds", "cg", "documents", "music", "sfx", "ambient")}
    variables = set(ep["variables"])
    block_scenes = {b["id"]: set(b.get("scenes", [])) for b in ep["blocks"]}
    all_scene_ids = set().union(*block_scenes.values())
    minigames = ep.get("minigames", {})
    endings = {e["id"] for e in ep.get("endings", [])}
    archive = {x["id"] for x in ep.get("archive_items", [])}
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import vnexpr
    seen_choice: dict[str, str] = {}
    for sid, sc in ep["scenes"].items():
        for st in sc.get("steps", []):
            if st.get("do") == "choice":
                cid = st.get("id", "")
                if cid in seen_choice:
                    errs.append(f"{sid}: id выбора {cid} уже есть в сцене {seen_choice[cid]} (id выборов уникальны на эпизод)")
                else:
                    seen_choice[cid] = sid
    for sid, sc in ep["scenes"].items():
        for e in v.iter_errors(sc):
            path = "/".join(str(p) for p in e.absolute_path)
            errs.append(f"{sid}/{path}: {e.message[:160]}")
        if sc["stage"]["bg"] not in ids["backgrounds"]:
            errs.append(f"{sid}: фон {sc['stage']['bg']} не объявлен")
        for k in ("music", "ambient"):
            if sc.get(k) and sc[k] not in ids[k]:
                errs.append(f"{sid}: {k} {sc[k]} не объявлен")
        steps = sc.get("steps", [])
        if steps and steps[-1].get("do") not in ("jump", "branch", "choice", "minigame", "end"):
            errs.append(f"{sid}: нет терминального шага")
        for i, st in enumerate(steps):
            do = st.get("do"); w = f"{sid}#{i}"
            if do in ("say", "show", "hide") and st.get("who") not in cast:
                errs.append(f"{w}: персонаж {st.get('who')} не в cast")
            if do in ("say", "show") and st.get("expression"):
                ss = cast.get(st.get("who"), {}).get("sprite_set")
                if ss in sprites and st["expression"] not in sprites[ss]["expressions"]:
                    errs.append(f"{w}: выражение {st['expression']} нет у {ss}")
            if do == "bg" and st["bg"] not in ids["backgrounds"]:
                errs.append(f"{w}: фон {st['bg']} не объявлен")
            if do == "cg" and st["cg"] not in ids["cg"]:
                errs.append(f"{w}: cg {st['cg']} не объявлен")
            if do == "document" and st["doc"] not in ids["documents"]:
                errs.append(f"{w}: документ {st['doc']} не объявлен")
            if do in ("music", "sfx", "ambient") and st.get("id") not in ids[do]:
                errs.append(f"{w}: {do} {st.get('id')} не объявлен")
            if do == "minigame" and st["minigame"] not in minigames:
                errs.append(f"{w}: мини-игра {st['minigame']} не объявлена")
            if do == "end" and st["ending"] not in endings:
                errs.append(f"{w}: концовка {st['ending']} не объявлена")
            if do == "archive_unlock" and st["item"] not in archive:
                errs.append(f"{w}: архив {st['item']} не объявлен")
            for expr in [st.get("when")] + [c.get("when") for c in st.get("cases", [])] + [o.get("when") for o in st.get("options", [])]:
                if expr:
                    for msg in vnexpr.check(expr, variables):
                        errs.append(f"{w}: условие «{expr}»: {msg}")
            effects = list(st.get("effects", [])) + [e for o in st.get("options", []) for e in o.get("effects", [])]
            for eff in effects:
                if eff.get("var") not in variables:
                    errs.append(f"{w}: переменная {eff.get('var')} не объявлена")
            targets = []
            if do == "jump": targets = [st["scene"]]
            if do == "branch": targets = [c["goto"] for c in st["cases"]] + [st["default"]]
            if do == "choice": targets = [o["goto"] for o in st["options"]]
            for t in targets:
                if t not in all_scene_ids:
                    errs.append(f"{w}: переход на сцену {t}, которой нет в аутлайне")
            for key in [st.get("key"), st.get("prompt_key"), st.get("intro_key"), st.get("text_key")] + [o.get("key") for o in st.get("options", [])]:
                if key and not str(ru.get(key, "")).strip():
                    errs.append(f"{w}: нет русского текста для ключа {key}")
            if do == "say" and len(str(ru.get(st.get("key"), ""))) > 220:
                errs.append(f"{w}: реплика длиннее 220 символов")
            if do == "narrate" and len(str(ru.get(st.get("key"), ""))) > 240:
                errs.append(f"{w}: реплика рассказчика длиннее 240 символов")
            if do == "caption":
                lim = {"date_stamp": 32, "location": 56, "lower_third": 48, "chapter": 40, "fact": 120}[st["style"]]
                if len(str(ru.get(st.get("key"), ""))) > lim:
                    errs.append(f"{w}: титр {st['style']} длиннее {lim}")
            if do == "choice":
                for o in st["options"]:
                    if len(str(ru.get(o.get("key"), ""))) > 60:
                        errs.append(f"{w}: кнопка {o.get('id')} длиннее 60")
    return errs

ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
VAR_TYPES = {"bool": bool, "int": int, "string": str}


def apply_block_scenes(ep: dict, block_scenes: dict, new_lists: dict, part: str) -> list[str]:
    """Расширить списки сцен блоков по черновику (новые сцены-вставки). Старые сцены остаются все и в прежнем порядке."""
    errs: list[str] = []
    for blk, lst in new_lists.items():
        if blk not in block_scenes:
            errs.append(f"{part}: block_scenes: неизвестный блок {blk}")
            continue
        if not isinstance(lst, list) or len(set(lst)) != len(lst):
            errs.append(f"{part}: block_scenes[{blk}]: нужен список id без повторов")
            continue
        block = next(b for b in ep["blocks"] if b["id"] == blk)
        old = list(block.get("scenes", []))
        if [sid for sid in lst if sid in old] != old:
            errs.append(f"{part}: block_scenes[{blk}]: старые сцены должны остаться все и в прежнем порядке")
            continue
        others = {sid for b in ep["blocks"] if b["id"] != blk for sid in b.get("scenes", [])}
        bad = [sid for sid in lst if sid not in old and (not ID_RE.match(sid) or sid in others)]
        if bad:
            errs.append(f"{part}: block_scenes[{blk}]: недопустимые или чужие id сцен {bad}")
            continue
        block["scenes"] = list(lst)
        block_scenes[blk] = set(lst)
    return errs


def apply_variables(ep: dict, new_vars: dict, part: str) -> list[str]:
    """Добавить переменные из черновика; уже объявленную переменную нельзя переопределить иначе."""
    errs: list[str] = []
    for name, spec in new_vars.items():
        if not ID_RE.match(name):
            errs.append(f"{part}: variables: недопустимое имя {name}")
            continue
        t = spec.get("type") if isinstance(spec, dict) else None
        if t not in VAR_TYPES or not isinstance(spec.get("default"), VAR_TYPES[t]) or isinstance(spec.get("default"), bool) and t != "bool":
            errs.append(f"{part}: variables: {name}: нужны type (bool|int|string) и default того же типа")
            continue
        cur = ep["variables"].get(name)
        if cur is not None and cur != spec:
            errs.append(f"{part}: variables: {name} уже объявлена иначе: {cur}")
            continue
        ep["variables"][name] = spec
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--part")
    ap.add_argument("--no-lint", action="store_true")
    ap.add_argument("--master", action="store_true", help="взять мастер-скелет из _drafts/<id>/_master.json")
    ap.add_argument("--check", action="store_true", help="только проверить черновики (ничего не писать)")
    a = ap.parse_args()
    ep_path = os.path.abspath(a.episode)
    ep = load(ep_path)
    draft_dir = os.path.join(os.path.dirname(ep_path), "_drafts", ep["id"])
    master_path = os.path.join(draft_dir, "_master.json")
    if a.master or a.check:
        if os.path.exists(master_path):
            ep = load(master_path)
    files = sorted(f for f in glob.glob(os.path.join(draft_dir, "*.json")) if not os.path.basename(f).startswith("_"))
    if a.part:
        files = [f for f in files if os.path.basename(f) == f"{a.part}.json"]
    if not files:
        print(f"черновиков нет в {draft_dir}")
        return 1
    ru_path = os.path.join(ROOT, "locales", "ru", f"{ep['id']}.json")
    ru = load(ru_path) if os.path.exists(ru_path) else {}
    block_scenes = {b["id"]: set(b.get("scenes", [])) for b in ep["blocks"]}
    seen: dict[str, str] = {}
    errors: list[str] = []
    n_scenes = n_keys = 0
    for f in files:
        d = load(f)
        part = d.get("part", os.path.basename(f))
        errors += apply_block_scenes(ep, block_scenes, d.get("block_scenes", {}), part)
        errors += apply_variables(ep, d.get("variables", {}), part)
        for sid, sc in d.get("scenes", {}).items():
            if sid in seen:
                errors.append(f"{part}: сцена {sid} уже пришла из {seen[sid]}")
                continue
            blk = sc.get("block")
            if blk not in block_scenes:
                errors.append(f"{part}: сцена {sid} ссылается на неизвестный блок {blk}")
                continue
            if sid not in block_scenes[blk]:
                errors.append(f"{part}: сцена {sid} не числится в blocks[{blk}].scenes аутлайна")
                continue
            sc["id"] = sid
            ep["scenes"][sid] = sc
            seen[sid] = part
            n_scenes += 1
        for k, v in d.get("locale_ru", {}).items():
            ru[k] = v
            n_keys += 1
        for kind, items in d.get("assets_needed", {}).items():
            for it in items:
                print(f"  [{part}] нужен ассет {kind}: {it.get('id')} — {it.get('notes', '')}")
    if a.check:
        for blk, ids in block_scenes.items():
            for sid in sorted(ids):
                if sid not in ep["scenes"]:
                    errors.append(f"сцена {sid} числится в blocks[{blk}].scenes, но её нет ни в мастере, ни в черновиках")
        errors += check_drafts(ep, ru)
    if errors:
        for e in errors:
            print("ERROR", e)
        return 1
    if a.check:
        print(f"проверка пройдена: сцен {n_scenes}, ключей ru {n_keys}")
        return 0
    dump(ep_path, ep)
    dump(ru_path, ru)
    print(f"слито сцен: {n_scenes}, ключей ru: {n_keys} из {len(files)} черновиков")
    if not a.no_lint:
        return subprocess.call([sys.executable, os.path.join(ROOT, "tools", "validate_episode.py"), ep_path])
    return 0


if __name__ == "__main__":
    sys.exit(main())
