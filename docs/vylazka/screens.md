# Картинки выставочных экранов: как сделаны

Большие экраны в игре светятся картинками: природа, природа не на своём месте, обрывки
поп-культуры (`untitled_session.md`, §2; устройство — `design.md`, §6, «Плоские вещи»). Здесь —
запросы, по которым картинки сделаны, чтобы их можно было повторить или дополнить.

Сами файлы — `vylazka/assets/screens/` (там же README: размеры и как добавить картинку).

Где стоят экраны (решение партнёра от 14.11): **только в офисе** — и ровно **два на весь этаж
жёлтых комнат**, «как соединение смысла и пространств»; в убежище их нет. На ближнем экране жёлтых
комнат — то же, что в офисе (природа или «странное»). Дальний — **проём**: на нём не картинка из
этого набора, а кадр самой игры — луг, на который попадаешь, войдя в экран (см. «Луг для проёма»
ниже). «Поп-культуру» (студия
телеигры, кадр мультфильма) показывает один экран — телевизор в комнате отдыха офиса: общая память,
то, что смотрели все. «Нет сигнала» (настроечные полосы, «снег») экран показывает сам, если его
картинка не загрузилась.

## Условия

- Модель: GPT Image 2 через ElevenLabs. Пропорция 9 : 16, разрешение 1K (720 × 1280), обычное качество.
- Одна попытка на картинку; все восемь приняты с первой. 185 кредитов за штуку, всего 1 477.
- На картинках нет людей, надписей, знаков и узнаваемых героев. «Поп-культура» — это род картинки
  (студия телеигры, кадр мультфильма), а не чьи-то персонажи: всё придумано заново.
- Запросы написаны по-английски: это техническая инструкция модели. Русская пометка — что должно выйти.

## Запросы

### roots — корни в срезе земли (природа)

> Vertical photograph of a cut bank in a forest, seen straight on and filling the whole frame: a
> cross-section of red-brown clay soil with pale twisting tree roots running down through it from the
> top edge, small green ferns and seedlings clinging to the earth, a strip of forest floor with leaves
> at the very top. Soft overcast daylight, natural colours, sharp detail. No people, no text, no watermark.

### moss — поваленный ствол во мху (природа)

> Vertical photograph of a huge fallen tree trunk covered in thick green moss in an old spruce forest,
> tangled roots and grey lichen, a few orange leaves caught in the moss, tall dark trunks behind, cool
> misty air with one soft sunbeam. Low viewpoint close to the trunk, natural colours, sharp detail. No
> people, no text, no watermark.

### lichen — бетон в разноцветном лишайнике (странное)

> Vertical photograph, straight-on view of a bare concrete wall in an abandoned building that is being
> overgrown: round colonies of lichen in unnaturally saturated colours — orange, turquoise, magenta,
> sulphur yellow — spreading in concentric rings, small wild flowers and moss growing straight out of
> the concrete, a faint oil-film iridescent sheen over the surface. Even soft light. Strange but fully
> photographic. No people, no text, no watermark.

### flooded — затопленная гостиная (странное)

> Vertical photograph of an ordinary 1980s apartment living room flooded ankle-deep with perfectly
> clear, still water: a patterned carpet visible under the water, white water lilies and green lily
> pads floating between a sofa and an armchair, the reflection of a window lying on the water, floral
> wallpaper, a floor lamp. Calm daylight, natural colours, sharp detail. No people, no text, no watermark.

### birches — берёзы сквозь пол офиса (странное)

> Vertical photograph of an empty open-plan office where young birch trees grow straight up through the
> grey carpet and through the suspended ceiling tiles: white trunks standing between rows of desks with
> old beige computer monitors, fallen yellow leaves on the desks and floor, fluorescent ceiling panels
> still switched on. Quiet, photographic, slightly cool colours. No people, no text, no logos, no watermark.

### deer — косуля в подъезде (странное)

> Vertical photograph of a wild roe deer standing calmly on the concrete landing of a staircase inside
> an old panel apartment block: lower walls painted green, a row of metal mailboxes, a window with
> frosted glass, worn concrete steps going up. The deer looks straight at the camera. Dim natural light
> from the window, photographic, muted colours. No people, no text, no watermark.

### gameshow — пустая студия телеигры (поп-культура)

> Vertical photograph of an empty 1990s television game show studio with the lights still on: a big
> prize wheel with plain coloured segments, a glitter curtain, three contestant podiums, a shiny floor,
> coloured spotlights and stage haze. Saturated videotape-era colours, slight softness. Nobody is there.
> No text, no letters, no numbers, no logos anywhere, no watermark.

### cartoon — кадр рисованного мультфильма (поп-культура)

> A single frame from an imaginary hand-drawn children's animated film of the 1980s, vertical format: a
> round, fluffy blue creature with big eyes and tiny legs stands on top of a green hill and waves;
> behind it a small red house, a crooked tree and a big pale sun; painted gouache background, flat cel
> paint on the character, slight film grain. The character is original and not based on any existing
> cartoon. No text, no logos, no watermark.

## Берёзы, которые сбылись

