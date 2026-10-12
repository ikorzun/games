"""tails.py <wave> <ids...>: собрать волну и напечатать только различающиеся части (REFERENCE, People, Camera, а Location/Light/Essential — если отличаются от первого кадра)."""
import json, sys, subprocess
import os
SP=os.environ.get('REGEN_DIR','assets/ep01/_regen')
name, ids = sys.argv[1], sys.argv[2:]
subprocess.run(['python3', 'tools/regen/wave_build.py', name, *ids], check=True, capture_output=True)
w = json.load(open(f'{SP}/{name}.json'))
first = None
for i, r in enumerate(w['requests']):
    p = r['params']['prompt']; m = [x['value'] for x in r['params']['medias']]
    ref = p[p.index('REFERENCE IMAGES\n')+17:p.index('\n\nCONTINUITY')]
    sc = p[p.index('SCENE\n\n')+7:]
    lines = dict(l.split(': ', 1) for l in sc.strip().split('\n'))
    print(f'=== {i} {ids[i]} medias={m}')
    print('REF:', ref)
    for k in ['People and action', 'Camera position']: print(f'{k}:', lines[k])
    other = {k: lines[k] for k in ['Location and time', 'Light sources', 'Essential objects']}
    if first is None or other != first:
        for k, v in other.items(): print(f'{k}:', v)
    first = first or other
    print()
