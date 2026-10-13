"""build.py: «Ход следствия», дни 1–5 и развязка (docs/season1/ep01-hod.md, ep01-hod-finale.md) → episodes/s1/ep01_hod.json
и locales/*/ep01_hod.json.

Игрок — Громов: решает, куда ехать (в день два места из трёх-четырёх; всё не успеть), как говорить с людьми (они
помнят), что предъявить; ночью второго дня сам излагает версию картами из блокнота; верная версия открывает
реконструкцию в формате передачи. Кадры — черновые генерации tools/hod/shots.py (сеты hod_*), без старых спрайтов.
Дни 3–5 и развязка — играбельный срез: новых кадров ещё нет, сеты hod_t_* стоят на фонах прежнего эпизода и заглушках.

  python3 tools/hod/shots.py   # план кадров assets/ep01/_hod/plan.json (вне git; без генерации, только листы)
  python3 episodes/s1/_drafts/ep01_hod/build.py && python3 tools/validate_episode.py episodes/s1/ep01_hod.json
"""
import collections, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
EP_ID = 'ep01_hod'
OLD = json.load(open(os.path.join(ROOT, 'episodes/s1/ep01_murylev.json'), encoding='utf-8'))
OLD_RU = json.load(open(os.path.join(ROOT, 'locales/ru/ep01_murylev.json'), encoding='utf-8'))
PLAN = json.load(open(os.path.join(ROOT, 'assets/ep01/_hod/plan.json'), encoding='utf-8'))

RU: 'collections.OrderedDict[str, str]' = collections.OrderedDict()
SCENES: dict = {}
_cur = {'scene': None, 'n': 0}


def key(suffix: str, text: str) -> str:
    k = f'ep01.h.{_cur["scene"]}.{suffix}'
    assert k not in RU, k
    RU[k] = text
    return k


def _line(step: dict, text: str, **kw) -> dict:
    _cur['n'] += 1
    step['key'] = key(f'l{_cur["n"]:02d}', text)
    step.update({k: v for k, v in kw.items() if v is not None})
    return step


def say(who, text, when=None, shot=None, expression=None, beat=None):
    return _line({'do': 'say', 'who': who}, text, when=when, shot=f'sh_{shot}' if shot else None, expression=expression, beat=beat)


def inner(text, when=None, shot=None):
    return _line({'do': 'narrate', 'style': 'inner'}, text, when=when, shot=f'sh_{shot}' if shot else None)


def vo(text, when=None):
    return _line({'do': 'narrate', 'style': 'voiceover'}, text, when=when)


def cap(style, text, when=None):
    _cur['n'] += 1
    st = {'do': 'caption', 'style': style, 'key': key(f'cap{_cur["n"]:02d}', text)}
    if when:
        st['when'] = when
    return st


def show(who, position='center', when=None):
    st = {'do': 'show', 'who': who, 'position': position}
    if when:
        st['when'] = when
    return st


def hide(who):
    return {'do': 'hide', 'who': who}


def e(var, op, value=None):
    d = {'var': var, 'op': op}
    if value is not None:
        d['value'] = value
    return d


def setv(*effects, when=None):
    st = {'do': 'set', 'effects': list(effects)}
    if when:
        st['when'] = when
    return st


def unlock(item, when=None):
    st = {'do': 'archive_unlock', 'item': item}
    if when:
        st['when'] = when
    return st


def sfx(sid, when=None):
    st = {'do': 'sfx', 'id': sid}
    if when:
        st['when'] = when
    return st


def jump(scene, transition=None, when=None):
    st = {'do': 'jump', 'scene': scene}
    if transition:
        st['transition'] = transition
    if when:
        st['when'] = when
    return st


def fx(kind, ms=None):
    st = {'do': 'fx', 'fx': kind}
    if ms:
        st['ms'] = ms
    return st


def branch(cases, default):
    return {'do': 'branch', 'cases': [{'when': w, 'goto': g} for w, g in cases], 'default': default}


def opt(oid, text, goto, effects=(), when=None, hidden=True, item=None, verdict=None):
    return dict(oid=oid, text=text, goto=goto, effects=list(effects), when=when, hidden=hidden, item=item, verdict=verdict)


def choice(cid, prompt, kind, options, when=None, penalty=None, timer=None, default=None):
    st = {'do': 'choice', 'id': cid, 'kind': kind, 'prompt_key': key(f'{cid}.prompt', prompt), 'options': []}
    if when:
        st['when'] = when
    if penalty:
        st['penalty'] = penalty
    if timer:
        st['timer_ms'], st['default_option'] = timer, default
    for o in options:
        d = {'id': o['oid'], 'key': key(f'{cid}.{o["oid"]}', o['text']), 'goto': o['goto']}
        if o['when']:
            d['when'] = o['when']
            if o['hidden']:
                d['hidden_when_false'] = True
        if o['item']:
            d['item'] = o['item']
        if o['verdict']:
            d['verdict'] = o['verdict']
        if o['effects']:
            d['effects'] = o['effects']
        st['options'].append(d)
    return st


def doc(docid, text, archive=None):
    st = {'do': 'document', 'doc': docid, 'text_key': key(f'doc_{docid}', text)}
    if archive:
        st['adds_to_archive'] = archive
    return st


BG = {}  # сет → id фона


def scene(sid, block, set_, steps_fn, time='day', music=None, ambient=None, filter_=None, season=None):
    _cur['scene'], _cur['n'] = sid, 0
    steps = steps_fn()
    s = {'id': sid, 'block': block, 'stage': {'bg': BG[set_], 'time_of_day': time}, 'steps': steps}
    if set_ in SHOT_SETS:  # временные сеты на старых фонах кадров не имеют — сцена идёт фоном и окном реплики
        s['coverage'] = set_
    if filter_:
        s['stage']['filter'] = filter_
    if season:
        s['stage']['season'] = season
    if music:
        s['music'] = music
    if ambient:
        s['ambient'] = ambient
    SCENES[sid] = s


# ───────────────────────────── кадры и фоны ─────────────────────────────

WIDE_OF = {  # сет → общий план (он же фон сета)
    'hod_office_am': 'office_am_wide', 'hod_office_call_am': 'office_am_wide', 'hod_office_eve': 'office_eve_wide',
    'hod_office_lens': 'office_eve_wide', 'hod_office_call_eve': 'office_eve_wide', 'hod_office_d2': 'office_d2_wide',
    'hod_office_night': 'office_night_wide', 'hod_flat': 'flat_wide', 'hod_flat_photo': 'flat_wide',
    'hod_landing_chain': 'landing_chain_wide', 'hod_landing_open': 'landing_open_wide', 'hod_notary': 'notary_wide',
    'hod_notary_register': 'notary_wide', 'hod_notary_stairs': 'stairs_wide', 'hod_zhek': 'zhek_wide',
    'hod_bti': 'bti_wide', 'hod_car': 'car_wide', 'hod_recon': 'recon_wide', 'hod_notary_alone': 'notary_alone_wide',
}
# Сеты из одного кадра (телефон, лупа, фото, реестр): их кадр — «общий план» сета, монтажёр берёт его на любую реплику,
# а в чужих сценах он не появится. Так вставка не всплывёт раньше времени (до того, как игрок открыл сервант).
AUX_SETS = {'hod_office_call_am', 'hod_office_call_eve', 'hod_office_lens', 'hod_flat_photo', 'hod_notary_register'}
OTS = {  # кадр через плечо: чьё плечо → на кого
    'office_am_ots_oper': ('sledak', 'oper'), 'office_eve_ots_expert': ('sledak', 'expert'),
    'office_d2_ots_boss': ('sledak', 'boss'), 'office_night_ots_expert': ('sledak', 'expert'),
    'flat_ots_buyer': ('sledak', 'buyer'), 'flat_ots_wife': ('sledak', 'lapin_wife'),
    'landing_chain_ots': ('sledak', 'neighbor'), 'landing_open_ots': ('sledak', 'neighbor'),
    'notary_ots_notary': ('sledak', 'notary'), 'stairs_ots_assistant': ('oper', 'assistant'),
    'zhek_ots_clerk': ('sledak', 'passport_clerk'), 'bti_ots_clerk': ('sledak', 'clerk'), 'car_ots_oper': ('sledak', 'oper'),
    'recon_ots_zoya': ('murashov_sil', 'zoya'),
}
FILE = lambda sid, set_: f'assets/ep01/hod/{set_}/{sid}.webp'  # noqa: E731
MEM = lambda sid, set_, tail='': f'assets/ep01/hod_memory/{set_}/{sid}{tail}.webp'  # noqa: E731
HAS = lambda path: os.path.exists(os.path.join(ROOT, path))  # noqa: E731


def memory_of(sid: str, set_: str, cast: list[str]) -> dict | None:
    """Графика «Воспоминания» (tools/hod/memory.py): кадр 16:9, квадрат для телефона и маски людей — что уже есть."""
    if not HAS(MEM(sid, set_)):
        return None
    m = {'file': MEM(sid, set_)}
    if HAS(MEM(sid, set_, '.square')):
        m['square'] = MEM(sid, set_, '.square')
    for key, tail in (('masks', ''), ('square_masks', '.square')):
        found = {w: MEM(sid, set_, f'{tail}.{w}') for w in cast if HAS(MEM(sid, set_, f'{tail}.{w}'))}
        if found:
            m[key] = found
    return m


SHOTS, BACKGROUNDS = [], []
for p in PLAN:
    if p['kind'] in ('doc', 'search'):  # бланк и фон мини-игры осмотра — не кадры покрытия
        continue
    kind = 'wide' if p['set'] in AUX_SETS else p['kind']
    sh = {'id': f'sh_{p["id"]}', 'set': p['set'], 'bg': f'bg_{p["set"]}', 'kind': kind, 'angle': 'eye',
          'cast': [] if p['kind'] == 'insert' else [{'who': w} for w in p['cast']], 'file': FILE(p['id'], p['set'])}
    if p['id'] in OTS:
        sh['from'], sh['focus'] = OTS[p['id']]
    for c in sh['cast']:  # маска человека для подсветки того, на ком внимание (tools/hod/masks.py)
        mask = f'assets/ep01/hod/{p["set"]}/{p["id"]}.{c["who"]}.webp'
        if os.path.exists(os.path.join(ROOT, mask)):
            c['mask'] = mask
    mem = memory_of(p['id'], p['set'], [c['who'] for c in sh['cast']])
    if mem:
        sh['memory'] = mem
    SHOTS.append(sh)
# Контора без помощницы: тот же кадр через плечо на Ковригина (на нём Люды не видно).
SHOTS.append({'id': 'sh_notary_alone_ots', 'set': 'hod_notary_alone', 'bg': 'bg_hod_notary_alone', 'kind': 'ots', 'angle': 'eye',
              'cast': [{'who': 'notary'}, {'who': 'sledak'}], 'from': 'sledak', 'focus': 'notary',
              'file': FILE('notary_ots_notary', 'hod_notary'),
              **({'memory': memory_of('notary_ots_notary', 'hod_notary', ['notary', 'sledak'])}
                 if memory_of('notary_ots_notary', 'hod_notary', ['notary', 'sledak']) else {})})
# Фон мини-игры «Осмотр квартиры»: стена Зои Павловны крупно, три улики врозь, людей нет.
BACKGROUNDS.append({'id': 'bg_hod_flat_inspect', 'path': FILE('flat_inspect', 'hod_flat_inspect'), 'season': 'indoor',
                    **({'memory': MEM('flat_inspect', 'hod_flat_inspect')} if HAS(MEM('flat_inspect', 'hod_flat_inspect')) else {}),
                    'notes': 'черновой кадр осмотра (лето 1993-го): фото внука, очки на футляре, таблетки на подоконнике'})
for set_, wide in WIDE_OF.items():
    BG[set_] = f'bg_{set_}'
    wide_set = next(p['set'] for p in PLAN if p['id'] == wide)
    BACKGROUNDS.append({'id': f'bg_{set_}', 'path': FILE(wide, wide_set), 'season': 'summer' if 'car' in set_ else 'indoor',
                        **({'memory': MEM(wide, wide_set)} if HAS(MEM(wide, wide_set)) else {}),
                        'notes': f'черновой общий план {wide} (лето 1993-го)'})
SHOT_SETS = {sh['set'] for sh in SHOTS}
# Дни 3–5 и развязка — играбельный срез до генерации кадров: интерьеры на фонах прежнего эпизода (без людей), улицы —
# чёрная заглушка (прежние уличные фоны осенние, а здесь август). Сеты без кадров: людей на сцене не показываем.
TEMP_SETS = {
    'hod_t_stairs': ('assets/ep01/bg/stairwell.webp', 'indoor', 'временно: подъезд прежнего эпизода (Хорошёвка, Чертаново)'),
    'hod_t_street': ('assets/common/bg/black.png', 'any', 'заглушка: улица у агентства, дорога без Сайко, лесополоса'),
    'hod_t_search': ('assets/ep01/bg/murashov_flat.webp', 'indoor', 'временно: квартира Мурашова прежнего эпизода (обыск)'),
    'hod_t_interrog': ('assets/common/bg/interrogation.webp', 'indoor', 'временно: допросная, общая для сезона'),
    'hod_t_court': ('assets/common/bg/courtroom.webp', 'indoor', 'временно: зал суда, общий для сезона'),
    'hod_t_moscow': ('assets/ep01/bg/moscow_1994.webp', 'winter', 'временно: Москва зимой 1994-го (эпилог)'),
    'hod_t_2004': ('assets/common/bg/office_now.webp', 'indoor', 'временно: кабинет «спустя годы» (запись 2004 года)'),
}
for set_, (path, season_, note) in TEMP_SETS.items():
    BG[set_] = f'bg_{set_}'
    BACKGROUNDS.append({'id': f'bg_{set_}', 'path': path, 'season': season_, 'notes': note})

# ───────────────────────────── блоки ─────────────────────────────
# b1 утро первого дня · bp места (общие для обоих дней) · b2 вечер · b3 утро второго дня (реклама на границе дней)
# · b4 ночь и версия · br реконструкция

DAY2_GO = [  # выбор второго дня: оставшееся место первого дня + ЖЭК + БТИ (не больше трёх вариантов на шаге)
    ('day == 2 && !visited_flat', 'flat', 'На Молодогвардейскую, к Лапиным'),
    ('day == 2 && visited_flat && !visited_galina', 'galina', 'К Галине, соседке'),
    ('day == 2 && visited_flat && visited_galina && !visited_notary', 'notary', 'На Пресню, к нотариусу'),
]


def day2_choices(cid, prompt):
    out = []
    for n, (cond, place, text) in enumerate(DAY2_GO, 1):
        out.append(choice(f'{cid}{n}', prompt, 'investigative', [
            opt(place, text, f'go_{place}', when=f'!visited_{place}'),
            opt('zhek', 'В ЖЭК, в паспортный стол', 'go_zhek', when='!visited_zhek'),
            opt('bti', 'В архив БТИ', 'go_bti', when='!visited_bti'),
        ], when=cond))
    out.append(choice(f'{cid}4', prompt, 'investigative', [
        opt('zhek', 'В ЖЭК, в паспортный стол', 'go_zhek', when='!visited_zhek'),
        opt('bti', 'В архив БТИ', 'go_bti', when='!visited_bti'),
    ], when='day == 2 && visited_flat && visited_galina && visited_notary'))
    return out


# ── День 1, утро ──
scene('d1_office', 'b1_day1', 'hod_office_am', lambda: [
    cap('date_stamp', 'Понедельник, 9 августа 1993 года'),
    cap('location', 'Прокуратура Кунцевского района'),
    show('sledak', 'left'), show('oper', 'right'),
    inner('Четыре заявления. Четыре квартиры, в которых живут чужие люди. И ни одного трупа.'),
    doc('doc_statement', 'Прокурору Кунцевского района г. Москвы от Сомовой Галины Васильевны, ул. Молодогвардейская, кв. 33.\n\n'
        'ЗАЯВЛЕНИЕ\n\nПрошу разыскать мою соседку Зою Павловну из кв. 34. С конца июня её никто не видел. В её квартире живут '
        'чужие люди, говорят, что купили. Зоя Павловна никуда уезжать не собиралась — мне бы сказала.\n\n2 августа 1993 г. Сомова',
        archive='n_statement'),
    say('oper', 'Громов? Виктор Сайко, МУР. Это я тебе их принёс. Молодогвардейская — первая. Остальные три — Фили, Пресня и опять Кунцево.'),
    say('sledak', 'Везде одно и то же?'),
    say('oper', 'Старик живёт один. Старик пропадает. Через месяц в квартире новые люди, а бумаги — хоть в рамку вешай.'),
    say('oper', 'По Молодогвардейской я пробил: сделку заверял нотариус на Пресне, Ковригин. Остальное — твоя работа.'),
    jump('d1_call'),
], time='day', music='m_investigation', ambient='amb_office')

