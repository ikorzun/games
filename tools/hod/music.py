"""music.py: фоновая музыка игры — ElevenLabs Music по ДНК главной темы (владелец 2026-10-14: «фоновую музыку сгенерируй
на основе основной заставки — это ДНК всей музыки в игре»).

ДНК передаётся не словами, а звуком: запись темы (assets/common/music/theme_main.mp3, по лицензии) загружена в Music
(/v1/music/upload), и каждый луп — composition plan модели music_v2_5 с аудио-образцом (conditioning_ref): отрезок темы
задаёт лад, «поступь» и настроение, текст роли — состав и плотность. Проба на 15 с повторила замеры темы: шаг 56 BPM
(дробление 112), ноты C G A D F B♭. Звучание — камерный состав по 2–3 живых инструмента, образец слабый (STYLE).

Луп для рантайма (HTML <audio loop>, без перехода): конец петли ищется там, где рисунок ударов совпадает с началом
(темп по замеру неоднозначен даже у самой темы: 56 / 76 / 112), хвост переходит в начало за XFADE с равной мощностью.
Дубль приходит без сжатия (PCM), громкость только понижается до −14 LUFS с пиком не выше −1,5 dBTP (без лимитера),
AAC 144 кбит/с стерео — один раз → assets/common/music/<роль>.m4a (пути и id m_* прежние). Сырьё — assets/ep01/_hod/music
(вне git). Ключ и запросы — как у озвучки (tools/hod/voice.py).

    python3 tools/hod/music.py gen [роль …]    # недостающие дубли (TAKES на роль), выбор лучшего, луп → assets/common/music
    python3 tools/hod/music.py build [роль …]  # только выбор и луп из готовых дублей
    python3 tools/hod/music.py use <роль> <n>  # взять дубль n вместо выбранного по замерам
"""
import json, os, subprocess, sys, uuid, urllib.error, urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice  # noqa: E402  ключ, запросы

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THEME = os.path.join(ROOT, 'assets/common/music/theme_main.mp3')
OUT = os.path.join(ROOT, 'assets/common/music')
RAW = os.path.join(ROOT, 'assets/ep01/_hod/music')
STATE = os.path.join(RAW, 'state.json')  # song_id загруженной темы, выбранные дубли
MODEL = 'music_v2_5'
TAKES = 2
LENGTH_MS = 90000
LOUD = {'I': -14.0, 'TP': -1.5}  # только вниз: дубли Music уже сведены (≈ −12,7 LUFS, пик ≈ −1 dBTP), лимитер «качал» звук
XFADE = 0.75  # с, переход хвоста в начало петли (2 с давали «двоение» на стыке)
STYLE = 'chamber'  # владелец 2026-10-14: синтезаторный вариант — «сильно синтетическая, местами зажёвывает», полный
                   # оркестр — «инструменты мешают друг другу»; камерный состав по 2–3 инструмента принят на пробе

DNA = ['instrumental', 'dark cinematic underscore', 'minimal chamber arrangement', 'lots of space between phrases',
       'each instrument in its own register, clear separation', 'minor key', 'slow heavy marching pulse',
       'warm natural acoustic recording']
NOT = ['vocals', 'lyrics', 'singing', 'choir', 'intro', 'outro', 'ending', 'fade out', 'climax', 'cheerful',
       'synthesizer', 'synth pads', 'electronic', 'drum machine', 'full orchestra', 'dense orchestration', 'busy arrangement',
       'wall of sound', 'layered strings', 'doubling', 'cluttered', 'brass', 'tape warble', 'wow and flutter', 'glitch', 'lo-fi']
