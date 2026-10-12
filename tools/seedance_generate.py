#!/usr/bin/env python3
"""Генерация клипов Seedance через BytePlus ModelArk API по промптам из docs/production/prompts/ep01-video.md.

Ключ — от Ark CLI (`arkcli auth login`): `VOLCENGINE_ARK_API_KEY` в ~/.arkcli-bp/.env. Он уходит curl'у
через stdin (`-H @-`), никогда не в аргументы, файлы и вывод. curl, а не urllib: у python.org-Python
сертификаты до этого хоста не доходят. Хост — ARK_HOST (по умолчанию ark.ap-southeast.bytepluses.com).

  python3 tools/seedance_generate.py --list                       # показать клипы из таблицы промптов
  python3 tools/seedance_generate.py --id v_common_title --dry-run # собрать запрос без отправки
  python3 tools/seedance_generate.py --id v_common_title [--model dreamina-seedance-2-5-260628] [--duration 8] [--res 480p] [--ratio 16:9] [--start-image URL] [--audio] [--no-draft]
  python3 tools/seedance_generate.py --all --out assets/common/video/drafts

По умолчанию — черновик (draft, 480p, 16:9, без звука), длительность из таблицы. Результат:
<out>/<id>.mp4 и <id>.job.json (модель, промпт, task id, usage, оценка цены; video_url живёт 24 ч,
task id черновика — 7 дней). Клипы — без узнаваемых лиц: реалистичные лица во входах ModelArk не принимает.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_MD = os.path.join(ROOT, "docs", "production", "prompts", "ep01-video.md")
ARK_HOST = os.environ.get("ARK_HOST", "ark.ap-southeast.bytepluses.com")
ARK_API_PATH = os.environ.get("ARK_API_PATH", "/api/v3/contents/generations/tasks")
DEFAULT_MODEL = os.environ.get("SEEDANCE_MODEL", "dreamina-seedance-2-5-260628")
KEY_FILE = os.path.expanduser("~/.arkcli-bp/.env")
PRICE_PER_1K = {"1080p": 0.0117}  # $ за 1K выходных токенов (замер); 480p/720p — 0.0107


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


def load_key() -> str:
    m = re.search(r"^VOLCENGINE_ARK_API_KEY=(.*)$", open(KEY_FILE).read(), re.M) if os.path.exists(KEY_FILE) else None
    return m.group(1).strip().strip("\"'") if m else ""


def build_request(p: dict, model: str, duration: int, res: str, ratio: str, start_image: str | None, audio: bool, draft: bool) -> dict:
    # параметры — полями тела, а не суффиксом текста
    content: list[dict] = [{"type": "text", "text": p["prompt"]}]
    if start_image:
        content.append({"type": "image_url", "image_url": {"url": start_image}, "role": "first_frame"})
    return {"model": model, "content": content, "ratio": ratio, "duration": duration, "resolution": res,
            "draft": draft, "generate_audio": audio, "watermark": False}


def call(method: str, path: str, body: dict | None, key: str) -> dict:
    args = ["curl", "-s", "-m", "120", "-X", method, "-H", "@-", "-H", "Content-Type: application/json"]
    if body is not None:
        args += ["--data-binary", json.dumps(body, ensure_ascii=False)]  # в теле секрета нет; ключ — только через stdin
    out = subprocess.run(args + [f"https://{ARK_HOST}{path}"], input=f"Authorization: Bearer {key}\n",
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except ValueError:
        return {"unreadable": out[:400]}


def generate(p: dict, a, key: str) -> dict:
    req = build_request(p, a.model, a.duration or p["duration"], a.res, a.ratio, a.start_image, a.audio, not a.no_draft)
    if a.dry_run:
        print(json.dumps(req, ensure_ascii=False, indent=2))
        return {}
    task = call("POST", ARK_API_PATH, req, key)
    if "id" not in task:
        raise SystemExit(f"{p['id']}: запрос отклонён: {json.dumps(task, ensure_ascii=False)[:600]}")
    tid = task["id"]
    print(f"{p['id']}: задача {tid}")
    os.makedirs(a.out, exist_ok=True)
    dst = os.path.join(a.out, f"{p['id']}.mp4")
    job_path = os.path.join(a.out, f"{p['id']}.job.json")
    rec = {"id": p["id"], "model": a.model, "task": tid, "prompt": p["prompt"],
           "params": {k: req[k] for k in ("ratio", "duration", "resolution", "draft", "generate_audio")}, "start_image": a.start_image}
    json.dump(rec, open(job_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)  # task id не теряется при таймауте
    for _ in range(120):  # до ~20 минут
        time.sleep(10)
        st = call("GET", f"{ARK_API_PATH}/{tid}", None, key)
        status = st.get("status")
        if status not in ("succeeded", "failed", "cancelled", "expired"):
            continue  # queued / running / сбой опроса
        if status != "succeeded":
            print(f"{p['id']}: {status}: {st.get('error') or st}")
            rec.update(status=status, error=st.get("error"))
            json.dump(rec, open(job_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            return st
        video_url = (st.get("content") or {}).get("video_url")
        subprocess.run(["curl", "-f", "-s", "-m", "180", "-o", dst, video_url], check=True)
        tokens = (st.get("usage") or {}).get("completion_tokens", 0)
        rec.update(status=status, usage=st.get("usage"), seed=st.get("seed"), video_url=video_url,
                   cost_usd=round(tokens / 1000 * PRICE_PER_1K.get(a.res, 0.0107), 3))
        json.dump(rec, open(job_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{p['id']}: сохранено {dst}, ≈ ${rec['cost_usd']}")
        return st
    print(f"{p['id']}: таймаут ожидания, task id в {job_path}")
    return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--id")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--duration", type=int)
    ap.add_argument("--res", default="480p")
    ap.add_argument("--ratio", default="16:9")
    ap.add_argument("--start-image")
    ap.add_argument("--audio", action="store_true")
    ap.add_argument("--no-draft", action="store_true", help="финальный рендер вместо черновика")
    ap.add_argument("--out", default=os.path.join(ROOT, "assets", "common", "video", "drafts"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    prompts = load_prompts()
    if a.list:
        for p in prompts.values():
            print(f"{p['id']:22} {p['duration']:>2} s  {p['where']}")
        return 0
    key = "" if a.dry_run else load_key()
    if not key and not a.dry_run:
        print(f"нет VOLCENGINE_ARK_API_KEY в {KEY_FILE} (arkcli auth login)")
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
