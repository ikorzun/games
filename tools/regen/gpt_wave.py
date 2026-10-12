"""gpt_wave.py <shot id>... [--q low|medium|high] [--model flare|sunburst] [--size WxH] [--dry-run]: снять кадры из
плана ($PLAN, по умолчанию plan.json) скиллом gpt-image (OpenAI GPT Image 2.5) — по 4 параллельно, в $SP/out/<id>.png (+ <id>.json с usage).

Референсы плана (`medias`) — в порядке плана, «Reference 1/2/3» в промпте позиционные:
  file:<путь>   — локальный файл (кроп из assets/ep01/_refs или кадр, снятый gpt-image);
  <job id>      — запись манифеста с этим job: кадр Higgsfield качается по url в $SP/cache (локальный файл
                  сета до закрытия может быть ещё старой редакции), лицо/фон/спрайт — локальный target.
"""
import json, os, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
SP = os.environ.get('REGEN_DIR', 'assets/ep01/_regen')
GPT = os.path.expanduser('~/.claude/skills/gpt-image/scripts/gpt_image.py')
os.environ.setdefault('SSL_CERT_FILE', '/etc/ssl/cert.pem')  # у Python с python.org нет своих корневых сертификатов
args = sys.argv[1:]
opt = {'--q': 'high', '--model': 'flare', '--size': '1920x1088'}
for k in opt:
    if k in args: i = args.index(k); opt[k] = args[i + 1]; del args[i:i + 2]
dry = '--dry-run' in args
ids = [a for a in args if a != '--dry-run']
plan = {s['id']: s for s in json.load(open(os.environ.get('PLAN', f'{SP}/plan.json')))}
byjob = {it['job']: it for it in json.load(open('assets/ep01/manifest.json')) if it.get('job')}
os.makedirs(f'{SP}/out', exist_ok=True); os.makedirs(f'{SP}/cache', exist_ok=True)


def local(m: str) -> str:
    if m.startswith('file:'):
        return m[len('file:'):]
    it = byjob[m]
    if it['kind'] == 'shot' and it.get('url'):
        p = f'{SP}/cache/{m}.png'
        if not os.path.exists(p):
            urllib.request.urlretrieve(it['url'], p)
        return p
    return it['target']


def run(sid: str) -> str:
    s = plan[sid]
    refs = [local(m) for m in s['medias']]
    cmd = ['python3', GPT, s['prompt'], '--model', opt['--model'], '--quality', opt['--q'], '--size', s.get('api_size', opt['--size']),
           '--out', f'{SP}/out', '--name', sid] + [x for r in refs for x in ('--image', r)]
    if s.get('background'):
        cmd += ['--background', s['background']]
    if dry:
        return f'{sid}: {opt} refs={refs}'
    for attempt in (1, 2):  # sunburst high однажды висел больше 10 минут: таймаут и один повтор
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            continue
        if not r.returncode:
            break
    else:
        return f'FAIL {sid}: timeout'
    if r.returncode:
        return f'FAIL {sid}: {r.stderr.strip()[-400:]}'
    res = json.loads(r.stdout)
    json.dump({'model': res['model'], 'quality': opt['--q'], 'size': s.get('api_size', opt['--size']), 'refs': refs, 'usage': res['usage'],
               'seconds': res['seconds']}, open(f'{SP}/out/{sid}.json', 'w'), ensure_ascii=False, indent=1)
    return f'ok {sid} {res["seconds"]}s usage={res["usage"]}'


with ThreadPoolExecutor(4) as ex:
    for line in ex.map(run, ids):
        print(line, flush=True)
