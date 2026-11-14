# Плакаты убежища: запросы к генератору картинок

Плакаты гражданской обороны и план убежища в Untitled Session — картинки
(`vylazka/assets/posters/`). Здесь записано, как они сделаны, чтобы любой лист можно было
перерисовать или добавить новый в той же манере.

- **Модель:** GPT Image 2 (в ElevenLabs — `gpt-image-2`), качество `medium`, разрешение `1K`,
  пропорция `2:3` (план убежища — `3:2`). Одна картинка — около 260 кредитов ElevenLabs.
- **Правило текста:** на листе не больше заголовка и 3–8 коротких подписей; каждая надпись дана
  в запросе дословно. После генерации каждая буква проверяется глазами: лист с ошибкой не берём.
- **Буква «ё»** на листах не ставится — так печатали и настоящие плакаты («НАДЕЖНАЯ ЗАЩИТА»).

Запросы написаны по-английски: это техническая инструкция для модели. Русский в них — только
точный текст надписей.

## Общая часть запроса (плакаты)

```
Use: game texture. A flat, front-on, full-bleed scan of ONE printed poster sheet that fills the entire
image edge to edge. No wall, no frame, no margin outside the paper, no perspective, no shadows, no hands:
the image itself is the sheet.

Subject: an authentic Soviet civil defence (Grazhdanskaya Oborona) instructional wall poster, offset
lithography, printed around 1975. Off-white, slightly yellowed matte paper. Limited ink palette: black,
brick red, slate blue, ochre (olive where the layout names it). Flat gouache-style didactic illustrations
in the plain manner of Soviet safety posters: ordinary adults in 1970s clothes, simplified but
anatomically correct, thin black contour, flat colour fills, no gradients, no photorealism, no cartoon
exaggeration.

Layout: <see the sheet below>

Text, Russian Cyrillic, verbatim, no extra characters, no substitutions, and no other text anywhere on
the sheet:
<see the sheet below>
Bottom line, small black capitals: ГРАЖДАНСКАЯ ОБОРОНА СССР

Constraints: no English, no Latin letters, no watermark, no signature, no logo, no modern objects, no
decorative border.
```

## Листы

Для каждого листа — раскладка (`Layout`) и точный текст.

### poster_mask — «Умей пользоваться противогазом»

A brick-red band across the top with the headline in two lines. Below it, four numbered rectangular
panels in a 2 x 2 grid with thin black borders. Each panel shows the same man, waist-up, performing one
step of putting on a Soviet GP-5 gas mask: a grey rubber helmet-mask that covers the whole head, two
round glass eyepieces, a short green cylindrical filter canister screwed directly to the front, and a
khaki canvas gas-mask bag on a shoulder strap at his hip. Panel 1: he holds his breath with eyes closed
and takes the mask out of the bag. Panel 2: he pulls the mask over his head with both hands. Panel 3:
mask on, he exhales sharply. Panel 4: mask on, he stands calm, facing the viewer. Under each panel, one
short caption line.

Заголовок (белым по красному): `УМЕЙ ПОЛЬЗОВАТЬСЯ` / `ПРОТИВОГАЗОМ`. Подписи: `1. ЗАДЕРЖИ ДЫХАНИЕ`,
`2. НАДЕНЬ МАСКУ`, `3. СДЕЛАЙ ВЫДОХ`, `4. ДЫШИ РОВНО`.

### poster_alarm — «По сигналу „Воздушная тревога“»

A slate-blue band across the top with the headline in two lines. Under it, one wide illustration: an
electric air-raid siren on the flat roof of a five-storey panel apartment block, concentric sound arcs
spreading from it, evening sky. Below, three numbered rectangular panels stacked in a column, each with
a picture on the left and one caption line on the right. Panel 1: a hand closes the valve on a kitchen
gas pipe, a wall light switch beside it. Panel 2: a woman in a coat puts a folder of documents into a
bag, a gas-mask bag on her shoulder. Panel 3: a man, a woman and a child walk down concrete steps to a
heavy steel door; above the door a plain sign with one word.

Заголовок (белым по синему): `ПО СИГНАЛУ` / `«ВОЗДУШНАЯ ТРЕВОГА»`. Подписи: `1. ВЫКЛЮЧИ ГАЗ И СВЕТ`,
`2. ВОЗЬМИ ДОКУМЕНТЫ`, `3. ИДИ В УБЕЖИЩЕ`. Табличка над дверью: `УБЕЖИЩЕ`.

### poster_shelter — «Правила поведения в убежище»

An olive-green band across the top with the headline in two lines. Under it, one large illustration: the
inside of an underground civil defence shelter compartment with a low concrete ceiling, a round
ventilation duct running along it, a heavy steel hermetic door with a wheel handle, two-tier wooden
bunks along the wall and a long wooden bench. Men, women and a child sit calmly on the benches and bunks
with bags at their feet; a commandant with a red armband stands by the door. Below the illustration,
four rows, each with a small round pictogram on the left and one short rule on the right: a finger to
the lips; a crossed-out cigarette; a crossed-out burning match; the commandant with the armband raising
his hand.

