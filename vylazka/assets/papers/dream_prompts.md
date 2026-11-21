# Промпты больного сна

Картинки слоёв `stickers`, `dream_a`, `dream_b` и новый большой портрет в `faces_a` (партнёр 19.11: «сгенерить в жпт»,
«через open ai api»). Модель — GPT Image 2.6 через коннектор Higgsfield: своего ключа OpenAI в облачной сессии нет; что это
модель OpenAI, сказано в описании Higgsfield, проверить это отсюда нельзя. Качество medium, по 0,5 кредита Higgsfield за
картинку; 23 картинки — 11,5 кредита (две — замены после разбора куратора). Промпты — по-английски,
как техническая инструкция модели (правило проекта); по-русски — что на картинке. Собирает слои `scripts/papers_dream.py`.

Общий хвост снимков сна (стиль «реалистичный, но минимальный» и «эстетика „Декалога“»): *Realistic 35mm film photograph from
the late 1980s, Eastern European prefab apartment. Minimal composition, one clear subject, lots of empty space. Muted,
desaturated cold grey-green palette with one pocket of warm tungsten light. Soft film grain, slightly underexposed, quiet and
uneasy, like a still from a 1980s Polish television drama. No people, no readable text, no logos, no brand names.* Ниже у
снимков — только начало промпта, хвост тот же (у части снимков он чуть короче или с другим оттенком палитры).

## Снимки на стену (3 : 4)

| Файл | По-русски | Начало промпта |
|---|---|---|
| `thermo` | градусник на блюдце, стакан воды, мокрое полотенце | On a bare white bedside table: a glass mercury thermometer lying on a white saucer beside a folded wet cloth and a half-empty glass of water; the thin silver mercury line has crept past the end of the scale. Cold morning window light from the side. |
| `window` | ночь, дом напротив: одно окно светится, в нём стоят и смотрят | Night. View from a dark apartment window across a snowy courtyard to the facade of an identical prefab apartment block: a grid of dark windows, only one lit with warm light, and in it a motionless dark silhouette standing and looking back. |
| `phone` | трубка висит на шнуре почти до пола | A narrow apartment hallway with faded patterned wallpaper; on a small wall shelf a cream rotary telephone, its receiver off the hook, hanging by the coiled cord almost to the floor. Dim warm light from a half-open doorway, the rest in cold shadow. |
| `iron` | утюг на доске, на рубашке подпалина | An empty small kitchen at dawn: an electric clothes iron standing upright on an ironing board, a thin thread of smoke rising from it; on the white shirt beneath, a brown scorched iron-shaped mark. |
| `milk` | опрокинутая бутылка молока на клеёнке | A glass milk bottle tipped over on a kitchen table covered with a worn oilcloth; the milk has spilled into a small white pool that drips slowly off the table edge. Pale cold window light, nobody in the room. |
| `bed` | кровать на одного, на подушке две вмятины | An unmade narrow single bed photographed from directly above: on the white sheet two shallow imprints of lying bodies side by side, although the bed is far too narrow for two people; a crumpled pillow with two dents. |
| `corridor` | больничный коридор ночью, пустая каталка | A long hospital corridor at night with worn green linoleum and pale green painted walls, flickering fluorescent tubes, an empty gurney with a folded grey blanket far at the end, a door ajar with warm light spilling out onto the floor. |
| `frost` | морозное окно высокого этажа, снаружи — след ладони | A frosted window pane seen from inside a dark room at dusk: in the frost, one single handprint melted from the outside of the glass, although the window is on a high floor of a prefab apartment block; far below, a snowy blue courtyard with a single street lamp. |
| `clock` | будильник без стрелок, стакан воды, очки | A small wind-up alarm clock on a bedside table at night with no hands on its face, beside a glass of water and a pair of folded reading glasses, lit by a weak tungsten lamp from the side, deep shadow behind. *(Первый вариант был с таблетками — заменён: рядом с кардиограммой, где линия уходит в ровную, таблетки читались как отравление; куратор, пачка 52, противоречие 335.)* |
| `ticket` | разорванный билет на мокром полу зала ожидания | A paper train ticket torn in half lying on the wet tiled floor of an empty railway station waiting hall at night, under flat fluorescent light; reflections in a shallow puddle; a row of empty wooden benches far behind, out of focus. The printed text on the ticket is too blurred to read. |
| `drawing` | детский рисунок: дом, все окна жёлтые, одно чёрное | A realistic photograph of a child's crayon drawing pinned to faded floral wallpaper with a single pushpin: a tall prefab apartment block with many small square windows, all colored warm yellow except one window colored solid black; blue snowflakes drawn around the building. *(свой короткий хвост: cold daylight, soft film grain, no words, no letters, no signature)* |
| `xray` | рентген: на месте сердца — ночная бабочка | A chest X-ray film clipped to a glowing light box in a dark doctor's office: the ribs and spine look normal, but where the heart should be there is the dark shape of a moth with open wings. |
| `stairs` | лестница уходит вниз дальше, чем может | An empty stairwell of a prefab apartment block seen from the landing: pale green painted walls, a single bare light bulb, worn concrete steps going down into darkness much further than any building could, the metal railing disappearing into black. |
| `kettle` | чайник отражает того, кого в кухне нет | A dark small kitchen at night: a chrome kettle on a gas stove with a small ring of blue flame; the curved polished surface of the kettle reflects the kitchen behind the camera and a blurred standing human figure, although the kitchen itself is empty. |

