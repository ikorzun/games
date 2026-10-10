#!/usr/bin/env python3
"""Генерация клипов Seedance через BytePlus ModelArk API по промптам из docs/production/prompts/ep01-video.md.

Требует: переменная окружения ARK_API_KEY (секрет окружения) и разрешённый хост ARK_HOST
(по умолчанию ark.ap-southeast.bytepluses.com; для Volcano Engine — ark.cn-beijing.volces.com).

  python3 tools/seedance_generate.py --list                       # показать клипы из таблицы промптов
  python3 tools/seedance_generate.py --id v_common_title --dry-run # собрать запрос без отправки
  python3 tools/seedance_generate.py --id v_common_title [--model seedance-1-0-pro-250528] [--duration 8] [--res 720p] [--ratio 16:9] [--start-image URL]
  python3 tools/seedance_generate.py --all --out assets/common/video

Статус: НЕ ПРОВЕРЕНО на живом API (ключа в сессии не было). Формат запроса — по документации ModelArk
«contents/generations/tasks»; при первом запуске сверить поля с актуальной документацией и поправить
ARK_API_PATH/параметры. Результат пишется в assets/<...>/generation-log.md.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_MD = os.path.join(ROOT, "docs", "production", "prompts", "ep01-video.md")
ARK_HOST = os.environ.get("ARK_HOST", "ark.ap-southeast.bytepluses.com")
ARK_API_PATH = os.environ.get("ARK_API_PATH", "/api/v3/contents/generations/tasks")
DEFAULT_MODEL = os.environ.get("SEEDANCE_MODEL", "seedance-1-0-pro-250528")


def load_prompts() -> dict[str, dict]:
    """Читает таблицу | id | Где | Длит. | Промпт | из markdown."""
    out: dict[str, dict] = {}
    for line in open(PROMPTS_MD, encoding="utf-8"):
        if not line.startswith("| `v_"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        vid = cells[0].strip("`")
        dur = re.search(r"(\d+)\s*s", cells[2])
        out[vid] = {"id": vid, "where": cells[1], "duration": int(dur.group(1)) if dur else 8, "prompt": cells[3]}
    return out


def build_request(p: dict, model: str, duration: int, res: str, ratio: str, start_image: str | None, audio: bool) -> dict:
    # Seedance на ModelArk принимает параметры как суффикс текста промпта
    text = f"{p['prompt']} --resolution {res} --duration {duration} --ratio {ratio} --camerafixed false"
    content: list[dict] = [{"type": "text", "text": text}]
    if start_image:
        content.append({"type": "image_url", "image_url": {"url": start_image}, "role": "first_frame"})
    req = {"model": model, "content": content}
    if not audio:
        req["generate_audio"] = False  # поле проверить по документации; у seedance-1.x аудио нет
    return req


def call(method: str, path: str, body: dict | None, key: str) -> dict:
    url = f"https://{ARK_HOST}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")


def generate(p: dict, a, key: str) -> dict:
    req = build_request(p, a.model, a.duration or p["duration"], a.res, a.ratio, a.start_image, a.audio)
    if a.dry_run:
        print(json.dumps(req, ensure_ascii=False, indent=2))
        return {}
    task = call("POST", ARK_API_PATH, req, key)
    tid = task.get("id")
    print(f"{p['id']}: задача {tid}")
    for _ in range(120):  # до ~10 минут
        time.sleep(5)
        st = call("GET", f"{ARK_API_PATH}/{tid}", None, key)
        status = st.get("status")
        if status in ("succeeded", "failed", "cancelled"):
            if status != "succeeded":
                print(f"{p['id']}: {status}: {st.get('error')}")
                return st
            video_url = (st.get("content") or {}).get("video_url")
            print(f"{p['id']}: готово {video_url}")
            if a.out and video_url:
                os.makedirs(a.out, exist_ok=True)
                dst = os.path.join(a.out, f"{p['id']}.mp4")
                urllib.request.urlretrieve(video_url, dst)
                print(f"  сохранено {dst}")
            with open(os.path.join(ROOT, "assets", "generation-log-video.md"), "a", encoding="utf-8") as f:
                f.write(f"| {p['id']} | {a.model} | {tid} | {a.duration or p['duration']} s, {a.res}, {a.ratio} | {video_url} |\n")
            return st
    print(f"{p['id']}: таймаут ожидания")
    return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--id")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--duration", type=int)
    ap.add_argument("--res", default="720p")
    ap.add_argument("--ratio", default="16:9")
    ap.add_argument("--start-image")
    ap.add_argument("--audio", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    prompts = load_prompts()
    if a.list:
        for p in prompts.values():
            print(f"{p['id']:22} {p['duration']:>2} s  {p['where']}")
        return 0
    key = os.environ.get("ARK_API_KEY", "")
    if not key and not a.dry_run:
        print("нет ARK_API_KEY в окружении (добавьте секрет окружения и хост в Allowed domains)")
        return 2
    targets = list(prompts.values()) if a.all else [prompts[a.id]] if a.id in prompts else []
    if not targets:
        print("укажите --id из --list или --all")
        return 1
    for p in targets:
        generate(p, a, key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
