"""sfx.py: звуки событий «Хода следствия» — ElevenLabs Sound Effects (владелец 2026-10-14: «если что-то происходит в
игре — звонок в дверь, звонок телефона — звуки должны быть и чётко совпадать с таймингом»).

Звук лежит рядом с эпизодом: эффекты — assets/ep01/sfx/<имя>.mp3 (моно), фоны — assets/ep01/amb/<имя>.mp3 (стерео,
бесшовная петля). Сырые дубли — assets/ep01/_hod/sfx_raw (вне git). Обработка ffmpeg: срез тишины в начале, громкость
к целевой (эффекты −20 LUFS, фоны −30 LUFS — под голосом, он −16), короткий спад в конце против щелчка.
Ключ и запросы — как у озвучки (tools/hod/voice.py: окружение или связка ключей macOS; ключ не печатается).
Кредиты общие с озвучкой: на переозвучку держим не меньше RESERVE.

    python3 tools/hod/sfx.py list            # что есть и чего нет
    python3 tools/hod/sfx.py gen [звук …]    # сгенерировать недостающие варианты частей (указанные звуки — заново) и собрать
    python3 tools/hod/sfx.py build [звук …]  # только выбрать варианты и собрать из сырых дублей
"""
import json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice  # noqa: E402  ключ, запросы, проверка тарифа

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'assets/ep01/_hod/sfx_raw')
RESERVE = 8000  # кредитов на переозвучку (договорённость с сессией озвучки 2026-10-14)