## Обрывки на пол (1 : 1, прозрачный фон)

Параметры: `background: transparent`, `output_format: png`. Хвост: *Realistic, minimal. No text, no numbers, no logos.*

| Файл | По-русски | Промпт |
|---|---|---|
| `scrap_photo` | угол снимка: рама окна и ладонь на стекле | Top-down photograph of a single torn corner of an old black-and-white snapshot lying flat, isolated on a fully transparent background. The photo fragment shows part of a dark window frame at night and a pale open hand pressed flat against the glass from outside. Rough torn paper edges with white paper fibres, a slight curl, faint creases, a little dust. |
| `scrap_plan` | тетрадный лист: план квартиры, одна комната зачёркнута | Top-down photograph of a crumpled, torn-out page from a squared school notebook (grid paper) lying flat, isolated on a fully transparent background. On it, a hand-drawn floor plan of a small flat in blue ballpoint pen: three rooms and a corridor, and one of the rooms scribbled over again and again until the paper is almost worn through. No words, no letters, no numbers. |
| `scrap_calendar` | листок отрывного календаря, число зачёркнуто красным | Top-down photograph of a single small tear-off wall calendar page on thin yellowed newsprint paper, lying flat, isolated on a fully transparent background. Only one large printed day number in black, crossed out by a hard red pencil stroke. Ragged torn top edge with remains of glue. No words, no month name, no weekday. |
| `scrap_ecg` | кардиограмма: биение, потом ровная линия | Top-down photograph of a torn strip of pale pink ECG chart paper with a fine red grid, lying flat at a slight diagonal, isolated on a fully transparent background. A thin black heart trace runs along it: a few ordinary beats, then the line goes completely flat for the rest of the strip. Torn ends, slight curl. |

## Наклейки (4 : 3, два листа по 12)

Общая часть: *A clean 4 by 3 grid of twelve square sticker designs on a plain white page, evenly spaced with wide white gutters
between them, viewed straight on. Each square tile has its own flat muted background color (…) and one centered, finely
detailed, slightly retro printed illustration with a thin dark outline, like a matte vinyl sticker with subtle halftone print
texture. Subjects, one per tile: … Gently uncanny, dreamlike, but friendly sticker style. No text, no letters, no numbers, no
logos, no brand names, no copyrighted characters.*

- Лист 1: a sleeping crescent moon wearing a nightcap; a pale moth with patterned wings; an open palm with an eye in its center;
  a two-tone medicine capsule; a melting alarm clock; a glowing jellyfish; a human ear; an old brass key; an audio cassette tape;
  a goldfish in a knotted plastic bag of water; a small house with only one lit window; a rain cloud raining onto a single flower.
- Лист 2: a glass mercury thermometer; a single human tooth; a paper boat on a puddle; a sleeping curled-up cat; an old telephone
  handset with a coiled cord; a glass of milk with a small flower in it; a finger with a red string tied around it *(не взята:
  издали читается как неприличный жест)*; a small ringed planet; a ghost under a white bedsheet; an electric clothes iron with
  a puff of steam; a sparrow; a burning match.

Наклейки нарочно перекликаются со снимками: градусник, телефон, молоко, утюг, будильник, бабочка, дом с одним окном. Это та же
история, только детская и «милая» — так тревога выглядит, когда её заклеивают.

## Портрет (3 : 4)

*A sepia-toned 1910s studio portrait photograph of a young woman in a plain dark high-collared dress with a small white lace collar, seated with hands folded in her
lap, painted studio backdrop, soft oval vignette, aged photo paper with scratches, foxing and silvering at the edges. Her face is
ominously smeared, as if she slowly turned her head during a long exposure: the features are dragged downward and sideways into a
soft ghostly streak, impossible to recognize, while her dress, hands and the backdrop stay sharp and still. Realistic antique
photograph, unsettling, minimal. No text.*

Место на стене лиц и в раме прежнее, но карточка теперь сгенерированная: вместо снимка партнёра (партнёр 19.11: «можно
перегенерить через жпт»). Первый вариант был в вышитой народной блузе — заменён на тёмное платье с кружевным воротничком:
народный костюм с изуродованным лицом читался бы высказыванием о народе (куратор, пачка 52, противоречие 331). Лицо смазано на самой карточке, как на долгой выдержке, — её не
узнать и издали; размывать лицо шейдером здесь больше не нужно, маска лиц под портретом снята.

## Снимки как с iPhone 4 (партнёр 21.11, 21:29)

