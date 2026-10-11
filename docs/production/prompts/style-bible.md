# Стайл-библия промптов (картинки и видео)

Промпты пишутся по-английски: модели (GPT Image, Nano Banana Pro, Soul Cast, Seedance)
стабильнее на английском. Русские пометки — для команды.

История решений владельца:
- 2026-10-10 — фотореалистичный кинокадр (35 мм, в духе «Брата»); все «живописные» генерации отменены.
- 2026-10-11 (вечер) — **новый базовый промпт**: кадр телевизионной драмы конца 1990-х в духе первых
  сезонов «Улиц разбитых фонарей», аналоговое ТВ стандартной чёткости (§1). Кадры и фоны, сделанные по
  промпту 2026-10-10 (волны 1–91 в `assets/ep01/generation-log.md`), — **старый стиль**: перегенерируются по
  новому промпту по мере бюджета Higgsfield; пока в игре они остаются.

## 1. Базовый промпт (решение владельца, 2026-10-11, вечер)

Единый базовый промпт для всех картинок: фонов, CG, кадров раскадровки, персонажей. Текст — дословно; в
конце заполняется блок SCENE (пять полей). Для предметов мини-игр — отдельный промпт `objects.md`.

```
Create one original fictional live-action television drama still that evokes the cinematography of the first seasons of the Russian series “Ulitsy razbitykh fonarey” / “Streets of Broken Lights”.

PERIOD AND HUMAN PRESENCE

St Petersburg in the late 1990s. A modest television crew filming inside a real, functioning location of that period.

Everyday detective work, ordinary people, fatigue, understated human warmth and dry humor. Distinctive imperfect faces, natural hair, ordinary builds and unretouched skin.

Capture a small ongoing action or a pause inside a conversation: someone listening, waiting for an answer, thinking, handling a piece of paper or leaning toward a car window. Expressions and gestures respond to the situation. Nobody poses for the camera.

CAMERA AND STAGING

Use a practical camera position physically available within the room or vehicle, near the eye level of a participant. Keep the horizon straight.

Favor medium shots, two-shots and group compositions. Place people at different distances when the scene allows. Let a shoulder, furniture edge, door frame or car window naturally overlap the composition.

Use a moderate wide-to-normal field of view, approximately 32-45 mm full-frame equivalent as a visual instruction. Preserve readable spatial relationships and recognizable surroundings. Backgrounds have enough depth of field to remain part of the scene, with modest optical softness.

Frame the conversation or action clearly. Allow slightly cramped spacing and ordinary cropping at the edges. Landscape composition approximately 5:3, one frame, without borders. These are reconstruction settings, not claims about the original camera equipment.

ANALOG TELEVISION IMAGE CHARACTER — ESSENTIAL

Render the image with the visible limitations of late-1990s analog standard-definition television video.

Reduce high-frequency detail and fine local contrast. Individual hair strands should gently merge into natural hair masses. Fine knit loops, fabric fibers, tiny pores, paper fibers, wood grain and dashboard textures should no longer be individually crisp.

Preserve clear facial features, expressions, fingers, gestures, silhouettes and the important contours of objects. Faces remain human and expressive. Soft detail must not turn skin waxy or hands indistinct.

Keep color detail slightly softer than luminance detail. Use restrained color resolution and, at most, a very subtle horizontal softness at strong color boundaries. Do not produce conspicuous color bleeding or rainbow edges.

Allow slight electronic noise mainly in darker areas, modest dynamic range and occasional loss of detail in the brightest areas. Broad shapes and the action remain legible.

Make this texture inherent to the photographed image. Avoid a uniformly blurred, defocused, hazy or artificially distressed appearance. The result should feel like a clean surviving television frame with limited fine detail.

LIGHT AND EXPOSURE

Use light motivated by the actual window, overcast sky and simple room fixtures. Ordinary soft or slightly blunt shadows are appropriate. Keep the lighting plain and physically consistent.

Allow the exposure to be less perfectly balanced than in a contemporary commercial photograph. Different parts of the location can have visibly different brightness. Do not illuminate every face separately.

For a modest daytime office, use a gently warm room tone with subtle natural white-balance irregularity. Pale window areas may lose some exterior detail. Preserve normal skin color and the separate colors of clothing and furniture.

For a scene viewed from a shaded car interior toward a brighter overcast exterior, let the cabin, dashboard and shaded clothing be visibly darker than the street and the person outside. The driver’s face remains readable. The palest exterior areas may approach clipping. Do not crush the entire cabin into black.

Apply these exposure relationships only when they fit the scene. Other locations should follow their own actual light sources.

COLOR

Preserve colors belonging to the objects: honey-brown furniture, pale green or beige walls, off-white paper, washed blue cotton, slate-blue nylon, ochre fabric, rust knitwear and occasional stronger everyday colors.

Allow restrained, slightly imperfect color rendition while keeping these colors distinct. Retain ordinary skin warmth.

No blanket green, yellow, sepia or blue cast. No fashionable teal-and-orange separation.

LOCATION AND COSTUME

Use period-appropriate rooms, vehicles, clothing and objects. Locations are used but functioning.

Furniture and clothes have different ages, materials and practical reasons to be present. Include a few specific everyday objects, casual mismatched clothing and localized signs of wear.

Keep the environment believable without excessive set dressing or exaggerated decay.

AVOID

Modern prestige-TV polish, razor-sharp microdetail, beauty retouching, waxy skin, uniform blur, heavy haze, dramatic rim lighting, volumetric rays, anamorphic flares, very shallow depth of field, fashion styling, heroic poses, theatrical menace, picturesque ruins and obligatory rain.

Avoid large film grain, film scratches, strong VHS tracking damage, scanline overlays, conspicuous chromatic fringes, vignette, timestamps, subtitles, channel logos, watermarks, modern objects and recognizable members of the original cast.

SCENE

Location and time: [Describe the place, year, season and time of day.]
People and action: [Describe the characters and their small ongoing action.]
Camera position: [Describe a physically plausible viewpoint and framing.]
Light sources: [Describe the actual window, sky or room fixtures.]
Essential objects: [List only the objects needed for this scene.]
```

