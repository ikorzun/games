"""accept.py --src hf|api <id>...: принять кадры и спрайты пересъёмки.
  hf  — генерация Higgsfield из registry.json (reg_add.py): файл качается по url;
  api — $SP/out/<id>.png (gpt_wave.py).
Файл → target рецептом fetch_assets по виду ассета (кадр — webp 1920×1080, спрайт — webp с альфой, 1400 по высоте),
запись в registry.json и в манифест с "v": 2: у hf — url и job (бот найдёт файл и пропустит), у api — без url и с
job "file:<target>" (по нему планировщик берёт кадр референсом). Файл коммитится вместе с манифестом."""
import json, os, subprocess, sys
from pathlib import Path
sys.path.insert(0, 'tools')
from fetch_assets import to_webp  # noqa: E402
SP = os.environ.get('REGEN_DIR', 'assets/ep01/_regen')
MAN = 'assets/ep01/manifest.json'
args = sys.argv[1:]
i = args.index('--src'); src = args[i + 1]; del args[i:i + 2]
plan = {}
for f in ('plan.json', 'sprite_plan.json', 'cg_plan.json', 'objects_plan.json'):
    if os.path.exists(f'{SP}/{f}'):
        plan.update({s['id']: s for s in json.load(open(f'{SP}/{f}'))})
reg = json.load(open(f'{SP}/registry.json'))
man = json.load(open(MAN))
byid = {it['id']: it for it in man}
for sid in args:
    s = plan[sid]; target = s['file']; kind = s.get('asset', 'shot')
    if src == 'hf':
        r = reg[sid]
        # curl с повторами: urllib на CDN Higgsfield дважды обрывался по таймауту чтения
        data = subprocess.run(['curl', '-sSf', '--retry', '3', '-m', '300', r['url']], capture_output=True, check=True).stdout
        entry = {"id": sid, "kind": kind, "url": r['url'], "target": target, "job": r['job'], "v": 2}
    else:
        meta = json.load(open(f'{SP}/out/{sid}.json'))
        data = Path(f'{SP}/out/{sid}.png').read_bytes()
        reg[sid] = {"file": f'{SP}/out/{sid}.png', "model": meta['model'], "q": meta['quality'], "v2": True}
        entry = {"id": sid, "kind": kind, "target": target, "job": f"file:{target}", "v": 2, "src": meta['model']}
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    note = to_webp(data, Path(target), kind)
    if sid in byid:
        byid[sid].clear(); byid[sid].update(entry)
    else:
        man.append(entry); byid[sid] = entry
    print('accepted', sid, '→', target, note)
json.dump(reg, open(f'{SP}/registry.json', 'w'), ensure_ascii=False, indent=1)
open(MAN, 'w', encoding='utf-8').write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
