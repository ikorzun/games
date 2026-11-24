#!/usr/bin/env python3
"""Страница «Вещи памяти» с картинками (слова партнёра 24.11, квиз: «Страница с картинками»).

Данные — те же, что у memory_things.py; картинки — кадры вещей из игры (папка с <вид>.png, 1280×720).
Запуск из папки vylazka:  python3 tools/koma/memory_page.py <папка с кадрами> <куда.html>
"""
import base64
import html
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
shots, dst = Path(sys.argv[1]), Path(sys.argv[2])
session = (ROOT / 'src/systems/session.ts').read_text(encoding='utf-8')
koma = (ROOT / 'src/systems/koma.ts').read_text(encoding='utf-8')
ru = json.loads((ROOT / 'locales/ru/ui.json').read_text(encoding='utf-8'))
PLACES = [('SHELTER_CHAIN', 'Убежище', 'дом, в котором все ушли спать вниз'), ('OFFICE_CHAIN', 'Офис', 'работа, из которой не вышел'), ('YELLOW_CHAIN', 'Жёлтые комнаты', 'тот же этаж, из которого всё вынесли'), ('STATION_MEMORIES', 'Зал ожидания', 'время идёт, пока идёшь')]
ROLE = {'LP01': 'одна вещь — две несовместимые жизни', 'LP02': 'чужой билет: маршрут и дата разных людей', 'LP03': 'жест не доказывает владельца', 'LP04': '«моя семья», которой не было', 'LP05': 'время известно, история — нет', 'LP06': 'фраза посетителя бюро', 'LP07': 'один из сотен сданных ключей', 'LP08': 'журнал бюро, почерк героя', 'LP09': 'бейдж сотрудника — работа героя', 'LP10': '«доказательство», которое ничего не доказывает', 'LP11': 'личные вещи героя', 'LP13': 'безупречно восстановленная биография', 'LP14': 'настоящий билет героя, неиспользованный'}
slot_of = dict(re.findall(r"^\s+(\w+): '(LP\d\d)',", koma, re.M))


def chain(name):
    body = re.search(rf"export const {name}: readonly MemoryDef\[\] = \[(.*?)\];", session, re.S).group(1)
    return re.findall(r"\{ id: '(\w+)', thing: '(\w+)', rooms: \['(\w+)'\] \}", body)


def picture(kind):
    f = shots / f'{kind}.png'
    if not f.exists():
        return ''
    im = Image.open(f).convert('RGB').crop((400, 150, 880, 660)).resize((360, 382), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=72)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


e = html.escape
parts = []
total = 0
for const, place, about in PLACES:
    cards = []
    for n, (mem, kind, room) in enumerate(chain(const), 1):
        total += 1
        slot = slot_of.get(mem)
        key = slot.lower() if slot else ''
        owner = ru.get(f'koma.owner.{key}', ru['koma.owner.other'])
        fact = ru.get(f'koma.fact.{key}', ru['koma.fact.other'])
        img = picture(kind)
        cards.append(f'''<article class="card">
  <div class="shot">{f'<img alt="{e(ru.get(f"mem.{mem}.task", mem))} в игре" src="{img}">' if img else ''}<span class="num">{n}</span></div>
  <div class="body">
    <h3>{e(ru.get(f"mem.{mem}.task", mem))}</h3>
    <p class="ids"><code>{mem}</code> · модель <code>{kind}</code> · комната <code>{room}</code></p>
    <dl>
      <dt>приходит</dt><dd>{e(ru.get(f"mem.{mem}.flash", "—"))}</dd>
      <dt>вспомнил</dt><dd>{e(ru.get(f"mem.{mem}.done", "—"))}</dd>
      <dt>Смотритель</dt><dd class="tag">{e(owner)}</dd>
      <dt>точно</dt><dd>{e(fact)}</dd>
    </dl>
    <p class="slot">{f'<b>{slot}</b> {e(ROLE.get(slot, ""))}' if slot else 'без слота канона — вещь места'}</p>
  </div>
</article>''')
    parts.append(f'<section><h2>{e(place)}</h2><p class="about">{e(about)} · вещи приходят по одной, по порядку и по кругу</p><div class="grid">{"".join(cards)}</div></section>')

