"""wave_build.py <name> <shot id>... [--q low|medium] [--res 1k|2k]: собрать $SP/<name>.json ({ids, requests}) из plan.json."""
import json, os, sys
SP = os.environ.get('REGEN_DIR', 'assets/ep01/regen')
args = sys.argv[1:]
q = 'low'; res = '1k'
if '--q' in args: i = args.index('--q'); q = args[i+1]; del args[i:i+2]
if '--res' in args: i = args.index('--res'); res = args[i+1]; del args[i:i+2]
name, ids = args[0], args[1:]
plan = {s['id']: s for s in json.load(open(f'{SP}/plan.json'))}
reqs = []
for i, sid in enumerate(ids):
    s = plan[sid]
    reqs.append({"index": i, "params": {"model": "gpt_image_2_5", "aspect_ratio": "16:9", "quality": q, "resolution": res,
                                         "prompt": s['prompt'], "medias": [{"role": "image_references", "value": j} for j in s['medias']]}})
json.dump({"ids": ids, "requests": reqs}, open(f'{SP}/{name}.json', 'w'), ensure_ascii=False)
for i, sid in enumerate(ids):
    s = plan[sid]; p = s['prompt']
    print(f'=== {i} {sid} q={q} res={res} medias={s["medias"]}')
    print(p[p.index('REFERENCE IMAGES'):p.index('CONTINUITY')].strip())
    print(p[p.index('SCENE\n'):].strip()); print()
