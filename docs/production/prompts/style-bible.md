# Стайл-библия промптов (картинки и видео)

Промпты пишутся по-английски: модели (Nano Banana Pro, GPT Image, Soul Cast, Seedance)
стабильнее на английском. Русские пометки — для команды.

## 1. Строка стиля (ставится в начало каждого промпта картинки)

```
STYLE: painted illustration over a photographic base (photobash look), Russia 1993, late-Soviet
interiors and streets, documentary realism, moderately stylized, muted desaturated palette with
cold grey-green shadows and warm tungsten-lamp accents, soft film grain, slightly faded like a
VHS recording from 1993, cinematic 35mm framing, clean image without filters or overlays.
NO: text, letters, signs with words, logos, watermarks, modern objects (plastic windows, LED
lights, smartphones, modern cars), real recognizable people, gore, blood.
```

Для персонажей и документов строка стиля сокращается (см. §4, §5).

## 2. Палитра по архетипу (добавляется второй строкой)

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
[STYLE] [PALETTE]
SUBJECT: <что в кадре, 1–2 предложения, конкретные предметы эпохи>
COMPOSITION: <план, ракурс, где пусто под текст/спрайты>
LIGHT: <источник, время суток, погода>
MOOD: <одно слово>
```

Правила композиции для фонов: горизонт на уровне глаз, центр кадра свободен для спрайтов,
нижняя треть без мелких деталей (там текстовое окно), важные объекты в центральных 60 % ширины
(портретный кроп). Разрешение 2k, 16:9.

## 4. Персонажи (Soul Cast → выражения)

Базовый промпт персонажа:
```
STYLE: painted illustration, documentary realism, moderately stylized, Russia 1993; full-body
character for a visual novel sprite, three-quarter view, standing, neutral grey studio background,
even soft light, no shadows on the background, no text.
CHARACTER: <пол, возраст, телосложение, лицо, причёска, одежда эпохи, 2–3 детали>
EXPRESSION: neutral, mouth closed
```
Выражения — отдельные генерации от базового кадра (`image_references` = база): `tense`
(brows drawn, jaw set), `tired` (heavy eyelids, slight slump), `firm` (direct gaze, chin up),
`grin`, `angry`, `hurt`, `scared`, `worried`, `warm`, `cold` (flat stare), `cornered`
(eyes darting, sweat), `smile`, `focused`, `sad`, `nervous`. Тело и одежда не меняются.
Финальная нарезка слоёв — художник.

Запрещено: портретное сходство с реальными людьми; «крутой» дизайн преступника (см.
`docs/production/ethics-and-legal.md` §4).

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
[STYLE as one sentence] Static tripod shot, <slow push-in | slow pan | locked off>, <что
происходит за 8 секунд: одно событие>, loopable, no people in close-up, no text, no logos.
```
Параметры по умолчанию: `seedance_2_0`, mode `std`, 720p, 8 s, `generate_audio: false`,
`genre: noir`, aspect 16:9. Черновики — `seedance_2_0_mini`, 480p, 4 s. Длинные вставки
(до 30 с) и продление — `seedance_2_5` (`video_extension`). Для «оживления» утверждённого
фона — `start_image` = этот фон.

VHS-эффект в промпте видео допустим только для заставки и склейки; для остальных клипов
картинка генерируется чистой, фильтр накладывает рантайм.

## 7. Негативный список (во все промпты)

`no text, no letters, no logos, no watermarks, no captions, no modern objects, no recognizable
real people, no gore, no blood, no weapons in frame, no cartoon or anime style, no neon
cyberpunk, no HDR look`.

## 8. Журнал

Каждая генерация записывается в `assets/<ep>/generation-log.md`: id ассета, модель, промпт
(ссылка на файл промптов + номер), параметры, job id, выбранный вариант, что доработал художник.
