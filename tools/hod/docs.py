"""docs.py: бумаги «Хода следствия» как настоящие документы лета 1993-го → промпты, генерация, webp.

Решение владельца 2026-10-13: документы в игре — реалистичные сканы (референсы: машинопись с пометками, ксерокопия,
штампы, папки «Дело»), текст впечатан в картинку, пока только по-русски. Тексты — дословно из сценария
(episodes/s1/_drafts/ep01_hod/build.py); добавлено только то, что есть на настоящих бумагах: штамп входящей
регистрации, подписи вместо «(подпись)», печать нотариуса. Промпты — по-английски (техническая инструкция).

  python3 tools/hod/docs.py md                 # → docs/production/prompts/ep01-hod-documents.md
  python3 tools/hod/docs.py gen statement      # GPT Image (sunburst, high) → assets/ep01/_hod/docs/<id>.png
  python3 tools/hod/docs.py webp statement     # принятый вариант → assets/ep01/hod/docs/ru/<id>.webp
  python3 tools/hod/docs.py fix power_of_attorney 1040,515,1185,580 "…"   # правка по маске: только прямоугольник

Правка по маске (fix): GPT Image перерисовывает прямоугольник, а в исходник вклеивается только он, с мягким краем —
остальной лист не меняется ни на пиксель. Исходник до первой правки лежит рядом: <id>.orig.png.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = 'assets/ep01/_hod/docs'
OUT = 'assets/ep01/hod/docs/ru'
GPT = os.path.expanduser('~/.claude/skills/gpt-image/scripts/gpt_image.py')

STYLE = (
    'A photorealistic flatbed scan of a genuine Russian paper document from the summer of 1993, as kept in a criminal '
    'case file. Perfectly flat, straight-on, even neutral light, no perspective, no hands, no desk, no props: the paper '
    'fills the entire frame edge to edge. Real paper texture and slight yellowing, real ink sitting in the paper fibres, '
    'small honest imperfections: a faint fold line, a tiny stain, worn edges. It looks like a real archival document '
    'scanned for a television documentary. No modern elements, no English text, no watermark, no caption, no frame, '
    'no logo. All text is Russian (Cyrillic) and must be reproduced exactly, letter for letter, as quoted below: do not '
    'add, drop, translate or paraphrase words; no other legible text on the page besides what is described.'
)

DOCS = {
    'statement': {
        'size': '1536x2048',
        'ru': 'Заявление Галины: от руки, синей шариковой ручкой, на тетрадном листе в клетку; штамп входящей регистрации прокуратуры.',
        'prompt': (
            'Document: a handwritten citizen\'s complaint written by an elderly Moscow woman in blue ballpoint pen on a '
            'single sheet torn out of a Soviet school exercise book: pale blue 5 mm squared grid, a red margin line on '
            'the left, the left edge slightly ragged where it was torn from the staples. Neat old-fashioned Soviet '
            'school cursive, slightly shaky, even lines, a little more pressure at the start of words. The sheet was '
            'folded in four, so two faint crossing fold lines.\n'
            'Layout and exact text:\n'
            '- Upper right quarter, four short handwritten lines: «Прокурору Кунцевского района г. Москвы» / '
            '«от Сомовой Галины Васильевны,» / «ул. Молодогвардейская, кв. 33.»\n'
            '- Centred below, a little larger: «ЗАЯВЛЕНИЕ»\n'
            '- The body across the full width, with a paragraph indent: «Прошу разыскать мою соседку Зою Павловну из '
            'кв. 34. С конца июня её никто не видел. В её квартире живут чужие люди, говорят, что купили. Зоя Павловна '
            'никуда уезжать не собиралась — мне бы сказала.»\n'
            '- Bottom left: «2 августа 1993 г.»; bottom right the signature: the handwritten surname «Сомова» with a '
            'short flourish under it.\n'
            '- Upper left corner: a slightly crooked rectangular violet rubber stamp of incoming mail, unevenly inked, '
            'printed «ПРОКУРАТУРА КУНЦЕВСКОГО РАЙОНА г. МОСКВЫ», with «Вх. № 1147» and «03.08.1993» filled in by hand '
            'in black ink.'
        ),
    },
    'power_of_attorney': {
        'size': '1536x2048',
        'ru': 'Доверенность (копия): ксерокопия машинописного оригинала с подписью и печатью нотариуса; в дате «4» напечатана поверх стёртой «1» — улика сверки под лупой.',
        'prompt': (
            'Document: an office photocopy made in 1993 of a notarised power of attorney typed on a Soviet mechanical '
            'typewriter. Greyish copier paper, grey toner speckle and faint streaks, a dark shadow band along the right '
            'edge, slightly uneven contrast; the typed letters a little swollen and uneven as in a copy of a typewritten '
            'original; signatures and the round notary seal reproduced in grey-black (a copy, no colour). The sheet lay '
            'slightly crooked on the copier glass, about half a degree.\n'
            'Layout and exact text, typewritten in a Cyrillic typewriter face with uneven letter weight, one and a half '
            'line spacing, wide margins:\n'
            '- Centred at the top: «ДОВЕРЕННОСТЬ»\n'
            '- Next line, left: «Город Москва, 14 июня 1993 г.» IMPORTANT: in «14» the digit «4» is typed over an '
            'erased «1»: the «4» is darker, with a faint doubled stem and a light smudge where the «1» was scraped '
            'off; the correction is visible on close inspection only.\n'
            '- Body paragraph with an indent: «Я, С. Зоя Павловна, проживающая по адресу: ул. Молодогвардейская, '
            'кв. 34, настоящей доверенностью уполномочиваю Мурашова Сергея Викторовича продать принадлежащую мне '
            'квартиру за цену и на условиях по своему усмотрению, получить причитающиеся мне деньги.»\n'
            '- Below on the right: a short, shaky old woman\'s pen signature.\n'
            '- Lower, typed: «Доверенность удостоверена нотариусом Ковригиным А. Н., зарегистрирована в реестре.» '
            'Under it «Нотариус» and a confident looping signature, half covered by a round seal about 4 cm across '
            'with the ring text «НОТАРИУС г. МОСКВЫ КОВРИГИН А. Н.» and «г. Москва» in the centre (no emblem).'
        ),
    },
    'contract_sale': {
        'size': '1536x2048',
        'ru': 'Договор купли-продажи: экземпляр покупателя, машинопись, синие подписи, фиолетовая печать нотариуса, ржавая скрепка.',
        'prompt': (
            'Document: the buyer\'s copy of a notarised flat sale contract, the original typed on a Soviet mechanical '
            'typewriter on thin slightly yellowed office paper, signed in blue ballpoint, with a violet round notary '
            'seal. A rusty staple in the upper left corner. Kept at home in a drawer: a soft crease across the middle.\n'
            'Layout and exact text, typewritten in a Cyrillic typewriter face with uneven letter weight, one and a half '
            'line spacing:\n'
            '- Centred at the top: «ДОГОВОР КУПЛИ-ПРОДАЖИ КВАРТИРЫ»\n'
            '- Next line: «Москва» on the left, «28 июня 1993 г.» on the right.\n'
            '- Body, two paragraphs with indents: «Продавец С. Зоя Павловна, от имени которой по доверенности от '
            '11 июня 1993 г. действует Мурашов Сергей Викторович, продаёт, а покупатель Лапин покупает однокомнатную '
            'квартиру на Молодогвардейской ул.» / «Расчёт произведён полностью.»\n'
            '- Signatures, typed labels with handwritten blue signatures on the lines: «Продавец (по доверенности):» '
            'followed by a quick sharp signature; «Покупатель:» followed by a careful rounded signature.\n'
            '- Below, typed: «Удостоверено нотариусом Ковригиным А. Н.», a looping notary signature, and a violet '
            'round seal about 4 cm across with the ring text «НОТАРИУС г. МОСКВЫ КОВРИГИН А. Н.» and «г. Москва» in the '
            'centre (no emblem), slightly smudged.'
        ),
    },
    'bti_card': {
        'size': '2048x1536',
        'ru': 'Карточка БТИ: картонная учётная карточка из ящика картотеки, печатный бланк, записи от руки, отверстие под стержень.',
        'prompt': (
            'Document: a Soviet archive index card of a Moscow Bureau of Technical Inventory, thin cream cardboard about '
            '15 x 10 cm, landscape, filling the frame; a round hole at the bottom centre for the card-drawer rod; edges '
            'greyed by fingers, a bent corner. Printed form in faded black typography, entries handwritten in black '
            'and violet ink, a few pencil ticks.\n'
            'Layout and exact text:\n'
            '- Printed header across the top: «БЮРО ТЕХНИЧЕСКОЙ ИНВЕНТАРИЗАЦИИ» and below it «КАРТОЧКА УЧЁТА»\n'
            '- Printed labels with handwritten values on the lines: «Адрес:» — «Молодогвардейская, кв. 34»; '
            '«Переход права:» — «договор от 28.06.1993»; «Нотариус:» — «Ковригин А. Н.»; «Представитель продавца по '
            'доверенности:» — «Мурашов С. В.»\n'
            '- A small rectangular violet stamp «ЗАРЕГИСТРИРОВАНО» at the lower right, slightly crooked.'
        ),
    },
}


def prompt(doc_id: str) -> str:
    return f'{STYLE}\n\n{DOCS[doc_id]["prompt"]}'


def write_md() -> None:
    lines = ['# Эпизод 1, «Ход следствия»: промпты документов', '',
             '> Генерация: `python3 tools/hod/docs.py gen <id>` (GPT Image 2.5 sunburst, high). Тексты — дословно из сценария;',
             '> добавлено только то, что есть на настоящих бумагах (штамп входящей регистрации, подписи, печать). Пока только ru.', '']
    for doc_id, d in DOCS.items():
        lines += [f'## {doc_id} — {d["size"]}', '', f'*{d["ru"]}*', '', '```', prompt(doc_id), '```', '']
    path = os.path.join(ROOT, 'docs/production/prompts/ep01-hod-documents.md')
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(path)


def gen(doc_id: str, n: int = 1) -> None:
    os.makedirs(os.path.join(ROOT, RAW), exist_ok=True)
    env = {**os.environ, 'SSL_CERT_FILE': '/etc/ssl/cert.pem'}
    subprocess.run([sys.executable, GPT, prompt(doc_id), '--model', 'sunburst', '--quality', 'high', '--size', DOCS[doc_id]['size'],
                    '--format', 'png', '-n', str(n), '--out', os.path.join(ROOT, RAW), '--name', doc_id], check=True, env=env)


def fix(doc_id: str, box: str, what: str) -> None:
    import shutil
    from PIL import Image, ImageDraw, ImageFilter
    raw = os.path.join(ROOT, RAW, f'{doc_id}.png')
    orig = os.path.join(ROOT, RAW, f'{doc_id}.orig.png')
    if not os.path.exists(orig):
        shutil.copy(raw, orig)
    x0, y0, x1, y1 = (int(v) for v in box.split(','))
    src = Image.open(raw).convert('RGB')
    mask = Image.new('RGBA', src.size, (0, 0, 0, 255))
    ImageDraw.Draw(mask).rectangle((x0, y0, x1, y1), fill=(0, 0, 0, 0))  # прозрачное — что перерисовать
    mpath = os.path.join(ROOT, RAW, f'{doc_id}.mask.png')
    mask.save(mpath)
    name = f'{doc_id}.fix'
    env = {**os.environ, 'SSL_CERT_FILE': '/etc/ssl/cert.pem'}
    edit = (f'Edit only the transparent masked rectangle of this scanned document; everything outside it stays exactly '
            f'as it is. Inside the rectangle: {what} Match the surrounding text exactly: same typeface or handwriting, '
            f'size, baseline, letter spacing, ink, paper and scan or copy noise, so the edit is invisible.')
    subprocess.run([sys.executable, GPT, edit, '--image', raw, '--mask', mpath, '--model', 'sunburst', '--quality', 'high',
                    '--size', DOCS[doc_id]['size'], '--format', 'png', '--out', os.path.join(ROOT, RAW), '--name', name],
                   check=True, env=env)
    fixed = Image.open(os.path.join(ROOT, RAW, f'{name}.png')).convert('RGB').resize(src.size)
    soft = Image.new('L', src.size, 0)
    ImageDraw.Draw(soft).rectangle((x0 + 6, y0 + 6, x1 - 6, y1 - 6), fill=255)
    soft = soft.filter(ImageFilter.GaussianBlur(4))
    Image.composite(fixed, src, soft).save(raw)
    print('исправлено', raw)


def webp(doc_id: str, src: str | None = None) -> None:
    from PIL import Image
    src = src or os.path.join(ROOT, RAW, f'{doc_id}.png')
    os.makedirs(os.path.join(ROOT, OUT), exist_ok=True)
    dst = os.path.join(ROOT, OUT, f'{doc_id}.webp')
    Image.open(src).convert('RGB').save(dst, 'WEBP', quality=86, method=6)
    print(dst, os.path.getsize(dst) // 1024, 'КБ')


if __name__ == '__main__':
    cmd, *ids = sys.argv[1:] or ['md']
    if cmd == 'md':
        write_md()
    elif cmd == 'gen':
        for i in ids:
            gen(i)
    elif cmd == 'fix':
        fix(ids[0], ids[1], ids[2])
    elif cmd == 'webp':
        for i in ids:
            webp(i)
