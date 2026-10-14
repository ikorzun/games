"""voice.py: озвучка «Хода следствия» через ElevenLabs → assets/ep01/voice/ru/<ключ реплики>.mp3.

Рантайм играет клип вместе с репликой (runtime/README.md, «Озвучка»): файл кладётся по ключу локализации, индекс
клипов строит сборка. Кастинг — tools/hod/voice_cast.json (кто → голос ElevenLabs и его настройки), профили голосов —
docs/season1/ep01-voices.md. Ключ API — из окружения ELEVENLABS_API_KEY или из связки ключей macOS (служба «elevenlabs»:
security add-generic-password -a "$USER" -s elevenlabs -w); в чат, в лог и в репозиторий его не пишем. Сырьё (пробы,
журнал знаков) — assets/ep01/_hod/voice/ (вне git).

  python3 tools/hod/voice.py check                     # ключ работает? тариф и остаток знаков (ключ не печатается)
  python3 tools/hod/voice.py voices                    # голоса аккаунта: имя, id, метки
  python3 tools/hod/voice.py library male|female [query]   # библиотека ElevenLabs: русские голоса для кастинга
  python3 tools/hod/voice.py add <роль> <voice_id>      # голос из библиотеки → в аккаунт, id — в кастинг (меняет аккаунт!)
  python3 tools/hod/voice.py remove <voice_id>          # убрать голос из аккаунта (место для следующих; меняет аккаунт!)
  python3 tools/hod/voice.py design <роль> [seed] [--tag r2]  # голос по описанию (кастинг: design): 3 пробы → _hod/voice/design/
  python3 tools/hod/voice.py try <роль> <voice_id> [метка]    # проба голоса библиотеки на реплике роли → _hod/voice/audition/
                                                       # (голос на время пробы добавляется в аккаунт и убирается)
  python3 tools/hod/voice.py design-save <роль> <n>     # сохранить пробу n как голос аккаунта, id — в кастинг (меняет аккаунт!)
  python3 tools/hod/voice.py samples [who ...]         # по одной пробе на персонажа → assets/ep01/_hod/voice/samples/
  python3 tools/hod/voice.py gen [--who sledak,oper] [--force] [--limit N]   # реплики; готовые клипы пропускает;
                                                       # роль тянет за собой роли того же голоса (voice_of)
  python3 tools/hod/voice.py norm                      # заново выровнять громкость всех клипов из сырья (_hod/voice/clips)
  python3 tools/hod/voice.py stats                     # сколько реплик и знаков, сколько уже озвучено, расход по журналу
"""
import json, os, ssl, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from export_voice_lines import collect, load  # noqa: E402

EPISODE = os.path.join(ROOT, 'episodes/s1/ep01_hod.json')
TEXTS = os.path.join(ROOT, 'locales/ru/ep01_hod.json')
CAST = os.path.join(ROOT, 'tools/hod/voice_cast.json')
OUT = os.path.join(ROOT, 'assets/ep01/voice/ru')
RAW = os.path.join(ROOT, 'assets/ep01/_hod/voice')
API = 'https://api.elevenlabs.io'
FORMAT = 'mp3_44100_64'  # моно 64 кбит/с: речь чистая, ≈ 8 КБ на секунду
# Голоса библиотеки записаны на разной громкости (пробы — от −23 до −35 LUFS): каждый клип приводится к одной громкости
# речи, исходник ElevenLabs остаётся в сырье (_hod/voice/clips) — выравнивание можно переделать без кредитов.
LOUD = {'I': -16.0, 'TP': -1.5, 'LRA': 11.0}
LANG_MODELS = {'eleven_turbo_v2_5', 'eleven_flash_v2_5', 'eleven_v3'}  # эти модели принимают language_code


