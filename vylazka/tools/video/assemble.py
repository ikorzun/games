"""Сборка геймплейного видео: кадры сцен по меткам → mp4 30 к/с, звук — из звуков игры (public/audio), заставка в конце.

Запуск: python3 -I tools/video/assemble.py tools/video/edit.json <out.mp4>  (нужен ffmpeg)
edit.json: {"clips": [{"scene": "s1", "from": 0, "to": 366, "gap": 6, "sfx": [[file, at_frame, volume, {fade/trim}]...],
            "bed": [file, volume, fade_in_s, fade_out_s]}], "title": "<папка кадров заставки>", "title_sfx": [...]}
Кадры сцены — e2e/out/gameplay/<scene>/NNNN.png; at_frame — от начала клипа.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

FPS = 30
ROOT = Path(__file__).resolve().parents[2]
FRAMES = ROOT / 'e2e' / 'out' / 'gameplay'
AUDIO = ROOT / 'public' / 'audio'
W, H = 1280, 720

edit = json.load(open(sys.argv[1]))
out = Path(sys.argv[2])
work = out.parent / (out.stem + '_work')
seq = work / 'seq'
if seq.exists():
    for f in seq.iterdir():
        f.unlink()
seq.mkdir(parents=True, exist_ok=True)

black = work / 'black.png'
if not black.exists():
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black:s={W}x{H}', '-frames:v', '1', str(black)], check=True)

n = 0
events = []  # (file, start_s, volume, opts)


def put(src: Path) -> None:
    global n
    os.symlink(Path(src).resolve(), seq / f'{n:05d}.png')
    n += 1


for clip in edit['clips']:
    for _ in range(clip.get('gap', 0)):
        put(black)
    start = n
    d = FRAMES / clip['scene']
    for i in range(clip['from'], clip['to']):
        p = d / f'{i:04d}.png'
        if not p.exists():
            break
        put(p)
    length = n - start
    if 'bed' in clip:
        f, vol, fi, fo = clip['bed']
        events.append((f, start / FPS, vol, {'loop': True, 'dur': length / FPS, 'fade_in': fi, 'fade_out': fo}))
    for s in clip.get('sfx', []):
        f, at, vol = s[0], s[1], s[2]
        opts = s[3] if len(s) > 3 else {}
        events.append((f, (start + at) / FPS, vol, opts))

if edit.get('title'):
    for _ in range(edit.get('title_gap', 8)):
        put(black)
    start = n
    tdir = Path(edit['title'])
    if not tdir.is_absolute():
        tdir = ROOT / tdir
    for p in sorted(tdir.glob('*.png')):
        put(p)
    for s in edit.get('title_sfx', []):
        f, at, vol = s[0], s[1], s[2]
        opts = s[3] if len(s) > 3 else {}
        events.append((f, (start + at) / FPS, vol, opts))
    for _ in range(12):
        put(black)

total = n / FPS
print(f'кадров {n}, {total:.1f} с, звуков {len(events)}')

video = work / 'video.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', str(seq / '%05d.png'), '-c:v', 'libx264', '-preset', 'slow',
                '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(video)], check=True)

# Звук: каждый звук — свой вход; петли — stream_loop; громкость, обрезка, затухания, задержка; смесь без нормировки, ограничитель.
args = ['ffmpeg', '-v', 'error', '-y']
filters = []
labels = []
for i, (f, at, vol, o) in enumerate(events):
    path = AUDIO / f if not os.path.isabs(f) else Path(f)
    if o.get('loop'):
        args += ['-stream_loop', '-1']
    args += ['-i', str(path)]
    chain = [f'[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo']
    if o.get('rate'):
        chain.append(f"asetrate=48000*{o['rate']},aresample=48000")
    dur = o.get('dur')
    if dur:
        chain.append(f'atrim=0:{dur:.3f},asetpts=PTS-STARTPTS')
    if o.get('fade_in'):
        chain.append(f"afade=t=in:st=0:d={o['fade_in']}")
    if o.get('fade_out') and dur:
        chain.append(f"afade=t=out:st={max(0, dur - o['fade_out']):.3f}:d={o['fade_out']}")
    chain.append(f'volume={vol}')
    ms = max(0, round(at * 1000))
    chain.append(f'adelay={ms}|{ms}')
    filters.append(','.join(chain) + f'[a{i}]')
    labels.append(f'[a{i}]')
filters.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{total:.3f},alimiter=limit=0.89[mix]')
audio = work / 'audio.m4a'
args += ['-filter_complex', ';'.join(filters), '-map', '[mix]', '-c:a', 'aac', '-b:a', '192k', str(audio)]
subprocess.run(args, check=True)

subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-i', str(audio), '-c:v', 'copy', '-c:a', 'copy', '-shortest',
                '-movflags', '+faststart', str(out)], check=True)
print(out, f'{out.stat().st_size // 1024} КБ')