# роль → (отрезок темы-образца, мс; сила образца; состав и настроение; чего не надо; указание в тексте). Образец слабый
# (low): от темы — лад, шаг и настроение, тембр — живой.
ROLES = {
    'calm': ((0, 30000), 'low', ['only two instruments', 'solo cello, long low notes', 'soft felt piano', 'very sparse', 'quiet'],
             ['percussion', 'drums', 'build-up'], 'quiet, sparse, steady, no ending'),
    'investigation': ((0, 30000), 'low', ['only three instruments', 'pizzicato double bass pulse', 'solo cello', 'sparse felt piano notes',
                                          'focused, methodical'], ['drums', 'build-up'], 'sparse, focused, methodical, steady pulse, no ending'),
    'tension': ((20000, 50000), 'low', ['only three instruments', 'low cello and double bass ostinato in unison', 'soft timpani heartbeat',
                                        'high dissonant violin harmonics', 'urgent, ominous', 'unresolved'], ['resolution', 'drop'],
                'insistent, ominous, sparse, steady, no ending'),
    'chronicle': ((0, 30000), 'low', ['only two instruments', 'solo piano, slow solemn chords', 'low cello drone', 'documentary, archival'],
                  ['percussion', 'drums', 'build-up'], 'solemn, sparse, steady, no ending'),
    'epilogue': ((33400, 63400), 'low', ['only two instruments', 'solo cello melody', 'sparse piano', 'elegiac, mournful', 'quiet aftermath'],
                 ['percussion', 'drums', 'build-up'], 'quiet, mournful, sparse, steady, no ending'),
}
SR = 44100


def state() -> dict:
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save_state(s: dict) -> None:
    os.makedirs(RAW, exist_ok=True)
    json.dump(s, open(STATE, 'w'), indent=1)


def theme_id() -> str:
    """Тема загружается в Music один раз (цена — как минута генерации); song_id хранится в сырье."""
    s = state()
    if s.get('theme_song_id'):
        return s['theme_song_id']
    b = '----' + uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="theme_main.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'
            ).encode() + open(THEME, 'rb').read() + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(voice.API + '/v1/music/upload', data=body, method='POST',
                                 headers={'xi-api-key': voice.key(), 'Content-Type': f'multipart/form-data; boundary={b}'})
    s['theme_song_id'] = json.loads(urllib.request.urlopen(req, context=voice.TLS, timeout=600).read())['song_id']
    save_state(s)
    return s['theme_song_id']


def take_path(role: str, n: int) -> str:
    return os.path.join(RAW, f'{role}.{STYLE}.{n}.wav')


def generate(role: str, n: int) -> None:
    (a, b), strength, styles, nots, direction = ROLES[role]
    chunk = {'text': f'[Instrumental] {{{direction}}}', 'duration_ms': LENGTH_MS, 'positive_styles': DNA + styles,
             'negative_styles': NOT + nots, 'context_adherence': 'high', 'condition_strength': strength,
             'conditioning_ref': {'song_id': theme_id(), 'range': {'start_ms': a, 'end_ms': b}}}
    pcm = voice.call('POST', '/v1/music?output_format=pcm_44100',  # без сжатия: AAC кодируется один раз, в конце
                     {'composition_plan': {'chunks': [chunk]}, 'model_id': MODEL}, accept='audio/pcm')
    os.makedirs(RAW, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', take_path(role, n)],
                   input=pcm, check=True)


def load(path: str, ch: int = 2) -> np.ndarray:
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).reshape(-1, ch)


def spectrum(x: np.ndarray, n: int = 4096, hop: int = 2048) -> np.ndarray:
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    return np.abs(np.fft.rfft(fr, axis=1))


def onsets(mono: np.ndarray) -> np.ndarray:
    """Поток спектра (рост энергии по полосам) с шагом 512 отсчётов ≈ 11,6 мс: где удары и атаки."""
    S = spectrum(mono, 2048, 512)
    return np.maximum(np.diff(np.log1p(S), axis=0), 0).sum(1)


def chroma(mono: np.ndarray) -> np.ndarray:
    S = spectrum(mono)
    f = np.fft.rfftfreq(4096, 1 / SR)
    ok = (f > 55) & (f < 2000)
    pc = (np.round(12 * np.log2(f[ok] / 440)) + 9) % 12
    c = np.array([S[:, ok][:, pc == i].sum() for i in range(12)])
    return c / c.max()


