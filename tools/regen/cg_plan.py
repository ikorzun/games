"""cg_plan.py: план CG-картинок эпизода для пересъёмки на high в $SP/cg_plan.json (формат plan.json: id, file, asset, prompt,
medias). Промпт = базовый промпт владельца (16:9) + REFERENCE IMAGES + блок SCENE (`export_prompts.cg_scene` по таблице
CG из ep01-images.md). Референс комнаты — принятый общий план сета нового редакции (непрерывность места), референсы
людей — файлы лиц; предметы мини-игр (cg_keys) идут по objects.md, здесь их нет."""
import json, os, sys
sys.path.insert(0, 'tools')
import export_prompts as ep  # noqa: E402
import shot_plan as sp  # noqa: E402
SP = os.environ.get('REGEN_DIR', 'assets/ep01/_regen')
md = open('docs/production/prompts/ep01-images.md', encoding='utf-8').read()
cells = {cid: c[0] for cid, c in ep.parse_tables(md)['CG']}
# cg_zoya_last в таблице не было (снят 2026-10-10 без записи промпта): s10 — «в последний раз видели во дворе,
# вышла сама, с сумкой, в выходном пальто».
cells.setdefault('cg_zoya_last', (
    "SUBJECT: courtyard of a nine-storey Soviet panel apartment block in Moscow, a July evening, poplar trees, a bench and a "
    "rusty climbing frame; a small elderly woman in an old dark-cherry wool coat and a grey knitted beret, a black handbag "
    "in her hands, walks away along the courtyard path toward the arch, seen from behind, alone. COMPOSITION: wide, the "
    "woman small in the lower third, the building facade and the empty path around her. LIGHT: soft evening light, a few "
    "lit windows. MOOD: the last time anyone saw her."))
# (room ref — принятый общий план, люди — лица; who: имя для текста референса)
REFS = {
    'cg_door_sealed': ('sh_stairwell_wide_1', []),
    'cg_zoya_last': ('sh_yard_wide_1', ['zoya']),
    'cg_arrest_night': ('sh_street_night_wide_1', []),
    'cg_verdict': (None, ['neighbor', 'murashov']),
}
# Уточнения мизансцены по итогам проверки: без них модель посадила Мурашова (серый костюм) на скамью перед камерой,
# а в клетку — другого человека.
EXTRA = {'cg_verdict': ("Staging: the man in the dove-grey suit from Reference 2 sits alone inside the metal cage, seen from "
                        "behind; the public benches between the woman and the cage are empty; nobody else in the room "
                        "wears a grey suit.")}
man = {it['id']: it for it in json.load(open('assets/ep01/manifest.json'))}
sp.LOOKS.update(sp.load_cast_looks())
base, _ = sp.load_prompt_parts()
head = base.replace(sp.PERIOD_SOURCE, sp.PERIOD_EPISODE, 1).replace(sp.FRAME_SOURCE, sp.FRAME_EPISODE, 1)
head = head.split("SCENE\n\nLocation and time:")[0].rstrip()
plan = []
for cid, (room, people) in REFS.items():
    refs, medias = [], []
    if room:
        refs.append(f"Reference {len(refs) + 1} is the same place seen in another shot of the story: keep its architecture, "
                    "furniture, colours and light; the camera of this picture stands where the scene text says.")
        medias.append(man[room]['job'])
    for who in people:
        look = f" ({sp.LOOKS[who]})" if sp.LOOKS.get(who) else ''
        hidden = {'murashov': '; only the back of his head and his shoulders are visible here',
                  'neighbor': '; only her hand and the sleeve of her cardigan are in focus here'}.get(who, '')
        refs.append(f"Reference {len(refs) + 1} is {sp.NAMES.get(who, who)}{look}: keep this exact person, hair and clothing"
                    f"{hidden}; take only the person, not the room or light around them.")
        medias.append(man[f'face_{who}']['job'])
    ref_block = ("REFERENCE IMAGES\n" + " ".join(refs) + "\n\n") if refs else ""
    scene = ep.cg_scene(cells[cid]) + ("\nAny writing on papers, stamps, plates or signs is out of focus or too small to "
                                        "read; no invented letters. Period accuracy, Moscow 1993–1994.")
    if cid in EXTRA:
        scene += "\n" + EXTRA[cid]
    plan.append({"id": cid, "asset": "cg", "file": man[cid]['target'], "medias": medias,
                 "prompt": f"{head}\n\n{ref_block}{scene}"})
json.dump(plan, open(f'{SP}/cg_plan.json', 'w'), ensure_ascii=False, indent=1)
print('cg plan:', [(s['id'], len(s['medias'])) for s in plan])
