"""build.py: «Ход следствия», дни 1–2 (docs/season1/ep01-hod.md) → episodes/s1/ep01_hod.json и locales/*/ep01_hod.json.

Игрок — Громов: решает, куда ехать (в день два места из трёх-четырёх; всё не успеть), как говорить с людьми (они
помнят), что предъявить; ночью второго дня сам излагает версию картами из блокнота; верная версия открывает
реконструкцию в формате передачи. Кадры — черновые генерации tools/hod/shots.py (сеты hod_*), без старых спрайтов.

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


def show(who, position='center'):
    return {'do': 'show', 'who': who, 'position': position}


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


def jump(scene, transition=None):
    st = {'do': 'jump', 'scene': scene}
    if transition:
        st['transition'] = transition
    return st


def branch(cases, default):
    return {'do': 'branch', 'cases': [{'when': w, 'goto': g} for w, g in cases], 'default': default}


def opt(oid, text, goto, effects=(), when=None, hidden=True, item=None, verdict=None):
    return dict(oid=oid, text=text, goto=goto, effects=list(effects), when=when, hidden=hidden, item=item, verdict=verdict)


def choice(cid, prompt, kind, options, when=None, penalty=None):
    st = {'do': 'choice', 'id': cid, 'kind': kind, 'prompt_key': key(f'{cid}.prompt', prompt), 'options': []}
    if when:
        st['when'] = when
    if penalty:
        st['penalty'] = penalty
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


def scene(sid, block, set_, steps_fn, time='day', music=None, ambient=None):
    _cur['scene'], _cur['n'] = sid, 0
    steps = steps_fn()
    s = {'id': sid, 'block': block, 'stage': {'bg': BG[set_], 'time_of_day': time}, 'coverage': set_, 'steps': steps}
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
SHOTS, BACKGROUNDS = [], []
for p in PLAN:
    if p['kind'] in ('doc', 'search'):  # бланк и фон мини-игры осмотра — не кадры покрытия
        continue
    kind = 'wide' if p['set'] in AUX_SETS else p['kind']
    sh = {'id': f'sh_{p["id"]}', 'set': p['set'], 'bg': f'bg_{p["set"]}', 'kind': kind, 'angle': 'eye',
          'cast': [] if p['kind'] == 'insert' else [{'who': w} for w in p['cast']], 'file': FILE(p['id'], p['set'])}
    if p['id'] in OTS:
        sh['from'], sh['focus'] = OTS[p['id']]
    SHOTS.append(sh)
# Контора без помощницы: тот же кадр через плечо на Ковригина (на нём Люды не видно).
SHOTS.append({'id': 'sh_notary_alone_ots', 'set': 'hod_notary_alone', 'bg': 'bg_hod_notary_alone', 'kind': 'ots', 'angle': 'eye',
              'cast': [{'who': 'notary'}, {'who': 'sledak'}], 'from': 'sledak', 'focus': 'notary',
              'file': FILE('notary_ots_notary', 'hod_notary')})
# Фон мини-игры «Осмотр квартиры»: стена Зои Павловны крупно, три улики врозь, людей нет.
BACKGROUNDS.append({'id': 'bg_hod_flat_inspect', 'path': FILE('flat_inspect', 'hod_flat_inspect'), 'season': 'indoor',
                    'notes': 'черновой кадр осмотра (лето 1993-го): фото внука, очки на футляре, таблетки на подоконнике'})
for set_, wide in WIDE_OF.items():
    BG[set_] = f'bg_{set_}'
    wide_set = next(p['set'] for p in PLAN if p['id'] == wide)
    BACKGROUNDS.append({'id': f'bg_{set_}', 'path': FILE(wide, wide_set), 'season': 'summer' if 'car' in set_ else 'indoor',
                        'notes': f'черновой общий план {wide} (лето 1993-го)'})

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
    branch([('slot >= 2 && day == 1', 'd1_evening'), ('slot >= 2 && day == 2', 'd2_night')], 'route_car'),
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
        unlock('n_read'),
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
    say('clerk', 'Вот в четверг и приходи, милый. По средам не принимаем.'),
    inner('Четверг. До пятницы останется один день.'),
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
    jump('proto_end', 'vhs_glitch'),
], time='day', music='m_chronicle')
scene('proto_end', 'b4_night', 'hod_office_night', lambda: [
    show('sledak', 'left'), show('expert', 'center'), show('oper', 'right'),
    say('oper', 'Толик, привет, это Сайко. Пробей мне Мурашова Сергея Викторовича: машина на нём есть? …«Волга»? Серая? Номер диктуй.', when='trust_oper >= 1'),
    inner('Серая «Волга» под окнами Галины. Сергей Викторович. Мурашов. Сходится.', when='trust_oper >= 1 && galina_open'),
    inner('«Волга», серая. Осталось найти, кто её видел у дома Зои Павловны.', when='trust_oper >= 1 && !galina_open'),
    say('oper', 'Всё, юрист, я спать. Мурашова своего завтра сам пробивай — у меня в МУРе четыре дела своих.', when='trust_oper == 0'),
    inner('Завтра, похоже, начну без него.', when='trust_oper == 0'),
    inner('До пятницы три дня.'),
    vo('Конец пробы. Дальше — день третий.'),  # строкой, а не плашкой главы: плашка наезжает на экран финала
    {'do': 'end', 'ending': 'e_proto'},
], time='night')

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

MINIGAMES = {
    'mg_docs': MG_DOCS,
    'mg_db': MG_DB,
    'mg_flat_inspect': {
        'id': 'mg_flat_inspect', 'type': 'crime_scene_search', 'beat': 'crime_scene',
        'title_key': key('title', 'Осмотр квартиры'),
        'brief_key': key('brief', 'Что Зоя Павловна «оставила», уезжая на юг? Лапины смотрят: копаться долго не дадут.'),
        'config': {
            'scene_bg': 'bg_hod_flat_inspect',
            # зоны — по кадру flat_inspect (рамки сверены на картинке); каждая находка открывает свой факт
            'hotspots': [
                {'id': 'photo', 'rect': [0.1087, 0.3218, 0.0456, 0.1215], 'label_key': key('hs.photo', 'Фото внука за стеклом'),
                 'required': True, 'archive_unlock': 'n_photo', 'effects': [e('photo_seen', 'set', True)]},
                {'id': 'glasses', 'rect': [0.0898, 0.6169, 0.0781, 0.0718], 'label_key': key('hs.glasses', 'Её очки на футляре'),
                 'required': True, 'archive_unlock': 'n_glasses', 'effects': [e('glasses_found', 'set', True)]},
                {'id': 'pills', 'rect': [0.7676, 0.4016, 0.0378, 0.0440], 'label_key': key('hs.pills', 'Таблетки на подоконнике'),
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

CAST_KEEP = ['sledak', 'oper', 'expert', 'boss', 'neighbor', 'buyer', 'lapin_wife', 'notary', 'clerk', 'zoya', 'murashov_sil']
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
]
RU['ep01.cast.assistant'] = 'Люда, помощница нотариуса'
RU['ep01.cast.passport_clerk'] = 'Паспортистка'
RU['ep01.title'] = OLD_RU['ep01.title']
RU['ep01.logline'] = 'Август 1993-го. Пенсионеры пропадают, их квартиры проданы по чистым бумагам. Следователь Громов ведёт дело сам: куда ехать, кого спрашивать, чему верить.'
RU['ep01.h.end.proto'] = 'Версия есть'
for b, t in (('b1_day1', 'День первый'), ('b3_day2', 'День второй'), ('b4_night', 'Версия'), ('br_recon', 'Реконструкция')):
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
                ('version_weak', 'Версия сложена наполовину догадками.')]:
    variables[b] = V('bool', False, doc_)

blocks = [
    {'id': 'b1_day1', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd1_office', 'title_key': 'ep01.h.block.b1_day1', 'music': 'm_investigation', 'season': 'summer', 'act': 1},
    {'id': 'bp_places', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'route', 'season': 'summer', 'act': 1},
    {'id': 'b2_evening', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd1_evening', 'season': 'summer', 'act': 1},
    {'id': 'b3_day2', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd2_office', 'title_key': 'ep01.h.block.b3_day2', 'season': 'summer', 'act': 2, 'ad_break_allowed': True},
    {'id': 'b4_night', 'type': 'investigation', 'presentation': 'procedural', 'entry_scene': 'd2_night', 'title_key': 'ep01.h.block.b4_night', 'season': 'summer', 'act': 2},
    {'id': 'br_recon', 'type': 'crime', 'presentation': 'reconstruction', 'entry_scene': 'recon', 'title_key': 'ep01.h.block.br_recon', 'season': 'summer', 'act': 2},
]
for b in blocks:
    b['scenes'] = [sid for sid, s in SCENES.items() if s['block'] == b['id']]

keep = lambda kind, ids: [a for a in OLD['assets'][kind] if a['id'] in ids]  # noqa: E731
episode = {
    'schema_version': 1, 'id': EP_ID, 'season': 1, 'order': 1, 'title_key': 'ep01.title', 'logline_key': 'ep01.logline',
    'archetype': OLD['archetype'], 'template': OLD['template'], 'based_on': OLD['based_on'],
    'frame': {**OLD['frame'], 'editorial_layer': False},
    'content_warnings': OLD['content_warnings'], 'age_rating': OLD['age_rating'], 'estimated_minutes': 15,
    'localization': OLD['localization'],
    'cast': cast, 'variables': variables, 'blocks': blocks, 'scenes': SCENES, 'minigames': MINIGAMES,
    'endings': [
        {'id': 'e_proto', 'title_key': 'ep01.h.end.proto', 'kind': 'canonical'},
    ],
    'archive_items': ARCHIVE,
    'assets': {
        'backgrounds': BACKGROUNDS, 'sprites': [], 'cg': [], 'shots': SHOTS,
        'documents': [{'id': 'doc_statement', 'path': 'assets/ep01/hod/docs/statement.webp', 'localized': False,
                       'notes': 'бланк в линейку без текста; текст заявления — слой из локали'}] +
                     keep('documents', {'doc_contract_sale', 'doc_bti_card', 'doc_power_of_attorney'}),
        'music': keep('music', {'m_theme_main', 'm_investigation', 'm_calm', 'm_tension', 'm_chronicle'}),
        'sfx': keep('sfx', {'sfx_phone_ring', 'sfx_vhs'}),
        'ambient': keep('ambient', {'amb_office', 'amb_stairwell', 'amb_street_day', 'amb_archive'}),
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
