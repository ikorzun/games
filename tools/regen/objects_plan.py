"""objects_plan.py: план реквизита мини-игр на high в $SP/objects_plan.json (формат plan.json: id, file, asset, prompt,
medias, api_size). Промпт — objects.md дословно + заполненный OBJECT BRIEF. Эталоны — фото реальных предметов из
assets/ep01/_refs/props (SOURCES.md). Решение владельца 2026-10-12: для пустых бланков 1990-х, фото которых в открытом
доступе не нашлось, — исключение из правила objects.md: бланк собирается по составу полей из найденных образцов
(docs/research/06-props-references.md); текст документа накладывает игра (text_key), на картинке он нечитаем."""
import json, os, re
SP = os.environ.get('REGEN_DIR', 'assets/ep01/_regen')
PROPS = 'assets/ep01/_refs/props'
md = open('docs/production/prompts/objects.md', encoding='utf-8').read()
i = md.index('```\nOBJECT PROMPT')
prompt = md[i + 4:md.index('```', i + 3)].rstrip()
head = prompt[:prompt.index('OBJECT BRIEF')].rstrip()
man = {it['id']: it for it in json.load(open('assets/ep01/manifest.json'))}

# Пустой бланк: лист целиком, плоский скан; поля пустые, печатные подписи полей бледные и нечитаемые, чтобы текст
# документа, который накладывает игра поверх картинки, читался.
BLANK = ("Output: a flat, evenly lit top-down scan of the whole sheet filling the frame edge to edge, portrait 3:4, no "
         "background around the paper, no hands, no desk. The form is BLANK: all fields and lines are empty — the "
         "game overlays the document text on top of this image, so the printed elements stay pale and light, in the "
         "upper and lower margins and along thin rules, and the middle of the sheet keeps calm open paper. Every "
         "printed word is too small or too soft to read; no invented letters, no numbers that can be read.")
DOCS = {
    'doc_power_of_attorney': {
        'object': "a blank notarial power of attorney of the Russian Federation, Moscow, 1993: one A4 sheet of thin "
                  "off-white office paper, slightly yellowed, folded once across the middle",
        'refs': [],
        'scale': "A4 sheet, 210 × 297 mm",
        'state': "unfilled form: a small printed heading at the top centre, a line for the city and date, ruled lines for "
                 "the principal and the attorney, and at the bottom the notary's certification block with lines for the "
                 "register number and the fee; one faded round violet notary seal and one rectangular violet register "
                 "stamp at the lower left, both soft and unreadable; a single fold line",
    },
    'doc_contract_sale': {
        'object': "a blank apartment sale contract, Moscow, 1993: two A4 sheets of thin office paper side by side as an "
                  "open spread, stapled at the top left corner, the paper slightly yellowed",
        'refs': [],
        'scale': "two A4 sheets, 2 × 210 × 297 mm, shown together",
        'state': "unfilled: numbered clauses as pale typewriter rules, dotted lines for the parties and the price, "
                 "signature lines for the seller and the buyer at the end of the second page, the notary's "
                 "certification block with one soft round violet seal on the second page; a small staple",
    },
    'doc_bti_card': {
        'object': "a blank record card of the Moscow Bureau of Technical Inventory (BTI) archive, 1993: a sheet of "
                  "grey-beige index cardboard with a printed table grid",
        'refs': [],
        'scale': "card about 148 × 210 mm, cardboard 0.4 mm thick",
        'state': "unfilled: a narrow printed heading band, a table grid with columns for the address, the owner, the "
                 "basis of the transfer and the date, a punched filing hole at the top centre, worn rounded corners, a "
                 "few faint pencil ticks; one small pale violet archive stamp in the lower right corner",
    },
    'doc_registration': {
        'object': "a blank passport office certificate of residence registration (spravka), Moscow, 1993: a half-A4 "
                  "sheet of cheap grey-white printed form paper",
        'refs': [f'{PROPS}/house_book_1995.jpg'],
        'scale': "about 148 × 210 mm",
        'state': "unfilled: a short printed heading, lines for the surname, year of birth, address and the date of "
                 "registration, a signature line for the head of the passport office — all these printed labels and the "
                 "heading are tiny, grey and blurred so that not a single word can be read; one round violet "
                 "passport-office seal, soft and unreadable; the paper and print quality like the Russian house register form in the "
                 "reference photograph (the same era of cheap state forms), but this is a single loose certificate",
    },
    'doc_newspaper_1994': {
        'object': "the front page of a Moscow evening city newspaper, early 1994: newsprint, black and white, folded "
                  "once vertically",
        'refs': [],
        'scale': "A3 tabloid page, about 297 × 420 mm",
        'state': "a real-looking newspaper layout, not a diagram: a masthead band at the top printed as soft dark "
                 "shapes so blurred that no letterforms can be recognized at all, a lead story with a headline as a soft dark bar, a halftone news photograph of "
                 "an ordinary Moscow apartment block entrance with no recognizable people, narrow columns of small grey "
                 "body text that is too small to read, column rules, a small advertisement box; slightly yellowed "
                 "newsprint, one fold",
    },
}