Пометки для команды (технические подстановки `tools/shot_plan.py`, текст промпта не редактируется вручную):

- Строка `St Petersburg in the late 1990s.` — стилевая отсылка к сериалу; планировщик подставляет город и период
  **эпизода** (`Moscow in the early 1990s.` для эпизода 1), а в поле `Location and time` называет место, год, сезон и
  время суток сцены. История остаётся московской, 1993 год.
- `approximately 5:3` → `16:9, the frame of the game`: движок показывает кадры 16:9; модель генерирует 16:9 (2k).
- Перед блоком SCENE планировщик вставляет блок REFERENCE IMAGES (какой референс — комната, какой — персонаж) и блок
  CONTINUITY (§1a): это условие пайплайна «один сет — одна комната, одни и те же люди», не стиль.
- Рантайм накладывает свой камкордер-фильтр (`runtime/src/stage/camcorder.ts`); с «аналоговой» картинкой из
  промпта его интенсивность, возможно, надо будет снизить — проверяется на сборке после первого сета в новом стиле.

## 1б. Сезон и время (решение владельца, 2026-10-11)

Уличный кадр обязан совпадать по сезону с титром сцены: поле `Location and time` называет месяц или сезон словами
(«July 1993, hazy hot summer», «late September», «26 October, cold rain») и перечисляет приметы сезона
(листва, снег, одежда людей). Сезон готовой картинки записывается в `assets.backgrounds[].season`
(`indoor` для интерьеров, `any` для нейтральных), у блоков и сцен — `season`; `tools/validate_episode.py`
сверяет их между собой и с текстом титров-дат. Зимняя улица под титром «лето 1993» — ошибка сборки.

## 1a. Камера для кадров раскадровки (обновлено под базовый промпт 2026-10-11, вечер)

Кадры раскадровки (персонажи, вписанные в окружение) генерируются по **сетам** (локация × свет × состав), а не по
сценам; грамматика — `docs/architecture/08-shot-grammar.md`. Базовый промпт не меняется: конкретный кадр описывается
в поле `Camera position` блока SCENE на языке самого промпта (практическая точка съёмки, уровень глаз участника,
32–45 мм, задний план узнаваем, умеренная мягкость). Правила:

- Крупности: `wide` (общий: камера у двери на уровне глаз стоящего, 32 мм, вся комната, люди внутри неё),
  `medium` (камера в комнате в нескольких шагах от людей, 40 мм, по пояс, ближнее плечо или край стола перекрывает
  кадр), `ots` (из-за плеча, 45 мм: затылок и плечо ближнего перекрывают край кадра, дальний лицом к камере, оба в
  фокусе с умеренной мягкостью), `close` (средне-крупный: камера через стол на уровне глаз, 45 мм, голова и плечи,
  комната узнаваема за спиной — без портретной малой глубины резкости), `reaction` (слушающий, не говорящий),
  `insert` (деталь с высоты глаз сидящего, 45 мм, на расстоянии руки).
