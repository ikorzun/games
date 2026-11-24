#!/usr/bin/env python3
"""Список вещей памяти: всё, что игрок встречает как вещь-воспоминание, одним документом.

Источники: цепочки мест (src/systems/session.ts), слоты канона (src/systems/koma.ts), строки (locales/ru/ui.json).
Запуск из папки vylazka:  python3 tools/koma/memory_things.py  →  ../docs/vylazka/koma/memory_things.md
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
session = (ROOT / 'src/systems/session.ts').read_text(encoding='utf-8')
koma = (ROOT / 'src/systems/koma.ts').read_text(encoding='utf-8')
ru = json.loads((ROOT / 'locales/ru/ui.json').read_text(encoding='utf-8'))

PLACES = [
    ('SHELTER_CHAIN', 'Убежище', 'дом, в котором все ушли спать вниз'),
    ('OFFICE_CHAIN', 'Офис', 'работа, из которой не вышел'),
    ('YELLOW_CHAIN', 'Жёлтые комнаты', 'тот же этаж, из которого всё вынесли'),
    ('STATION_MEMORIES', 'Зал ожидания', 'время идёт, пока идёшь'),
]
SLOT_ROLE = {
    'LP01': 'одна вещь — две несовместимые жизни', 'LP02': 'чужой билет: маршрут и дата разных людей', 'LP03': 'жест не доказывает владельца',
    'LP04': '«моя семья», которой не было', 'LP05': 'время известно, история — нет', 'LP06': 'фраза посетителя бюро',
    'LP07': 'один из сотен сданных ключей', 'LP08': 'журнал бюро, почерк героя', 'LP09': 'бейдж сотрудника — работа героя',
    'LP10': '«доказательство», которое ничего не доказывает', 'LP11': 'личные вещи героя', 'LP13': 'безупречно восстановленная биография',
    'LP14': 'настоящий билет героя, неиспользованный',
}
slot_of = dict(re.findall(r"^\s+(\w+): '(LP\d\d)',", koma, re.M))


def chain(name: str):
    body = re.search(rf"export const {name}: readonly MemoryDef\[\] = \[(.*?)\];", session, re.S).group(1)
    return re.findall(r"\{ id: '(\w+)', thing: '(\w+)', rooms: \['(\w+)'\] \}", body)


out = [
    '# Вещи памяти: всё, что игрок встречает как вещь-воспоминание',
    '',
    'Собрано скриптом `vylazka/tools/koma/memory_things.py` из кода и русских строк игры (слова партнёра 24.11: «вынести отдельно',
    'все вещи, которые игрок встречает как объекты памяти»). Руками не править: изменить вещь или строку — в игре, потом',
    'перезапустить скрипт. Порядок в каждом месте — порядок цепочки: вещи приходят по одной и по кругу.',
    '',
    'У каждой вещи: **как зовётся** на экране (и на бирке), **вспышка** — строка, с которой она приходит, **вспомнил** — первая',
    'ассоциация героя (в сюжете KOMA это его выдумка), **слот канона**, что **дописывает Смотритель** в графе «владелец» и что о вещи',
    '**известно точно** (карточка за «не подтверждено»). Прочерк — у вещи нет своей строки, идёт общая.',
    '',
]
total = 0
kinds = {}
for const, place, about in PLACES:
    out += [f'## {place} — {about}', '']
    for n, (mem, kind, room) in enumerate(chain(const), 1):
        total += 1
        kinds.setdefault(kind, []).append(f'{place}: {ru.get(f"mem.{mem}.task", mem)}')
        slot = slot_of.get(mem)
        key = slot.lower() if slot else None
        out += [
            f'### {n}. {ru.get(f"mem.{mem}.task", mem)} · `{mem}`',
            '',
            f'- модель: `{kind}`; комната: `{room}`',
            f'- вспышка: «{ru.get(f"mem.{mem}.flash", "—")}»',
            f'- вспомнил: «{ru.get(f"mem.{mem}.done", "—")}»',
            f'- слот канона: {f"`{slot}` — {SLOT_ROLE.get(slot, "")}" if slot else "нет (вещь места, в сюжете — «невостребованное»)"}',
            f'- дописывает Смотритель: «{ru.get(f"koma.owner.{key}") if key and f"koma.owner.{key}" in ru else ru["koma.owner.other"]}»',
            f'- известно точно: «{ru.get(f"koma.fact.{key}") if key and f"koma.fact.{key}" in ru else ru["koma.fact.other"]}»',
            '',
        ]
shared = {k: v for k, v in kinds.items() if len(v) > 1}
out += ['## Одна модель — в двух местах', '', 'Места связаны не порядком, а вещами: та же вещь встречается в другом месте под другим именем.', '']
out += [f'- `{k}`: {"; ".join(v)}' for k, v in sorted(shared.items())]
out += ['', f'Всего вещей памяти: {total}; разных моделей: {len(kinds)}; со слотом канона: {sum(1 for c, _, _ in PLACES for m, _, _ in chain(c) if m in slot_of)}.', '']
dst = ROOT.parent / 'docs/vylazka/koma/memory_things.md'
dst.write_text('\n'.join(out), encoding='utf-8')
print(f'{dst.relative_to(ROOT.parent)}: вещей {total}, моделей {len(kinds)}')