Заголовок (белым по зелёному): `ПРАВИЛА ПОВЕДЕНИЯ` / `В УБЕЖИЩЕ`. Правила: `СОБЛЮДАЙ ТИШИНУ`,
`НЕ КУРИ`, `НЕ ЗАЖИГАЙ ОГОНЬ`, `СЛУШАЙ КОМЕНДАНТА`.

### poster_aid — «Первая медицинская помощь»

(в общей части добавлено: `no blood or gore`) A white band across the top with the headline in two lines
in brick red, a small red cross at the left end of the band. Below it, four numbered rectangular panels
in a 2 x 2 grid with thin black borders. In every panel a volunteer nurse in a grey dress with a white
armband bearing a red cross and a canvas first-aid bag helps a casualty. Panel 1: she tightens a rubber
tourniquet on a man's upper arm. Panel 2: she winds a white gauze bandage around a man's head. Panel 3:
she ties a wooden splint to a man's lower leg with bandages. Panel 4: she and a man carry a casualty on
a canvas stretcher. Under each panel, one short caption line.

Заголовок (красным по белому): `ПЕРВАЯ МЕДИЦИНСКАЯ` / `ПОМОЩЬ`. Подписи: `1. ОСТАНОВИ КРОВОТЕЧЕНИЕ`,
`2. НАЛОЖИ ПОВЯЗКУ`, `3. НАЛОЖИ ШИНУ`, `4. ВЫНЕСИ ПОСТРАДАВШЕГО`.

### poster_signals — «Сигналы гражданской обороны»

A black band across the top with the headline in two lines. Below it, four wide horizontal rows
separated by thin black rules. Each row has a square picture on the left and the name of one signal in
large capitals on the right. Row 1 picture: an electric siren on a pole with sound arcs, on a brick-red
square. Row 2 picture: a street loudspeaker horn on a pole, on a slate-blue square. Row 3 picture: the
black radiation trefoil symbol on an ochre-yellow square. Row 4 picture: a grey rubber gas mask with two
round eyepieces and a green filter canister, on an olive square.

Заголовок (белым по чёрному): `СИГНАЛЫ` / `ГРАЖДАНСКОЙ ОБОРОНЫ`. Строки: `ВОЗДУШНАЯ ТРЕВОГА`,
`ОТБОЙ ВОЗДУШНОЙ ТРЕВОГИ`, `РАДИАЦИОННАЯ ОПАСНОСТЬ`, `ХИМИЧЕСКАЯ ТРЕВОГА`.

### poster_protect — «Средства индивидуальной защиты»

A slate-blue band across the top with the headline in two lines. Below it, four rectangular panels in a
2 x 2 grid with thin black borders. Panel 1: a Soviet GP-5 gas mask laid out as an exhibit: grey rubber
helmet-mask with two round eyepieces, a short green cylindrical filter canister, and a khaki canvas bag
beside it. Panel 2: a workman wearing a white half-mask dust respirator with two straps over a cap.
Panel 3: a woman wearing a white cotton-gauze face bandage that covers nose, mouth and chin, tied behind
the head. Panel 4: a full-length figure in a long hooded rubberised protective cape, rubber boots,
rubber gloves and a gas mask. Under each panel, one caption line.

Заголовок (белым по синему): `СРЕДСТВА` / `ИНДИВИДУАЛЬНОЙ ЗАЩИТЫ`. Подписи: `ПРОТИВОГАЗ ГП-5`,
`РЕСПИРАТОР Р-2`, `ВАТНО-МАРЛЕВАЯ ПОВЯЗКА`, `ЗАЩИТНЫЙ ПЛАЩ`.

### poster_nuclear — «Ядерный взрыв. Поражающие факторы»

(предмет: `educational wall poster from a 1970s school textbook series explaining the effects of a
nuclear explosion`; добавлено: `no people harmed, no gore`) A brick-red band across the top with the
headline in one line, and a narrow black band under it with the subtitle. Below, one wide schematic
diagram: a stylised mushroom cloud drawn in flat ochre and red over a simple map-like landscape, with
three concentric dashed rings on the ground around its base. Under the diagram, four rectangular panels
in a 2 x 2 grid with thin black borders. Panel 1: a brick house with arrows of a pressure wave pushing
against its wall and windows. Panel 2: straight bright rays falling on a wall that casts a sharp shadow.
Panel 3: wavy lines passing through a thick concrete wall and growing weaker. Panel 4: a dust cloud
drifting over fields with the black radiation trefoil sign on a post. Under each panel, one caption line.

Заголовок (белым по красному): `ЯДЕРНЫЙ ВЗРЫВ`. Подзаголовок (белым по чёрному): `ПОРАЖАЮЩИЕ ФАКТОРЫ`.
Подписи: `УДАРНАЯ ВОЛНА`, `СВЕТОВОЕ ИЗЛУЧЕНИЕ`, `ПРОНИКАЮЩАЯ РАДИАЦИЯ`, `РАДИОАКТИВНОЕ ЗАРАЖЕНИЕ`.