- Ракурсы (`angle`): только физически доступные точки в комнате или машине — с крышки шкафа, со стола, с заднего
  сиденья, из коридора через проём; описание конкретное: где стоит камера, куда наклонена, что закрывает передний
  план (`ANGLES` в `tools/shot_plan.py`). Голландский угол запрещён («keep the horizon straight»).
- Свет остаётся мотивированным (поле `Light sources`): окно, настольная лампа, люминесцентные трубки; никакого
  рим-лайта; экспозиция неровная, как у телевизионной камеры (окно может выбелиться, салон машины темнее улицы).
- Персонажи — по референсам (`image_references`: сначала комната или кроп принятого кадра сета, затем спрайты);
  блок REFERENCE IMAGES перечисляет, какой референс кто, а блок CONTINUITY требует сохранить лица, причёски и одежду.
- Каждый результат просматривается; брак — нейронные дефекты (лишние или сросшиеся пальцы, вторая рука, «плавающие»
  предметы, двоящиеся лампы, искривлённые прямые, пластиковая кожа, читаемый псевдотекст), подмена или удвоение людей,
  копия кадрирования референса, изменившиеся лицо, причёска, одежда или цвет предмета. Бракованный кадр
  перегенерируется тем же промптом (при повторном браке — с уточнением), в репозиторий попадает только принятый.

Блок CONTINUITY (вставляется планировщиком после REFERENCE IMAGES, перед SCENE):

```
CONTINUITY AND INTEGRITY (mandatory)
- The room is exactly the referenced background: same furniture, window, wallpaper and props in the same
  places; only the camera moved.
- Each person is exactly the referenced character: same face, age, hair, build and the same clothes in every
  shot of this set; expressions change, clothing never does.
- People are never swapped: the person named for Reference 2 has Reference 2's face and clothes, and so on;
  who is near the camera and who is far is exactly as the scene text says.
- Props are exactly as in the room reference: nothing added (no dust covers, extra chairs, cups or papers),
  nothing removed; the left-to-right order of people and furniture is the same as in the wide view.
- Anatomy and props are coherent even in the soft television image: five fingers on each hand, hands grip
  objects naturally, two eyes looking in one direction, glasses with two lenses; every object appears once
  (one lamp, one typewriter, one glass); nothing floats, melts or merges.
- Any writing on papers, stamps, signs or calendars is out of focus or too small to read; no invented letters.
- Period accuracy, Moscow 1993: no modern phones, cars, LED lights or plastic windows.
```

## 2. Палитра по архетипу (подсказка акцентов внутри описания сцены)

Базовый промпт требует цвета самих предметов без цветного фильтра на весь кадр. Строка ниже вставляется в поле
`Essential objects` как указание на доминирующие материалы и один акцент, не как «грейдинг».

| Архетип | Строка палитры |
|---|---|
| real_estate_murders (пилот) | `PALETTE: grey-green concrete, faded wallpaper, yellow tungsten lamp, overcast daylight` |
| serial_killer | `PALETTE: cold green and graphite grey, night, fluorescent light, a single dried-red accent` |
| gang_war | `PALETTE: navy and black, neon magenta and cyan reflections, gold accents, heavy VHS wear` |
| fraud | `PALETTE: amber and sepia, warm office light, banknote green accent` |
| kidnapping_hostages / prison_escape | `PALETTE: steel blue, red-and-blue emergency lights, searchlights` |
| robbery_cash | `PALETTE: olive and khaki, money green, chrome` |
| corrupt_police | `PALETTE: beige and brown office tones, red stamp accent` |

## 3. Шаблон промпта картинки (блок SCENE)

```
[БАЗОВЫЙ ПРОМПТ §1 целиком; блок SCENE заполняется так:]
SCENE

Location and time: <город, год, месяц или сезон, время суток; место в 1–2 предложениях с конкретными предметами эпохи.>
People and action: <кто в кадре (слева направо), что делает каждый — маленькое действие или пауза; для фона под спрайты — «The room is empty, no people.»>
Camera position: <практическая точка съёмки, уровень глаз, эквивалент 32–45 мм, что перекрывает край кадра, что оставить пустым.>
Light sources: <окно, небо, лампы — реальные источники сцены; время суток.>
Essential objects: <только предметы этой сцены; строка PALETTE §2 при необходимости.>
```