def _tls() -> ssl.SSLContext:
    """Python с python.org на macOS не видит системных сертификатов (CERTIFICATE_VERIFY_FAILED): берём certifi, иначе
    системный набор macOS."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        cafile = '/etc/ssl/cert.pem'
        return ssl.create_default_context(cafile=cafile) if os.path.exists(cafile) else ssl.create_default_context()


TLS = _tls()

# Только для запроса к синтезу (субтитры не меняются): аббревиатуры, которые модель читает буквами неверно.
SAY = [('БТИ', 'Бэ-Тэ-И'), ('№', 'номер '), ('С. В.', 'Эс Вэ'), ('А. Н.', 'А Эн'), ('МУРе', 'МУРе'), ('…', '...'),
       # экран жертв: инициал фамилии и годы жизни — словами (иначе «С.» читается как предлог, годы — как числа)
       ('Павловна С. 1919–1993', 'Павловна Эс. Тысяча девятьсот девятнадцатый — тысяча девятьсот девяносто третий'),
       ('Ильич Р. 1914–1993', 'Ильич Эр. Тысяча девятьсот четырнадцатый — тысяча девятьсот девяносто третий')]


KEYCHAIN = 'elevenlabs'  # служба в связке ключей macOS
_key: list[str] = []


def key() -> str:
    """Ключ: ELEVENLABS_API_KEY, иначе связка ключей macOS — так ключ не нужно класть в файлы и перезапускать приложение."""
    if not _key:
        k = os.environ.get('ELEVENLABS_API_KEY', '').strip()
        if not k and sys.platform == 'darwin':
            r = subprocess.run(['security', 'find-generic-password', '-s', KEYCHAIN, '-w'], capture_output=True, text=True)
            k = r.stdout.strip() if r.returncode == 0 else ''
        if not k:
            sys.exit('Нет ключа: сохраните его в связке ключей — в Терминале выполните\n'
                     '  security add-generic-password -a "$USER" -s elevenlabs -w\n'
                     'и вставьте ключ дважды (на экране он не появится). В чат ключ не присылайте.')
        _key.append(k)
    return _key[0]


def call(method: str, path: str, body: dict | None = None, accept: str = 'application/json', tries: int = 4) -> bytes:
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(tries):
        req = urllib.request.Request(API + path, data=data, method=method,
                                     headers={'xi-api-key': key(), 'Content-Type': 'application/json', 'Accept': accept})
        try:
            with urllib.request.urlopen(req, timeout=120, context=TLS) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            if e.code == 401:  # в ответе — чего не хватает (например, права ключа), сам ключ там не повторяется
                sys.exit(f'ElevenLabs: 401 на {path.split("?")[0]} — {detail}')
            sys.exit(f'ElevenLabs {method} {path.split("?")[0]}: HTTP {e.code} {detail}')
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            sys.exit(f'ElevenLabs: сеть — {e}')
    raise RuntimeError('unreachable')


def cast() -> dict:
    return json.load(open(CAST, encoding='utf-8'))


def lines() -> list[dict]:
    got, _ = collect(load(EPISODE), load(TEXTS), None)
    return got


def spoken(text: str) -> str:
    for a, b in SAY:
        text = text.replace(a, b)
    return text


def tts(who: str, text: str, prev: str = '', nxt: str = '') -> bytes:
    c = cast()
    role = c['roles'][who]
    voice = role.get('voice_id') or c['roles'].get(role.get('voice_of', ''), {}).get('voice_id')
    if not voice:
        sys.exit(f'{who}: голос не выбран — заполните voice_id в {os.path.relpath(CAST, ROOT)}')
    model = role.get('model', c['model'])
    body = {'text': spoken(text), 'model_id': model, 'voice_settings': {**c['settings'], **role.get('settings', {})}}
    if prev:
        body['previous_text'] = spoken(prev)
    if nxt:
        body['next_text'] = spoken(nxt)
    if model in LANG_MODELS:
        body['language_code'] = 'ru'
    return call('POST', f'/v1/text-to-speech/{voice}?output_format={FORMAT}', body, accept='audio/mpeg')


def normalize(src: str, dst: str) -> None:
    """Громкость речи — к LOUD (EBU R128): усиление до цели и лимитер по пику. loudnorm в линейном режиме на коротких
    репликах (1–3 с) упирался в пик и оставлял их на 4–8 дБ тише, а динамический «качает» — поэтому так."""
    m = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af',
                        f"loudnorm=I={LOUD['I']}:TP={LOUD['TP']}:LRA={LOUD['LRA']}:print_format=json", '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    j = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    gain = LOUD['I'] - float(j['input_i'])
    limit = 10 ** (LOUD['TP'] / 20)
    af = f'volume={gain:.2f}dB,alimiter=limit={limit:.3f}:attack=2:release=60:level=false'
    tmp = dst + '.tmp.mp3'
    # в игру — моно 48 кбит/с, 32 кГц (runtime/README.md, «Озвучка»: речь 32–48 кбит/с): эпизод ≈ 35 минут ≈ 12,5 МБ
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', af, '-ar', '32000', '-ac', '1',
                    '-c:a', 'libmp3lame', '-b:a', '48k', tmp], check=True)
    os.replace(tmp, dst)


def norm_all() -> None:
    src_dir = os.path.join(RAW, 'clips')
    names = sorted(f for f in os.listdir(src_dir) if f.endswith('.mp3'))
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(lambda f: normalize(os.path.join(src_dir, f), os.path.join(OUT, f)), names))
    print(f'выровнено: {len(names)} клипов → {os.path.relpath(OUT, ROOT)}')


def ledger(name: str, chars: int) -> None:
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, 'ledger.jsonl')
    with open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'name': name, 'chars': chars, 't': int(time.time())}, ensure_ascii=False) + '\n')


def check() -> None:
    """Ключ принят? Тариф и сколько знаков осталось в этом месяце; сколько нужно на эпизод."""
    sub = json.loads(call('GET', '/v1/user/subscription'))
    used, limit = sub.get('character_count', 0), sub.get('character_limit', 0)
    need = sum(len(x['text']) for x in lines())
    print(f"ключ принят · тариф {sub.get('tier', '?')} · знаков в месяце {limit}, потрачено {used}, осталось {limit - used}")
    print(f'на эпизод нужно ≈ {need} знаков (модель {cast()["model"]}: знак = кредит) плюс пробы и переозвучки')


def voices() -> None:
    data = json.loads(call('GET', '/v1/voices'))
    for v in data.get('voices', []):
        labels = ', '.join(f'{k}: {val}' for k, val in (v.get('labels') or {}).items())
        print(f"{v['voice_id']}  {v['name']:28s} {v.get('category', '')}  {labels}")


def library(gender: str, query: str = '') -> None:
    q = {'language': 'ru', 'gender': gender, 'page_size': 60, 'sort': 'usage_character_count_1y'}
    if query:
        q['search'] = query
    data = json.loads(call('GET', '/v1/shared-voices?' + urllib.parse.urlencode(q)))
    for v in data.get('voices', []):
        print(f"{v['voice_id']}  {v['public_owner_id'][:10]}…  {v['name'][:28]:28s} {v.get('age', ''):12s} "
              f"{v.get('accent', '')[:14]:14s} {(v.get('description') or '').replace(chr(10), ' ')[:90]}")


def save_cast(c: dict) -> None:
    open(CAST, 'w', encoding='utf-8').write(json.dumps(c, ensure_ascii=False, indent=2) + '\n')


def add(role: str, voice_id: str) -> None:
    """Общий голос библиотеки — в «Мои голоса» аккаунта (занимает место: на Starter их 10), id — в кастинг."""
    c = cast()
    q = {'page_size': 100, 'search': voice_id}
    found = [v for v in json.loads(call('GET', '/v1/shared-voices?' + urllib.parse.urlencode(q))).get('voices', []) if v['voice_id'] == voice_id]
    if not found:
        sys.exit(f'{voice_id}: в библиотеке не найден')
    v = found[0]
    res = json.loads(call('POST', f"/v1/voices/add/{v['public_owner_id']}/{voice_id}", {'new_name': f"hod {role} — {v['name'][:40]}"}))
    c['roles'][role]['voice_id'] = res.get('voice_id', voice_id)
    c['roles'][role]['library'] = {'voice_id': voice_id, 'name': v['name']}
    save_cast(c)
    print(f"{role}: {v['name']} → {c['roles'][role]['voice_id']}")


def remove(voice_id: str) -> None:
    call('DELETE', f'/v1/voices/{voice_id}')
    print(f'{voice_id}: убран из аккаунта (id в кастинге остаётся — для повторного add)')


def sample_line(role: str) -> str:
    """Характерная реплика роли средней длины (около 120 знаков) — для проб."""
    own = [ln['text'] for ln in lines() if ln['who'] == role]
    return min(own, key=lambda t: abs(len(t) - 120)) if own else ''


def design(role: str, seed: int | None = None, tag: str = '') -> None:
    """Голос по описанию (Voice Design, eleven_ttv_v3): три пробы на репликах самой роли; в аккаунт ничего не пишется."""
    import base64
    c = cast()
    desc = c['roles'][role]['design']
    first = sample_line(role)
    own = [first] + [ln['text'] for ln in lines() if ln['who'] == role and ln['text'] != first]
    text = ''
    for t in own:
        text = f'{text} {t}'.strip()
        if len(text) >= 200:
            break
    text = text[:1000] if len(text) >= 100 else (text + ' ' + desc.get('extra_text', 'Ну что вы, милый, я же вам всё рассказала, как было. Вы уж разберитесь.'))[:1000]
    before = json.loads(call('GET', '/v1/user/subscription')).get('character_count', 0)
    body = {'voice_description': desc['description'], 'model_id': desc.get('model', 'eleven_ttv_v3'), 'text': spoken(text)}
    if seed is not None:
        body['seed'] = seed
    res = json.loads(call('POST', '/v1/text-to-voice/design?output_format=' + FORMAT, body))
    after = json.loads(call('GET', '/v1/user/subscription')).get('character_count', 0)
    out = os.path.join(RAW, 'design')
    os.makedirs(out, exist_ok=True)
    meta = {'role': role, 'text': res.get('text', text), 'previews': []}
    for i, pv in enumerate(res.get('previews', []), 1):
        dst = os.path.join(out, f'{role}{tag}_{i}.mp3')
        open(dst, 'wb').write(base64.b64decode(pv['audio_base_64']))
        meta['previews'].append({'n': i, 'generated_voice_id': pv['generated_voice_id'], 'file': os.path.relpath(dst, ROOT)})
        print(f'{role} проба {i}: {os.path.relpath(dst, ROOT)} ({pv.get("duration_secs", 0):.1f} с)')
    json.dump(meta, open(os.path.join(out, f'{role}{tag}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ledger(f'design:{role}', after - before)
    print(f'списано знаков: {after - before}')


def design_save(role: str, n: int, tag: str = '') -> None:
    c = cast()
    meta = json.load(open(os.path.join(RAW, 'design', f'{role}{tag}.json'), encoding='utf-8'))
    pv = next(p for p in meta['previews'] if p['n'] == n)
    res = json.loads(call('POST', '/v1/text-to-voice', {'voice_name': f'hod {role} (design)',
                                                         'voice_description': c['roles'][role]['design']['description'],
                                                         'generated_voice_id': pv['generated_voice_id']}))
    c['roles'][role]['voice_id'] = res['voice_id']
    save_cast(c)
    print(f"{role}: проба {n} → голос {res['voice_id']}")


def try_voice(role: str, voice_id: str, label: str = '') -> None:
    """Проба голоса библиотеки на реплике роли (с настройками роли): голос добавляется на время пробы и убирается."""
    c = cast()
    found = [v for v in json.loads(call('GET', '/v1/shared-voices?' + urllib.parse.urlencode({'page_size': 100, 'search': voice_id}))).get('voices', [])
             if v['voice_id'] == voice_id]
    if not found:
        sys.exit(f'{voice_id}: в библиотеке не найден')
    v = found[0]
    res = json.loads(call('POST', f"/v1/voices/add/{v['public_owner_id']}/{voice_id}", {'new_name': f'hod try {role}'}))
    vid = res.get('voice_id', voice_id)
    try:
        text = sample_line(role)
        body = {'text': spoken(text), 'model_id': c['model'], 'voice_settings': {**c['settings'], **c['roles'][role].get('settings', {})}}
        audio = call('POST', f'/v1/text-to-speech/{vid}?output_format={FORMAT}', body, accept='audio/mpeg')
        out = os.path.join(RAW, 'audition')
        os.makedirs(out, exist_ok=True)
        dst = os.path.join(out, f'{role}_{label or v["name"].split(" ")[0]}.mp3')
        open(dst[:-4] + '.raw.mp3', 'wb').write(audio)
        normalize(dst[:-4] + '.raw.mp3', dst)
        ledger(f'try:{role}:{voice_id}', len(text))
        print(f"{role} · {v['name']}: {len(text)} зн. → {os.path.relpath(dst, ROOT)}")
    finally:
        call('DELETE', f'/v1/voices/{vid}')


def with_shared(roles: set[str]) -> set[str]:
    """Роли, которые звучат тем же голосом (voice_of): «sledak» тянет «_inner» и «sledak_old»."""
    c = cast()
    return roles | {w for w, r in c['roles'].items() if r.get('voice_of') in roles}


def samples(who_list: list[str]) -> None:
    c = cast()
    os.makedirs(os.path.join(RAW, 'samples'), exist_ok=True)
    by: dict[str, list[str]] = {}
    for ln in lines():
        by.setdefault(ln['who'], []).append(ln['text'])
    for who in who_list or list(c['roles']):
        # проба — характерная реплика роли средней длины (около 120 знаков), а не первая попавшаяся
        own = by.get(who, [])
        text = c['roles'][who].get('sample') or (min(own, key=lambda t: abs(len(t) - 120)) if own else '')
        if not text:
            continue
        audio = tts(who, text)
        dst = os.path.join(RAW, 'samples', f'{who}.mp3')
        open(dst[:-4] + '.raw.mp3', 'wb').write(audio)
        normalize(dst[:-4] + '.raw.mp3', dst)
        ledger(f'sample:{who}', len(text))
        print(f'{who}: {len(text)} зн. → {os.path.relpath(dst, ROOT)}')


def gen(who: str | None, force: bool, limit: int) -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(RAW, 'clips'), exist_ok=True)
    all_lines = lines()
    roles = with_shared(set(who.split(','))) if who else None
    todo = []
    for i, ln in enumerate(all_lines):
        if roles and ln['who'] not in roles:
            continue
        dst = os.path.join(OUT, f"{ln['clip']}.mp3")
        if os.path.exists(dst) and not force:
            continue
        same = lambda j: 0 <= j < len(all_lines) and all_lines[j]['scene'] == ln['scene']  # noqa: E731
        prev = all_lines[i - 1]['text'] if same(i - 1) else ''
        nxt = all_lines[i + 1]['text'] if same(i + 1) else ''
        todo.append((ln, prev, nxt, dst))
    todo = todo[:limit] if limit else todo
    print(f'к озвучке: {len(todo)} реплик, {sum(len(t[0]["text"]) for t in todo)} знаков')

    def one(item):
        ln, prev, nxt, dst = item
        audio = tts(ln['who'], ln['text'], prev, nxt)
        raw = os.path.join(RAW, 'clips', os.path.basename(dst))
        open(raw + '.tmp', 'wb').write(audio)
        os.replace(raw + '.tmp', raw)
        normalize(raw, dst)
        ledger(ln['clip'], len(ln['text']))
        return f"{ln['clip']} ({ln['who']}, {len(ln['text'])} зн.)"

    with ThreadPoolExecutor(max_workers=3) as ex:  # ElevenLabs ограничивает одновременные запросы по тарифу
        for n, msg in enumerate(ex.map(one, todo), 1):
            print(f'[{n}/{len(todo)}] {msg}')


def stats() -> None:
    all_lines = lines()
    done = [ln for ln in all_lines if os.path.exists(os.path.join(OUT, f"{ln['clip']}.mp3"))]
    print(f"реплик {len(all_lines)} ({sum(len(x['text']) for x in all_lines)} зн.), озвучено {len(done)} "
          f"({sum(len(x['text']) for x in done)} зн.)")
    path = os.path.join(RAW, 'ledger.jsonl')
    if os.path.exists(path):
        rows = [json.loads(x) for x in open(path, encoding='utf-8')]
        print(f'по журналу отправлено в синтез: {sum(r["chars"] for r in rows)} знаков ({len(rows)} запросов)')


if __name__ == '__main__':
    cmd, *args = sys.argv[1:] or ['stats']
    if cmd == 'check':
        check()
    elif cmd == 'voices':
        voices()
    elif cmd == 'library':
        library(args[0], ' '.join(args[1:]))
    elif cmd == 'add':
        add(args[0], args[1])
    elif cmd == 'remove':
        remove(args[0])
    elif cmd == 'design':
        tag = args[args.index('--tag') + 1] if '--tag' in args else ''
        pos = [a for a in args if a != '--tag' and a != tag]
        design(pos[0], int(pos[1]) if len(pos) > 1 else None, tag)
    elif cmd == 'design-save':
        design_save(args[0], int(args[1]), args[2] if len(args) > 2 else '')
    elif cmd == 'try':
        try_voice(args[0], args[1], args[2] if len(args) > 2 else '')
    elif cmd == 'samples':
        samples(args)
    elif cmd == 'gen':
        who = args[args.index('--who') + 1] if '--who' in args else None
        limit = int(args[args.index('--limit') + 1]) if '--limit' in args else 0
        gen(who, '--force' in args, limit)
    elif cmd == 'norm':
        norm_all()
    elif cmd == 'stats':
        stats()
    else:
        sys.exit(__doc__)
