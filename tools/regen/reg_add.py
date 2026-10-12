"""reg_add.py <wave.json> <jobs_wait result json string>: записать job/url в registry.json по индексам волны."""
import json, os, sys
SP = os.environ.get('REGEN_DIR', 'assets/ep01/regen')
wave = json.load(open(sys.argv[1]))
res = json.loads(sys.argv[2])
reg = json.load(open(f'{SP}/registry.json'))
for j in res['jobs']:
    sid = wave['ids'][j['index']]
    if j['status'] != 'completed':
        print('NOT COMPLETED', sid, j); continue
    reg[sid] = {"job": j["job_id"], "url": j["result_url"], "v2": True}
    print('reg', sid, j['job_id'])
json.dump(reg, open(f'{SP}/registry.json', 'w'), ensure_ascii=False, indent=1)