def brief(o: dict, refs_note: str, destination: str, placement: str, output: str) -> str:
    return "\n".join([
        "OBJECT BRIEF", "",
        f"Object(s), existing type or model, period: {o['object']}.", "",
        f"Photographs of the real object(s), designated as construction references: {refs_note}", "",
        f"Reliable dimensions or identified scale reference: {o['scale']}.", "",
        f"Configuration, condition and required mini-game state: {o['state']}.", "",
        f"Approved scene reference and destination location: {destination}", "",
        "Other visible objects and their dimensions or scale relationship: none.", "",
        f"Placement, camera position and actual light sources: {placement}", "",
        f"Output: {output}",
    ])


plan = []
for did, o in DOCS.items():
    note = ("the attached photograph of a Russian house register form, 1995 (Reference 1) — for the paper, print and "
            "stamp character of cheap state forms of the period." if o['refs'] else
            "none available in open sources; follow the standard field composition of Russian state forms of 1992–1994 "
            "described above (owner's exception for blank forms).")
    b = brief(o, note, "the document viewer of the game; the story is set in Moscow, 1993–1994.",
              "flat scan, the camera straight above the sheet, soft even light, no shadows across the paper.", BLANK)
    plan.append({"id": did, "asset": "doc", "file": man[did]['target'], "aspect": "3:4", "api_size": "1152x1536",
                 "medias": [f"file:{r}" for r in o['refs']], "prompt": f"{head}\n\n{b}"})

keys = {
    # Только цилиндровые: у сувальдных ключей нет эталона в открытом доступе (06-props-references.md), без фото — не рисуем.
    'object': "six ordinary apartment door keys of Moscow, early 1990s, all Soviet cylinder ('English') keys with a "
              "flat bow, a round hole and a toothed blade with a groove, slightly different bows and tooth patterns; "
              "each key has its own small cardboard tag tied with a thin string through the key hole",
    'scale': "a cylinder key is about 60 × 29 × 2 mm (Reference 2 gives the exact proportions); a tag about 50 × 25 mm",
    'state': "evidence from a search: the six keys lie side by side in a row on the desk, each with its tag; the tags "
             "carry addresses handwritten in blue ballpoint that are too small and soft to read",
}
kb = brief(keys,
           "Reference 1 — a Soviet cylinder key on a split ring (construction of the bow, hole, blade and teeth); "
           "Reference 2 — a cylinder key of the same period with known dimensions (proportions and thickness). Keep "
           "their real construction; the steel or nickel-plated finish of Reference 1, two of the keys may be brass.",
           "Reference 3 — the approved wide shot of Sergei Murashov's living room at night (the lacquered desk, the "
           "lamp light, the colours); the keys lie on that desk.",
           "the camera looks down at the desk at a slight angle from the eye level of a standing person, a 45 "
           "mm-equivalent field of view; the warm desk lamp is the only light, the window dark.",
           "scene insert, 16:9, one consistent physical scale for all six keys.")
plan.append({"id": "cg_keys", "asset": "cg", "file": man['cg_keys']['target'], "aspect": "16:9", "api_size": "1920x1088",
             "medias": [f"file:{PROPS}/key_ussr_1960.jpg", f"file:{PROPS}/key_elzett_1980.jpg",
                        "file:assets/ep01/shots/murashov_flat/wide_1.webp"],
             "prompt": f"{head}\n\n{kb}"})
json.dump(plan, open(f'{SP}/objects_plan.json', 'w'), ensure_ascii=False, indent=1)
print('objects plan:', [(s['id'], len(s['medias'])) for s in plan])
