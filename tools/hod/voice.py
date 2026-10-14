"""voice.py: озвучка «Хода следствия» через ElevenLabs → assets/ep01/voice/ru/<ключ реплики>.mp3.

Рантайм играет клип вместе с репликой (runtime/README.md, «Озвучка»): файл кладётся по ключу локализации, индекс
клипов строит сборка. Кастинг — tools/hod/voice_cast.json (кто → голос ElevenLabs и его настройки), профили голосов —
docs/season1/ep01-voices.md. Ключ API — из окружения ELEVENLABS_API_KEY или из связки ключей macOS (служба «elevenlabs»:
security add-generic-password -a "$USER" -s elevenlabs -w); в чат, в лог и в репозиторий его не пишем. Сырьё (пробы,
журнал знаков) — assets/ep01/_hod/voice/ (вне git).

  python3 tools/hod/voice.py check                     # ключ работает? тариф и остаток знаков (ключ не печатается)
  python3 tools/hod/voice.py voices                    # голоса аккаунта: имя, id, метки
  python3 tools/hod/voice.py library male|female [query]   # библиотека ElevenLabs: русские голоса для кастинга
  python3 tools/hod/voice.py samples [who ...]         # по одной пробе на персонажа → assets/ep01/_hod/voice/samples/
  python3 tools/hod/voice.py gen [--who oper] [--force] [--limit N]   # реплики эпизода; готовые клипы пропускает
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
SAY = [('БТИ', 'Бэ-Тэ-И'), ('№', 'номер '), ('С. В.', 'Эс Вэ'), ('А. Н.', 'А Эн'), ('МУРе', 'МУРе'), ('…', '...')]


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


def samples(who_list: list[str]) -> None:
    c = cast()
    os.makedirs(os.path.join(RAW, 'samples'), exist_ok=True)
    by = {}
    for ln in lines():
        by.setdefault(ln['who'], ln)
    for who in who_list or list(c['roles']):
        text = c['roles'][who].get('sample') or by.get(who, {}).get('text')
        if not text:
            continue
        audio = tts(who, text)
        dst = os.path.join(RAW, 'samples', f'{who}.mp3')
        open(dst, 'wb').write(audio)
        ledger(f'sample:{who}', len(text))
        print(f'{who}: {len(text)} зн. → {os.path.relpath(dst, ROOT)}')


def gen(who: str | None, force: bool, limit: int) -> None:
    os.makedirs(OUT, exist_ok=True)
    all_lines = lines()
    todo = []
    for i, ln in enumerate(all_lines):
        if who and ln['who'] != who:
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
        open(dst + '.tmp', 'wb').write(audio)
        os.replace(dst + '.tmp', dst)
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
    elif cmd == 'samples':
        samples(args)
    elif cmd == 'gen':
        who = args[args.index('--who') + 1] if '--who' in args else None
        limit = int(args[args.index('--limit') + 1]) if '--limit' in args else 0
        gen(who, '--force' in args, limit)
    elif cmd == 'stats':
        stats()
    else:
        sys.exit(__doc__)
