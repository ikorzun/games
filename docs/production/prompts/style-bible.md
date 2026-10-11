# Стайл-библия промптов (картинки и видео)

Промпты пишутся по-английски: модели (GPT Image, Nano Banana Pro, Soul Cast, Seedance)
стабильнее на английском. Русские пометки — для команды. Стиль утверждён владельцем 2026-10-10:
фотореалистичный кинокадр, а не живопись (§1); все предыдущие «живописные» генерации отменены.

## 1. Базовый промпт (решение владельца, 2026-10-10)

Единый базовый промпт для всех картинок: фонов, CG, персонажей, концепт-кадров. Фотореализм
«кинокадра» в духе операторской работы «Брата» Балабанова без копирования конкретных кадров;
никакой живописи, фотобаша и накладных VHS-эффектов в самой картинке (зерно, фильтры и титры
накладывает рантайм). Текст базового промпта — дословно, в конце подставляется описание сцены.

```
Create a photorealistic cinematic still for an adult historical visual novel.

Visual language: restrained observational realism of 1990s post-Soviet crime drama, in the cinematographic spirit of Aleksei Balabanov's "Brother", but fully original. Do not recreate any specific frame, actor, costume, or recognizable shot from the film. Transfer only the principles of cinematography, atmosphere, and realism.

The image must feel like a real frame from a grounded low-budget 1990s crime drama: ordinary people, believable lived-in spaces, natural imperfections, quiet tension, and a sense of daily life continuing around the investigation.

STYLE AND MOOD
- Photorealistic, not illustrated, not painterly, not stylized CGI.
- Calm, observational, understated.
- Tension through stillness, silence, pauses, and composition, not through action spectacle.
- No glamour, no fashion-shoot look, no glossy polish.
- The world should feel authentic, modest, used, slightly worn, and materially believable.

CAMERA
- Human eye-level camera.
- Static or very restrained framing.
- Natural 35mm or 40mm lens feeling.
- No extreme wide-angle distortion.
- No dramatic dutch angles, no cinematic over-stylization.
- Composition should feel practical and accidental rather than designed for advertisement.
- Characters should exist inside the environment, not dominate it like heroic portraits.

LIGHTING
- Naturalistic available light.
- Overcast daylight, soft window light, or ordinary practical interior lighting.
- Slightly imperfect mixed lighting is acceptable if realistic.
- No theatrical rim light, no dramatic spotlights, no golden-hour beauty light.
- No excessive contrast, no HDR look, no artificial volumetric rays.

COLOR
- Muted natural palette.
- Dull greens, browns, grays, pale ochres, faded blues.
- Skin tones realistic and subdued.
- No teal-and-orange grading.
- No neon palette.
- No strong color filter over the whole image.
- The color should feel like real film photography from a grounded drama.

TEXTURE AND IMAGE QUALITY
- Subtle 35mm film feel, soft microcontrast, natural grain if needed.
- No fake VHS overlay, no timestamps, no scanlines.
- No exaggerated blur or fake vintage damage.
- No hyper-sharp digital commercial clarity.
- The image should feel tactile, photographed, and period-appropriate.

ENVIRONMENT
- Spaces must feel geographically and socially specific.
- Interiors: modest offices, stairwells, rented rooms, police rooms, corridors, airport halls, bank back offices, courtyards, old streets.
- Everything should feel functional and believable, not set-designed for nostalgia.
- Objects, furniture, walls, windows, flooring, and props should reflect the mid-1990s.
- Avoid anachronisms and modern devices.

CHARACTERS
- Ordinary faces, not model-like.
- Natural posture, unposed behavior.
- Everyday clothing appropriate to the location and year.
- No exaggerated emotion.
- Expressions subtle: tiredness, suspicion, attentiveness, uncertainty, restraint.
- Preserve realism in anatomy, skin texture, and clothing folds.

IMPORTANT RESTRICTIONS
- No UI, no captions, no text overlays, no logos unless explicitly required by the scene.
- No readable invented gibberish text.
- No collage.
- No poster composition.
- No action-movie drama.
- No visual cliches of "retro crime" like heavy sepia, smoke effects, or forced darkness.
- No stylized nostalgia effects.
- No surrealism.

FINAL GOAL
Produce a single believable cinematic still that looks like an original frame from a grounded 1990s investigative visual novel set in the real world.

SCENE TO DEPICT:
[insert specific scene description here]
```

