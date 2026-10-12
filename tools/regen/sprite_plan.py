"""sprite_plan.py: план спрайтов пересъёмки в $SP/sprite_plan.json (формат plan.json: id и file — из манифеста,
`zoya.neutral` → assets/ep01/sprites/zoya/neutral.webp; asset sprite, 9:16, прозрачный фон). База (neutral) — по файлу
лица персонажа; выражение — правка принятой базы (стайл-библия §4) и попадает в план, когда база уже в registry.json."""
import json, os, sys
sys.path.insert(0, 'tools')
import export_prompts as ep  # noqa: E402
import shot_plan as sp  # noqa: E402
SP = os.environ.get('REGEN_DIR', 'assets/ep01/_regen')
SPRITE_FRAME = "Portrait composition 9:16, one full-length figure, one frame, without borders."
EXPR = {
    "tense": "brows drawn together, the jaw set, the lips pressed",
    "tired": "heavy eyelids, a slight slump of the shoulders",
    "firm": "a direct steady gaze, the chin slightly up",
    "grin": "a crooked teasing grin, the eyes narrowed with amusement",
    "angry": "brows lowered, nostrils flared, the mouth tight",
    "hurt": "wincing in pain, the brows raised and drawn together, the mouth tight",
    "focused": "narrowed attentive eyes, the brows slightly drawn, the lips closed",
    "smile": "a polite, pleasant smile that does not reach the eyes",
    "cold": "a flat unblinking stare, no smile",
    "cornered": "the eyes darting to the side, a sheen of sweat on the forehead, the jaw tight",
    "nervous": "the eyes avoiding the viewer, a damp forehead, a strained half-smile",
    "warm": "a small uncertain smile, the eyes softening for a moment; nothing sweet about it",
    "worried": "brows raised and drawn together, the mouth tight",
    "scared": "the eyes wide, the brows raised, the mouth slightly open",
    "stern": "a heavy disapproving look, the corners of the mouth turned down",
    "sad": "the eyes lowered, the corners of the mouth down, quiet grief",
}
md = open('docs/production/prompts/ep01-images.md', encoding='utf-8').read()
rows = ep.parse_tables(md)["Персонажи (базовый кадр по §4 стайл-библии, затем выражения)"]
man = {it['id']: it for it in json.load(open('assets/ep01/manifest.json'))}
reg = json.load(open(f'{SP}/registry.json'))
base, _ = sp.load_prompt_parts()
head = (base.replace(sp.PERIOD_SOURCE, sp.PERIOD_EPISODE, 1).replace(sp.FRAME_SOURCE, SPRITE_FRAME, 1)
        .split("SCENE\n\nLocation and time:")[0].rstrip())
plan = []
for cid, cells in rows:
    name, look = ep.face_name_look(cid, sp.NAMES.get(cid, cid), cells[0])
    scene = ep.sprite_scene(name, look)
    if cid == 'sledak_old':  # тот же следователь в 2004-м: год в сцене спрайта — его, не 1993
        scene = scene.replace("Moscow, 1993;", "Moscow, 2004;", 1)
    for e in [x.strip() for x in cells[1].split('(')[0].split(',')]:
        sid = f'{cid}.{e}'
        s = {"id": sid, "asset": "sprite", "aspect": "9:16", "api_size": "1088x1920", "background": "transparent",
             "file": man[sid]['target']}
        if e == 'neutral':
            refs = (f"REFERENCE IMAGES\nReference 1 is {name}: keep this exact face, hair and build; take only the person "
                    "from this reference, not the room, light or objects around them.")
            s["medias"] = [man[f'face_{cid}']['job']]
            s["prompt"] = f"{head}\n\n{refs}\n\n{scene}"
        else:
            b = reg.get(f'{cid}.neutral')
            if not b or not b.get('q') == 'high':
                continue  # база ещё не принята по новым лицам
            refs = (f"REFERENCE IMAGES\nReference 1 is the full-length character sprite of {name}: keep exactly the same "
                    "person, face, hair, build, clothing, pose, framing, light and plain background; change only the "
                    "facial expression.")
            s["medias"] = [b['job'] if b.get('job') else f"file:{man[f'{cid}.neutral']['target']}"]
            s["prompt"] = f"{head}\n\n{refs}\n\n" + scene.replace("neutral expression, mouth closed", f"the facial expression: {EXPR[e]}")
        plan.append(s)
json.dump(plan, open(f'{SP}/sprite_plan.json', 'w'), ensure_ascii=False, indent=1)
print('sprite plan:', len(plan), [s['id'] for s in plan])
