"""gpt_accept.py <shot id>...: принять кадры, снятые gpt_wave.py: $SP/out/<id>.png → target кадра (webp 1920×1080
тем же рецептом, что у fetch_assets), запись в registry.json и в манифест с "v": 2 без url (качать нечего) и
job "file:<target>" — по нему планировщик берёт кадр референсом. Файл кадра коммитится вместе с манифестом."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, 'tools')
from fetch_assets import to_webp
SP = os.environ.get('REGEN_DIR', 'assets/ep01/regen')
MAN = 'assets/ep01/manifest.json'
plan = {s['id']: s for s in json.load(open(f'{SP}/plan.json'))}
reg = json.load(open(f'{SP}/registry.json'))
man = json.load(open(MAN))
byid = {it['id']: it for it in man}
for sid in sys.argv[1:]:
    target = plan[sid]['file']
    meta = json.load(open(f'{SP}/out/{sid}.json'))
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    to_webp(Path(f'{SP}/out/{sid}.png').read_bytes(), Path(target), 'shot')
    reg[sid] = {"file": f'{SP}/out/{sid}.png', "model": meta['model'], "quality": meta['quality'], "v2": True}
    entry = {"id": sid, "kind": "shot", "target": target, "job": f"file:{target}", "v": 2, "src": meta['model']}
    if sid in byid:
        byid[sid].clear(); byid[sid].update(entry)
    else:
        man.append(entry); byid[sid] = entry
    print('accepted', sid, '→', target)
json.dump(reg, open(f'{SP}/registry.json', 'w'), ensure_ascii=False, indent=1)
open(MAN, 'w', encoding='utf-8').write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