scene('d1_call', 'b1_day1', 'hod_office_call_am', lambda: [
    show('sledak', 'left'), show('oper', 'right'),
    sfx('sfx_phone_ring'),
    inner('Палыч, начальник отдела. Звонит, когда недоволен, — то есть всегда.'),
    say('boss', 'Громов, по пенсионерам. Это материал проверки, а не дело. До пятницы: будет бумага с изъяном — возбуждай. Не будет — отказной. И не раздувай.'),
    say('sledak', 'Понял, Валентин Павлович.'),
    inner('До пятницы — пять дней. На то, чтобы найти людей, которых никто не ищет.'),
    jump('d1_go'),
])

scene('d1_go', 'b1_day1', 'hod_office_am', lambda: [
    show('sledak', 'left'), show('oper', 'right'),
    say('oper', 'Ну что, юрист, куда едем? Машина внизу, бензина полбака.'),
    choice('c_d1_go', 'Куда едем?', 'investigative', [
        opt('flat', 'На Молодогвардейскую. Посмотрим квартиру', 'go_flat'),
        opt('galina', 'К соседке, которая писала заявление', 'go_galina'),
        opt('notary', 'На Пресню, к нотариусу Ковригину', 'go_notary'),
    ]),
])

# ── Дорога: после каждого места ──
scene('route', 'bp_places', 'hod_car', lambda: [
    setv(e('slot', 'add', 1)),
    branch([('slot >= 2 && day == 1', 'd1_evening'), ('slot >= 2 && day == 2', 'd2_night'),
            ('slot >= 2 && day == 3', 'd3_evening'), ('day == 3', 'd3_route')], 'route_car'),
], ambient='amb_street_day')

scene('route_car', 'bp_places', 'hod_car', lambda: [
    show('oper', 'left'), show('sledak', 'right'),
    say('oper', '«Гражданка»… Я бы тоже дверь не открыл. Бабушки любят, когда их по отчеству.', when="last_place == 'galina' && galina_closed"),
    say('oper', 'Серая «Волга» под окнами. Таких в Москве тысяч двадцать. Но уже не миллион.', when="last_place == 'galina' && galina_open"),
    say('oper', 'Ты им сказал, что квартиру могут отобрать. Честно. Теперь они или помогут, или побегут к адвокату.', when="last_place == 'flat' && lapins_told_truth"),
    say('oper', 'Ребёнок у них. Жалко. Но бумаги ты взял — это главное.', when="last_place == 'flat' && !lapins_told_truth"),
    say('oper', 'Пришли с пустыми руками — ушли с пустыми руками. Он теперь будет звонить.', when="last_place == 'notary' && !have_contract && notary_alarmed"),
    say('oper', 'Девочка за машинкой с тебя глаз не сводила. Ей есть что сказать — только не при шефе.', when="last_place == 'notary' && !have_contract && !notary_alarmed"),
    say('oper', 'Девочка напугана до смерти. Сергей Викторович у них, считай, свой человек.', when="last_place == 'notary' && lyuda_talked"),
    say('oper', 'Ковригин потел, как в бане. И не от жары.', when="last_place == 'notary' && have_contract && !lyuda_talked"),
    say('oper', 'Шоколадку он ей принёс… Вежливый, сволочь.', when="last_place == 'zhek'"),
    say('sledak', 'Шесть квартир за лето. Один нотариус, одно доверенное лицо.', when="last_place == 'bti' && bti_six"),
    say('sledak', 'Три сделки нашёл, остальное не дали досмотреть. Один нотариус, одно доверенное лицо.', when="last_place == 'bti' && bti_chain && !bti_six"),
    say('oper', 'Это уже не совпадение. Это конвейер.', when="last_place == 'bti' && bti_chain"),
    say('sledak', 'Фамилия есть. Мурашов С. В., по доверенности.', when="last_place == 'bti' && !bti_chain"),
    say('oper', 'Мурашов… Пробьём.', when="last_place == 'bti' && !bti_chain"),
    say('oper', 'Дальше куда?'),
    choice('c_route_d1', 'Дальше куда?', 'investigative', [
        opt('flat', 'На Молодогвардейскую, к Лапиным', 'go_flat', when='!visited_flat'),
        opt('galina', 'К Галине, соседке', 'go_galina', when='!visited_galina'),
        opt('notary', 'На Пресню, к нотариусу', 'go_notary', when='!visited_notary'),
    ], when='day == 1'),
    *day2_choices('c_route_d2_', 'Дальше куда?'),
])

# ── Дорога: машина Сайко, Громов вспоминает, зачем едем; место — растворением (переход между сетами) ──


def go(place, lines, then=None):
    scene(f'go_{place}', 'bp_places', 'hod_car', lambda: [
        show('oper', 'left'), show('sledak', 'right'),
        *[inner(t, when=w) for t, w in lines],
        then if then else jump(place),
    ], ambient='amb_street_day')


go('flat', [
    ('Квартира тридцать четыре. Там теперь живут Лапины. Посмотрю, по каким бумагам они купили, — и что осталось от хозяйки.', None),
    ('Галина говорила: Зоя Павловна никуда не собиралась. Проверим.', 'galina_open'),
])
go('galina', [
    ('Галина Васильевна писала заявление. Она последней видела Зою Павловну — надо узнать, кто к ней ходил.', None),
    ('И видела ли она того, кто продал квартиру, — Мурашова.', 'know_name'),
])
go('notary', [
    ('Ковригин заверял доверенность от четырнадцатого июня. С бумагами на руках спрошу, кто привёл к нему Зою Павловну.', 'have_contract'),
    ('Ковригин заверял сделку. Без бумаг он будет тянуть время — но посмотреть на него стоит.', '!have_contract'),
    ('И спрошу, как она прочла доверенность без очков.', 'glasses_found'),
], then=branch([('lyuda_gone', 'notary_alone')], 'notary'))  # помощницу могли отправить в отпуск вечером первого дня
go('zhek', [
    ('Паспортный стол ЖЭКа: Зою Павловну выписали из квартиры. Кто подал заявление — и видели ли его там раньше?', None),
])
go('bti', [
    ('Архив БТИ: там видна каждая сделка с квартирой. Если Мурашов работает не первый раз — это будет в картотеке.', None),
])

# ── Квартира Зои Павловны у Лапиных ──
scene('flat', 'bp_places', 'hod_flat', lambda: [
    setv(e('visited_flat', 'set', True), e('last_place', 'set', 'flat')),
    cap('location', 'Молодогвардейская улица, квартира 34'),
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    inner('Обои содраны до газет. Сервант с посудой стоит, как стоял, — посреди чужого ремонта.'),
    say('buyer', 'Мы ничего не нарушали. Купили по договору, у нотариуса. Деньги отдали все, до копейки.'),
    say('lapin_wife', 'Нам сказали, бабушка уехала к родственникам на юг. Сервант оставила — сказали, не нужен.'),
    unlock('n_south'),
    choice('c_flat', 'Что сказать Лапиным?', 'dialogue', [
        opt('formal', 'Покажите договор. Если всё по закону — вам бояться нечего', 'flat_formal'),
        opt('truth', 'Сделку могут признать недействительной. Помогите нам', 'flat_truth',
            effects=[e('lapins_told_truth', 'set', True)]),
    ]),
])
CONTRACT = ('ДОГОВОР КУПЛИ-ПРОДАЖИ КВАРТИРЫ. Москва, 28 июня 1993 г. Продавец С. Зоя Павловна, от имени которой по доверенности '
            'от 14 июня 1993 г. действует Мурашов Сергей Викторович, продаёт, а покупатель Лапин покупает однокомнатную квартиру '
            'на Молодогвардейской ул. Расчёт произведён полностью. Удостоверено нотариусом Ковригиным А. Н. '
            'Продавец (по доверенности): (подпись). Покупатель: (подпись).')
scene('flat_formal', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    say('buyer', 'Пожалуйста. Копия договора и копия доверенности. Нотариус сказал — всё чисто.'),
    doc('doc_contract_sale', CONTRACT, archive='n_contract'),
    unlock('n_poa'),
    setv(e('have_contract', 'set', True), e('know_name', 'set', True)),
    unlock('n_name'),
    say('lapin_wife', 'Если всё чисто, зачем вы пришли?'),
    jump('flat_look'),
])
scene('flat_truth', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    say('lapin_wife', 'Как — недействительной? Мы десять лет копили. У нас ребёнок.'),
    say('buyer', 'Вот. Договор, доверенность. Посредник торопил: деньги наличными, прямо у нотариуса, в коридоре. Сказал — так быстрее.'),
    doc('doc_contract_sale', CONTRACT, archive='n_contract'),
    unlock('n_poa'),
    setv(e('have_contract', 'set', True), e('know_name', 'set', True)),
    unlock('n_name'), unlock('n_cash'),
    setv(e('murashov_spooked', 'set', True), when='day == 3'),  # в среду Лапины снова звонят нотариусу — Мурашов предупреждён
    jump('flat_look'),
])
scene('flat_look', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    say('oper', 'Юрист. Глянь в сервант. За стеклом.'),
    choice('c_flat_photo', 'Сервант', 'investigative', [
        opt('open', 'Осмотреть комнату самому', 'flat_inspect'),
        opt('later', 'Не трогать без понятых. Вернёмся с Левиной', 'flat_later', effects=[e('photo_later', 'set', True)]),
    ]),
])
# Осмотр (мини-игра mg_flat_inspect): что нашёл — то и узнал (находки открывают свои факты в блокноте).
scene('flat_inspect', 'bp_places', 'hod_flat_photo', lambda: [
    show('sledak', 'center'),
    inner('Хозяйка «уехала на юг». Посмотрим, что она взяла с собой — и что оставила.'),
    {'do': 'minigame', 'minigame': 'mg_flat_inspect'},
])
scene('flat_inspect_fail', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    say('lapin_wife', 'Вы долго ещё? У нас ребёнок спит.'),
    jump('flat_inspect_done'),
])
scene('flat_inspect_done', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    say('sledak', 'Родственники на юге, говорите? У неё один внук. В Самаре.', when='photo_seen'),
    say('lapin_wife', 'Нам так сказали… Мы же не знали.', when='photo_seen'),
    inner('Очки на футляре. Без очков она и газету не читала. А доверенность, выходит, подписала не глядя.', when='glasses_found'),
    inner('Нитроглицерин на подоконнике. Сердечники без него из дома не выходят.', when='pills_found'),
    inner('Копаться дальше при хозяевах не дадут. Завтра Левина посмотрит по протоколу, с понятыми.', when='!photo_seen'),
    setv(e('photo_later', 'set', True), when='!photo_seen'),
    jump('route'),
])
scene('flat_later', 'bp_places', 'hod_flat', lambda: [
    show('buyer', 'left'), show('oper', 'left'), show('sledak', 'center'), show('lapin_wife', 'right'),
    inner('Без понятых это не улика, а сувенир. Завтра Левина изымет её по протоколу.'),
    jump('route'),
])

# ── Галина, соседка ──
scene('galina', 'bp_places', 'hod_landing_chain', lambda: [
    setv(e('visited_galina', 'set', True), e('last_place', 'set', 'galina')),
    cap('location', 'Молодогвардейская, третий этаж'),
    show('neighbor', 'left'), show('sledak', 'center'), show('oper', 'right'),
    inner('Квартиры 33 и 34 — дверь в дверь. У Зои Павловны дверь теперь новая, железная. Дверь Галины открывается на цепочку.'),
    say('neighbor', 'Опять милиция? Я всё написала. Всё, что знала.'),
    choice('c_galina', 'Как говорить с Галиной?', 'dialogue', [
        opt('formal', 'Гражданка Сомова, ваши показания нужно оформить протоколом', 'galina_closed',
            effects=[e('galina_closed', 'set', True), e('trust_oper', 'sub', 1)]),
        opt('human', 'Галина Васильевна, давайте без протокола. Кто к ней ходил?', 'galina_open',
            effects=[e('galina_open', 'set', True), e('trust_oper', 'add', 1)]),
    ]),
], ambient='amb_stairwell')
scene('galina_closed', 'bp_places', 'hod_landing_chain', lambda: [
    show('neighbor', 'left'), show('sledak', 'center'), show('oper', 'right'),
    say('neighbor', 'Протоколом… Ничего я не видела. В конце июня ушла она с сумкой — и всё. Пишите что хотите.'),
    unlock('n_left'),
    inner('Цепочка так и не снялась.'),
    jump('route'),
])
scene('galina_open', 'bp_places', 'hod_landing_open', lambda: [
    show('neighbor', 'left'), show('sledak', 'center'), show('oper', 'right'),
    inner('Цепочка падает. Галина встаёт на пороге в тапках и говорит шёпотом, будто за железной дверью кто-то слушает.'),
    say('neighbor', 'Ходил к ней один… Сергей. Недели три ходил, с бумагами помогал. Вежливый. Говорил — из газеты.'),
    say('sledak', 'Фамилию он называл?'),
    say('neighbor', 'Нет. Она его по имени-отчеству — Сергей Викторович. На «Волге» приезжал, на серой. Ставил под моими окнами, не у подъезда.'),
    unlock('n_sergei'),
    say('neighbor', 'В последний раз она вышла в конце июня. С сумкой, в выходном плаще. Сказала: Сергей Викторович заедет, по бумагам. Больше я её не видела.'),
    unlock('n_last_seen'),
    say('neighbor', 'А если он узнает, что это я?'),
    choice('c_galina_fear', 'Галина боится', 'moral', [
        opt('promise', 'Ваше имя нигде не прозвучит', 'galina_end', effects=[e('galina_trust', 'set', True)]),
        opt('duty', 'Понадобится — вызовем в суд. Это ваш долг', 'galina_end'),
    ]),
])
scene('galina_end', 'bp_places', 'hod_landing_open', lambda: [
    show('neighbor', 'left'), show('sledak', 'center'), show('oper', 'right'),
    say('neighbor', 'Ну, смотрите. Я вам поверила.', when='galina_trust'),
    say('neighbor', 'Долг… Я своё отдолжала. Дочка у меня в Туле — к ней поеду, пока вы его ловите.', when='!galina_trust'),
    setv(e('galina_leaving', 'set', True), when='!galina_trust'),
    jump('route'),
])

# ── Нотариус Ковригин: с помощницей (notary) и без неё (notary_alone — её отправили в отпуск после визита к Лапиным) ──


def notary_chain(pre: str, set_: str, lyuda: bool) -> None:
    def cast():
        return ([show('assistant', 'left')] if lyuda else []) + [show('notary', 'center'), show('sledak', 'center'), show('oper', 'right')]
    after_talk = f'{pre}_lyuda_q' if lyuda else 'route'
    scene(pre, 'bp_places', set_, lambda: [
        setv(e('visited_notary', 'set', True), e('last_place', 'set', 'notary')),
        cap('location', 'Нотариальная контора. Пресня'),
        *cast(),
        inner('Очередь до дверей. Ковригин принимает нас сразу — и это ему явно не нравится.'),
        *([] if lyuda else [inner('Машинка у окна под чехлом. Помощница, говорят, со вчерашнего дня в отпуске.')]),
        say('notary', 'Прокуратура? Прошу. Только недолго: у меня люди с утра сидят, а помощница одна.' if lyuda else
            'Прокуратура? Прошу. Только недолго: помощница в отпуске, я тут один на всю очередь.'),
        # без помощницы контора бывает только после Лапиных, а у них договор дают всегда
        branch([('have_contract', f'{pre}_papers')], f'{pre}_bare') if lyuda else jump(f'{pre}_papers'),
    ], ambient='amb_office')
    if not lyuda:
        return papers(pre, set_, cast, after_talk)
    scene(f'{pre}_bare', 'bp_places', set_, lambda: [
        *cast(),
        say('sledak', 'Нас интересует сделка по Молодогвардейской. Июнь.'),
        say('notary', 'Голубчик, у меня таких сделок сотни. Номер в реестре, дата — или официальный запрос. Через горпрокуратуру.'),
        choice(f'c_{pre}_bare', 'Ковригин тянет время', 'dialogue', [
            opt('insist', 'Вы обязаны показать реестр следователю', f'{pre}_insist', effects=[e('notary_alarmed', 'set', True)]),
            opt('retreat', 'Хорошо. Придём с запросом', f'{pre}_retreat'),
        ]),
    ])
    scene(f'{pre}_insist', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Обязан. По запросу. Всего доброго, товарищ следователь.'),
        say('oper', 'Ну, поговорили.'),
        jump('route'),
    ])
    scene(f'{pre}_retreat', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Вот это правильно. Порядок есть порядок.'),
        *([inner('Девушка за машинкой за весь разговор не напечатала ни буквы.')] if lyuda else []),
        jump('route'),
    ])
    papers(pre, set_, cast, after_talk)