Пометка для команды: раздел ENVIRONMENT в базовом промпте намеренно шире эпизода 1 (аэропорт,
банк) — он общий на сезон; модель берёт из него только то, что подходит сцене.

## 1б. Сезон и время (решение владельца, 2026-10-11)

Уличный кадр обязан совпадать по сезону с титром сцены: SCENE TO DEPICT называет месяц или сезон словами
(«July 1993, hazy hot summer», «late September», «26 October, cold rain») и перечисляет приметы сезона
(листва, снег, одежда людей). Сезон готовой картинки записывается в `assets.backgrounds[].season`
(`indoor` для интерьеров, `any` для нейтральных), у блоков и сцен — `season`; `tools/validate_episode.py`
сверяет их между собой и с текстом титров-дат. Зимняя улица под титром «лето 1993» — ошибка сборки.

## 1a. Камера для кадров раскадровки (решение владельца, 2026-10-11)

Блок CAMERA базового промпта описывает **установочный** кадр и фоны. Для кадров раскадровки
(персонажи, вписанные в окружение: общий, средний, крупный план, «восьмёрка», детали, неожиданные
ракурсы) блок CAMERA **заменяется** описанием конкретного кадра. Остальной базовый промпт — без
изменений: реализм, естественный свет, приглушённая палитра, никакого глянца и «ретро»-клише.

Цель раскадровки — динамика разговора, тревожность и напряжение через крупность, пространство кадра
и ракурс (`docs/architecture/08-shot-grammar.md`). Правила:

- Крупности: `wide` (общий, люди малы в пространстве), `medium` (по пояс, двое-трое), `ots`
  (через плечо, 50 мм, малая глубина резкости), `close` (крупный, 85 мм), `insert` (деталь: руки,
  документ, сигарета, телефон), `reaction` (слушающий, не говорящий).
- Ракурсы: уровень глаз по умолчанию; `low` (с уровня стола или пола, потолок в кадре — давление,
  угроза), `high` (сверху, со шкафа — система больше человека), `doorway` (из коридора через дверной
  проём, кадр в кадре — наблюдение), `reflection` (в стекле, зеркале), `foreground` (предметы на
  переднем плане закрывают часть кадра — скрытность, слежка). Голландский угол — только лёгкий
  (≤ 5°) и только в блоках pursuit/confrontation.
- Объективы: 28–35 мм для общих и «через проём», 40–50 мм для средних и OTS, 85 мм для крупных;
  без сверхширокоугольной дисторсии.
- Свет остаётся мотивированным (окно, настольная лампа, люминесцентные трубки); в крупных планах
  допускается полутень на половине лица и контровой свет от окна — но не студийный рим-лайт.
- Персонажи — по референсам (`image_references`: сначала фон локации, затем спрайты); промпт
  перечисляет, какой референс кто, и требует сохранить лица, причёски и одежду.
- Кадры генерируются по **сетам** (локация × освещение × состав), а не по сценам: крупный план
  Громова за своим столом переиспользуется во всех сценах кабинета.

Усиление кинематографичности и реализма (решение владельца, 2026-10-11): к базовому промпту для кадров
раскадровки добавляются блоки PHOTOGRAPHIC REALISM и CONTINUITY (ниже), а каждый результат просматривается
и бракуется при нейронных дефектах — лишние или сросшиеся пальцы, вторая рука, «плавающие» предметы, двоящиеся
лампы и ручки, искривлённые прямые (рамы, дверные коробки, край стола), пластиковая кожа, текстуры без
структуры, читаемый псевдотекст, изменившиеся лицо, причёска или одежда персонажа. Бракованный кадр
перегенерируется тем же промптом (при повторном браке — с уточнением проблемного места), в репозиторий
попадает только принятый.