page = f'''<title>Вещи памяти</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400&family=Inter:wght@400;500;600&display=swap">
<style>
:root {{ --bg:#f3efe6; --card:#fbf8f1; --fg:#24211c; --dim:#6f685c; --line:#d9d1c0; --tag:#e9dfc6; --accent:#8a3b2a; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#14130f; --card:#1d1b16; --fg:#e8e2d4; --dim:#9a927f; --line:#34312a; --tag:#2b2820; --accent:#d98a73; color-scheme:dark }} }}
:root[data-theme="dark"] {{ --bg:#14130f; --card:#1d1b16; --fg:#e8e2d4; --dim:#9a927f; --line:#34312a; --tag:#2b2820; --accent:#d98a73; color-scheme:dark }}
body {{ background:var(--bg); color:var(--fg); font:15px/1.5 Inter,system-ui,sans-serif; padding-block:28px 56px; padding-left:max(16px,env(safe-area-inset-left,0px)); padding-right:max(16px,env(safe-area-inset-right,0px)); }}
main {{ max-width:1180px; margin:0 auto; }}
h1 {{ font:300 30px/1.15 "DM Mono",ui-monospace,monospace; margin:0 0 8px; text-wrap:balance; }}
.lead {{ color:var(--dim); max-width:66ch; margin:0 0 6px; }}
h2 {{ font:400 20px/1.2 "DM Mono",ui-monospace,monospace; margin:40px 0 2px; }}
.about {{ color:var(--dim); margin:0 0 14px; font-size:13px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:6px; overflow:hidden; display:flex; flex-direction:column; min-width:0; }}
.shot {{ position:relative; background:#0b0b0a; aspect-ratio:360/382; max-width:100%; }}
.shot img {{ display:block; width:100%; height:100%; object-fit:cover; }}
.num {{ position:absolute; left:10px; top:8px; font:400 12px "DM Mono",monospace; color:#e9dfc6; opacity:.8; }}
.body {{ padding:12px 14px 14px; min-width:0; }}
h3 {{ font:400 17px/1.2 "DM Mono",ui-monospace,monospace; margin:0 0 2px; }}
.ids {{ margin:0 0 10px; font-size:11.5px; color:var(--dim); overflow-wrap:anywhere; }}
code {{ font:400 11.5px "DM Mono",monospace; }}
dl {{ margin:0; display:grid; grid-template-columns:auto 1fr; gap:5px 10px; font-size:13.5px; }}
dt {{ color:var(--dim); font:400 11px/1.9 "DM Mono",monospace; text-transform:uppercase; letter-spacing:.04em; }}
dd {{ margin:0; min-width:0; }}
dd.tag {{ font-family:"DM Mono",monospace; font-weight:300; background:var(--tag); padding:1px 6px; border-radius:2px; }}
.slot {{ margin:11px 0 0; padding-top:9px; border-top:1px solid var(--line); font-size:12.5px; color:var(--dim); }}
.slot b {{ font:400 12px "DM Mono",monospace; color:var(--accent); margin-right:4px; }}
</style>
<main>
<h1>Вещи памяти</h1>
<p class="lead">Все {total} вещей, которые игрок встречает как вещь-воспоминание, по четырём местам. Кадр снят в игре, под лучом фонаря. «Приходит» — строка, с которой вещь появляется; «вспомнил» — первая ассоциация героя (в сюжете это его выдумка); «Смотритель» — что он дописывает в графе «владелец»; «точно» — карточка за «не подтверждено».</p>
<p class="lead">Собрано из кода и русских строк игры на 24.11. Одна и та же модель бывает вещью двух мест: чайник, кресло, пальто, билет.</p>
{"".join(parts)}
</main>
'''
dst.write_text(page, encoding='utf-8')
print(dst, len(page) // 1024, 'КБ, вещей', total)