def papers(pre, set_, cast, after_talk):
    lyuda = pre == 'notary'
    scene(f'{pre}_papers', 'bp_places', set_, lambda: [
        *cast(),
        say('sledak', 'Доверенность от четырнадцатого июня. Зоя Павловна. Доверенное лицо — Мурашов.'),
        say('notary', 'Да-да, припоминаю. Пожилая женщина, всё прочитано вслух, всё подписано. В пределах моей компетенции — всё по закону.'),
        choice(f'c_{pre}_ask', 'С чего начать?', 'investigative', [
            opt('register', 'Покажите запись в реестре за четырнадцатое июня', f'{pre}_reg',
                effects=[e('notary_alarmed', 'set', True)]),
            opt('who', 'Кто её к вам привёл?', f'{pre}_who'),
            opt('glasses', 'Как она прочла доверенность без очков?', f'{pre}_glasses', when='glasses_found',
                effects=[e('notary_alarmed', 'set', True)]),
        ]),
    ])
    scene(f'{pre}_glasses', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Очки?.. Да, она была без очков. Текст зачитал доверенный, при мне. По закону так можно.'),
        inner('Значит, доверенность ей читал сам Мурашов. Что он там прочитал — знает только он.'),
        unlock('n_read'), setv(e('murashov_read', 'set', True)),
        jump(after_talk),
    ])
    scene(f'{pre}_reg', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Пожалуйста. Подпись доверителя, тариф уплачен.'),
        jump(f'{pre}_reg_ins'),
    ])
    scene(f'{pre}_reg_ins', 'bp_places', 'hod_notary_register', lambda: [
        show('notary', 'center'), show('sledak', 'center'),
        inner('Запись есть. Только чернила синее, чем в соседних строках, — будто её вписали позже.'),
        unlock('n_register'),
        jump(f'{pre}_reg2'),
    ])
    scene(f'{pre}_reg2', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Техническая ошибка помощницы. Бывает.'),
        *([inner('За машинкой что-то упало. Помощница нагнулась за ручкой и не спешит подниматься.')] if lyuda else
          [inner('Помощницы нет, и спросить, чья это ошибка, некого.')]),
        jump(after_talk),
    ])
    scene(f'{pre}_who', 'bp_places', set_, lambda: [
        *cast(),
        say('notary', 'Доверенное лицо. Мурашов Сергей Викторович. Приличный человек, вежливый, всё объяснял бабушке сам.'),
        *([inner('За машинкой что-то упало. Помощница нагнулась за ручкой и не спешит подниматься.')] if lyuda else []),
        jump(after_talk),
    ])


notary_chain('notary', 'hod_notary', True)
notary_chain('notary_alone', 'hod_notary_alone', False)
scene('notary_lyuda_q', 'bp_places', 'hod_notary', lambda: [
    show('assistant', 'left'), show('notary', 'center'), show('sledak', 'center'), show('oper', 'right'),
    say('oper', 'Юрист, девочка сейчас заплачет. Выйду покурить — как раз на её лестницу.'),
    choice('c_lyuda', 'Сайко предлагает поговорить с помощницей', 'tactical', [
        opt('go', 'Иди. Только аккуратно', 'lyuda'),
        opt('no', 'Не надо. Спугнём нотариуса', 'route'),
    ]),
])
scene('lyuda', 'bp_places', 'hod_notary_stairs', lambda: [
    cap('location', 'Лестница конторы. Десять минут спустя'),
    show('sledak', 'left'), show('assistant', 'center'), show('oper', 'right'),
    say('assistant', 'Я ничего не знаю. Я тут полгода всего.'),
    say('oper', 'Да мы ж не про тебя. Про Сергея Викторовича. Часто бывает?'),
    say('assistant', 'Раз в месяц. Всегда со старушкой, всегда без очереди. За срочность платит наличными — Анатолию Николаевичу прямо в стол.'),
    unlock('n_lyuda'),
    say('assistant', 'Только вы ему не говорите. Он и так кричит, что я лишнее вижу.'),
    setv(e('lyuda_talked', 'set', True), e('trust_oper', 'add', 1)),
    jump('route'),
], ambient='amb_stairwell')

# ── ЖЭК, паспортный стол (второй день) ──
scene('zhek', 'bp_places', 'hod_zhek', lambda: [
    setv(e('visited_zhek', 'set', True), e('last_place', 'set', 'zhek')),
    cap('location', 'ЖЭК № 7. Паспортный стол'),
    show('oper', 'left'), show('sledak', 'center'), show('passport_clerk', 'right'),
    inner('Очередь, окошко, запах мокрой тряпки. Здесь начинается любая приватизация: справки, выписки, печати.'),
    say('passport_clerk', 'Тридцать четвёртая? Выписана двадцать пятого июня. По заявлению.'),
    say('sledak', 'Сама приходила?'),
    say('passport_clerk', 'Не сама. Доверенное лицо, с доверенностью. Вежливый такой мужчина, шоколадку мне принёс. Сказал — уезжает бабушка к родне.'),
    unlock('n_vypiska'),
    say('passport_clerk', 'Ещё что? Только быстро — у меня граждане ждут.'),
    choice('c_zhek', 'Один вопрос, и быстро', 'investigative', [
        opt('name', 'Как его фамилия? В заявлении должна быть', 'zhek_name', effects=[e('know_name', 'set', True)]),
        opt('seen', 'Вы его раньше видели?', 'zhek_seen'),
    ]),
])
scene('zhek_name', 'bp_places', 'hod_zhek', lambda: [
    show('oper', 'left'), show('sledak', 'center'), show('passport_clerk', 'right'),
    say('passport_clerk', 'В заявлении… Мурашов. Сергей Викторович. Доверенность нотариальная, всё как положено.'),
    unlock('n_name'),
    jump('route'),
])
scene('zhek_seen', 'bp_places', 'hod_zhek', lambda: [
    show('oper', 'left'), show('sledak', 'center'), show('passport_clerk', 'right'),
    say('passport_clerk', 'Так он у нас всё лето в очереди крутился. Со старушками разговаривал, справки им заполнял. Я думала — внук чей-то.'),
    unlock('n_queue'),
    jump('route'),
])

# ── Архив БТИ (второй день, вторник) ──
scene('bti', 'bp_places', 'hod_bti', lambda: [
    setv(e('visited_bti', 'set', True), e('last_place', 'set', 'bti')),
    cap('location', 'Архив БТИ. Приём по вторникам и четвергам'),
    show('clerk', 'left'), show('sledak', 'right'),
    inner('Сайко остался в машине: бумаги — это моё. Раиса Львовна смотрит на моё удостоверение дольше, чем на меня.'),
    say('clerk', 'Среда у нас неприёмная, милый. Ну, раз уж приехал…', when='day == 3'),
    say('clerk', 'Прокуратура… Запрос есть? Без запроса — только по адресу.'),
    say('sledak', 'По адресу. Молодогвардейская, квартира тридцать четыре.'),
    say('clerk', 'Переход права — договор от двадцать восьмого июня. Нотариус Ковригин. Представитель продавца по доверенности — Мурашов С. В.'),
    unlock('n_card'), unlock('n_name'), setv(e('know_name', 'set', True)),
    say('sledak', 'А другие сделки — с тем же нотариусом и тем же представителем?'),
    say('clerk', 'Это уже без запроса не могу, милый.'),
    choice('c_bti', 'Раиса Львовна ждёт', 'dialogue', [
        opt('plead', 'Раиса Львовна, старики пропадают. Четверо уже', 'bti_chain'),
        opt('formal', 'Запрос будет завтра', 'bti_formal'),
    ]),
], ambient='amb_archive')
scene('bti_chain', 'bp_places', 'hod_bti', lambda: [
    show('clerk', 'left'), show('sledak', 'right'),
    say('clerk', '…Летом, говоришь? Ковригин и этот Мурашов? Ищи сам, милый. До обеда — час.'),
    {'do': 'minigame', 'minigame': 'mg_db'},
])
scene('bti_chain_ok', 'bp_places', 'hod_bti', lambda: [
    show('clerk', 'left'), show('sledak', 'right'),
    inner('Шесть карточек. Шесть квартир за лето. Нотариус везде Ковригин, доверенное лицо везде Мурашов.'),
    say('clerk', 'Шесть… Господи. Это ж всё одинокие.'),
    jump('route'),
])
scene('bti_chain_part', 'bp_places', 'hod_bti', lambda: [
    show('clerk', 'left'), show('sledak', 'right'),
    inner('Три карточки — а дальше Раиса Львовна закрыла ящик: обед. Нотариус Ковригин, доверенное лицо Мурашов. И это не всё.'),
    jump('route'),
])
scene('bti_chain_fail', 'bp_places', 'hod_bti', lambda: [
    show('clerk', 'left'), show('sledak', 'right'),
    say('clerk', 'Всё, милый, обед. Приходи в четверг — с запросом.'),
    inner('Целый час в картотеке — и ни одной карточки, кроме нашей.'),
    jump('route'),
])
scene('bti_formal', 'bp_places', 'hod_bti', lambda: [
    show('clerk', 'left'), show('sledak', 'right'),
    say('clerk', 'Вот в четверг и приходи, милый. По средам не принимаем.', when='day < 3'),
    inner('Четверг. До пятницы останется один день.', when='day < 3'),
    say('clerk', 'Вот завтра и приходи, милый. С запросом.', when='day == 3'),
    inner('Завтра будет уже не до картотеки.', when='day == 3'),
    jump('route'),
])

# ── День 1, вечер ──
scene('d1_evening', 'b2_evening', 'hod_office_eve', lambda: [
    cap('date_stamp', 'Понедельник, 19:40'),
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center'),
    inner('К вечеру отдел пустеет. Остаются лампа, машинка под чехлом и Левина с двумя стаканами чая.'),
    say('expert', 'Чай горячий, сигарета моя. Рассказывай, что набегали.'),
    say('expert', 'Давай сюда доверенность. Подчистки видны только в косом свете.', when='have_contract'),
    branch([('have_contract', 'd1_lens')], 'd1_eve_rest'),
], time='evening', music='m_calm', ambient='amb_office')
scene('d1_lens', 'b2_evening', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'Доверенность и договор — рядом, под лампу. Где-то они не сходятся. Смотри сам.'),
    {'do': 'minigame', 'minigame': 'mg_docs'},
], time='evening')
scene('d1_lens_ok', 'b2_evening', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'Вот. Последняя цифра в дате переписана: четвёрка поверх единицы. Оговорки «исправленному верить» нет.'),
    unlock('n_date'),
    setv(e('case_opened', 'set', True)),
    jump('d1_eve_rest'),
], time='evening')
scene('d1_lens_fail', 'b2_evening', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'Не вижу, Громов. К вечеру глаз замыливается. Бумага как бумага.'),
    setv(e('lens_tried', 'set', True)),
    jump('d1_eve_rest'),
], time='evening')
scene('d1_eve_rest', 'b2_evening', 'hod_office_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center'),
    say('expert', 'Вот тебе и бумага с изъяном, Громов. Возбуждай. Палыч поворчит и подпишет.', when='case_opened'),
    say('expert', 'Бумаги есть, а изъяна в них не видно. Палыч скажет — отказной. До пятницы четыре дня.', when='have_contract && !case_opened'),
    say('expert', '«Сергей» и серая «Волга» — уже кое-что. Но бумаги с изъяном нет, а до пятницы четыре дня.', when='!have_contract && galina_open'),
    say('expert', 'Пустой день — тоже день. Только до пятницы их осталось четыре.', when='!have_contract && !galina_open'),
    say('expert', 'Фото, говоришь, за стеклом? Завтра с утра съезжу с понятыми. По протоколу — значит, в дело.', when='photo_later'),
    say('expert', 'Очки дома, а подпись в доверенности ровная. Значит, читал ей кто-то другой.', when='glasses_found'),
    say('expert', 'Нитроглицерин оставила? Такие на юг не уезжают, Громов.', when='pills_found'),
    say('oper', 'Звонил знакомый с Пресни. Ковригин сегодня отпустил помощницу — в отпуск, с завтрашнего дня. Адреса не оставил.', when='visited_flat && !lyuda_talked'),
    setv(e('lyuda_gone', 'set', True), when='visited_flat && !lyuda_talked'),
    inner('Лапины кому-то позвонили, едва мы ушли. Или нотариус сам всё понял.', when='visited_flat && !lyuda_talked'),
    jump('d1_eve_call'),
], time='evening')
scene('d1_eve_call', 'b2_evening', 'hod_office_call_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    sfx('sfx_phone_ring', when='notary_alarmed'),
    say('boss', 'Громов! Мне из горпрокуратуры звонили. Нотариус Ковригин жалуется: следователь ломится к нему без бумаг. Ты что творишь?', when='notary_alarmed'),
    say('sledak', 'Работаю, Валентин Павлович.', when='notary_alarmed'),
    setv(e('boss_favor', 'sub', 1), when='notary_alarmed'),
    sfx('sfx_phone_ring'),
    say('sledak', 'Да, мам. Задержусь. Суп на плите, я сам разогрею.'),
    inner('Где-то по Москве ездит серая «Волга». У её хозяина тоже есть планы на завтра.'),
    setv(e('day', 'set', 2), e('slot', 'set', 0), e('last_place', 'set', '')),
    jump('d2_office', 'fade'),
], time='evening')

# ── День 2, утро ──
scene('d2_office', 'b3_day2', 'hod_office_d2', lambda: [
    cap('date_stamp', 'Вторник, 10 августа'),
    show('sledak', 'left'), show('oper', 'center'), show('boss', 'right'),
    inner('Палыч пришёл сам. Это хуже звонка.'),
    say('boss', 'Возбудил? Ну смотри. Дело теперь твоё — и спрашивать буду с тебя, а не с МУРа.', when='case_opened'),
    say('boss', 'И нотариуса без нужды не трогай. Член палаты.', when='case_opened'),
    say('boss', 'Нотариус — член палаты. Мне из горпрокуратуры звонили. До пятницы, Громов, и тихо.', when='!case_opened && notary_alarmed'),
    say('boss', 'До пятницы, помнишь? Бумага с изъяном — или отказной.', when='!case_opened && !notary_alarmed'),
    choice('c_boss', 'Что ответить Палычу?', 'moral', [
        opt('quiet', 'Понял. Тихо', 'd2_route', effects=[e('boss_favor', 'add', 1)]),
        opt('push', 'Пропавших уже четверо, Валентин Павлович', 'd2_push', effects=[e('gromov_rep', 'add', 1), e('trust_oper', 'add', 1)]),
    ]),
], time='day', music='m_investigation', ambient='amb_office')
scene('d2_push', 'b3_day2', 'hod_office_d2', lambda: [
    show('sledak', 'left'), show('oper', 'center'), show('boss', 'right'),
    say('boss', 'Четверо, пятеро… У тебя бумаги, а не трупы. Работай.'),
    jump('d2_route'),
])
scene('d2_route', 'b3_day2', 'hod_office_d2', lambda: [
    branch([('photo_later || lapins_told_truth', 'd2_calls')], 'd2_go'),
])
scene('d2_calls', 'b3_day2', 'hod_office_call_am', lambda: [
    show('sledak', 'left'), show('oper', 'right'),
    sfx('sfx_phone_ring', when='photo_later'),
    say('expert', 'Громов, я с Молодогвардейской. Фото изъято, понятые расписались. На обороте — «Бабушке от внука. Самара».', when='photo_later'),
    unlock('n_photo', when='photo_later'), setv(e('photo_seen', 'set', True), when='photo_later'),
    sfx('sfx_phone_ring', when='lapins_told_truth'),
    say('lapin_wife', 'Это Ирина Лапина. Вчера, как вы ушли, муж позвонил нотариусу. Посредник так велел: если кто придёт — звонить.', when='lapins_told_truth'),
    unlock('n_call', when='lapins_told_truth'),
    inner('Значит, нотариус и посредник — одна связка.', when='lapins_told_truth'),
    jump('d2_go'),
])
scene('d2_go', 'b3_day2', 'hod_office_am', lambda: [
    show('sledak', 'left'), show('oper', 'right'),
    say('oper', 'Ну, юрист, куда сегодня?'),
    *day2_choices('c_d2_go', 'Куда сегодня?'),
])