```
PHOTOGRAPHIC REALISM (mandatory)
- The frame is a still from a 1990s motion picture shot on 35mm colour negative film with vintage spherical
  lenses: gentle highlight roll-off, soft micro-contrast, fine organic grain, slight halation around the desk
  lamp and the window; no digital sharpening, no HDR, no plastic smoothness.
- Physically correct optics for the stated lens: consistent depth of field, straight lines stay straight,
  no fisheye or warped geometry on frames, doors, table edges or window bars.
- Anatomy and props are exactly right: five fingers on each hand, hands grip objects naturally, two eyes
  looking in one direction, normal teeth, glasses with two lenses; every object appears once (one lamp, one
  typewriter, one glass); nothing floats, melts or merges; fabric shows weave and wrinkles, skin shows pores,
  hair has individual strands.
- Any writing on papers, stamps, signs or calendars is out of focus or too small to read; no invented letters.
- Period accuracy, Moscow 1993: no modern phones, cars, LED lights or plastic windows.

CONTINUITY (mandatory)
- The room is exactly the referenced background: same furniture, window, wallpaper and props in the same
  places; only the camera moved.
- Each person is exactly the referenced character: same face, age, hair, build and the same clothes in every
  shot of this set; expressions change, clothing never does.
- People are never swapped: the person named for Reference 2 has Reference 2's face and clothes, and so on;
  who is near the camera and who is far is exactly as the scene text says.
```

Шаблон блока CAMERA для кадра раскадровки:

```
CAMERA (this shot)
- Shot size: <wide | medium two-shot | over-the-shoulder | close-up | insert | reaction shot>.
- Angle and height: <eye level | low angle from desk height | high angle from the cabinet top |
  from the corridor through the half-open door | reflection in the window glass>.
- Lens: <35mm deep focus | 50mm shallow depth of field | 85mm portrait>.
- Composition: <who is where; what is in the foreground; looking room or its lack; headroom;
  negative space; frame within frame>.
- Framing is motivated by the moment: <one sentence: what the viewer should feel>.
```

## 2. Палитра по архетипу (подсказка акцентов внутри описания сцены)

Базовый промпт требует естественную приглушённую палитру без цветного фильтра на весь кадр.
Строка ниже вставляется в описание сцены как указание на доминирующие материалы и один акцент,
не как «грейдинг».

| Архетип | Строка палитры |
|---|---|
| real_estate_murders (пилот) | `PALETTE: grey-green concrete, faded wallpaper, yellow tungsten lamp, overcast daylight` |
| serial_killer | `PALETTE: cold green and graphite grey, night, fluorescent light, a single dried-red accent` |
| gang_war | `PALETTE: navy and black, neon magenta and cyan reflections, gold accents, heavy VHS wear` |
| fraud | `PALETTE: amber and sepia, warm office light, banknote green accent` |
| kidnapping_hostages / prison_escape | `PALETTE: steel blue, red-and-blue emergency lights, searchlights` |
| robbery_cash | `PALETTE: olive and khaki, money green, chrome` |
| corrupt_police | `PALETTE: beige and brown office tones, red stamp accent` |

## 3. Шаблон промпта картинки

```
[БАЗОВЫЙ ПРОМПТ §1 целиком, вместо последней строки:]
SCENE TO DEPICT:
<Где и когда: место, город, месяц и год.> <Что в кадре: 1–3 предложения, конкретные предметы
эпохи.> <Люди: есть/нет; если фон под спрайты — «empty room, no people».> <Композиция: план,
ракурс, что оставить пустым.> <Свет: источник, время суток, погода.> <Палитра §2 как акцент.>
```

Правила композиции для фонов: горизонт на уровне глаз, центр кадра свободен для спрайтов,
нижняя треть без мелких деталей (там текстовое окно), важные объекты в центральных 60 % ширины
(портретный кроп). 16:9; разрешение максимальная у модели (2k у Nano Banana Pro).

