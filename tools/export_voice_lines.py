#!/usr/bin/env python3
"""Экспорт реплик эпизода для озвучки (TTS или актёры): кто, что и как говорит, по порядку сцен.

  python3 tools/export_voice_lines.py episodes/s1/ep01_murylev.json
      — только статистика по говорящим в stdout: реплик, знаков, средняя длина. Файлов не пишет.

  python3 tools/export_voice_lines.py episodes/s1/ep01_murylev.json --out /tmp/voice_lines.json
      — + список реплик JSON-массивом в порядке сцен (blocks[].scenes, затем шаги say / narrate):
        [{key, clip, who, style, expression, text, chars, scene}, …].

  python3 tools/export_voice_lines.py episodes/s1/ep01_murylev.json --who oper --out /tmp/oper.json
      — только реплики одного говорящего (id из cast, либо _narrator / _inner / _report).

  python3 tools/export_voice_lines.py episodes/s1/ep01_murylev.json --lang en --out -
      — текст из locales/en/<id эпизода>.json; «--out -» пишет JSON в stdout (статистика тогда уходит в stderr,
        stdout остаётся чистым JSON — удобно для jq и конвейеров).

Поля реплики:
  key         ключ локализации (ep01.s12.l003);
  clip        имя клипа без расширения: явное поле voice шага, иначе ключ — файл рантайма
              assets/<ep>/voice/<lang>/<clip>.mp3 (runtime/README.md, «Озвучка»);
  who         id из cast; закадровый текст: narrate voiceover → _narrator, narrate inner → _inner, narrate report → _report;
  style       say | voiceover | inner | report (для narrate — его style, по умолчанию voiceover);
  expression  выражение лица — явное у шага или унаследованное от show / say той же сцены (как в рантайме, без учёта `when`); у narrate null;
  text, chars текст на выбранном языке и его длина в знаках (len строки, с пробелами);
  scene       сцена, где реплика встречается впервые.

Реплика с одним и тем же clip в список попадает один раз (первая по порядку): клип по ключу один, сколько бы шагов
ни ссылалось на этот ключ (в ep01 — ветви по `when`). Чтобы такие шаги звучали по-разному, задайте шагу поле `voice`.
Пустой текст (язык ещё не переведён) в список не попадает — озвучивать нечего, считается в статистике отдельно.
Без зависимостей, Python 3.12.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ("ru", "en", "es", "pt")
# narrate → who: закадровый текст озвучивается отдельными профилями (docs/season1/ep01-voices.md)
NARRATE_WHO = {"voiceover": "_narrator", "inner": "_inner", "report": "_report"}
NARRATE_LABEL = {"_narrator": "Рассказчик (закадровый)", "_inner": "Мысли героя (inner)", "_report": "Протокол (report)"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def scene_order(ep: dict) -> list[str]:
    """Сцены в порядке блоков (blocks[].scenes); не попавшие ни в один список — в конце, в порядке файла."""
    scenes = ep.get("scenes", {})
    order: list[str] = []
    seen: set[str] = set()
    for block in ep.get("blocks", []):
        listed = block.get("scenes")
        if listed is None:  # блок без списка сцен: берём сцены, которые на него ссылаются
            listed = [sid for sid, sc in scenes.items() if sc.get("block") == block.get("id")]
        for sid in listed:
            if sid in scenes and sid not in seen:
                seen.add(sid)
                order.append(sid)
    order.extend(sid for sid in scenes if sid not in seen)
    return order


def walk_lines(ep: dict):
    """Реплики эпизода по порядку: (сцена, индекс шага, шаг, действующее выражение лица)."""
    scenes = ep.get("scenes", {})
    for sid in scene_order(ep):
        sprites: dict[str, str | None] = {}  # who → выражение; вход в сцену убирает спрайты (как в рантайме)
        for i, step in enumerate(scenes[sid].get("steps", [])):
            do = step.get("do")
            who = step.get("who")
            if do == "show":
                sprites[who] = step.get("expression", sprites.get(who))
            elif do == "hide":
                sprites.pop(who, None)
            elif do == "say":
                expr = step.get("expression")
                if expr is not None or step.get("pose") is not None or step.get("position") is not None:
                    # говорящий вне сцены появляется только если указана позиция (Interpreter.applySayToSprite)
                    if who in sprites or step.get("position") is not None:
                        sprites[who] = expr if expr is not None else sprites.get(who)
                yield sid, i, step, (expr if expr is not None else sprites.get(who))
            elif do == "narrate":
                yield sid, i, step, None


def collect(ep: dict, texts: dict, who_filter: str | None):
    """(список реплик, сводка). Сводка: шагов, повторов, без текста, предупреждения."""
    lines: list[dict] = []
    seen: dict[str, str] = {}  # clip → who первой реплики
    summary = {"steps": 0, "dups": 0, "no_text": 0, "warnings": []}
    for sid, _i, step, expression in walk_lines(ep):
        if step["do"] == "say":
            who, style = step["who"], "say"
        else:
            style = step.get("style", "voiceover")
            who = NARRATE_WHO.get(style, "_narrator")
        summary["steps"] += 1
        key = step["key"]
        clip = step.get("voice") or key
        if clip in seen:
            summary["dups"] += 1
            if seen[clip] != who:
                summary["warnings"].append(f"клип {clip} встречается у разных говорящих: {seen[clip]} и {who}")
            continue
        seen[clip] = who
        text = texts.get(key, "")
        if not isinstance(text, str) or not text.strip():
            summary["no_text"] += 1
            continue
        if who_filter is not None and who != who_filter:
            continue
        lines.append(
            {
                "key": key,
                "clip": clip,
                "who": who,
                "style": style,
                "expression": expression,
                "text": text,
                "chars": len(text),
                "scene": sid,
            }
        )
    return lines, summary


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def stats_text(ep: dict, lines: list[dict], summary: dict, names: dict, lang: str, who_filter: str | None) -> str:
    by: dict[str, list[int]] = {}
    for ln in lines:
        row = by.setdefault(ln["who"], [0, 0])
        row[0] += 1
        row[1] += ln["chars"]
    rows = sorted(by.items(), key=lambda kv: (-kv[1][1], kv[0]))
    out = [f"Эпизод {ep.get('id', '?')}, язык {lang}" + (f", говорящий {who_filter}" if who_filter else "")]
    out.append(
        f"Шагов say / narrate: {summary['steps']}; в списке клипов: {fmt(len(lines))}"
        + (f"; повторов ключа: {summary['dups']} (один клип на ключ — для разных дублей задайте шагу voice)" if summary["dups"] else "")
    )
    if summary["no_text"]:
        out.append(f"Без текста на языке {lang}: {summary['no_text']} (в список не вошли)")
    for w in summary["warnings"]:
        out.append(f"ПРЕДУПРЕЖДЕНИЕ: {w}")
    out.append("")
    if not rows:
        out.append("(реплик нет)")
        return "\n".join(out)
    w_id = max(len("Говорящий"), *(len(k) for k, _ in rows))
    w_name = max(len("Имя"), *(len(names.get(k, "")) for k, _ in rows))
    out.append(f"{'Говорящий':<{w_id}}  {'Имя':<{w_name}}  {'Реплик':>7}  {'Знаков':>8}  {'Среднее':>8}")
    total_n = total_c = 0
    for who, (n, c) in rows:
        out.append(f"{who:<{w_id}}  {names.get(who, ''):<{w_name}}  {n:>7}  {fmt(c):>8}  {round(c / n):>8}")
        total_n += n
        total_c += c
    out.append(f"{'ИТОГО':<{w_id}}  {'':<{w_name}}  {total_n:>7}  {fmt(total_c):>8}  {round(total_c / total_n):>8}")
    voiceover = sum(by[k][1] for k in NARRATE_LABEL if k in by)
    if voiceover and who_filter is None:
        out.append(f"\nЗакадровый текст (_narrator + _inner + _report): {fmt(voiceover)} знаков")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Экспорт реплик эпизода для озвучки.")
    ap.add_argument("episode", help="episodes/s1/ep01_murylev.json")
    ap.add_argument("--lang", default="ru", choices=LANGS, help="язык текста (по умолчанию ru)")
    ap.add_argument("--who", help="только реплики этого говорящего (id из cast или _narrator / _inner / _report)")
    ap.add_argument("--out", help="куда записать JSON-список реплик; «-» — в stdout")
    args = ap.parse_args()

    try:
        ep = load(args.episode)
    except (OSError, json.JSONDecodeError) as e:
        print(f"Не удалось прочитать эпизод {args.episode}: {e}", file=sys.stderr)
        return 2
    loc = os.path.join(ROOT, "locales", args.lang, f"{ep.get('id', '')}.json")
    try:
        texts = load(loc)
    except (OSError, json.JSONDecodeError) as e:
        print(f"Не удалось прочитать локаль {loc}: {e}", file=sys.stderr)
        return 2

    names = {c["id"]: texts.get(c.get("name_key", ""), "") or c["id"] for c in ep.get("cast", [])}
    names.update(NARRATE_LABEL)

    lines, summary = collect(ep, texts, args.who)
    if args.who is not None and not lines:
        known = sorted({ln["who"] for ln in collect(ep, texts, None)[0]})
        print(f"У говорящего «{args.who}» нет реплик на языке {args.lang}. Есть: {', '.join(known)}", file=sys.stderr)
        return 1

    to_stdout = args.out == "-"
    if args.out and not to_stdout:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(lines, f, ensure_ascii=False, indent=2)
            f.write("\n")
    elif to_stdout:
        json.dump(lines, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")

    report = stats_text(ep, lines, summary, names, args.lang, args.who)
    print(report, file=sys.stderr if to_stdout else sys.stdout)
    if args.out and not to_stdout:
        print(f"\nСписок реплик ({len(lines)}) записан: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