# ── День 2, ночь: версия ──
VERSION_PENALTY = [e('nerves', 'sub', 1)]  # шкала «Самообладание» над вариантами, как в прежнем эпизоде
scene('d2_night', 'b4_night', 'hod_office_night', lambda: [
    cap('date_stamp', 'Вторник, 22:40'),
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    inner('Отдел пуст. Лампа, папки и Левина у открытого окна.'),
    say('oper', 'Заезжал к Галине — протокол подписать. Соседи говорят: уехала в Тулу, к дочке. Свидетельницы у тебя больше нет.', when='galina_leaving'),
    say('expert', 'Излагай. Как по-твоему было? Только по бумагам, не по чувствам.'),
    jump('d_who'),
], time='night', music='m_tension', ambient='amb_office')
scene('d_who', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    choice('d_who', 'Кто продал квартиру Зои Павловны?', 'deduction', [
        opt('lapins', 'Лапины. Купили — и молчат', 'd_who_w1', verdict='wrong'),
        opt('notary', 'Нотариус Ковригин', 'd_who_w2', verdict='wrong'),
        opt('murashov', 'Мурашов С. В., по доверенности', 'd_how', item='n_name', verdict='right'),
        opt('proxy', 'Тот, у кого была доверенность', 'd_how', verdict='right', effects=[e('version_weak', 'set', True)]),
    ], penalty=VERSION_PENALTY),
])
scene('d_who_w1', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('expert', 'Лапины заплатили. Продавец деньги получает, а не отдаёт.'),
    jump('d_who'),
])
scene('d_who_w2', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('expert', 'Нотариус заверяет. Продаёт тот, у кого доверенность.'),
    jump('d_who'),
])
scene('d_how', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    choice('d_how', 'Где у этой сделки слабое место?', 'deduction', [
        opt('none', 'Нигде. Всё подписано, всё по закону', 'd_how_w1', verdict='wrong'),
        opt('date', 'Дата в доверенности исправлена задним числом', 'd_where', item='n_date', verdict='right'),
        opt('cash', 'Нотариус берёт за срочность и не задаёт вопросов', 'd_where', item='n_lyuda', verdict='right'),
        opt('notary', 'Без нотариуса такая сделка не прошла бы', 'd_where', verdict='right', effects=[e('version_weak', 'set', True)]),
    ], penalty=VERSION_PENALTY),
])
scene('d_how_w1', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('expert', 'Если нигде — иди спать. А я подожду, пока найдёшь.'),
    jump('d_how'),
])
scene('d_where', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    choice('d_where', 'Что с Зоей Павловной?', 'deduction', [
        opt('south', 'Уехала на юг, к родне', 'd_where_w1', verdict='wrong'),
        opt('left', 'Ушла с ним в конце июня — и пропала', 'version', item='n_last_seen', verdict='right'),
        opt('vypiska', 'Её выписали без неё. Значит, знали, что не вернётся', 'version', item='n_vypiska', verdict='right'),
        opt('unknown', 'Не знаю. Но живой её после июня никто не видел', 'version', verdict='right', effects=[e('version_weak', 'set', True)]),
    ], penalty=VERSION_PENALTY),
])
scene('d_where_w1', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('expert', 'К кому? Внук у неё в Самаре, ты сам фото видел.', when='photo_seen'),
    say('expert', 'К кому? Ты хоть одного родственника на юге нашёл?', when='!photo_seen'),
    jump('d_where'),
])
scene('version', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('expert', 'Сходится. Фамилия, слабое место сделки, пропавшая хозяйка.', when='!version_weak'),
    say('expert', 'Сходится, но на соплях. Половину ты угадал, а не нашёл.', when='version_weak'),
    say('expert', 'И мимо ты бил не раз. В суде переспросить не дадут.', when='nerves <= 1'),
    say('expert', 'Только это пока версия. Чтобы стало делом, надо понять, как он их находит.'),
    jump('recon', 'vhs_glitch'),
])

# ── Реконструкция: ЖЭК, июнь ──
scene('recon', 'br_recon', 'hod_recon', lambda: [
    cap('location', 'Реконструкция. ЖЭК № 7, июнь 1993 года'),
    show('zoya', 'left'), show('murashov_sil', 'right'),
    vo('Июнь. Чтобы приватизировать квартиру, нужны справки из ЖЭКа, паспортного стола и БТИ. Зоя Павловна собирает их третью неделю.'),
    say('zoya', 'Четвёртый раз сюда прихожу. В одном окошке — не к нам, в другом — приходите завтра.'),
    say('murashov_sil', 'Простите, невольно услышал. Вам не в это окно, а в третье. Давайте папку, я посмотрю.'),
    say('zoya', 'Ой, спасибо. Ничего я в этих бумагах не понимаю. Хочу квартиру на внука оформить.'),
    say('murashov_sil', 'Я из бывших журналистов, привык разбираться в бумагах. Помогаю людям — бесплатно, по-соседски. Сергей Викторович.'),
    say('zoya', 'Бесплатно? Так не бывает, Сергей Викторович.'),
    say('murashov_sil', 'Бывает, когда человека жалко.'),
    vo('Через неделю она подпишет доверенность, не надев очков. Ещё через неделю выйдет из дома с сумкой — и больше не вернётся.'),
    jump('d2_late', 'vhs_glitch'),
], time='day', music='m_chronicle')
scene('d2_late', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('oper', 'Толик, привет, это Сайко. Пробей мне Мурашова Сергея Викторовича: машина на нём есть? …«Волга»? Серая? Номер диктуй.', when='trust_oper >= 1'),
    inner('Серая «Волга» под окнами Галины. Сергей Викторович. Мурашов. Сходится.', when='trust_oper >= 1 && galina_open'),
    inner('«Волга», серая. Осталось найти, кто её видел у дома Зои Павловны.', when='trust_oper >= 1 && !galina_open'),
    setv(e('volga_known', 'set', True), when='trust_oper >= 1'),
    say('oper', 'Всё, юрист, я спать. Мурашова своего завтра сам пробивай — у меня в МУРе четыре дела своих.', when='trust_oper == 0'),
    inner('Завтра, похоже, начну без него.', when='trust_oper == 0'),
    setv(e('oper_with', 'set', False), when='trust_oper == 0'),
    inner('До пятницы три дня.'),
    setv(e('day', 'set', 3), e('slot', 'set', 0), e('last_place', 'set', '')),
    jump('d3_office', 'fade'),
], time='night')

# ── День 3, среда: «Сергей Викторович» (docs/season1/ep01-hod-finale.md §3) ──
# Места среды: адрес Мурашова и Ковригин — всегда; третье место считается утром: вторая квартира, если в БТИ нашли
# сделки, иначе место пробы, до которого не доехали (только с Сайко: старые места сняты с ним в кадре). Нотариус
# третьим местом не бывает — его закрывает визит к Ковригину. Без третьего места выбор из двух.
THIRD = {
    'second': ('На Хорошёвку: вторая квартира из картотеки', 'g3_second'),
    'flat': ('На Молодогвардейскую, к Лапиным', 'go_flat'),
    'galina': ('К Галине, соседке', 'go_galina'),
    'zhek': ('В ЖЭК, в паспортный стол', 'go_zhek'),
    'bti': ('В архив БТИ', 'go_bti'),
}
D3_ADDR = ('В Чертаново, по прописке Мурашова', 'g3_address')
D3_KOV = ('На Пресню, к Ковригину', 'g3_kovrigin')


def d3_choices(cid, prompt):
    out = []
    for t, (text, goto) in THIRD.items():
        out.append(choice(f'{cid}_{t}', prompt, 'investigative', [
            opt(t, text, goto, effects=[e('v3_third', 'set', True)]),
            opt('address', *D3_ADDR, when='!v3_address'),
            opt('kovrigin', *D3_KOV, when='!v3_kovrigin'),
        ], when=f"third == '{t}' && !v3_third"))
    out.append(choice(f'{cid}_two', prompt, 'investigative', [opt('address', *D3_ADDR), opt('kovrigin', *D3_KOV)],
                      when='!v3_address && !v3_kovrigin'))
    out.append(branch([('!v3_address', D3_ADDR[1])], D3_KOV[1]))  # осталось одно место — едем без выбора
    return out


scene('d3_office', 'b5_day3', 'hod_office_d2', lambda: [
    cap('date_stamp', 'Среда, 11 августа'),
    setv(e('third', 'set', 'second'), when='bti_chain'),
    *[setv(e('third', 'set', p), when=f'!bti_chain && oper_with && !visited_{p}') for p in ('flat', 'galina', 'zhek', 'bti')],
    setv(e('murashov_spooked', 'set', True), when='lapins_told_truth'),
    show('sledak', 'left'), show('oper', 'center', when='oper_with'), show('boss', 'right'),
    inner('Палыч опять пришёл сам. Значит, ему опять звонили.', when='notary_alarmed'),
    inner('Палыч заходит без стука — проверить, на месте ли я.', when='!notary_alarmed'),
    say('boss', 'Дело у тебя возбуждено. К пятнице жду не бумагу, Громов, а человека.', when='case_opened'),
    say('boss', 'Среда, Громов. В пятницу — бумага с изъяном на стол или отказной. Третьего не дано.', when='!case_opened'),
    say('boss', 'И если нотариус ещё раз позвонит в город — дело заберут. Мне за тебя краснеть надоело.', when='boss_favor < 0'),
    say('sledak', 'Будет, Валентин Павлович.'),
    say('oper', 'Пока ты спал, юрист, я не спал. Мурашов Сергей Викторович, пятьдесят пятого года, прописан в Чертанове. «Волга» серая — на нём.', when='oper_with'),
    unlock('n_volga', when='oper_with'),
    inner('Сайко нет. На его столе записка: «Я в МУРе». Мурашова пробиваю сам, через паспортный стол: в заявлении о выписке есть его паспорт. Прописан в Чертанове.', when='!oper_with'),
    unlock('n_address'),
    sfx('sfx_phone_ring', when='lapins_told_truth'),
    say('lapin_wife', 'Это Ирина Лапина. Вчера вечером звонил Сергей Викторович. Велел молчать, обещал вернуть деньги, если всё будет тихо.', when='lapins_told_truth'),
    inner('Он знает, что его ищут.', when='lapins_told_truth'),
    unlock('n_irina', when='lapins_told_truth'),
    sfx('sfx_phone_ring', when='photo_later && !photo_seen'),
    say('expert', 'Громов, это Левина. Фото внука изъяла, понятые расписались. На обороте — «Бабушке от внука. Самара».', when='photo_later && !photo_seen'),
    unlock('n_photo', when='photo_later && !photo_seen'),
    setv(e('photo_seen', 'set', True), when='photo_later'),
    jump('d3_lens', when='!case_opened && have_contract'),
    inner('Договора у меня нет: к Лапиным я так и не доехал. Бумагу к пятнице дадут только люди — Ковригин или тот, кто напишет заявление.', when='!case_opened'),
    jump('d3_go'),
], music='m_investigation', ambient='amb_office')
scene('d3_lens', 'b5_day3', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'В понедельник к вечеру мы оба ослепли. Давай свежим глазом: доверенность и договор — под лампу.', when='lens_tried'),
    say('expert', 'Договор и доверенность — рядом, под лампу. Пока бумага не доказала обратного, она чистая.', when='!lens_tried'),
    {'do': 'minigame', 'minigame': 'mg_docs_d3'},
])
scene('d3_lens_ok', 'b5_day3', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'Вот. В дате доверенности четвёрка поверх единицы. Оговорки «исправленному верить» нет.'),
    unlock('n_date'), setv(e('case_opened', 'set', True)),
    inner('Бумага с изъяном. Дело возбуждаю сегодня — Палыч подпишет, никуда не денется.'),
    jump('d3_go'),
])
scene('d3_lens_fail', 'b5_day3', 'hod_office_lens', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    say('expert', 'Нет, Громов. Бумага как бумага. Если изъян и есть, то не в ней.'),
    inner('Значит, бумагу к пятнице дадут люди: Ковригин, который заверял, или тот, кто напишет заявление.'),
    jump('d3_go'),
])
# Выезд: с Сайко — его машина, без него — Громов один (заглушка улицы: кадры машины сняты с Сайко за рулём).
scene('d3_go', 'b5_day3', 'hod_car', lambda: [branch([('oper_with', 'd3_go_car')], 'd3_go_walk')])
scene('d3_go_car', 'b5_day3', 'hod_car', lambda: [
    show('oper', 'left'), show('sledak', 'right'),
    say('oper', 'Ну что, юрист. Куда сначала?'),
    *d3_choices('c_d3_go_car', 'Куда сначала?'),
], ambient='amb_street_day')
scene('d3_go_walk', 'b5_day3', 'hod_t_street', lambda: [
    inner('Троллейбус, метро, пересадка. Без Сайко день короче, а Москва длиннее.'),
    *d3_choices('c_d3_go_walk', 'Куда сначала?'),
], ambient='amb_street_day')

D3_REACT = [  # после места среды: (условие, реплика Сайко в машине, мысль Громова без него)
    ("last_place == 'second'", 'Здоровый, стриженый, за рулём. Значит, «вежливый» работает не один.',
     'Вежливый работает не один. За рулём у него — здоровый, стриженый.'),
    ("last_place == 'second' && klava_statement", 'А заявление о пропаже — это уже дело. Палыч не отвертится.',
     'Заявление о пропаже. От такого Палыч не отмахнётся.'),
    ("last_place == 'address' && murashov_spooked", 'Он тебя срисовал, юрист. Видел, как он в окно смотрел?',
     'Он посмотрел мне вслед из окна. Запомнил.'),
    ("last_place == 'address' && office_watched", 'Шмеля этого я где-то видел. Ночью пробью.', None),
    ("last_place == 'address' && !murashov_spooked && !office_watched", None,
     'Где его брать, я знаю. Осталось — с чем.'),
    ("last_place == 'kovrigin' && kovrigin_deal", 'Нотариус поплыл. Свидетелем, значит… Ну-ну.',
     'Показания под протокол. Бумага к пятнице есть.'),
    ("last_place == 'kovrigin' && kovrigin_pressed", 'Адвоката ждёт. А Палычу — вторая жалоба.',
     'Вторая жалоба. Палыч будет рад.'),
    ("last_place == 'flat' || last_place == 'galina' || last_place == 'zhek' || last_place == 'bti'",
     'Что с понедельника висело — закрыли.', None),
]
scene('d3_route', 'b5_day3', 'hod_car', lambda: [branch([('oper_with', 'd3_route_car')], 'd3_route_walk')])
scene('d3_route_car', 'b5_day3', 'hod_car', lambda: [
    show('oper', 'left'), show('sledak', 'right'),
    *[say('oper', car, when=w) for w, car, _ in D3_REACT if car],
    say('oper', 'Дальше куда?'),
    *d3_choices('c_d3_route_car', 'Дальше куда?'),
], ambient='amb_street_day')
scene('d3_route_walk', 'b5_day3', 'hod_t_street', lambda: [
    *[inner(walk, when=w) for w, _, walk in D3_REACT if walk],
    *d3_choices('c_d3_route_walk', 'Дальше куда?'),
], ambient='amb_street_day')


def go3(place, car, walk):
    """Дорога к месту среды: с Сайко — его машина, без него — Громов один."""
    scene(f'g3_{place}', 'b5_day3', 'hod_car', lambda: [branch([('oper_with', f'g3c_{place}')], f'g3w_{place}')])
    scene(f'g3c_{place}', 'b5_day3', 'hod_car', lambda: [
        show('oper', 'left'), show('sledak', 'right'), *[inner(t) for t in car], jump(place),
    ], ambient='amb_street_day')
    scene(f'g3w_{place}', 'b5_day3', 'hod_t_street', lambda: [*[inner(t) for t in walk], jump(place)], ambient='amb_street_day')


go3('second', ['Вторая карточка из картотеки: Хорошёвка, квартира Петра Ильича. «Уехал к сестре». Посмотрим, кто его провожал.'],
    ['Хорошёвка, вторая карточка из картотеки. Пётр Ильич «уехал к сестре». Доеду на троллейбусе — посмотрю, кто его провожал.'])
go3('address', ['Чертаново, адрес по прописке. Сайко говорит, такие, как Мурашов, по прописке не живут. Проверим.'],
    ['Чертаново, адрес по прописке. Час на метро. Такие, как Мурашов, по прописке обычно не живут.'])
go3('kovrigin', ['Ковригин. Он заверял всё, что подписал Мурашов. Посмотрим, сколько он выдержит, когда поймёт, что это не одна сделка.'],
    ['Ковригин. Он заверял всё, что подписал Мурашов. Посмотрим, сколько он выдержит, когда поймёт, что это не одна сделка.'])

# А. Вторая квартира (Хорошёвка): Пётр Ильич и соседка Клавдия Семёновна — первый след водителя.
scene('second', 'b5_day3', 'hod_t_stairs', lambda: [
    setv(e('last_place', 'set', 'second'), e('second_victim', 'set', True)),
    cap('location', 'Хорошёвское шоссе, третий этаж'),
    inner('Дверь Петра Ильича новая, железная — как у Зои Павловны. Звоню в соседнюю.'),
    say('klava', 'Вы к Петру Ильичу? Нету его. В июле уехал к сестре в Краснодар — так эти, новые, говорят.'),
    say('sledak', 'А вы как думаете?'),
    say('klava', 'Сестра у него десять лет как померла. Он мне сам рассказывал — ко мне на чай ходил, по вторникам.'),
    say('klava', 'Токарь он. Всю жизнь у станка. Мне то утюг починит, то замок. Денег не брал.'),
    unlock('n_pyotr'),
    say('klava', 'А как уезжал — я видела. Утром, в июле. Сел в серую «Волгу». Рядом — вежливый такой, при галстуке. А за рулём другой: здоровый, стриженый, шея как у быка.'),
    say('klava', 'И мне рукой не помахал. Он всегда махал.'),
    unlock('n_driver'), setv(e('driver_known', 'set', True), e('volga_known', 'set', True)),
    choice('c_klava', 'Клавдия Семёновна видела больше всех', 'dialogue', [
        opt('statement', 'Напишите заявление о пропаже. Тогда его будут искать', 'second_statement'),
        opt('talk', 'Просто расскажите. Без бумаг', 'second_talk'),
    ]),
], ambient='amb_stairwell')
scene('second_statement', 'b5_day3', 'hod_t_stairs', lambda: [
    say('klava', 'Заявление… А если этот, здоровый, вернётся?'),
    say('sledak', 'Заявление ляжет в дело, а не на лавочку у подъезда. Его будут искать, а не вас.'),
    say('klava', 'Давайте бумагу. Пётр Ильич бы за меня написал.'),
    setv(e('klava_statement', 'set', True)), unlock('n_klava'),
    inner('Заявление о пропаже человека. Это уже не бумага с изъяном — это основание для дела.'),
    jump('route'),
])
scene('second_talk', 'b5_day3', 'hod_t_stairs', lambda: [
    say('klava', 'Вот и ладно. Без бумаг мне спокойнее.'),
    inner('Ей спокойнее. Мне — нет: рассказ к делу не подошьёшь.'),
    jump('route'),
])

