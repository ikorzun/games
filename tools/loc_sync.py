#!/usr/bin/env python3
"""Синхронизация локалей эпизода.

  python3 tools/loc_sync.py skeleton episodes/s1/ep01_murylev.json
      — создаёт/дополняет locales/{ru,en,es,pt}/<ep>.json всеми ключами из эпизода
        (новые ключи получают "" ; существующие строки не трогаются; порядок ключей — как в эпизоде).

  python3 tools/loc_sync.py export episodes/s1/ep01_murylev.json [--out locales/_export]
      — пишет CSV для переводчиков/Crowdin: key, context, ru, en, es, pt.
        context = тип шага и говорящий (чтобы переводчик видел, кто и в какой ситуации говорит).

  python3 tools/loc_sync.py import locales/_export/ep01_murylev.csv
      — вливает колонки en/es/pt обратно в locales/<lang>/<ep>.json (пустые ячейки пропускаются).

  python3 tools/loc_sync.py stats episodes/s1/ep01_murylev.json
      — доля переведённых ключей по языкам, объём слов источника (для оценки стоимости перевода).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ("ru", "en", "es", "pt")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def keys_with_context(ep: dict) -> list[tuple[str, str]]:
    """Все ключи эпизода в порядке появления + контекст для переводчика."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    cast = {c["id"]: c for c in ep.get("cast", [])}

    def add(k: str, ctx: str):
        if k and k not in seen:
            seen.add(k)
            out.append((k, ctx))

    add(ep.get("title_key"), "episode title")
    add(ep.get("logline_key"), "episode logline (1–2 предложения для меню)")
    for c in ep.get("cast", []):
        add(c["name_key"], f"character name ({c['role']})")
        add(c.get("short_name_key"), f"short name ({c['role']})")
        add(c.get("bio_key"), f"bio ({c['role']})")
    for b in ep.get("blocks", []):
        add(b.get("title_key"), f"block title [{b['type']}]")
        add(b.get("date_caption_key"), f"date/place caption [{b['type']}]")
    for sid, scene in ep.get("scenes", {}).items():
        for i, st in enumerate(scene.get("steps", [])):
            do = st.get("do")
            where = f"{sid}#{i}"
            if do == "say":
                who = cast.get(st["who"], {}).get("role", st["who"])
                add(st["key"], f"{where} say — {st['who']} ({who}), {st.get('expression', '')}")
            elif do == "narrate":
                add(st["key"], f"{where} narration ({st.get('style', 'voiceover')})")
            elif do == "caption":
                add(st["key"], f"{where} caption [{st['style']}] — коротко, это титр")
            elif do == "document":
                add(st.get("text_key"), f"{where} document text — {st['doc']}")
            elif do == "choice":
                add(st.get("prompt_key"), f"{where} choice prompt")
                for o in st["options"]:
                    add(o["key"], f"{where} choice option [{st.get('kind', '')}] — кнопка, ≤ 60 символов")
            elif do == "minigame":
                add(st.get("intro_key"), f"{where} minigame intro")
    for mid, mg in ep.get("minigames", {}).items():
        add(mg["title_key"], f"minigame {mid} title [{mg['type']}]")
        add(mg["brief_key"], f"minigame {mid} brief — инструкция игроку")

        def walk_cfg(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k.endswith("_key") and isinstance(v, str):
                        add(v, f"minigame {mid} config {path}.{k} — текст внутри мини-игры")
                    else:
                        walk_cfg(v, f"{path}.{k}" if path else k)
            elif isinstance(o, list):
                for i, x in enumerate(o):
                    walk_cfg(x, f"{path}[{i}]")

        walk_cfg(mg.get("config", {}), "")
    for e in ep.get("endings", []):
        add(e["title_key"], f"ending title [{e['kind']}]")
    for a in ep.get("archive_items", []):
        add(a["title_key"], f"archive {a['kind']} title")
        add(a.get("text_key"), f"archive {a['kind']} text")
    return out


def loc_path(ep_id: str, lang: str) -> str:
    return os.path.join(ROOT, "locales", lang, f"{ep_id}.json")


def cmd_skeleton(a):
    ep = load(a.episode)
    keys = keys_with_context(ep)
    for lang in LANGS:
        p = loc_path(ep["id"], lang)
        data = load(p) if os.path.exists(p) else {}
        new = {k: data.get(k, "") for k, _ in keys}
        # сохраняем лишние (возможно, устаревшие) ключи в конце, чтобы ничего не потерять
        for k, v in data.items():
            if k not in new:
                new[k] = v
        added = sum(1 for k, _ in keys if k not in data)
        dump(p, new)
        print(f"{lang}: {p} — ключей {len(new)}, добавлено {added}")


def cmd_export(a):
    ep = load(a.episode)
    keys = keys_with_context(ep)
    locs = {lang: (load(loc_path(ep["id"], lang)) if os.path.exists(loc_path(ep["id"], lang)) else {}) for lang in LANGS}
    out_dir = a.out or os.path.join(ROOT, "locales", "_export")
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, f"{ep['id']}.csv")
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["key", "context", *LANGS])
        for k, ctx in keys:
            w.writerow([k, ctx, *[locs[l].get(k, "") for l in LANGS]])
    print(f"экспорт: {p} ({len(keys)} строк)")


def cmd_import(a):
    with open(a.csv, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    ep_id = os.path.splitext(os.path.basename(a.csv))[0]
    for lang in LANGS:
        if lang == "ru" and not a.overwrite_source:
            continue
        p = loc_path(ep_id, lang)
        data = load(p) if os.path.exists(p) else {}
        n = 0
        for r in rows:
            v = (r.get(lang) or "").strip()
            if v and data.get(r["key"]) != v:
                data[r["key"]] = v
                n += 1
        dump(p, data)
        print(f"{lang}: обновлено {n}")


def cmd_stats(a):
    ep = load(a.episode)
    keys = [k for k, _ in keys_with_context(ep)]
    ru = load(loc_path(ep["id"], "ru")) if os.path.exists(loc_path(ep["id"], "ru")) else {}
    words = sum(len(str(ru.get(k, "")).split()) for k in keys)
    chars = sum(len(str(ru.get(k, ""))) for k in keys)
    print(f"{ep['id']}: ключей {len(keys)}, слов (ru) {words}, символов (ru) {chars}")
    for lang in LANGS:
        p = loc_path(ep["id"], lang)
        data = load(p) if os.path.exists(p) else {}
        done = sum(1 for k in keys if str(data.get(k, "")).strip())
        pct = 100.0 * done / len(keys) if keys else 0
        print(f"  {lang}: {done}/{len(keys)} ({pct:.0f}%)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("skeleton"); s.add_argument("episode"); s.set_defaults(fn=cmd_skeleton)
    s = sub.add_parser("export"); s.add_argument("episode"); s.add_argument("--out"); s.set_defaults(fn=cmd_export)
    s = sub.add_parser("import"); s.add_argument("csv"); s.add_argument("--overwrite-source", action="store_true"); s.set_defaults(fn=cmd_import)
    s = sub.add_parser("stats"); s.add_argument("episode"); s.set_defaults(fn=cmd_stats)
    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
