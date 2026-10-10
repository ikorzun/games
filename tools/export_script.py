#!/usr/bin/env python3
"""Экспорт эпизода в читаемый режиссёрский сценарий (Markdown).

  python3 tools/export_script.py episodes/s1/ep01_murylev.json [--lang ru] [--out docs/production/ep01-shooting-script.md]

Для каждой сцены: блок и режим показа, кадр (фон, фильтр, время суток, погода, музыка, эмбиент),
затем шаги в порядке исполнения: титры, реплики, показ персонажей, эффекты, выборы, мини-игры, переходы.
Текст берётся из locales/<lang>/<episode>.json. Генерируемый файл не редактируется руками.
"""
from __future__ import annotations

import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PRES = {
    "reconstruction": "реконструкция", "chronicle": "хроника", "talking_head": "говорящая голова",
    "procedural": "процедурный", "title": "заставка", "map": "карта", "courtroom": "зал суда",
    "montage": "монтаж", "document": "документ",
}
BLOCK = {
    "cold_open": "Холодное открытие", "title_card": "Заставка", "chronicle": "Хроника", "crime": "Преступление",
    "discovery": "Обнаружение", "investigation": "Следствие", "dead_end": "Ложный след", "breakthrough": "Перелом",
    "pursuit": "Операция", "confrontation": "Допрос", "trial": "Суд", "epilogue": "Эпилог", "interlude": "Интерлюдия",
    "archive_break": "Архив", "editorial": "Редакция",
}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--lang", default="ru")
    ap.add_argument("--out")
    a = ap.parse_args()
    ep = load(a.episode)
    loc = load(os.path.join(ROOT, "locales", a.lang, f"{ep['id']}.json"))
    t = lambda k: loc.get(k, f"[{k}]") if k else ""
    cast = {c["id"]: c for c in ep["cast"]}
    assets = {k: {x["id"]: x for x in v} for k, v in ep["assets"].items() if isinstance(v, list)}
    blocks = {b["id"]: b for b in ep["blocks"]}
    name = lambda cid: t(cast[cid].get("short_name_key") or cast[cid]["name_key"]) if cid in cast else cid

    out = []
    out.append(f"# {t(ep['title_key'])} — режиссёрский сценарий (сгенерировано из `{os.path.relpath(a.episode, ROOT)}`)\n")
    out.append(f"_{t(ep.get('logline_key'))}_\n")
    bo = ep["based_on"]
    out.append(f"Источник: {bo['case_name']}; {bo['city']}, {'–'.join(map(str, bo['years']))}. "
               f"Фикционализация: {bo['fictionalization']['level']}, имена изменены: {bo['fictionalization']['names_changed']}. "
               f"Архетип: `{ep['archetype']}`. Хронометраж ≈ {ep.get('estimated_minutes', '?')} мин.\n")
    out.append("## Персонажи\n")
    for c in ep["cast"]:
        out.append(f"- **{t(c['name_key'])}** — {c['role']}" + (f", спрайты `{c['sprite_set']}`" if c.get("sprite_set") else ""))
    out.append("")
    out.append("## Структура блоков\n")
    out.append("| # | Блок | Тип | Режим показа | Акт | Сцены |")
    out.append("|---|---|---|---|---|---|")
    for i, b in enumerate(ep["blocks"], 1):
        out.append(f"| {i} | {t(b.get('title_key')) or BLOCK.get(b['type'], b['type'])} | `{b['type']}` | {PRES.get(b['presentation'], b['presentation'])} | {b.get('act', '')} | {', '.join(b.get('scenes', []))} |")
    out.append("")
    out.append("## Сцены\n")

    for b in ep["blocks"]:
        for sid in b.get("scenes", []):
            sc = ep["scenes"][sid]
            st = sc["stage"]
            bg = assets.get("backgrounds", {}).get(st["bg"], {})
            out.append(f"### {sid} · {BLOCK.get(b['type'], b['type'])} ({PRES.get(b['presentation'], b['presentation'])})\n")
            frame = [f"фон `{st['bg']}`" + (f" — {bg['notes']}" if bg.get("notes") else "")]
            if st.get("filter", "none") != "none":
                frame.append(f"фильтр `{st['filter']}`")
            if st.get("time_of_day"):
                frame.append(st["time_of_day"])
            if st.get("weather"):
                frame.append(st["weather"])
            if st.get("letterbox"):
                frame.append("letterbox")
            if sc.get("music"):
                frame.append(f"музыка `{sc['music']}`")
            if sc.get("ambient"):
                frame.append(f"эмбиент `{sc['ambient']}`")
            out.append("**Кадр:** " + "; ".join(frame) + "\n")
            for step in sc["steps"]:
                do = step["do"]
                cond = f" _(если `{step['when']}`)_" if step.get("when") else ""
                if do == "caption":
                    out.append(f"- ТИТР [{step['style']}]: «{t(step['key'])}»")
                elif do == "narrate":
                    label = {"voiceover": "РАССКАЗЧИК", "inner": "ВНУТРЕННИЙ ГОЛОС", "report": "ПРОТОКОЛ"}[step.get("style", "voiceover")]
                    out.append(f"- **{label}:** {t(step['key'])}{cond}")
                elif do == "say":
                    expr = f" ({step['expression']})" if step.get("expression") else ""
                    out.append(f"- **{name(step['who']).upper()}{expr}:** {t(step['key'])}{cond}")
                elif do == "show":
                    sil = " (силуэт)" if step.get("silhouette") else ""
                    out.append(f"- показ: {name(step['who'])}{sil}, {step.get('expression', '')} {step.get('position', 'center')}".rstrip())
                elif do == "hide":
                    out.append(f"- уход: {name(step['who'])}")
                elif do == "cg":
                    out.append(f"- CG `{step['cg']}` ({step.get('transition', 'fade')})")
                elif do == "bg":
                    out.append(f"- смена фона `{step['bg']}`")
                elif do == "document":
                    out.append(f"- ДОКУМЕНТ `{step['doc']}`: {t(step.get('text_key'))}")
                elif do in ("music", "sfx", "ambient"):
                    out.append(f"- звук: {do} `{step.get('id')}`")
                elif do in ("stop_music", "stop_ambient"):
                    out.append(f"- звук: {do}")
                elif do == "fx":
                    out.append(f"- эффект `{step['fx']}`" + (f" {step['ms']} мс" if step.get("ms") else ""))
                elif do == "choice":
                    timer = f", таймер {step['timer_ms']//1000} с" if step.get("timer_ms") else ""
                    out.append(f"- ВЫБОР [{step.get('kind', '')}{timer}]: {t(step.get('prompt_key'))}")
                    for o in step["options"]:
                        eff = ", ".join(f"{e['var']} {e['op']} {e.get('value', '')}".strip() for e in o.get("effects", []))
                        out.append(f"  - «{t(o['key'])}» → {o['goto']}" + (f" _({eff})_" if eff else ""))
                elif do == "set":
                    out.append("- переменные: " + ", ".join(f"{e['var']} {e['op']} {e.get('value', '')}".strip() for e in step["effects"]))
                elif do == "branch":
                    out.append("- ВЕТВЛЕНИЕ: " + "; ".join(f"`{c['when']}` → {c['goto']}" for c in step["cases"]) + f"; иначе → {step['default']}")
                elif do == "jump":
                    out.append(f"- → {step['scene']}" + (f" ({step['transition']})" if step.get("transition") else ""))
                elif do == "minigame":
                    mg = ep["minigames"][step["minigame"]]
                    oc = "; ".join(f"{k} → {v['goto']}" for k, v in mg["outcomes"].items())
                    out.append(f"- МИНИ-ИГРА `{mg['type']}` «{t(mg['title_key'])}»: {t(step.get('intro_key'))} _(исходы: {oc})_")
                elif do == "archive_unlock":
                    out.append(f"- архив: открыт материал `{step['item']}`")
                elif do == "end":
                    e = next(x for x in ep["endings"] if x["id"] == step["ending"])
                    out.append(f"- КОНЕЦ: «{t(e['title_key'])}» [{e['kind']}]")
            out.append("")

    out.append("## Концовки\n")
    for e in ep["endings"]:
        out.append(f"- **{t(e['title_key'])}** (`{e['kind']}`) — сцена {e.get('epilogue_scene', '')}")
    out.append("")
    text = "\n".join(out)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"written {a.out}: {len(out)} lines")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