# Б. Адрес Мурашова: Чертаново → агентство на Пресне.
scene('address', 'b5_day3', 'hod_t_stairs', lambda: [
    setv(e('v3_address', 'set', True), e('last_place', 'set', 'address')),
    cap('location', 'Чертаново. Квартира, где прописан Мурашов'),
    inner('Дверь открывают жильцы: квартиру сдают. Хозяйка живёт этажом ниже и поднимается на звонок.'),
    say('landlady', 'Сергей Викторович? Платит аккуратно, за полгода вперёд. Только не живёт тут — за городом у него дом. А работает на Пресне, в агентстве. Где раньше газета была.'),
    unlock('n_office'), setv(e('office_known', 'set', True)),
    say('landlady', 'Вежливый. Цветы мне на Восьмое марта принёс. А что он натворил?'),
    say('sledak', 'Спасибо. Мы разберёмся.'),
    jump('address_office', 'dissolve'),
], ambient='amb_stairwell')
scene('address_office', 'b5_day3', 'hod_t_street', lambda: [
    cap('location', 'Пресня. Агентство недвижимости'),
    inner('Вывеска свежая, а на стекле двери ещё видно старое: «Редакция». У входа — серая «Волга». Рядом кто-то курит, спиной ко мне.'),
    setv(e('volga_known', 'set', True)),
    choice('c_address', 'Как подобраться к агентству?', 'tactical', [
        opt('buyer', 'Зайти под видом покупателя', 'address_buyer'),
        opt('watch', 'Сесть в машину и смотреть', 'address_watch', when='oper_with'),
        opt('leave', 'Уехать. Вернуться с санкцией', 'address_leave', when='!oper_with'),
    ]),
], ambient='amb_street_day')
scene('address_buyer', 'b5_day3', 'hod_t_street', lambda: [
    inner('Курильщик у «Волги» оборачивается, когда я прохожу мимо. Здоровый, стриженый.'),
    inner('Внутри — комната бывшей редакции. Три телефона, папки, графин. За столом — он.'),
    say('murashov', 'Добрый день. Вы по объявлению? Однокомнатные есть. Бумаги у нас чистые, я за этим слежу сам.'),
    say('sledak', 'Мне бы для матери. Поближе к метро.'),
    say('murashov', 'Для матери — понимаю. Оставьте телефон, я перезвоню.'),
    inner('Вежливый. Бесцветный. В очереди я бы на него не оглянулся. Только смотрел он на меня на секунду дольше, чем нужно.'),
    unlock('n_seen'), setv(e('murashov_spooked', 'set', True), e('driver_known', 'set', True)),
    jump('route'),
], ambient='amb_street_day')
scene('address_watch', 'b5_day3', 'hod_t_street', lambda: [
    inner('Сайко ставит машину через дорогу. Три часа мы смотрим на дверь бывшей редакции.'),
    say('oper', 'Водитель от машины не отходит. Курит, ждёт. Хозяина возит, не иначе.'),
    inner('В шесть выходит Мурашов. Водитель открывает ему дверцу — здоровый, стриженый, шея как у быка.'),
    say('oper', 'Номер я переписал. Если он так каждый день — в шесть из конторы, в полночь за город, — его можно брать без водителя. А водителя — отдельно.'),
    unlock('n_watch'), setv(e('office_watched', 'set', True), e('driver_known', 'set', True)),
    jump('route'),
], ambient='amb_street_day')
scene('address_leave', 'b5_day3', 'hod_t_street', lambda: [
    inner('Один я тут ничего не высижу. А зайду — запомнит лицо. Уезжаю: вернусь с санкцией и нарядом.'),
    inner('Курильщик так и не обернулся. Лица я не разглядел.'),
    jump('route'),
], ambient='amb_street_day')

# В. Ковригин: показания за обещание или давление и жалоба.
scene('kovrigin', 'b5_day3', 'hod_notary_alone', lambda: [
    setv(e('v3_kovrigin', 'set', True), e('last_place', 'set', 'kovrigin')),
    cap('location', 'Нотариальная контора. Пресня'),
    show('notary', 'center'), show('sledak', 'center'), show('oper', 'right', when='oper_with'),
    inner('Очереди нет. На двери табличка: «Приём временно не ведётся». Машинка у окна под чехлом.'),
    inner('Люды нет. Похоже, Ковригин понял, кто его сдал.', when='lyuda_talked'),
    say('notary', 'Опять вы. Я ведь сказал — по запросу.', when='visited_notary'),
    say('notary', 'Прокуратура? Я ждал. Вернее, ждал, что кто-нибудь придёт.', when='!visited_notary'),
    say('sledak', 'Шесть сделок за лето, Анатолий Николаевич. Один доверенный — Мурашов. Один нотариус — вы.', when='bti_six'),
    say('sledak', 'Три сделки за лето — и это не всё. Один доверенный — Мурашов. Один нотариус — вы.', when='bti_chain && !bti_six'),
    say('sledak', 'Доверенность Зои Павловны, Анатолий Николаевич. Доверенный — Мурашов. Заверяли — вы.', when='!bti_chain'),
    say('notary', 'Я заверял. Это моя работа. Что люди потом делают со своими квартирами…'),
    say('notary', 'Скажите прямо: что мне будет?'),
    setv(e('visited_notary', 'set', True)),
    choice('c_kovrigin', 'Ковригин торгуется', 'moral', [
        opt('deal', 'Дадите показания — пойдёте свидетелем', 'kovrigin_deal'),
        opt('press', 'Вы соучастник. Пишите явку с повинной', 'kovrigin_press'),
    ]),
], ambient='amb_office')
scene('kovrigin_deal', 'b5_day3', 'hod_notary_alone', lambda: [
    show('notary', 'center'), show('sledak', 'center'), show('oper', 'right', when='oper_with'),
    say('notary', 'Свидетелем… Хорошо. Пишите.'),
    say('notary', 'Водитель у него — Шмелёв Дмитрий. Шмелём зовут. Сидел. Возит Сергея Викторовича на «Волге» и ждёт у меня под окнами.'),
    say('notary', 'Доверенности старикам читал он сам, вслух. Я только спрашивал: «Согласны?» Они кивали.'),
    say('notary', 'Даты других сделок — в реестре, я покажу. А сидит он на Пресне, в агентстве, где раньше была редакция. Два квартала отсюда.'),
    unlock('n_kovrigin'), unlock('n_shmel'), unlock('n_office'), unlock('n_read'),
    setv(e('kovrigin_deal', 'set', True), e('driver_known', 'set', True), e('shmel_named', 'set', True),
         e('murashov_read', 'set', True), e('office_known', 'set', True), e('volga_known', 'set', True)),
    inner('Свидетелем он не пойдёт: кем ему быть, решит суд. Он этого ещё не знает. А я знаю.'),
    jump('route'),
])
scene('kovrigin_press', 'b5_day3', 'hod_notary_alone', lambda: [
    show('notary', 'center'), show('sledak', 'center'), show('oper', 'right', when='oper_with'),
    say('notary', 'Явку? Я? Да вы знаете, сколько лет я в палате?'),
    say('notary', 'Мурашова и спрашивайте. Сидит на Пресне, в агентстве, где раньше была редакция. А я без адвоката больше ни слова.'),
    unlock('n_office'),
    setv(e('office_known', 'set', True), e('kovrigin_pressed', 'set', True), e('notary_alarmed', 'set', True), e('boss_favor', 'sub', 1)),
    inner('Он снимает трубку — звонить адвокату. Вторая жалоба ляжет Палычу на стол раньше, чем я доеду до отдела.'),
    jump('route'),
])

# ── Среда, вечер: доска Левиной и «Где старики?» ──
scene('d3_evening', 'b6_board', 'hod_office_eve', lambda: [
    cap('date_stamp', 'Среда, 20:30'),
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center', when='oper_with'),
    inner('Левина прикалывает к стене кусок обоев изнанкой наружу. Вместо доски.'),
    say('expert', 'Фото внука я изъяла, понятые расписались. Вешай рядом.', when='photo_later && !photo_seen'),
    unlock('n_photo', when='photo_later && !photo_seen'),
    setv(e('photo_seen', 'set', True), when='photo_later'),
    say('expert', 'Вешай всё, что набегал. Только то, что есть, — без «наверное».'),
    say('expert', 'И не торопись. Во вторник ты половину угадал.', when='version_weak'),
    {'do': 'minigame', 'minigame': 'mg_board'},
], time='evening', music='m_calm', ambient='amb_office')
scene('d3_board_done', 'b6_board', 'hod_office_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center', when='oper_with'),
    say('expert', 'Сходится. Все нитки ведут к одному человеку.', when='board_ok'),
    say('expert', 'Ниток мало, Громов. Но и они ведут к одному человеку.', when='!board_ok'),
    say('expert', 'А теперь главный вопрос. Не «кто». «Где».'),
    jump('d3_where'),
], time='evening')
scene('d3_where', 'b6_board', 'hod_office_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center', when='oper_with'),
    choice('d3_where', 'Где старики?', 'deduction', [
        opt('relatives', 'Уехали к родне. Так всем и говорили', 'd3_where_w1', verdict='wrong'),
        opt('country', 'Живут у него за городом', 'd3_where_w2', verdict='wrong'),
        opt('dead', 'Их нет в живых', 'd3_night', verdict='right'),
    ], penalty=VERSION_PENALTY),
], time='evening')
scene('d3_where_w1', 'b6_board', 'hod_office_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center', when='oper_with'),
    say('expert', 'Шестеро — и ни один не позвонил? Ни внуку, ни соседке?', when='bti_six'),
    say('expert', 'Трое — и ни один не позвонил? Ни внуку, ни соседке?', when='bti_chain && !bti_six'),
    say('expert', 'Зоя Павловна уехала к родне — и ни разу не позвонила внуку?', when='!bti_chain'),
    say('expert', 'А Пётр Ильич — к сестре, которой десять лет как нет.', when='second_victim'),
    jump('d3_where'),
], time='evening')
scene('d3_where_w2', 'b6_board', 'hod_office_eve', lambda: [
    show('sledak', 'left'), show('expert', 'right'), show('oper', 'center', when='oper_with'),
    say('expert', 'Держать их у себя? Квартиры проданы, деньги получены. Зачем ему лишние рты, Громов?'),
    jump('d3_where'),
], time='evening')
scene('d3_night', 'b6_board', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'right'),
    inner('Три дня я искал подпись. А надо было — людей.'),
    say('expert', 'Иди домой, Громов. Завтра тебе понадобится голова. И Палыч.'),
    sfx('sfx_phone_ring'),
    say('oper', 'Юрист, это Сайко. Шмелёва твоего пробил: тридцать четыре года, два раза сидел. Тяжёлый.', when='oper_with && shmel_named'),
    say('oper', 'Юрист, это Сайко. Водитель твой — Шмелёв Дмитрий, Шмель. Тридцать четыре года, два раза сидел. Возит Мурашова.', when='oper_with && driver_known && !shmel_named'),
    unlock('n_shmel', when='oper_with && driver_known'),
    setv(e('shmel_named', 'set', True), when='oper_with && driver_known'),
    say('sledak', 'Да, мам. Поздно. Нет, не жди.', when='!oper_with || !driver_known'),
    setv(e('day', 'set', 4)),
    jump('d4_office', 'fade'),
], time='night', ambient='amb_office')

# ── День 4, четверг: санкция, опознание, операция, обыск (§4) ──
scene('d4_office', 'b7_op', 'hod_office_d2', lambda: [
    cap('date_stamp', 'Четверг, 12 августа'),
    show('sledak', 'left'), show('oper', 'center', when='oper_with'), show('boss', 'right'),
    say('sledak', 'Валентин Павлович, мне нужна санкция на задержание. Сегодня.'),
    say('boss', 'На кого?'),
    say('sledak', 'Мурашов Сергей Викторович. Посредник. Шесть квартир за лето — и ни одного хозяина в живых.', when='bti_six'),
    say('sledak', 'Мурашов Сергей Викторович. Посредник. Квартиры одиноких стариков — и ни одного хозяина в живых.', when='!bti_six'),
    branch([('case_opened || klava_statement || kovrigin_deal', 'd4_sanction')], 'd4_refuse'),
], music='m_tension', ambient='amb_office')
scene('d4_sanction', 'b7_op', 'hod_office_d2', lambda: [
    show('sledak', 'left'), show('oper', 'center', when='oper_with'), show('boss', 'right'),
    say('boss', 'Дело возбуждено, бумага с изъяном есть. Ладно.', when='case_opened'),
    say('boss', 'Заявление о пропаже второго старика… Это уже не бумаги, Громов. Это люди.', when='!case_opened && klava_statement'),
    say('boss', 'Нотариус сам пишет показания? Ну ты даёшь, Громов.', when='!case_opened && !klava_statement'),
    say('boss', 'Подписываю. Но если возьмёшь не того — отвечать будешь сам.'),
    unlock('n_sanction'), setv(e('sanction', 'set', True)),
    inner('Фото Мурашова — из паспортного стола, с карточки десятилетней давности. Нужен человек, который его узнает.'),
    jump('d4_ident_irina', when='lapins_told_truth'),
    inner('Галина видела его три недели подряд. Но я обещал ей, что её имя нигде не прозвучит.', when='galina_trust'),
    choice('c_ident', 'Опознать Мурашова может Галина', 'moral', [
        opt('ask', 'Галина Васильевна, только вы его видели', 'd4_ident_galina'),
        opt('spare', 'Её не трогать. Обещал', 'd4_op'),
    ], when='galina_trust'),
    inner('Опознать его некому. Возьмём — разберёмся.'),
    jump('d4_op', 'fade'),
])
scene('d4_ident_irina', 'b7_op', 'hod_flat', lambda: [
    cap('location', 'Молодогвардейская, квартира 34'),
    show('oper', 'left', when='oper_with'), show('sledak', 'center'), show('lapin_wife', 'right'),
    inner('Ирина смотрит на фото долго, будто считает про себя до десяти.'),
    say('lapin_wife', 'Он. Сергей Викторович. В коридоре у нотариуса деньги пересчитывал — два раза, чтобы мы видели.'),
    say('lapin_wife', 'Пишите. Я подпишу. Хватит молчать.'),
    setv(e('identified', 'set', True)), unlock('n_ident'),
    jump('d4_op', 'fade'),
])
scene('d4_ident_galina', 'b7_op', 'hod_landing_open', lambda: [
    show('neighbor', 'left'), show('sledak', 'center'), show('oper', 'right', when='oper_with'),
    inner('Галина открывает сразу, без цепочки. Видит фото у меня в руке — и всё понимает.'),
    say('neighbor', 'Вы же обещали.'),
    say('sledak', 'Обещал. Только вы его видели.'),
    say('neighbor', '…Он. Сергей Викторович. Под моими окнами «Волгу» ставил.'),
    say('neighbor', 'Распишусь. А вы ко мне больше не приходите.'),
    setv(e('identified', 'set', True), e('galina_promise_broken', 'set', True)), unlock('n_ident'),
    jump('d4_op', 'fade'),
], ambient='amb_stairwell')
scene('d4_refuse', 'b7_op', 'hod_office_d2', lambda: [
    show('sledak', 'left'), show('oper', 'center', when='oper_with'), show('boss', 'right'),
    say('boss', 'На каком основании? Бумаги чистые, дела нет, заявлений нет. Без дела никого брать не дам.'),
    say('sledak', 'Он уедет, Валентин Павлович.'),
    say('boss', 'Значит, уедет. Отдавай материал в город — пусть у них голова болит.'),
    setv(e('case_transferred', 'set', True)),
    inner('Подпись, печать, курьер. К вечеру материал уходит в город.'),
    jump('d5_gone', 'fade'),
])
# Операция: ждать можно только с Сайко, зная расписание и не спугнув Мурашова; иначе — сразу.
scene('d4_op', 'b7_op', 'hod_t_street', lambda: [
    cap('date_stamp', 'Четверг, 23:40'),
    cap('location', 'Пресня, у агентства'),
    inner('Галину я так и не попросил. Обещал — значит, обещал.', when='galina_trust && !identified'),
    inner('В бывшей редакции горит одно окно. У входа — серая «Волга».'),
    branch([('oper_with && office_watched && !murashov_spooked', 'd4_op_choice')], 'd4_op_now'),
], time='night', music='m_tension', ambient='amb_street_night')
scene('d4_op_choice', 'b7_op', 'hod_t_street', lambda: [
    say('oper', 'Всё по расписанию. В полночь он выходит, Шмель везёт его за город и возвращается один. Можно взять порознь.'),
    say('oper', 'А можно сейчас. Оба тут, оба на виду. Только у Шмеля правый карман оттянут.'),
    choice('c_op', 'Брать сейчас или ждать?', 'tactical', [
        opt('now', 'Брать сейчас. Обоих', 'd4_op_now'),
        opt('wait', 'Ждать. Взять порознь', 'd4_op_wait'),
    ], timer=12000, default='wait'),
], time='night')
scene('d4_op_now', 'b7_op', 'hod_t_street', lambda: [
    inner('В агентстве свет, у входа «Волга» с открытым багажником. Он уезжает — ждать нельзя.', when='murashov_spooked'),
    inner('Сайко нет. Со мной два сержанта из отделения. Ждать некому — берём сразу.', when='!oper_with'),
    inner('Расписания у нас нет. Ждать — значит гадать. Берём сразу.', when='oper_with && !office_watched && !murashov_spooked'),
    inner('Шмелёв замечает нас первым.'),
    sfx('sfx_shot'), fx('flash'),
    inner('Сайко сидит на асфальте и держится за плечо.', when='oper_with'),
    say('oper', 'Царапина, юрист. Бери своего. Шмеля ребята держат.', when='oper_with'),
    setv(e('oper_wounded', 'set', True), e('accomplice_talks', 'set', True), when='oper_with'),
    inner('Шмелёв уходит дворами. Сержант бежит за ним и возвращается один.', when='!oper_with'),
    setv(e('shmel_escaped', 'set', True), when='!oper_with'),
    inner('Мурашова берём на лестнице. Он не бежит и ни о чём не спрашивает. Протягивает руки — как в очереди за справкой.'),
    jump('d4_search', 'fade'),
], time='night')
scene('d4_op_wait', 'b7_op', 'hod_t_street', lambda: [
    setv(e('op_waited', 'set', True)),
    inner('Полночь. Мурашов выходит, Шмелёв открывает ему дверцу. «Волга» уходит в сторону области.'),
    inner('В половине второго она возвращается — одна. Шмелёва берут у метро: руку из кармана он вынуть не успевает.'),
    say('accomplice', 'Я только возил.'),
    say('accomplice', 'Возил в лес.'),
    inner('И молчит до самого отдела.'),
    setv(e('accomplice_talks', 'set', True)), unlock('n_shmel_talks'),
    inner('Мурашова берём на рассвете, на крыльце его дома за городом. Он не бежит и ни о чём не спрашивает.'),
    jump('d4_search', 'fade'),
], time='night')
scene('d4_search', 'b7_op', 'hod_t_search', lambda: [
    cap('location', 'Обыск у Мурашова'),
    inner('Три телефона, папки по годам, на окне — фикус. Всё как у человека, у которого всё в порядке.'),
    say('oper', 'Юрист, с чего начнём? К утру приедет адвокат — всё перевернуть не успеем.', when='oper_with && !oper_wounded'),
    inner('К утру приедет адвокат. Всё перевернуть не успею.', when='!oper_with || oper_wounded'),
    choice('c_search', 'Обыск: с чего начать?', 'investigative', [
        opt('papers', 'Папки. Доверенности, расписки, договоры', 'd4_search_papers'),
        opt('keys', 'Ключи и вещи. Всё, что не его', 'd4_search_keys'),
    ]),
], time='night')
scene('d4_search_papers', 'b7_op', 'hod_t_search', lambda: [
    inner('Доверенности. Шесть штук, все на его имя, все заверены Ковригиным.'),
    inner('Это я знал и так — из картотеки.', when='bti_six'),
    inner('В картотеке я нашёл меньше. Теперь их шесть — и все на бумаге.', when='!bti_six'),
    unlock('n_bti', when='!bti_six'),
    setv(e('bti_chain', 'set', True), e('bti_six', 'set', True)),
    inner('До ящиков стола руки не дошли: в семь утра приехал адвокат.'),
    jump('d5_morning', 'fade'),
], time='night')
scene('d4_search_keys', 'b7_op', 'hod_t_search', lambda: [
    inner('В нижнем ящике стола — связка ключей. На каждом картонная бирка, адрес его рукой.'),
    inner('Под ключами — паспорта. Чужие. Сверху — паспорт Зои Павловны.'),
    inner('В шкафу — женская сумка. С ней, говорила Галина, Зоя Павловна вышла из дома в конце июня.', when='galina_open'),
    inner('В шкафу — старая женская сумка с застёжкой-поцелуйчиком.', when='!galina_open'),
    setv(e('keys_found', 'set', True)), unlock('n_keys'),
    jump('d5_morning', 'fade'),
], time='night')