# Части — простые одиночные события (модель плохо держит «два звонка и щелчок» в одном промпте): имя → (длительность с,
# петля, промпт). Каждую часть генерируем в TAKES вариантах и берём тот, где звук плотнее и раньше начинается.
TAKES = 2
PARTS = {
    'phone_bell': (1.5, False, 'An old Soviet rotary desk telephone rings once: a loud mechanical bell, close up in a quiet office. No voices, no music.'),
    'phone_pickup': (0.6, False, 'A heavy plastic telephone handset is lifted off a rotary phone cradle: a single click. No voices.'),
    'phone_dial': (3.5, False, 'A rotary telephone dial is turned and released several times: ratcheting clicks, close up. No voices.'),
    'doorbell_ring': (1.2, False, 'An old electric apartment doorbell, one long harsh buzzing ring heard on a stairwell landing. No voices.'),
    'door_chain_open': (1.6, False, 'An apartment door opens a little and stops on a security chain: a sharp metallic chain rattle. No voices.'),
    'door_chain_off': (1.8, False, 'A door security chain is unhooked and dropped, rattling, then the door swings open with a creak. No voices.'),
    'door_close': (1.8, False, 'A heavy padded apartment door closes with a muffled thud and a lock turns. Stairwell echo. No voices.'),
    'office_door': (1.3, False, 'An old wooden office door is opened quickly: the handle clacks, the hinges creak. No voices.'),
    'stairs_up': (3.0, False, 'Footsteps walking up concrete stairs in an apartment building stairwell, echo. No voices.'),
    'stairs_run': (2.5, False, 'Fast running footsteps down concrete stairs with echo. No voices.'),
    'car_door': (0.8, False, 'An old car door slams shut. No voices.'),
    'car_start': (3.0, False, 'An old small car engine cranks, starts and idles roughly. No voices, no music.'),
    'car_trunk': (1.5, False, 'An old sedan trunk lid is unlatched and opens with a metallic clunk and a spring squeak. No voices.'),
    'pen_drop': (1.0, False, 'A ballpoint pen drops onto a wooden parquet floor and rolls a little. No voices.'),
    'stamp': (1.0, False, 'A rubber office stamp is thumped onto paper on a wooden desk twice. No voices.'),
    'drawer_keys': (1.6, False, 'A wooden desk drawer slides open and a bunch of keys jingles as it is picked up. No voices.'),
    'drawer_close': (0.8, False, 'A wooden desk drawer is pushed shut with a bump. No voices.'),
    'match': (1.2, False, 'A wooden match is struck on a matchbox and flares. No voices.'),
    'tea_glass': (1.5, False, 'A glass of tea in a metal glass holder is set down on a wooden desk and a teaspoon clinks against it. No voices.'),
    'handcuffs': (1.0, False, 'Metal handcuffs click shut. No voices.'),
    'shovels': (4.0, False, 'A shovel digs into damp forest soil, several strokes, scraping and thudding. No voices.'),
    'gunshot': (2.5, False, 'A single pistol gunshot in a concrete stairwell at night, sharp crack with a long echo. No voices, no music.'),
    # фоны (бесшовные петли)
    'forest_dawn': (16.0, True, 'Early summer morning at the edge of a birch forest: birds singing, a light breeze in the leaves, a distant road. Calm steady background, no voices, no music.'),
    'night_flat': (16.0, True, 'A quiet apartment at night: a refrigerator hums, a wall clock ticks, a distant city outside a closed window. Steady background, no voices, no music.'),
    'court_room': (16.0, True, 'A small courtroom: quiet murmur of a few people, chairs creaking, papers shuffling, an occasional cough, no clear words. Steady background, no music.'),
    'winter_street': (16.0, True, 'A city street in winter: light cold wind, distant traffic on wet snow, a trolleybus passing far away, muffled footsteps on snow. Steady background, no voices, no music.'),
    # общие фоны и VHS-склейка — раньше были не из ElevenLabs (владелец 2026-10-14: «звуки и музыку — из ElevenLabs»)
    'yard_summer': (16.0, True, 'A Moscow apartment courtyard on a summer day heard through an open window: children playing far away, sparrows chirping, leaves rustling, a distant car. Steady background, no clear words, no music.'),
    'office_day': (16.0, True, 'An old Soviet government office in the daytime: a typewriter clacking behind a wall, muffled murmur in the corridor, a wall clock ticking, a chair creaking now and then. Steady background, no telephone, no clear words, no music.'),
    'street_day': (16.0, True, 'A Moscow street on a summer day in the early 1990s: steady traffic of old cars and buses passing, a trolleybus hum, distant horns, sparrows. Steady background, no clear words, no music.'),
    'street_night': (16.0, True, 'A city street on a summer night just after rain: tyres hissing on wet asphalt as an occasional car passes, distant traffic, water dripping from a drainpipe, no rain falling. Steady background, no voices, no music.'),
    'archive_hum': (16.0, True, 'A quiet windowless archive room: fluorescent tube lights buzzing and humming, a low ventilation hum, an occasional rustle of paper. Steady background, no voices, no music.'),
    'stairwell': (16.0, True, 'A concrete stairwell in an old Soviet apartment block: hollow quiet echo, a faint lift hum, a muffled television far behind an apartment door. Steady background, no door slams, no clear words, no music.'),
    'vhs_glitch': (2.0, False, 'A VHS tape glitch: a short burst of analog video tracking noise, tape warble and static hiss, ending with a click. No voices, no music.'),
}
# Готовые звуки игры: имя → (папка, состав). Состав — части и паузы (число, с) по порядку; тайминг события задаём тут,
# а сценарий ждёт столько же (sfx hold_ms), чтобы реплика пришлась после звука (снял трубку — заговорил).
SOUNDS = {
    'phone_ring': ('sfx', ['phone_bell', 0.6, 'phone_bell', 0.35, 'phone_pickup']),
    'phone_dial': ('sfx', ['phone_dial']),
    'doorbell': ('sfx', ['doorbell_ring', 0.5, 'doorbell_ring']),
    'door_chain_open': ('sfx', ['door_chain_open']),
    'door_chain_off': ('sfx', ['door_chain_off']),
    'door_close': ('sfx', ['door_close']),
    'office_door': ('sfx', ['office_door']),
    'stairs_up': ('sfx', ['stairs_up']),
    'stairs_run': ('sfx', ['stairs_run']),
    'car_go': ('sfx', ['car_door', 0.25, 'car_start']),
    'car_trunk': ('sfx', ['car_trunk']),
    'pen_drop': ('sfx', ['pen_drop']),
    'stamp': ('sfx', ['stamp']),
    'drawer_keys': ('sfx', ['drawer_keys']),
    'drawer_close': ('sfx', ['drawer_close']),
    'match': ('sfx', ['match']),
    'tea_glasses': ('sfx', ['tea_glass']),
    'handcuffs': ('sfx', ['handcuffs']),
    'shovels': ('sfx', ['shovels']),
    'gunshot': ('sfx', ['gunshot']),
    'forest_dawn': ('amb', ['forest_dawn']),
    'night_flat': ('amb', ['night_flat']),
    'court_room': ('amb', ['court_room']),
    'winter_street': ('amb', ['winter_street']),
    'yard_summer': ('amb', ['yard_summer']),
    'office_day': ('amb', ['office_day']),
    'street_day': ('amb', ['street_day']),
    'street_night': ('amb', ['street_night']),
    'archive_hum': ('amb', ['archive_hum']),
    'stairwell': ('amb', ['stairwell']),
    'vhs_glitch': ('sfx', ['vhs_glitch']),
}