Правила композиции для фонов: горизонт на уровне глаз, центр кадра свободен для спрайтов, нижняя треть без мелких
деталей (там текстовое окно), важные объекты в центральных 60 % ширины (портретный кроп). 16:9; разрешение 2k.

Модели: по умолчанию **GPT Image 2.5** (`gpt_image_2_5`, quality medium, 2k — 1 кредит за кадр); **Nano Banana Pro**
(`nano_banana_pro`, 2 кредита) — для вариантов по референсу утверждённого кадра, когда нужно удержать одно и то же
помещение.

## 4. Персонажи (базовый кадр → выражения)

Базовый промпт §1 целиком, блок SCENE:
```
Location and time: Moscow, 1993; a plain, evenly lit mid-grey wall with no objects (the figure will be cut out).
People and action: Full-body portrait for a visual novel character sprite. <CHARACTER: пол, возраст, телосложение, лицо, причёска, одежда эпохи, 2–3 детали.> The person stands in a three-quarter view turned slightly toward camera-left (all sprites face the same way: the runtime mirrors them to face a partner), in natural, unposed posture, whole body in frame including shoes, subtle expression: neutral, mouth closed. Ordinary face, not model-like.
Camera position: a television camera at chest height, 40 mm-equivalent, the whole figure in frame with headroom.
Light sources: soft overcast window light from the front-left.
Essential objects: none.
```
Выражения — отдельные генерации от базового кадра (`image_references` = база): `tense`
(brows drawn, jaw set), `tired` (heavy eyelids, slight slump), `firm` (direct gaze, chin up),
`grin`, `angry`, `hurt`, `scared`, `worried`, `warm`, `cold` (flat stare), `cornered`
(eyes darting, sweat), `smile`, `focused`, `sad`, `nervous`. Тело и одежда не меняются.
Финальная нарезка слоёв — художник. Текущие спрайты сделаны по промпту 2026-10-10 и служат референсами лиц и
одежды для кадров раскадровки; перегенерация в новом стиле — после решения владельца о бюджете.

Запрещено: портретное сходство с реальными людьми и с актёрами сериала; «крутой» дизайн
преступника (см. `docs/production/ethics-and-legal.md` §4).

## 5. Документы, предметы и UI

Документы, ключи, кассеты и прочий реквизит мини-игр — по промпту `objects.md` (реальная конструкция по фотографиям,
единый масштаб, свет сцены-назначения, аналоговая мягкость). Документы без читаемого текста: текст накладывает
рантайм из локали (`text_key`). Для газеты — колонки как серые полосы, фото как серые прямоугольники.

Плашка заставки: `black background, a single horizontal crimson-red plate slightly off-center,
CRT scanlines, faint static noise, no text` (название накладывает рантайм).

## 6. Видео (Seedance)

Шаблон:
```
Live-action television drama frame in motion, a late-1990s Russian detective series shot on analog standard-definition video (in the spirit of the first seasons of "Streets of Broken Lights", fully original): practical camera position, natural available light, restrained everyday colours, soft video detail, no VHS damage, no text. Static tripod shot, <slow push-in | slow pan | locked off>, <что происходит за 8 секунд: одно событие>, loopable, no people in close-up, no text, no logos.
```
Параметры по умолчанию: `seedance_2_0`, mode `std`, 720p, 8 s, `generate_audio: false`,
`genre: noir`, aspect 16:9. Черновики — `seedance_2_0_mini`, 480p, 4 s. Длинные вставки
(до 30 с) и продление — `seedance_2_5` (`video_extension`). Для «оживления» утверждённого
фона — `start_image` = этот фон.

VHS-эффект в промпте видео допустим только для заставки и склейки (там он «требуется сценой»);
для остальных клипов картинка генерируется чистой, фильтр накладывает рантайм.

## 7. Негативный список (во все промпты)

`no text, no letters, no logos, no watermarks, no captions, no timestamps, no modern objects, no recognizable
real people, no gore, no blood, no weapons in frame, no cartoon or anime style, no painterly or
illustrated look, no neon, no teal-and-orange grading, no HDR look, no film grain, no film scratches, no VHS
tracking damage, no scanline overlays, no vignette, no sepia, no smoke effects, no poster composition`.

## 8. Журнал

Каждая генерация записывается в `assets/<ep>/generation-log.md`: id ассета, модель, промпт
(ссылка на файл промптов + номер), параметры, job id, выбранный вариант, что доработал художник.