# ── День 5, пятница: лесополоса, допрос, очная ставка, решение Палыча (§4–§5) ──
scene('d5_morning', 'b8_friday', 'hod_t_street', lambda: [
    cap('date_stamp', 'Пятница, 13 августа'),
    setv(e('day', 'set', 5)),
    branch([('accomplice_talks', 'd5_field')], 'd5_interrog'),
], time='dawn')
# Лесополоса: последствие, без тел (этика §4) — лента, лопаты, Левина; число — как нашёл Громов.
scene('d5_field', 'b8_friday', 'hod_t_street', lambda: [
    cap('location', 'Лесополоса под Апрелевкой, 7:20'),
    inner('Шмелёв показал место ночью. Сам попросил карту.'),
    unlock('n_shmel_talks'),
    inner('Лента между берёзами. Лопаты. Левина в резиновых сапогах ходит вдоль ленты и ничего не говорит.'),
    inner('Я стою у машины. Ближе меня не зовут — и я не прошу.'),
    say('expert', 'Шестеро, Громов. Как в картотеке.', when='bti_six'),
    say('expert', 'Больше, чем ты нашёл, Громов.', when='!bti_six'),
    inner('Сайко в Боткинской. Позвонил в шесть: «Шмель показал место». И повесил трубку.', when='oper_wounded'),
    inner('Сайко курит у машины. Не шутит.', when='!oper_wounded'),
    setv(e('field_seen', 'set', True)), unlock('n_field'),
    jump('d5_interrog', 'fade'),
], time='dawn')
scene('d5_interrog', 'b8_friday', 'hod_t_interrog', lambda: [
    cap('location', 'Допросная'),
    inner('Он садится, поправляет манжеты и ждёт, когда я начну.'),
    say('murashov', 'Я люблю, когда люди работают по бумагам. Спрашивайте. У меня все бумаги в порядке.'),
    inner('Бумаги у него в порядке. А люди?'),
    {'do': 'minigame', 'minigame': 'mg_interrogation_hod'},
], music='m_tension')
scene('d5_after', 'b8_friday', 'hod_t_interrog', lambda: [
    say('murashov', 'Пишите. Я продиктую по датам. Только дословно.', when="confession == 'full'"),
    inner('Он диктует ровно, как анкету: даты, адреса, суммы. Ни одного лишнего слова.', when="confession == 'full'"),
    say('murashov', 'Сделки — да. Доверенности — да. Остальное доказывайте.', when="confession == 'partial'"),
    say('murashov', 'Доказывайте.', when="confession == 'none'"),
    inner('До конца допроса он смотрит не на меня, а на мою руку, которая пишет протокол.', when="confession != 'full'"),
    branch([('kovrigin_deal', 'd5_confront')], 'd5_boss'),
])
scene('d5_confront', 'b8_friday', 'hod_t_interrog', lambda: [
    inner('Очная ставка. Ковригина сажают напротив. Он смотрит в стол.'),
    say('murashov', 'Анатолий Николаевич, вы же всё помните. Всё было по закону.'),
    choice('c_confront', 'Ковригин молчит', 'dialogue', [
        opt('press', 'Вы знали, Анатолий Николаевич. Всё лето знали', 'd5_confront_press'),
        opt('calm', 'Повторите то, что писали. Спокойно, по порядку', 'd5_confront_calm'),
    ]),
])
scene('d5_confront_press', 'b8_friday', 'hod_t_interrog', lambda: [
    say('notary', 'Знал?.. Вы обещали, что я свидетель. А теперь — «знал»?'),
    say('notary', 'Отказываюсь от показаний. Без адвоката — ни слова.'),
    setv(e('kovrigin_retracted', 'set', True)),
    inner('Свидетелем ему и правда не быть. Только теперь и показаний его у меня нет.'),
    jump('d5_boss', 'fade'),
])
scene('d5_confront_calm', 'b8_friday', 'hod_t_interrog', lambda: [
    say('notary', 'Читал им он. Сам, вслух. Я только спрашивал: «Согласны?» Они кивали.'),
    say('notary', 'И за срочность я брал. Это тоже пишите.'),
    say('murashov', 'Анатолий Николаевич устал. Ему бы отдохнуть.'),
    inner('Первая его фраза за день — не по бумагам.'),
    jump('d5_boss', 'fade'),
])
# Сила дела (§6) — только из найденного, одной сценой: восемь пунктов, всего 8.
STRENGTH = ['case_opened', 'klava_statement', 'kovrigin_deal && !kovrigin_retracted', 'accomplice_talks', 'keys_found',
            'identified', 'bti_six', "confession == 'full'"]
scene('d5_boss', 'b8_friday', 'hod_office_d2', lambda: [
    cap('date_stamp', 'Пятница, 19:00'),
    *[setv(e('case_strength', 'add', 1), when=w) for w in STRENGTH],
    setv(e('case_transferred', 'set', True), when='case_strength < 3 || (case_strength < 5 && boss_favor < 1)'),
    show('sledak', 'left'), show('oper', 'center', when='oper_with && !oper_wounded'), show('boss', 'right'),
    say('boss', 'Доводи сам, Громов. Заработал.', when='!case_transferred'),
    say('boss', 'Дело забирает город. Не обижайся: у них люди и сроки, а у тебя — бумаги и нервы.', when='case_transferred'),
    say('oper', 'Ну что, юрист. Пятница.', when='oper_with && !oper_wounded'),
    sfx('sfx_phone_ring', when='oper_wounded'),
    say('oper', 'Юрист? Из Боткинской звоню. Рука на месте, врач говорит — повезло.', when='oper_wounded'),
    inner('В трубке слышно, как жена говорит ему: «Дай сюда. Сколько можно».', when='oper_wounded'),
    jump('fin_zoya', 'slow_fade'),
], time='evening', ambient='amb_office')
scene('d5_gone', 'b8_friday', 'hod_t_street', lambda: [
    cap('date_stamp', 'Пятница, 13 августа'),
    setv(e('day', 'set', 5)),
    cap('location', 'Пресня, у агентства'),
    inner('Агентство закрыто. На двери — «Ремонт». «Волги» у входа нет.'),
    say('oper', 'Уехал, юрист. Ночью, с вещами. Соседи видели.', when='oper_with'),
    inner('Соседи видели: ночью грузили вещи в серую «Волгу».', when='!oper_with'),
    inner('Материал в городе. С моей подписью на последней странице.'),
    jump('fin_zoya', 'slow_fade'),
], ambient='amb_street_day')

# ── Развязка (§6): экран Зои Павловны, суд, эпилог, журнал решений, Громов-2004, концовка ──
# Жертвы — люди (этика §4.2): годы жизни и чем жили, без подробностей смерти.
scene('fin_zoya', 'b9_end', 'hod_flat_photo', lambda: [
    vo('Зоя Павловна С. 1919–1993.'),
    vo('Сорок лет — корректор в типографии на Пресне. Опечатки в чужих текстах видела с первого взгляда.'),
    vo('Внука вырастила сама. Когда он уехал учиться в Самару, писала ему каждое воскресенье.'),
    vo('Квартиру на Молодогвардейской хотела оставить ему.'),
    vo('Пётр Ильич Р. 1914–1993. Токарь, сорок лет у станка. Чинил соседям утюги и замки — и денег не брал.', when='second_victim'),
    jump('fin_court', 'slow_fade'),
], music='m_epilogue')
scene('fin_court', 'b9_end', 'hod_t_court', lambda: [
    cap('date_stamp', 'Москва, 1994 год', when='sanction'),
    cap('date_stamp', 'Москва, 1995 год', when='!sanction'),
    vo('Московский городской суд признал Мурашова виновным в убийствах, совершённых из корыстных побуждений, и приговорил его к исключительной мере наказания.'),
    vo('В приговоре — шесть эпизодов.', when='bti_six || field_seen'),
    vo('В приговоре — те эпизоды, что успели доказать.', when='!bti_six && !field_seen'),
    cap('fact', 'С 1996 года в России действует мораторий на смертную казнь.'),
    vo('Приговор Мурашову так и не исполнили: исключительную меру заменили пожизненным лишением свободы.'),
    vo('Нотариус Ковригин получил шесть лет и лишился права заверять документы. Шмелёв — двенадцать.'),
    vo('Ковригин на суде повторял одно: «Мне обещали».', when='kovrigin_deal'),
    vo('Мурашов на суде не сказал ни слова. Только попросил вести протокол дословно.', when="confession != 'full'"),
    jump('fin_epilogue', 'slow_fade'),
])
scene('fin_epilogue', 'b9_end', 'hod_t_moscow', lambda: [
    cap('date_stamp', 'Москва, 1994–1997 годы'),
    vo('Квартиру на Молодогвардейской по суду вернули внуку из Самары.'),
    vo('Фотографию из серванта отдали ему вместе с ключами.', when='photo_seen'),
    vo('Лапины дали показания и по суду вернули часть денег.', when='lapins_told_truth'),
    vo('Лапины узнали всё из повестки.', when='!lapins_told_truth'),
    vo('Галина опознала Мурашова — и через год переехала к дочери в Тулу. Адреса Громову не оставила.', when='galina_promise_broken'),
    vo('Имя Галины в деле так и не прозвучало.', when='galina_trust && !galina_promise_broken'),
    vo('Галина уехала в Тулу ещё в августе и в Москву не вернулась.', when='galina_leaving'),
    vo('Галина так и не узнала, что её заявление стало делом.', when='galina_closed || !visited_galina'),
    vo('Люда ушла из конторы и поступила на юридический.', when='lyuda_talked'),
    vo('Люда из отпуска в контору не вернулась.', when='lyuda_gone && !lyuda_talked'),
    vo('Место под Апрелевкой Шмелёв показал только весной 1994-го.', when='!field_seen'),
    vo('Сайко вернулся через четыре месяца. Правая рука выше плеча так и не поднялась.', when='oper_wounded'),
    vo('Сайко получил благодарность в приказе — и «квартирные» дела потоком.', when='oper_with && !oper_wounded'),
    vo('Сайко узнал, чем кончилось дело, из сводки.', when='!oper_with'),
    vo('Палыч ушёл на пенсию в девяносто пятом. На проводах про Громова сказал: «Неудобный. Но довёл».', when='!case_transferred'),
    vo('Мурашова задержали весной 1994-го в Твери — другие люди. Громова перевели на хозяйственные дела.', when='!sanction'),
    vo('Дело довела горпрокуратура. Громова перевели на хозяйственные дела.', when='sanction && case_transferred'),
    vo('Громов остался в Кунцеве. «Квартирные» дела теперь приносили ему первому.', when='!case_transferred'),
    jump('fin_journal'),
], filter_='archive_photo', season='winter')
# Журнал решений: три главных — Галина, Ковригин, операция; одной фразой, без оценки.
scene('fin_journal', 'b9_end', 'hod_t_moscow', lambda: [
    vo('Галине пообещали, что её имя не прозвучит, — и попросили опознать.', when='galina_promise_broken'),
    vo('Галине пообещали, что её имя не прозвучит, — и слово сдержали.', when='galina_trust && !galina_promise_broken'),
    vo('Галине сказали: «Это ваш долг», — и она уехала.', when='galina_leaving'),
    vo('С Галиной заговорили протоколом — и цепочка с двери так и не снялась.', when='galina_closed'),
    vo('К Галине так и не зашли.', when='!visited_galina'),
    vo('Ковригину пообещали, что он пойдёт свидетелем. Суд решил иначе.', when='kovrigin_deal'),
    vo('Ковригину ничего не обещали — и он ничего не сказал.', when='kovrigin_pressed'),
    vo('К Ковригину в среду не поехали.', when='!v3_kovrigin'),
    vo('Санкцию не дали — и брать было некого.', when='!sanction'),
    vo('У агентства ждали до полуночи — и взяли обоих порознь.', when='op_waited'),
    vo('Брали сразу — и пуля досталась Сайко.', when='oper_wounded'),
    vo('Брали сразу, без Сайко, — и Шмелёв ушёл дворами.', when='shmel_escaped'),
    jump('fin_2004', 'vhs_glitch'),
], filter_='archive_photo', season='winter')
scene('fin_2004', 'b9_end', 'hod_t_2004', lambda: [
    cap('lower_third', 'Андрей Громов, следователь. Запись 2004 года'),
    say('sledak_old', 'Мне до сих пор пишут внуки. Не про Мурашова — про бабушек. Спрашивают, какими они были. А я знаю только, какими были их бумаги.'),
    {'do': 'end', 'ending': 'e_early', 'when': '!sanction || case_transferred'},
    {'do': 'end', 'ending': 'e_variant', 'when': 'oper_wounded || case_strength < 5'},
    {'do': 'end', 'ending': 'e_canon'},
], filter_='vhs')

