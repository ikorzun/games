#!/usr/bin/env python3
"""Скачивает сгенерированные ассеты по манифесту и конвертирует их в форматы рантайма.

Манифест: assets/<ep>/manifest.json — список записей
  {"id": "bg_yard_summer", "kind": "bg|cg|shot|doc|sprite|ui|music|ambient|sfx",
   "url": "https://…png", "target": "assets/ep01/bg/yard_summer.webp", "job": "<job id>"}
Картинки: bg/cg/shot/ui → webp q82, вписать в 1920×1080 (кроп по центру до 16:9); doc → webp q85, высота ≤ 1600;
sprite → webp с альфой q88, высота 1400 (альфа сохраняется; если PNG без альфы — предупреждение).
Аудио: сохраняется как есть (mp3/wav → mp3 через ffmpeg, если он установлен и нужен).

  pip install pillow requests
  python3 tools/fetch_assets.py assets/ep01/manifest.json [--only bg,sprite] [--force]

Сеть: CDN Higgsfield должен быть доступен (в облачной среде Claude — разрешить домен в настройках).
"""
from __future__ import annotations
import argparse, io, json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def fetch(url: str) -> bytes:
    import requests  # noqa
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return r.content

def to_webp(data: bytes, target: Path, kind: str) -> str:
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    note = ""
    if kind == "sprite":
        if im.mode != "RGBA":
            note = "НЕТ АЛЬФЫ — нужен remove_background"
            im = im.convert("RGBA")
        h = 1400
        w = round(im.width * h / im.height)
        im = im.resize((w, h), Image.LANCZOS)
        im.save(target, "WEBP", quality=88, method=6)
    elif kind == "doc":
        im = im.convert("RGB")
        if im.height > 1600:
            im = im.resize((round(im.width * 1600 / im.height), 1600), Image.LANCZOS)
        im.save(target, "WEBP", quality=85, method=6)
    else:  # bg / cg / shot / ui — 16:9, 1920×1080
        im = im.convert("RGB")
        tw, th = 1920, 1080
        scale = max(tw / im.width, th / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        left = (im.width - tw) // 2
        top = (im.height - th) // 2
        im = im.crop((left, top, left + tw, top + th))
        im.save(target, "WEBP", quality=82, method=6)
    return note

def to_audio(data: bytes, url: str, target: Path) -> str:
    ext = os.path.splitext(url.split("?")[0])[1].lower()
    if ext == target.suffix.lower():
        target.write_bytes(data)
        return ""
    if not shutil.which("ffmpeg"):
        alt = target.with_suffix(ext or ".bin")
        alt.write_bytes(data)
        return f"ffmpeg нет: сохранён как {alt.name}; сконвертируйте в {target.suffix} или поправьте путь в эпизоде"
    tmp = target.with_suffix(ext or ".bin")
    tmp.write_bytes(data)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-codec:a", "libmp3lame", "-q:a", "4", str(target)], check=True)
    tmp.unlink()
    return "ffmpeg → mp3"

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--only", default="", help="список kind через запятую")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    items = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    only = {k for k in args.only.split(",") if k}
    ok = skipped = failed = 0
    for it in items:
        if only and it["kind"] not in only:
            continue
        target = ROOT / it["target"]
        if target.exists() and not args.force:
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = fetch(it["url"])
            if it["kind"] in ("music", "ambient", "sfx"):
                note = to_audio(data, it["url"], target)
            else:
                note = to_webp(data, target, it["kind"])
            size = target.stat().st_size // 1024
            print(f"OK   {it['id']:24} → {it['target']} ({size} КБ){' — ' + note if note else ''}")
            ok += 1
        except Exception as e:  # noqa
            print(f"FAIL {it['id']:24} {e}", file=sys.stderr)
            failed += 1
    print(f"-- готово: {ok}, пропущено (есть): {skipped}, ошибок: {failed}")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
