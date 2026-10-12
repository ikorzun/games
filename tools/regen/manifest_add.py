"""Добавить/обновить в манифесте записи kind=shot по реестру job'ов (scratchpad/registry.json) и плану."""
import json, os, sys
SP = os.environ.get('REGEN_DIR', 'assets/ep01/regen')
MAN = 'assets/ep01/manifest.json'
plan = {s['id']: s for s in json.load(open(f'{SP}/plan.json'))}
reg = json.load(open(f'{SP}/registry.json'))
man = json.load(open(MAN))
byid = {it['id']: it for it in man}
ids = sys.argv[1:] or list(reg)
n = 0
for sid in ids:
    r = reg[sid]; s = plan[sid]
    entry = {"id": sid, "kind": "shot", "url": r['url'], "target": s['file'], "job": r['job'], "v": 2}
    if r.get('note'): entry['note'] = r['note']
    if sid in byid:
        byid[sid].update(entry)
    else:
        man.append(entry); byid[sid] = entry
    n += 1
open(MAN, 'w', encoding='utf-8').write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
print('manifest entries written:', n, 'total', len(man))