Слова партнёра: «Картинки в воспоминаниях сейчас слишком нейронные. Давай поправим стиль, словно они сняты на iphone4». Все 14
снимков сделаны заново — те же сюжеты, но как случайные кадры с телефона: вспышка бьёт в ближнее и проваливается в темноту, шум
в тенях, жёлто-зелёный тон ламп, кривой горизонт, ничего не выстроено. Модель — GPT Image 2.6 (`gpt-image-2.6-sunburst`) через
ключ OpenAI партнёра (секрет облачного окружения), качество medium, 1024 × 1536; в слой идёт середина 3 : 4, как и прежде
(`scripts/papers_dream.py`). Обрывки, наклейки и портрет — прежние: это бумажные вещи, а не снимки.

Общий хвост (по-английски — инструкция модели): *Shot on an iPhone 4 around 2011 and never edited: a casual, slightly careless phone snapshot in portrait orientation, from an old phone's camera roll. Tiny 5-megapixel sensor look: soft corners, smeared fine detail, visible luminance noise and blotchy colour noise in the shadows, mild JPEG blockiness, slightly crooked horizon, imperfect off-centre framing, nothing staged or composed. Indoors at night the small harsh LED flash lights only the nearest things with hot glare and falls off steeply into murky darkness; without flash there is a muddy yellow-green tungsten cast and hand-shake smear. Flat and unflattering: no cinematic lighting, no colour grading, no film grain, no bokeh, no shallow depth of field, no HDR. Ordinary, mundane, accidental. No people unless described, no readable text, no logos, no brand names.*

| Файл | Начало промпта |
|---|---|
| `thermo` | A glass mercury thermometer lying on a white saucer on a cluttered bedside table next to a half-empty glass of water and a folded wet washcloth; the silver mercury line has crept past the end of the scale. Taken with the flash, close, from above at an angle. |
| `window` | Night, taken through a dark apartment window across a snowy courtyard: the facade of an identical Soviet prefab apartment block, a grid of dark windows, only one lit with warm light, and in it a motionless dark silhouette standing and looking back. Low light, noisy, a little blurred from hand shake, the room faintly reflected in the glass. |
| `phone` | A narrow apartment hallway with old patterned wallpaper; a cream rotary telephone on a small wall shelf, its receiver off the hook, hanging by the coiled cord almost to the floor. Flash photo: the shelf and the phone overexposed, the hallway beyond falling into darkness. |
| `iron` | An electric clothes iron standing upright on an ironing board in a small kitchen at dawn, a thin thread of smoke rising from it; on the white shirt underneath, a brown scorched iron-shaped mark. Dim grey window light, no flash, noisy. |
| `milk` | A glass milk bottle tipped over on a kitchen table covered with a worn patterned oilcloth; the milk has spilled into a white puddle that drips off the table edge. Flash photo from above, nobody in the room. |
| `bed` | An unmade narrow single bed photographed from directly above with the flash: on the white sheet two shallow imprints of lying bodies side by side, although the bed is far too narrow for two; a crumpled pillow with two dents. |
| `corridor` | A long hospital corridor at night with worn green linoleum and pale green painted walls, flickering fluorescent tubes, an empty gurney with a folded grey blanket far at the end, a door ajar with warm light spilling onto the floor. Taken quickly from the hip, tilted, noisy, no flash. |
| `frost` | A frosted window pane in a dark room at dusk: in the frost one single handprint melted from the outside of the glass, although the window is high up in a prefab apartment block; far below, a snowy blue courtyard with one street lamp. Phone photo with a blue cast, noisy. |
| `clock` | A small wind-up alarm clock with no hands on its face, on a bedside table at night beside a glass of water and a pair of folded reading glasses, lit only by the phone's flash; deep black behind. |
| `ticket` | A paper train ticket torn in half lying on the wet tiled floor of an empty railway station waiting hall at night, flat fluorescent light, reflections in a shallow puddle, a row of empty wooden benches out of focus behind. The printing on the ticket is too blurred to read. |
| `drawing` | A child's crayon drawing pinned to faded floral wallpaper with one pushpin: a tall apartment block with many small square windows, all coloured yellow except one solid black window; blue snowflakes drawn around it. Taken straight on with the flash, which leaves a glare spot on the paper. |
| `xray` | A chest X-ray film clipped to a glowing light box in a dark doctor's office: the ribs and spine look normal, but where the heart should be there is the dark shape of a moth with open wings. A quick phone snapshot of the light box, glare, slight moire. |
| `stairs` | An empty stairwell of a prefab apartment block seen from the landing: pale green painted walls, a single bare light bulb, worn concrete steps going down into darkness much further than any building could, the metal railing disappearing into black. Flash photo; the flash reaches only the first few steps. |
| `kettle` | A dark small kitchen at night: a chrome kettle on a gas stove with a small ring of blue flame; its curved polished surface reflects the kitchen behind the photographer and a blurred standing human figure, although the kitchen itself is empty. No flash, noisy, yellow cast. |