### poster_refuge — «Убежище — надежная защита»

An ochre band across the top with the headline in two lines in black. Below it, one tall cutaway section
drawing: a brick apartment house at ground level and, underneath it in the earth, a civil defence
shelter with thick reinforced-concrete walls. Seen in section from left to right: a stair going down
from the street to a heavy steel hermetic door, a small airlock chamber with a second door, a long
compartment where people sit on benches and two-tier bunks, a machinery room with a hand-cranked
filter-ventilation unit and round filter canisters, a row of water tanks, and at the far right a narrow
tunnel leading up to a hatch away from the house. Six short labels with thin black leader lines point to
these parts. (Технический рисунок: `hatching for concrete and earth`.)

Заголовок (чёрным по охре): `УБЕЖИЩЕ` / `НАДЕЖНАЯ ЗАЩИТА`. Выноски: `ВХОД`, `ТАМБУР`,
`ОТСЕК ДЛЯ ЛЮДЕЙ`, `ФИЛЬТРОВЕНТИЛЯЦИЯ`, `ЗАПАС ВОДЫ`, `АВАРИЙНЫЙ ВЫХОД`.

### poster_dose — «Дозиметрический контроль»

An olive-green band across the top with the headline in two lines. Under it, one wide illustration: a
civil defence scout in a hooded rubberised protective suit, rubber gloves and a grey gas mask walks
along a road and holds out a metal probe on a long rod towards the ground; on his chest hangs an
olive-green field radiation meter in a box with a round dial; a cable runs from the box to the probe;
headphones over the hood. Beside him a small triangular fence sign with the black radiation trefoil.
Below, three numbered rectangular panels in a row with thin black borders. Panel 1: a gloved hand turns
the round switch on the olive meter box. Panel 2: the probe held near the ground, the dial needle
pointing to the middle of the scale. Panel 3: a hand writes numbers with a pencil in a ruled log book.
Under each panel, one short caption line.

Заголовок (белым по зелёному): `ДОЗИМЕТРИЧЕСКИЙ` / `КОНТРОЛЬ`. Подписи: `1. ВКЛЮЧИ ПРИБОР`,
`2. ИЗМЕРЬ УРОВЕНЬ`, `3. ЗАПИШИ ПОКАЗАНИЯ`.

### scheme — план убежища (3:2, свой запрос целиком)

```
Use: game texture. A flat, front-on, full-bleed scan of ONE sheet of paper that fills the entire image
edge to edge. No wall, no frame, no margin outside the paper, no perspective, no shadows, no hands, no
pins: the image itself is the sheet.

Subject: an authentic Soviet evacuation plan of an underground civil defence shelter, the kind that hung
behind glass by the entrance in the 1970s: a hand-drafted architectural floor plan in black drawing ink
on yellowed drafting paper, drawn with ruler and stencil lettering, with evacuation routes added in red
ink. Slight foxing and a faint vertical fold line in the paper. No photorealism, no 3D, no colour fills
except pale grey hatching for the thick outer walls.

Layout: landscape sheet. At the top left, the title in one line of large stencil capitals. The plan
occupies the left three quarters of the sheet: a long central corridor running left to right with five
rooms above it and five rooms below it, thick hatched outer walls, thin inner walls, door openings shown
with quarter-circle door swings, a stair at the far left end of the corridor and a narrow escape tunnel
at the far right end. Each room contains only a small number in a circle, from 1 to 8. Red arrows run
along the corridor from the rooms towards the stair on the left and towards the tunnel on the right. The
right quarter of the sheet is a ruled legend box with a heading and eight numbered lines. Under the
legend, a short red arrow with a two-word explanation.

Text, Russian Cyrillic, verbatim, no extra characters, no substitutions, and no other text anywhere on
the sheet:
Title, black stencil capitals: ПЛАН УБЕЖИЩА
Legend heading, small black capitals: ПОМЕЩЕНИЯ
Legend lines, small black capitals, one per line: 1. ВХОД ; 2. ТАМБУР ; 3. ОТСЕК ; 4. ВЕНТИЛЯЦИЯ ;
5. ДИЗЕЛЬНАЯ ; 6. САНУЗЕЛ ; 7. МЕДПУНКТ ; 8. ВЫХОД
Explanation beside the red arrow, small red capitals: ПУТЬ ЭВАКУАЦИИ

Constraints: no English, no Latin letters, no watermark, no signature, no logo, no stamps, no modern
objects, no decorative border.
```

## После генерации

Полный размер кладётся в `vylazka/assets/posters/master/<id>.webp` (качество 92), файл для игры — в
`vylazka/assets/posters/<id>.webp`: 512×768 (план — 768×512), WebP с потерями, качество 82. Дальше —
по `vylazka/assets/posters/README.md`.