def loopify(x: np.ndarray) -> tuple[np.ndarray, float]:
    """Конец петли — там, где рисунок ударов ближе всего к началу (окно 4 с, поиск от 65 с): шов попадает в долю при
    любом темпе. Первую секунду пропускаем (атака генерации), хвост переходит в начало за XFADE с равной мощностью.
    Второе значение — совпадение рисунка у шва (корреляция, 1 — один в один)."""
    hop, fps = 512, SR / 512
    env = onsets(x.mean(1))
    s0, w, fade = int(fps), int(4 * fps), int(XFADE * SR)
    a = env[s0:s0 + w]
    a = (a - a.mean()) / (a.std() + 1e-9)
    best, match = 0, -1.0
    for n in range(int(65 * fps), min(len(env) - s0 - w - fade // hop - 1, int(80 * fps))):  # ≤ 80 с: ≤ 1,5 МБ
        b = env[s0 + n:s0 + n + w]
        c = float(np.dot(a, (b - b.mean()) / (b.std() + 1e-9)) / w)
        if c > match:
            best, match = n, c
    start, length = s0 * hop, best * hop
    y = x[start:start + length].copy()
    t = np.linspace(0, np.pi / 2, fade)[:, None]
    y[:fade] = x[start:start + fade] * np.sin(t) + x[start + length:start + length + fade] * np.cos(t)
    return y, match


def measure(path: str, theme: np.ndarray) -> dict:
    x = load(path)
    _, match = loopify(x)
    return {'notes': round(float(np.corrcoef(chroma(x.mean(1)), theme)[0, 1]), 3), 'seam': round(match, 2)}


def write(role: str, path: str) -> None:
    x = load(path)
    y, _ = loopify(x)
    tmp = os.path.join(RAW, f'{role}.loop.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', tmp],
                   input=y.astype(np.float32).tobytes(), check=True)
    m = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', tmp, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    j = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    gain = min(LOUD['I'] - float(j['input_i']), LOUD['TP'] - float(j['input_tp']))  # без лимитера: пик не выше TP
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', f'volume={gain:.2f}dB', '-c:a', 'aac', '-b:a', '144k',
                    '-ar', str(SR), '-movflags', '+faststart', os.path.join(OUT, f'{role}.m4a')], check=True)


def main() -> None:
    cmd, *args = sys.argv[1:] or ['build']
    s = state()
    if cmd == 'use':
        s.setdefault('use', {})[args[0]] = int(args[1])
        s.setdefault('picked', {})[args[0]] = int(args[1])
        save_state(s)
        write(args[0], take_path(args[0], int(args[1])))
        print(f'{args[0]}: дубль {args[1]} → {os.path.relpath(os.path.join(OUT, args[0] + ".m4a"), ROOT)}')
        return
    if cmd not in ('gen', 'build'):
        sys.exit(__doc__)
    roles = args or list(ROLES)
    if cmd == 'gen':
        for role in roles:
            for n in range(1, TAKES + 1):
                if not os.path.exists(take_path(role, n)):
                    generate(role, n)
                    print(f'{role}: дубль {n} готов', flush=True)
    theme = chroma(load(THEME).mean(1))
    for role in roles:
        rows = [(n, measure(take_path(role, n), theme)) for n in range(1, TAKES + 1) if os.path.exists(take_path(role, n))]
        # лучший: ноты ближе к теме (ДНК), шов ровнее
        n, _ = max(rows, key=lambda r: r[1]['notes'] + r[1]['seam'] / 2)
        n = s.get('use', {}).get(role, n)  # ручной выбор (use) важнее замеров
        write(role, take_path(role, n))
        s.setdefault('picked', {})[role] = n
        s.setdefault('measured', {})[role] = dict(rows)
        save_state(s)
        print(f'{role}: ' + ' · '.join(f"{'▶' if k == n else ' '}{k}: ноты {m['notes']}, шов {m['seam']}" for k, m in rows))


if __name__ == '__main__':
    main()