def out_path(name: str) -> str:
    return os.path.join(ROOT, f'assets/ep01/{SOUNDS[name][0]}/{name}.mp3')


def take_path(part: str, n: int) -> str:
    return os.path.join(RAW, f'{part}.{n}.mp3')


def part_path(part: str) -> str:
    """Выбранный вариант части, срезанный по тишине и выровненный (wav, вне git)."""
    return os.path.join(RAW, f'{part}.wav')


def credits_left() -> int:
    sub = json.loads(voice.call('GET', '/v1/user/subscription'))
    return int(sub['character_limit']) - int(sub['character_count'])


def generate(part: str, n: int) -> None:
    dur, loop, prompt = PARTS[part]
    body = {'text': prompt, 'duration_seconds': dur, 'prompt_influence': 0.6, 'model_id': 'eleven_text_to_sound_v2'}
    if loop:
        body['loop'] = True
    audio = voice.call('POST', '/v1/sound-generation?output_format=mp3_44100_128', body, accept='audio/mpeg')
    os.makedirs(RAW, exist_ok=True)
    with open(take_path(part, n), 'wb') as f:
        f.write(audio)


def envelope(path: str) -> list[float]:
    """Громкость по 50 мс (моно, 16 кГц)."""
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    import array
    a = array.array('h', pcm)
    win = 800
    return [(sum(v * v for v in a[i:i + win]) / max(1, len(a[i:i + win]))) ** 0.5 / 32768 for i in range(0, len(a), win)]


def score(part: str, path: str) -> float:
    """Чем больше, тем лучше: звук начинается сразу и занимает заметную часть заказанной длины (не тишина с хвостом)."""
    env = envelope(path)
    if not env:
        return -1
    peak = max(env) or 1e-9
    loud = [v > peak * 0.2 for v in env]
    onset = loud.index(True) if True in loud else len(env)
    if PARTS[part][1]:  # петля: ровная громкость без провалов
        return min(env) / peak
    return sum(loud) / len(env) - onset * 0.05