Картинка `birches` — берёзы, проросшие сквозь пол офиса, — больше не только картинка. По просьбе
партнёра (15.11) такие же берёзы стоят в отделе офиса: сквозь ковролин и потолок, с выбитыми плитами
и голыми ветками, без листьев; они прорастают по мере стирания места (`design.md`, §14). Экраны того же этажа по-прежнему её показывают: теперь это
обещание, которое в одной из комнат сбывается.

## Луг для проёма

`meadow` — девятая картинка, и она не сгенерирована: это кадр карманного пространства «луг» с точки
появления игрока — тропа к дверной раме, облака, холмы. Нейросеть и кредиты не тратились; чужого
в кадре нет. Снят в самой игре: сборка, адрес `?level=pocket_meadow&q=high`, окно 720 × 1280,
интерфейс скрыт; дальше как у остальных — срезать до 3 : 5 и уменьшить до 384 × 640.

Зачем свой кадр, а не красивая картинка луга: экран-проём обещает место, и обещание должно
сбыться — вошёл и увидел то же самое. Если луг изменится (другие вещи, другое небо), кадр надо
переснять. Мелочи при этом совпадать не обязаны: луг каждый раз собирается по сиду заново, и это
в правилах игры — место не обязано остаться прежним.

## Что стоит добавить

- Больше «общей памяти»: новогодний концерт без лиц, прогноз погоды, заставка между передачами,
  кадр видеоигры девяностых — всё придуманное, без чужих знаков.
- Картинки под конкретные вылазки (`sorties.md`): двор из окна, школьный коридор, больничное окно со
  снегом. Экран тогда работает как «окно» в соседнюю вылазку.
- Подписи на экранах — строками самой игры (тем же голосом, что вспышки воспоминаний): экран как
  носитель слоя «сеть».

## Снимки как с iPhone 4 (партнёр 21.11, 21:29)

Слова партнёра: «Картинки в воспоминаниях сейчас слишком нейронные. Давай поправим стиль, словно они сняты на iphone4». Восемь
картинок экранов сделаны заново — те же сюжеты, но как кадры с телефона: косуля в подъезде со вспышкой, затопленная комната
с порога против окна, мультфильм — снимок экрана старого телевизора, со строками развёртки и бликом лампы. Модель — GPT Image 2.6
через ключ OpenAI партнёра, качество medium, 1024 × 1536; для экранов — середина 9 : 16 (720 × 1280, `master/`), в игру — середина
3 : 5 (384 × 640). Кадр луга (`meadow.webp`) — по-прежнему кадр самой игры.

Общий хвост — тот же, что у снимков больного сна (`vylazka/assets/papers/dream_prompts.md`, глава про iPhone 4). Сюжеты:
- `roots`: *A cut bank in a forest seen straight on and filling most of the frame: a cross-section of red-brown clay soil with pale twisting tree roots running down through it from the top, small ferns and seedlings clinging to the earth, a strip of forest floor with leaves at the top. Grey overcast day, slightly overexposed, soft detail.*
- `moss`: *A huge fallen tree trunk covered in thick green moss in an old spruce forest, tangled roots and grey lichen, a few orange leaves caught in the moss, tall dark trunks behind. Grey wet day, taken low and close to the trunk, a raindrop smear on the lens in one corner.*
- `lichen`: *A bare concrete wall in an abandoned building that is being overgrown: round colonies of lichen in unnaturally saturated colours — orange, turquoise, magenta, sulphur yellow — spreading in concentric rings, small wild flowers and moss growing straight out of the concrete. Taken straight on with the flash in a dim corridor, hot spot in the middle.*
- `flooded`: *An ordinary 1980s apartment living room flooded ankle-deep with perfectly clear still water: a patterned carpet visible under the water, white water lilies and green lily pads floating between a sofa and an armchair, floral wallpaper, a floor lamp. Taken from the doorway, daylight from the window blown out, a bit tilted.*
- `birches`: *An empty open-plan office where young birch trees grow straight up through the grey carpet and through the suspended ceiling tiles: white trunks between rows of desks with old beige computer monitors, fallen yellow leaves on desks and floor, fluorescent ceiling panels still on. Greenish fluorescent cast, slightly blurred.*
- `deer`: *A wild roe deer standing calmly on the concrete landing of a staircase inside an old panel apartment block: lower walls painted green, a row of metal mailboxes, a frosted glass window, worn concrete steps going up. The deer looks straight at the camera; taken with the flash, its eyes glow back from the flash, the stairwell behind falls into darkness.*
- `gameshow`: *An empty 1990s television game show studio with the lights still on, taken from the empty audience seats: a big prize wheel with plain coloured segments, a glitter curtain, three contestant podiums, a shiny floor, coloured spotlights blown out into flares. Nobody there. No letters, no numbers, no logos anywhere.*
- `cartoon`: *A photo of an old CRT television screen in a dark room, taken at a slight angle: on the screen a frame of a hand-drawn children's cartoon from the 1980s — a round fluffy blue creature with big eyes and tiny legs stands on a green hill and waves, a small red house, a crooked tree and a big pale sun behind it. Visible scan lines and moire, the curved glass reflecting a lamp glare. The character is original and not based on any existing cartoon. No text, no logos.*