Модели: по умолчанию **GPT Image 2.5** (`gpt_image_2_5`, 0,25 кредита за кадр, сильный
фотореализм); **Nano Banana Pro** (`nano_banana_pro`, 2 кредита) — для вариантов по референсу
утверждённого кадра (`image_references`), когда нужно удержать одно и то же помещение.

## 4. Персонажи (базовый кадр → выражения)

Базовый промпт §1 целиком, описание сцены:
```
SCENE TO DEPICT:
Full-body portrait for a visual novel character sprite, Moscow 1993. <CHARACTER: пол, возраст,
телосложение, лицо, причёска, одежда эпохи, 2–3 детали.> The person stands in a three-quarter
view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture against a plain, evenly lit mid-grey wall with no objects
(the figure will be cut out), soft overcast window light from the front-left, whole body in
frame including shoes, subtle expression: neutral, mouth closed. Ordinary face, not model-like.
```
Выражения — отдельные генерации от базового кадра (`image_references` = база): `tense`
(brows drawn, jaw set), `tired` (heavy eyelids, slight slump), `firm` (direct gaze, chin up),
`grin`, `angry`, `hurt`, `scared`, `worried`, `warm`, `cold` (flat stare), `cornered`
(eyes darting, sweat), `smile`, `focused`, `sad`, `nervous`. Тело и одежда не меняются.
Финальная нарезка слоёв — художник. Soul Cast допустим для базового кадра, если даёт более
устойчивое лицо между выражениями; стиль задаёт тот же базовый промпт.

Запрещено: портретное сходство с реальными людьми и с актёрами «Брата»; «крутой» дизайн
преступника (см. `docs/production/ethics-and-legal.md` §4).

## 5. Документы и UI

```
STYLE: flat scan of a Soviet-era official paper form, yellowed paper, typewriter lines and table
rules, blurred purple stamp circles, NO readable text, NO letters, empty fields; top-down, even
light, 3:4.
```
Текст документа накладывает рантайм из локали (`text_key`). Для газеты — колонки как серые
полосы, фото как серые прямоугольники.

Плашка заставки: `black background, a single horizontal crimson-red plate slightly off-center,
CRT scanlines, faint static noise, no text` (название накладывает рантайм).

## 6. Видео (Seedance)

Шаблон:
```
Photorealistic cinematic still in motion, restrained observational realism of a 1990s post-Soviet crime drama (in the cinematographic spirit of Balabanov's "Brother", fully original), natural available light, muted natural palette, subtle 35mm film feel, no VHS overlay, no text. Static tripod shot, <slow push-in | slow pan | locked off>, <что
происходит за 8 секунд: одно событие>, loopable, no people in close-up, no text, no logos.
```
Параметры по умолчанию: `seedance_2_0`, mode `std`, 720p, 8 s, `generate_audio: false`,
`genre: noir`, aspect 16:9. Черновики — `seedance_2_0_mini`, 480p, 4 s. Длинные вставки
(до 30 с) и продление — `seedance_2_5` (`video_extension`). Для «оживления» утверждённого
фона — `start_image` = этот фон.

VHS-эффект в промпте видео допустим только для заставки и склейки (там он «требуется сценой»);
для остальных клипов картинка генерируется чистой, фильтр накладывает рантайм.

## 7. Негативный список (во все промпты)

`no text, no letters, no logos, no watermarks, no captions, no modern objects, no recognizable
real people, no gore, no blood, no weapons in frame, no cartoon or anime style, no painterly or
illustrated look, no neon, no teal-and-orange grading, no HDR look, no fake VHS overlay, no sepia,
no smoke effects, no poster composition`.

## 8. Журнал

Каждая генерация записывается в `assets/<ep>/generation-log.md`: id ассета, модель, промпт
(ссылка на файл промптов + номер), параметры, job id, выбранный вариант, что доработал художник.