def pick(part: str) -> str:
    """Выбрать лучший вариант части; у эффекта срезать тишину по краям (порог — 40 дБ ниже пика: колокол телефона
    затухает плавно, и паузы между частями должен задавать рецепт, а не хвост), затем громкость к целевой."""
    import numpy as np
    takes = [take_path(part, n) for n in range(1, TAKES + 1) if os.path.exists(take_path(part, n))]
    best = max(takes, key=lambda p: score(part, p))
    loop = PARTS[part][1]
    ch = 2 if loop else 1
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', best, '-ac', str(ch), '-ar', '44100', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, dtype=np.float32).reshape(-1, ch)
    if not loop:
        win = 882  # 20 мс
        mono = x.mean(axis=1)
        rms = np.array([np.sqrt(np.mean(mono[i:i + win] ** 2)) for i in range(0, len(mono), win)]) + 1e-9
        db = 20 * np.log10(rms)
        on = np.nonzero(db > db.max() - 40)[0]
        a, b = on[0] * win, min(len(mono), (on[-1] + 1) * win)
        x = x[a:b].copy()
        fade = min(len(x), 1764)  # 40 мс спада в конце
        x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    chain = 'loudnorm=I=-20:TP=-2:LRA=11'
    if loop:  # петля — одно усиление на весь файл: динамический loudnorm в начале «вдыхает», и на шве скачок до 10 дБ
        m = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-f', 'f32le', '-ar', '44100', '-ac', str(ch), '-i', '-',
                            '-af', 'loudnorm=I=-30:TP=-3:print_format=json', '-f', 'null', '-'],
                           input=x.astype(np.float32).tobytes(), capture_output=True).stderr.decode()
        chain = f"volume={-30 - float(json.loads(m[m.rindex('{'):m.rindex('}') + 1])['input_i']):.2f}dB"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', str(ch), '-i', '-', '-af', chain,
                    '-ar', '44100', part_path(part)], input=x.astype(np.float32).tobytes(), check=True)
    return best


def build(name: str) -> None:
    """Собрать звук игры из частей и пауз; эффект — моно 96 кбит/с со спадом 40 мс, фон — стерео 128 кбит/с."""
    folder, recipe = SOUNDS[name]
    dst = out_path(name)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    inputs, labels, k = [], [], 0
    for item in recipe:
        if isinstance(item, str):
            inputs += ['-i', part_path(item)]
            labels.append(f'[{k}:a]')
            k += 1
        else:
            inputs += ['-f', 'lavfi', '-t', str(item), '-i', f'anullsrc=r=44100:cl={"stereo" if folder == "amb" else "mono"}']
            labels.append(f'[{k}:a]')
            k += 1
    loop = folder == 'amb'
    tail = '' if loop else ',areverse,afade=t=in:d=0.04,areverse'
    graph = f'{"".join(labels)}concat=n={len(labels)}:v=0:a=1{tail}[out]'
    codec = ['-ac', '2', '-b:a', '128k'] if loop else ['-ac', '1', '-b:a', '96k']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '44100', *codec, dst], check=True)


def duration(path: str) -> float:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def main() -> None:
    cmd, *names = sys.argv[1:] or ['list']
    if cmd == 'list':
        for n in SOUNDS:
            p = out_path(n)
            print(f'{n:16} {"есть " + format(duration(p), ".2f") + " с" if os.path.exists(p) else "нет"}')
        return
    if cmd not in ('gen', 'build'):
        sys.exit(__doc__)
    sounds = names or list(SOUNDS)
    parts = sorted({it for n in sounds for it in SOUNDS[n][1] if isinstance(it, str)})
    if cmd == 'gen':
        left = credits_left()
        print(f'кредитов осталось {left}, в запасе на переозвучку держим {RESERVE}')
        for part in parts:
            for n in range(1, TAKES + 1):
                if os.path.exists(take_path(part, n)) and not names:
                    continue
                if left < RESERVE + 400:
                    sys.exit(f'стоп: осталось {left} кредитов — запас на переозвучку {RESERVE}')
                generate(part, n)
            print(f'{part:16} готово', flush=True)
        print(f'потрачено {left - credits_left()} кредитов (счётчик обновляется с задержкой)')
    for part in parts:
        best = pick(part)
        print(f'{part:16} вариант {os.path.basename(best)}')
    for n in sounds:
        build(n)
        print(f'{n:16} {duration(out_path(n)):.2f} с')


if __name__ == '__main__':
    main()