# ───────────────────────────── мини-игры ─────────────────────────────

_cur['scene'] = 'mg_flat_inspect'
def legacy_minigame(mid, outcomes, skip_as, **over):
    m = json.loads(json.dumps(OLD['minigames'][mid]))
    for k in ('assets',):
        m.pop(k, None)

    def keys(o):
        if isinstance(o, dict):
            for v in o.values():
                yield from keys(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys(v)
        elif isinstance(o, str) and o.startswith('ep01.mg_'):
            yield o
    for k in keys(m):
        RU[k] = OLD_RU[k]
    m['outcomes'] = outcomes
    m['skip'] = {'allowed': True, 'after_fails': 1, 'skip_counts_as': skip_as}
    m.update(over)
    return m


MG_DOCS = legacy_minigame('mg_docs', {'success': {'goto': 'd1_lens_ok'}, 'fail': {'goto': 'd1_lens_fail'}}, 'success')
# в пробе изъян один — дата (подпись в договоре в сюжет не входит); остальные поля — ложные следы
MG_DOCS['config'] = {**MG_DOCS['config'], 'discrepancies': [d for d in MG_DOCS['config']['discrepancies'] if d['field'] == 'date'],
                     'required': 1}
# Среда: та же сверка — свежим глазом (в понедельник не нашли) или впервые (договор достали во вторник).
MG_DOCS_D3 = legacy_minigame('mg_docs', {'success': {'goto': 'd3_lens_ok'}, 'fail': {'goto': 'd3_lens_fail'}}, 'success',
                             id='mg_docs_d3', config=MG_DOCS['config'])
MG_DB = legacy_minigame('mg_db', {'success': {'goto': 'bti_chain_ok', 'effects': [e('bti_chain', 'set', True), e('bti_six', 'set', True)], 'archive_unlock': 'n_bti'},
                                  'partial': {'goto': 'bti_chain_part', 'effects': [e('bti_chain', 'set', True)], 'archive_unlock': 'n_bti3'},
                                  'fail': {'goto': 'bti_chain_fail'}}, 'partial')
# Картотека в августе 1993-го: сделки до пятницы 6 августа, «шесть за лето» — с июня; сделка Зои Павловны есть всегда
# («ни одной карточки, кроме нашей» в bti_chain_fail), Молодогвардейская и Лапин — только у неё.
MG_DB['config'] = {**MG_DB['config'], 'dates': {'from': '1992-06-01', 'to': '1993-08-06'},
                   'target_dates': {'from': '1993-06-01', 'to': '1993-08-06'},
                   'fixed': [{'values': {'address': 'molodogvardeyskaya', 'notary': 'kovrigin', 'attorney': 'murashov_sv', 'buyer': 'lapin'},
                              'n': 34, 'date': '1993-06-28'}]}
RU['ep01.mg_docs.brief'] = 'Сравните доверенность и договор под лампой и отметьте поле, которое исправлено.'
RU.pop('ep01.mg_docs.hint.signature', None)  # подпись в договоре в пробе не изъян

# Доска Левиной (среда, вечер): на доске только найденное — узел с requires есть, только если переменная истинна, и связи
# с ним входят в «Связи: n из N» только вместе с ним. Лапины — приманка: покупатели, а не продавцы.
_cur['scene'] = 'mg_board'
BOARD_NODES = [  # (id, подпись, вид, requires)
    ('zoya', 'Зоя Павловна', 'person', None),
    ('flat_zoya', 'Квартира на Молодогвардейской', 'flat', None),
    ('notary', 'Нотариус Ковригин', 'person', None),
    ('murashov', 'Мурашов С. В.', 'person', None),
    ('buyer', 'Лапины, покупатели', 'person', None),
    ('volga', 'Серая «Волга»', 'property', 'volga_known'),
    ('driver', 'Водитель «Волги»', 'person', 'driver_known'),
    ('office', 'Агентство на Пресне', 'property', 'office_known'),
    ('deals', 'Сделки из картотеки БТИ', 'document', 'bti_chain'),
    ('pyotr', 'Пётр Ильич', 'person', 'second_victim'),
    ('flat_pyotr', 'Квартира на Хорошёвке', 'flat', 'second_victim'),
]
MG_BOARD = {
    'id': 'mg_board', 'type': 'evidence_board', 'beat': 'deduction',
    'title_key': key('title', 'Доска Левиной'),
    'brief_key': key('brief', 'Свяжите людей, квартиры и вещи. На доске только то, что вы нашли.'),
    'config': {
        'nodes': [{'id': nid, 'label_key': key(f'node.{nid}', label), 'kind': kind, **({'requires': req} if req else {})}
                  for nid, label, kind, req in BOARD_NODES],
        'required_links': [['zoya', 'flat_zoya'], ['flat_zoya', 'notary'], ['notary', 'murashov'], ['murashov', 'volga'],
                           ['volga', 'driver'], ['murashov', 'office'], ['deals', 'murashov'], ['pyotr', 'flat_pyotr'],
                           ['flat_pyotr', 'murashov']],
        'decoy_links': [['buyer', 'murashov'], ['buyer', 'notary']],
        'max_wrong_links': 3,
        'partial_threshold': 3,
    },
    'difficulty': 'normal',
    'skip': {'allowed': True, 'after_fails': 1, 'skip_counts_as': 'partial'},
    'outcomes': {'success': {'goto': 'd3_board_done', 'effects': [e('board_ok', 'set', True)]},
                 'partial': {'goto': 'd3_board_done'}, 'fail': {'goto': 'd3_board_done'}},
    'touch_ready': True,
}

# Допрос (пятница): пять утверждений Мурашова, каждое опровергает одна из двух улик — улика есть, только если её нашли.
# Заявление Галины и договор Лапиных — приманки: ничего не опровергают.
_cur['scene'] = 'mg_interrogation_hod'
IP_STATEMENTS = [  # (id, утверждение, улики)
    ('south', 'Зоя Павловна уехала к родственникам на юг. Сама мне так сказала.', ['ev_photo', 'ev_pills']),
    ('read', 'Доверенность она прочла сама и подписала при нотариусе.', ['ev_glasses', 'ev_read']),
    ('free', 'Я помогал старикам с бумагами бесплатно. По-соседски.', ['ev_lyuda', 'ev_deals']),
    ('shmel', 'Шмелёва я не знаю. Мало ли кто стоит у подъезда.', ['ev_driver', 'ev_shmel']),
    ('where', 'Где они сейчас — не знаю. Взрослые люди, уехали куда хотели.', ['ev_keys', 'ev_field']),
]
IP_EVIDENCE = [  # (id, подпись, requires)
    ('ev_photo', 'Фото внука из Самары', 'photo_seen'),
    ('ev_pills', 'Нитроглицерин на подоконнике', 'pills_found'),
    ('ev_glasses', 'Очки на футляре', 'glasses_found'),
    ('ev_read', 'Ковригин: доверенность читал Мурашов', 'murashov_read'),
    ('ev_lyuda', 'Люда: наличные Ковригину в стол', 'lyuda_talked'),
    ('ev_deals', 'Сделки из картотеки БТИ', 'bti_chain'),
    ('ev_driver', 'Водитель «Волги»', 'driver_known'),
    ('ev_shmel', 'Шмелёв: «Возил в лес»', 'accomplice_talks'),
    ('ev_keys', 'Ключи с бирками и паспорта', 'keys_found'),
    ('ev_field', 'Лесополоса под Апрелевкой', 'field_seen'),
    ('ev_statement', 'Заявление Галины', None),
    ('ev_contract', 'Договор Лапиных', None),
]
MG_INTERROGATION = {
    'id': 'mg_interrogation_hod', 'type': 'interrogation_press', 'beat': 'confrontation',
    'title_key': key('title', 'Допрос Мурашова'),
    'brief_key': key('brief', 'Предъявите улику против утверждения. Улики, которых вы не нашли, недоступны. Три ошибки — и он замолчит.'),
    'config': {
        'suspect': 'murashov',
        'statements': [{'id': f'st_{sid}', 'text_key': key(f'st.{sid}', text), 'contradicted_by': ev} for sid, text, ev in IP_STATEMENTS],
        'evidence': [{'id': eid, 'label_key': key(f'ev.{eid[3:]}', label), **({'requires': req} if req else {})}
                     for eid, label, req in IP_EVIDENCE],
        'full_threshold': 5, 'partial_threshold': 2, 'max_mistakes': 3,
    },
    'difficulty': 'hard',
    'skip': {'allowed': True, 'after_fails': 2, 'skip_counts_as': 'partial'},
    'outcomes': {'success': {'goto': 'd5_after', 'effects': [e('confession', 'set', 'full')]},
                 'partial': {'goto': 'd5_after', 'effects': [e('confession', 'set', 'partial')]},
                 'fail': {'goto': 'd5_after', 'effects': [e('confession', 'set', 'none')]}},
}

_cur['scene'] = 'mg_flat_inspect'
MINIGAMES = {
    'mg_docs': MG_DOCS,
    'mg_db': MG_DB,
    'mg_docs_d3': MG_DOCS_D3,
    'mg_board': MG_BOARD,
    'mg_interrogation_hod': MG_INTERROGATION,
    'mg_flat_inspect': {
        'id': 'mg_flat_inspect', 'type': 'crime_scene_search', 'beat': 'crime_scene',
        # Макет мини-игры (Figma 2026-10-13): заголовок — вопрос, под ним бриф и (из max_misses) «У вас всего 4 попытки…».
        'title_key': key('title', 'Что Зоя Павловна «оставила», уезжая на юг?'),
        'brief_key': key('brief', 'Лапины смотрят: копаться долго не дадут.'),
        'config': {
            'scene_bg': 'bg_hod_flat_inspect',
            # зоны — по кадру flat_inspect (рамки сверены на картинке); каждая находка открывает свой факт, а why — строка
            # экрана итога: что находка значит и что меняет дальше (только то, что делают её effects: сцены 409/411/412,
            # вопрос нотариусу c_*_ask, реплики Левиной в d1_eve_rest)
            'hotspots': [
                {'id': 'photo', 'rect': [0.1087, 0.3218, 0.0456, 0.1215], 'label_key': key('hs.photo', 'Фото внука за стеклом'),
                 'why_key': key('why.photo', 'У Зои Павловны один родственник — внук в Самаре. А Лапиным сказали, что она уехала к родне на юг. Громов спросит их об этом сразу.'),
                 'required': True, 'archive_unlock': 'n_photo', 'effects': [e('photo_seen', 'set', True)]},
                {'id': 'glasses', 'rect': [0.0898, 0.6169, 0.0781, 0.0718], 'label_key': key('hs.glasses', 'Её очки на футляре'),
                 'why_key': key('why.glasses', 'Без очков Зоя Павловна не читает — значит, доверенность подписала, не прочитав. У нотариуса появится вопрос: как она её прочла?'),
                 'required': True, 'archive_unlock': 'n_glasses', 'effects': [e('glasses_found', 'set', True)]},
                {'id': 'pills', 'rect': [0.7676, 0.4016, 0.0378, 0.0440], 'label_key': key('hs.pills', 'Таблетки на подоконнике'),
                 'why_key': key('why.pills', 'Нитроглицерин. Сердечница без него из дома не выходит — значит, на юг она не уезжала. Вечером это подтвердит Левина.'),
                 'required': False, 'archive_unlock': 'n_pills', 'effects': [e('pills_found', 'set', True)]},
            ],
            'max_misses': 4,
            'hint_after_misses': 2,
            'time_limit_ms': 0,
        },
        'difficulty': 'easy',
        'skip': {'allowed': True, 'after_fails': 1, 'skip_counts_as': 'partial'},
        'outcomes': {'success': {'goto': 'flat_inspect_done'}, 'partial': {'goto': 'flat_inspect_done'},
                     'fail': {'goto': 'flat_inspect_fail'}},
        'touch_ready': True,
    },
}

# ───────────────────────────── блокнот (архив) ─────────────────────────────

NOTES = [
    ('n_statement', 'document', 'Заявление Галины', None, 'doc_statement'),
    ('n_south', 'fact', 'Лапины: «уехала на юг»', 'Квартиру купили 28 июня у доверенного лица. Лапиным сказали, что хозяйка уехала к родственникам на юг. Сервант с посудой остался от неё.', None),
    ('n_contract', 'document', 'Договор купли-продажи', None, 'doc_contract_sale'),
    ('n_poa', 'document', 'Доверенность (копия)', 'ДОВЕРЕННОСТЬ. Город Москва, 14 июня 1993 г. Я, С. Зоя Павловна, проживающая по адресу: '
     'ул. Молодогвардейская, кв. 34, настоящей доверенностью уполномочиваю Мурашова Сергея Викторовича продать принадлежащую мне '
     'квартиру за цену и на условиях по своему усмотрению, получить причитающиеся мне деньги. Доверенность удостоверена нотариусом '
     'Ковригиным А. Н., зарегистрирована в реестре.', 'doc_power_of_attorney'),
    ('n_name', 'fact', 'Доверенное лицо: Мурашов С. В.', 'Квартиру Зои Павловны продавал по доверенности Мурашов Сергей Викторович.', None),
    ('n_cash', 'fact', 'Деньги — наличными у нотариуса', 'Посредник торопил Лапиных: расчёт наличными прямо в конторе Ковригина, в коридоре.', None),
    ('n_photo', 'photo', 'Фото внука', 'За стеклом серванта. На обороте карандашом: «Бабушке от внука. Самара». Родственник у неё один — внук в Самаре.', None),
    ('n_left', 'fact', 'Галина: ушла в конце июня', 'В конце июня Зоя Павловна вышла из дома с сумкой. Больше Галина её не видела.', None),
    ('n_sergei', 'fact', 'Галина: «Сергей Викторович»', 'Вежливый, «из газеты», три недели помогал Зое Павловне с бумагами. Приезжал на серой «Волге», ставил её под окнами Галины, не у подъезда.', None),
    ('n_last_seen', 'fact', 'Галина: в последний раз', 'В конце июня Зоя Павловна вышла с сумкой, в выходном плаще. Сказала: Сергей Викторович заедет, по бумагам. Больше её не видели.', None),
    ('n_register', 'fact', 'Реестр Ковригина', 'Запись о доверенности от 14 июня вписана другими чернилами, синее соседних строк. Ковригин: «техническая ошибка помощницы».', None),
    ('n_lyuda', 'fact', 'Помощница нотариуса', 'Люда: Сергей Викторович бывает раз в месяц, всегда со старушкой и без очереди; за срочность платит наличными Ковригину в стол.', None),
    ('n_vypiska', 'fact', 'ЖЭК: выписана 25 июня', 'Зою Павловну выписали 25 июня по заявлению доверенного лица. Сама она не приходила. Паспортистке он принёс шоколадку.', None),
    ('n_queue', 'fact', 'ЖЭК: он ходил в очередь', 'Всё лето вежливый мужчина крутился в очереди ЖЭКа, разговаривал со старушками и заполнял им справки.', None),
    ('n_card', 'document', 'Карточка БТИ', 'Молодогвардейская, кв. 34. Переход права: договор от 28.06.1993, нотариус Ковригин А. Н. Представитель продавца по доверенности: Мурашов С. В.', 'doc_bti_card'),
    ('n_bti3', 'fact', 'Три сделки за лето — и это не всё', 'Минимум три квартиры одиноких стариков: нотариус Ковригин, доверенное лицо Мурашов С. В. Досмотреть картотеку не дали.', None),
    ('n_bti', 'fact', 'Шесть сделок за лето', 'Шесть квартир одиноких стариков. Нотариус везде Ковригин, доверенное лицо везде Мурашов С. В.', None),
    ('n_date', 'fact', 'Дата в доверенности', 'Левина: последняя цифра даты переписана — четвёрка поверх единицы. Оговорки «исправленному верить» нет. Бумага с изъяном.', None),
    ('n_glasses', 'fact', 'Очки Зои Павловны', 'Остались дома, на серванте, на футляре. Без очков она не читает: доверенность подписывала, не прочитав.', None),
    ('n_pills', 'fact', 'Таблетки на подоконнике', 'Нитроглицерин. Сердечница без него из дома не выходит — на юг она не уезжала.', None),
    ('n_read', 'fact', 'Доверенность ей читал Мурашов', 'Ковригин: бабушка была без очков, текст ей зачитал доверенный — сам Мурашов. «По закону можно».', None),
    ('n_call', 'fact', 'Лапины звонили нотариусу', 'Посредник велел Лапиным звонить нотариусу, если придут из милиции. Нотариус и посредник — одна связка.', None),
    # дни 3–5
    ('n_address', 'fact', 'Прописка Мурашова', 'Мурашов Сергей Викторович, 1955 года рождения. Прописан в Чертанове.', None),
    ('n_volga', 'fact', '«Волга» Мурашова', 'Серая «Волга» записана на Мурашова С. В. Номер пробил Сайко.', None),
    ('n_irina', 'fact', 'Ирина: звонил Сергей Викторович', 'Мурашов звонил Лапиным: велел молчать, обещал вернуть деньги, если всё будет тихо. Он знает, что его ищут.', None),
    ('n_pyotr', 'fact', 'Пётр Ильич, 79 лет', 'Хорошёвка, вторая квартира из картотеки. Токарь на пенсии. «Уехал к сестре в Краснодар» в июле — а сестры нет в живых десять лет.', None),
    ('n_driver', 'fact', 'Клавдия Семёновна: водитель', 'Петра Ильича увезли в июле на серой «Волге». Рядом сидел вежливый, при галстуке, за рулём — здоровый, стриженый.', None),
    ('n_klava', 'fact', 'Заявление о пропаже', 'Клавдия Семёновна написала заявление о пропаже Петра Ильича. Это основание для дела.', None),
    ('n_office', 'fact', 'Агентство на Пресне', 'Мурашов живёт за городом, а работает в агентстве недвижимости на Пресне — в бывшей редакции газеты. У входа его «Волга».', None),
    ('n_seen', 'fact', 'Мурашов в лицо', 'Громов зашёл в агентство под видом покупателя: вежливый, бесцветный. Мурашов запомнил лицо.', None),
    ('n_watch', 'fact', 'Расписание Мурашова', 'В шесть он уходит из агентства, в полночь водитель везёт его за город и возвращается один. Брать можно порознь.', None),
    ('n_kovrigin', 'fact', 'Показания Ковригина', 'Под протокол: доверенности старикам читал вслух Мурашов, даты других сделок — в реестре. Ковригину обещано, что он пойдёт свидетелем.', None),
    ('n_shmel', 'fact', 'Шмелёв Дмитрий («Шмель»)', 'Водитель Мурашова. Тридцать четыре года, дважды судим.', None),
    ('n_sanction', 'fact', 'Санкция на задержание', 'Палыч подписал санкцию на задержание Мурашова.', None),
    ('n_ident', 'fact', 'Опознание', 'Мурашова опознали по фото из паспортного стола.', None),
    ('n_shmel_talks', 'fact', 'Шмелёв: «Возил в лес»', '«Я только возил. Возил в лес». Место показал сам.', None),
    ('n_keys', 'fact', 'Ключи с бирками', 'При обыске: ключи от чужих квартир с бирками, адреса его рукой; паспорта стариков; сумка Зои Павловны.', None),
    ('n_field', 'fact', 'Лесополоса под Апрелевкой', 'Место показал Шмелёв.', None),
]
ARCHIVE = []
_cur['scene'] = 'note'
for nid, kind, title, text, asset in NOTES:
    item = {'id': nid, 'kind': kind, 'title_key': key(f'{nid}.title', title)}
    if text:
        item['text_key'] = key(f'{nid}.text', text)
    elif nid == 'n_statement':
        item['text_key'] = 'ep01.h.d1_office.doc_doc_statement'
    elif nid == 'n_contract':
        item['text_key'] = 'ep01.h.flat_formal.doc_doc_contract_sale'
    if asset:
        item['asset'] = asset
    ARCHIVE.append(item)

# ───────────────────────────── эпизод ─────────────────────────────

CAST_KEEP = ['sledak', 'oper', 'expert', 'boss', 'neighbor', 'buyer', 'lapin_wife', 'notary', 'clerk', 'zoya', 'murashov_sil',
             'murashov', 'accomplice', 'sledak_old']
cast = []
for c in OLD['cast']:
    if c['id'] in CAST_KEEP:
        d = {k: v for k, v in c.items() if k != 'sprite_set'}  # кадры вместо спрайтов: старые спрайты — в зимней одежде
        cast.append(d)
        RU[c['name_key']] = OLD_RU[c['name_key']]
        if c.get('short_name_key'):
            RU[c['short_name_key']] = OLD_RU[c['short_name_key']]
RU['ep01.cast.neighbor'] = 'Галина'
cast += [
    {'id': 'assistant', 'name_key': 'ep01.cast.assistant', 'role': 'witness', 'name_color': '#b7b1a6'},
    {'id': 'passport_clerk', 'name_key': 'ep01.cast.passport_clerk', 'role': 'extra', 'name_color': '#b7b1a6'},
    {'id': 'klava', 'name_key': 'ep01.cast.klava', 'role': 'witness', 'name_color': '#b7b1a6'},
    {'id': 'landlady', 'name_key': 'ep01.cast.landlady', 'role': 'extra', 'name_color': '#b7b1a6'},
]
RU['ep01.cast.klava'] = 'Клавдия Семёновна'
RU['ep01.cast.landlady'] = 'Хозяйка квартиры'
RU['ep01.cast.assistant'] = 'Люда, помощница нотариуса'
RU['ep01.cast.passport_clerk'] = 'Паспортистка'
# Окно реплики (макет в Figma, 2026-10-13): портрет у имени и подпись под ним — роль в истории, без спойлеров.
# Портреты — вырезки из летних кадров эпизода (tools/hod/portraits.py). Должность из имени ушла в подпись.
TITLES = {
    'sledak': 'следователь прокуратуры', 'oper': 'оперуполномоченный, МУР', 'expert': 'эксперт-криминалист',
    'boss': 'начальник следственного отдела', 'notary': 'нотариус', 'assistant': 'помощница нотариуса',
    'neighbor': 'соседка', 'buyer': 'покупатель', 'lapin_wife': 'покупательница', 'clerk': 'архив БТИ',
    'passport_clerk': 'ЖЭК', 'zoya': 'пенсионерка', 'murashov_sil': 'посетитель',
    'murashov': 'посредник по сделкам с жильём', 'accomplice': 'водитель Мурашова', 'sledak_old': 'запись 2004 года',
    'klava': 'соседка Петра Ильича', 'landlady': 'Чертаново',
}
for c in cast:
    c['title_key'] = f"ep01.cast.{c['id']}_title"
    if HAS(f"assets/ep01/portraits/{c['id']}.webp"):  # новых лиц (Мурашов, Шмелёв, соседка) ещё нет — без портрета
        c['portrait'] = f"assets/ep01/portraits/{c['id']}.webp"
    RU[c['title_key']] = TITLES[c['id']]
RU['ep01.cast.notary'] = 'Ковригин'
RU['ep01.cast.assistant'] = 'Люда'
RU['ep01.cast.clerk'] = 'Раиса Львовна'
RU['ep01.title'] = OLD_RU['ep01.title']
RU['ep01.logline'] = 'Август 1993-го. Пенсионеры пропадают, их квартиры проданы по чистым бумагам. Следователь Громов ведёт дело сам: куда ехать, кого спрашивать, чему верить.'
RU['ep01.h.end.canon'] = 'Дело закрыто'
RU['ep01.h.end.variant'] = 'Цена вопроса'
RU['ep01.h.end.early'] = 'Дело передано'
for b, t in (('b1_day1', 'День первый'), ('b3_day2', 'День второй'), ('b4_night', 'Версия'), ('br_recon', 'Реконструкция'),
             ('b5_day3', 'День третий'), ('b6_board', 'Доска'), ('b7_op', 'Операция'), ('b8_friday', 'Допрос'), ('b9_end', 'Развязка')):
    RU[f'ep01.h.block.{b}'] = t

V = lambda t, d, doc, **kw: {'type': t, 'default': d, 'doc': doc, **kw}  # noqa: E731
variables = {
    'trust_oper': OLD['variables']['trust_oper'], 'boss_favor': OLD['variables']['boss_favor'],
    'gromov_rep': OLD['variables']['gromov_rep'],
    'day': V('int', 1, 'День следствия.', min=1, max=6), 'slot': V('int', 0, 'Сколько мест отработано за день.', min=0, max=3),
    'last_place': V('string', '', 'Где были только что (реплика Сайко в машине).'),
    'nerves': V('int', 3, 'Самообладание Громова на ночном разборе версии (шкала дедукции): неверный ход — минус один, '
                'ниже нуля не падает; меняет реплику Левиной.', min=0, max=3),
}
for b, doc_ in [('visited_flat', 'Были в квартире у Лапиных.'), ('visited_galina', 'Говорили с Галиной.'), ('visited_notary', 'Были у нотариуса.'),
                ('visited_zhek', 'Были в паспортном столе ЖЭКа.'), ('visited_bti', 'Были в архиве БТИ.'),
                ('have_contract', 'Копия договора и доверенности у следователя.'), ('know_name', 'Фамилия доверенного известна.'),
                ('lapins_told_truth', 'Лапиным сказали, что сделку могут признать недействительной.'),
                ('photo_seen', 'Фото внука найдено.'), ('photo_later', 'Фото оставили до понятых.'),
                ('glasses_found', 'При осмотре нашли очки Зои Павловны.'), ('pills_found', 'При осмотре нашли её таблетки.'),
                ('galina_open', 'Галина рассказала всё.'), ('galina_closed', 'С Галиной заговорили протоколом.'),
                ('galina_trust', 'Галине обещали, что её имя не прозвучит.'), ('galina_leaving', 'Галина собирается уехать к дочери.'),
                ('notary_alarmed', 'Нотариус встревожен и жалуется.'),
                ('lyuda_talked', 'Помощница нотариуса рассказала про Сергея Викторовича.'), ('lyuda_gone', 'Помощницу отправили в отпуск.'),
                ('case_opened', 'Уголовное дело возбуждено.'), ('bti_chain', 'В картотеке БТИ найдены сделки Ковригина и Мурашова.'), ('bti_six', 'Найдены все шесть сделок.'),
                ('version_weak', 'Версия сложена наполовину догадками.'),
                # дни 3–5
                ('lens_tried', 'Лупа в понедельник изъяна не нашла (в среду — «свежим глазом»).'),
                ('murashov_read', 'Известно, что доверенность старухе читал вслух сам Мурашов.'),
                ('volga_known', '«Волга» Мурашова известна.'), ('driver_known', 'Водителя описали, видели или назвали.'),
                ('shmel_named', 'Водитель известен по имени — Шмелёв.'), ('office_known', 'Агентство Мурашова на Пресне известно.'),
                ('office_watched', 'За агентством следили с Сайко: расписание известно.'),
                ('murashov_spooked', 'Мурашов знает, что его ищут (Лапины или визит под видом покупателя): ждать нельзя.'),
                ('second_victim', 'Были во второй квартире — у Петра Ильича.'), ('klava_statement', 'Заявление о пропаже Петра Ильича.'),
                ('kovrigin_deal', 'Ковригин дал показания за обещание «пойдёте свидетелем».'),
                ('kovrigin_pressed', 'Ковригина давили явкой — он молчит, вторая жалоба.'),
                ('kovrigin_retracted', 'На очной ставке Ковригин отказался от показаний.'),
                ('v3_third', 'Третье место среды отработано.'), ('v3_address', 'Были по адресу Мурашова.'), ('v3_kovrigin', 'Были у Ковригина в среду.'),
                ('board_ok', 'Доска сошлась целиком.'), ('sanction', 'Санкция на задержание есть.'), ('identified', 'Мурашова опознали.'),
                ('galina_promise_broken', 'Галину попросили опознать вопреки обещанию.'),
                ('oper_wounded', 'Сайко ранен при задержании.'), ('accomplice_talks', 'Шмелёв заговорил.'),
                ('shmel_escaped', 'Шмелёв ушёл при задержании.'), ('op_waited', 'У агентства ждали и взяли порознь.'),
                ('keys_found', 'При обыске нашли ключи и паспорта.'), ('field_seen', 'Лесополоса под Апрелевкой.'),
                ('case_transferred', 'Дело ушло в горпрокуратуру.')]:
    variables[b] = V('bool', False, doc_)
variables['oper_with'] = V('bool', True, 'Сайко работает с Громовым; с среды — только если пробил «Волгу» (доверие ≥ 1).')
variables['third'] = V('string', '', 'Третье место среды: second — вторая квартира; flat, galina, zhek, bti — место пробы, до которого не доехали.')
variables['confession'] = V('string', 'none', 'Итог допроса: none | partial | full.')
variables['case_strength'] = V('int', 0, 'Сила дела (§6): восемь пунктов, считается в пятницу вечером.', min=0, max=8)

blocks = [
    {'id': 'b1_day1', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd1_office', 'title_key': 'ep01.h.block.b1_day1', 'music': 'm_investigation', 'season': 'summer', 'act': 1},
    {'id': 'bp_places', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'route', 'season': 'summer', 'act': 1},
    {'id': 'b2_evening', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd1_evening', 'season': 'summer', 'act': 1},
    {'id': 'b3_day2', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd2_office', 'title_key': 'ep01.h.block.b3_day2', 'season': 'summer', 'act': 2, 'ad_break_allowed': True},
    {'id': 'b4_night', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd2_night', 'title_key': 'ep01.h.block.b4_night', 'season': 'summer', 'act': 2},
    {'id': 'br_recon', 'type': 'crime', 'presentation': 'reconstruction', 'entry_scene': 'recon', 'title_key': 'ep01.h.block.br_recon', 'season': 'summer', 'act': 2},
    {'id': 'b5_day3', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd3_office', 'title_key': 'ep01.h.block.b5_day3', 'season': 'summer', 'act': 2, 'ad_break_allowed': True},
    {'id': 'b6_board', 'type': 'breakthrough', 'presentation': 'procedural', 'entry_scene': 'd3_evening', 'title_key': 'ep01.h.block.b6_board', 'season': 'summer', 'act': 2},
    {'id': 'b7_op', 'type': 'pursuit', 'presentation': 'procedural', 'entry_scene': 'd4_office', 'title_key': 'ep01.h.block.b7_op', 'season': 'summer', 'act': 3, 'ad_break_allowed': True},
    {'id': 'b8_friday', 'type': 'confrontation', 'presentation': 'procedural', 'entry_scene': 'd5_morning', 'title_key': 'ep01.h.block.b8_friday', 'season': 'summer', 'act': 3},
    {'id': 'b9_end', 'type': 'epilogue', 'presentation': 'chronicle', 'entry_scene': 'fin_zoya', 'title_key': 'ep01.h.block.b9_end', 'act': 3},
]
for b in blocks:
    b['scenes'] = [sid for sid, s in SCENES.items() if s['block'] == b['id']]

keep = lambda kind, ids: [a for a in OLD['assets'][kind] if a['id'] in ids]  # noqa: E731
episode = {
    'schema_version': 1, 'id': EP_ID, 'season': 1, 'order': 1, 'title_key': 'ep01.title', 'logline_key': 'ep01.logline',
    'archetype': OLD['archetype'], 'template': OLD['template'], 'based_on': OLD['based_on'],
    'frame': {**OLD['frame'], 'editorial_layer': False},
    'content_warnings': OLD['content_warnings'], 'age_rating': OLD['age_rating'], 'estimated_minutes': 45,
    'localization': OLD['localization'],
    'cast': cast, 'variables': variables, 'blocks': blocks, 'scenes': SCENES, 'minigames': MINIGAMES,
    'endings': [
        {'id': 'e_canon', 'title_key': 'ep01.h.end.canon', 'kind': 'canonical'},
        {'id': 'e_variant', 'title_key': 'ep01.h.end.variant', 'kind': 'variant'},
        {'id': 'e_early', 'title_key': 'ep01.h.end.early', 'kind': 'early'},
    ],
    'archive_items': ARCHIVE,
    'assets': {
        'backgrounds': BACKGROUNDS, 'sprites': [], 'cg': [], 'shots': SHOTS,
        # Настоящие бумаги лета 1993-го (tools/hod/docs.py): текст впечатан в картинку, пока только по-русски.
        'documents': [{'id': f'doc_{name}', 'path': f'assets/ep01/hod/docs/ru/{name}.webp', 'localized': True, 'notes': note}
                      for name, note in (('statement', 'заявление Галины от руки на тетрадном листе, штамп входящей прокуратуры'),
                                         ('power_of_attorney', 'ксерокопия доверенности; в дате «4» поверх стёртой «1»'),
                                         ('contract_sale', 'договор купли-продажи, экземпляр Лапиных'),
                                         ('bti_card', 'учётная карточка БТИ из картотеки'))],
        'music': keep('music', {'m_theme_main', 'm_investigation', 'm_calm', 'm_tension', 'm_chronicle', 'm_epilogue'}),
        'sfx': keep('sfx', {'sfx_phone_ring', 'sfx_vhs', 'sfx_shot'}),
        'ambient': keep('ambient', {'amb_office', 'amb_stairwell', 'amb_street_day', 'amb_archive', 'amb_street_night'}),
        'budget_mb': 30,
    },
}

out = os.path.join(ROOT, 'episodes/s1', f'{EP_ID}.json')
json.dump(episode, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open(out, 'a', encoding='utf-8').write('\n')
for lang in ('ru', 'en', 'es', 'pt'):
    p = os.path.join(ROOT, 'locales', lang, f'{EP_ID}.json')
    prev = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    data = collections.OrderedDict((k, v if lang == 'ru' else prev.get(k, '')) for k, v in RU.items())
    json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(p, 'a', encoding='utf-8').write('\n')
words = sum(len(v.split()) for k, v in RU.items() if '.l' in k or 'doc_' in k)
print(f'{EP_ID}: сцен {len(SCENES)}, кадров {len(SHOTS)}, строк ru {len(RU)}, слов в репликах ≈ {words}')
