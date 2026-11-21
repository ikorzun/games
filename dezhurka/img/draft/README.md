# Фото-черновик задержанных

Черновая проба: как задержанные могут выглядеть в фотореалистичной графике. Сделано на минимальных
настройках одной генерацией, чтобы потратить как можно меньше кредитов. Это не финальные ассеты.

| Что | Значение |
|---|---|
| Сервис, модель | Higgsfield, `gpt_image_2_6` |
| Настройки | `quality: low`, `resolution: 1k`, `aspect_ratio: 2:3` → лист 688×1024 |
| Цена | 0,25 кредита за весь лист (семь отдельных кадров стоили бы 1,75) |
| Job id | `b5473a7d-dcf7-4046-8b47-d881217c12c6` (2026-11-20) |
| Файлы | `sheet.webp` — лист целиком; `c01…c07.webp` — кадры задержанных 333×247; `lobby.webp` — пустой вестибюль |

Приём: вместо семи картинок модель рисует один лист-«опознание» — сетку 2×4 с одной камерой и одним
вестибюлем во всех кадрах. `tools/cut_sheet.py` режет лист по белым просветам. В игре кадр целиком
встаёт в окно дежурки, решётка и рама рисуются поверх; сержанта в фото-режиме в кадре нет.

Что видно по результату:
- сетка ровная, вестибюль и свет совпадают во всех кадрах, типажи попали в описания;
- у «Иванова» татуировка-якорь на шее читается, шрам над бровью получился едва заметным;
- 333 px на кадр мало: на телефоне сойдёт за «телевизионную» мягкость, на широком экране мыльно.

Если стиль подходит, следующий шаг — те же кадры по одному в нормальном качестве и с сержантом.

## Промпт

Промпт написан по-английски как техническая инструкция (правило проекта); стиль взят из
`docs/production/prompts/style-bible.md` §1 в сжатом виде.

```
A contact sheet of EIGHT separate photographs arranged in a strict grid: 2 columns and 4 rows, all frames exactly the same size, landscape 4:3, separated by thin straight white gutters, white outer border. No text, no captions, no numbers, no labels anywhere.

Every frame is a still from a fictional Russian television crime drama of the late 1990s, analog standard-definition video look: soft fine detail, modest dynamic range, plain natural colors, ordinary imperfect unretouched faces, nobody poses.

SAME fixed camera and SAME location in all eight frames: the shabby entrance lobby of a Russian militia (police) station at night in October 1994, seen straight-on from the duty officer's desk window at eye level. Background identical in every frame: wall painted in two tones, dingy off-white above and dark institutional green oil paint below chest height, a brown wooden door on the right side, cold fluorescent tube light from above. No bars, no glass reflections, no window frame in the picture.

In frames 1 to 7 one detained person stands in the center facing the camera, framed from the chest up, head in the upper middle of the frame, same scale in every frame, tired late-night expression. Frame 8 has no people.

Row 1 left, frame 1: thin student, 20 years old, shaggy dark-blond hair, round wire glasses, worried look, denim jacket over a knitted olive sweater.
Row 1 right, frame 2: worker, 33, sullen, heavy stubble, grey flat cap, dark quilted padded work jacket (telogreika).
Row 2 left, frame 3: kind old woman, 71, deep wrinkles, dark red floral headscarf tied under the chin, old dark winter coat with a worn fur collar.
Row 2 right, frame 4: stout calm man, 44, bald on top with grey hair on the sides, thick grey moustache, olive windbreaker open over a white double-breasted chef's jacket.
Row 3 left, frame 5: slim tipsy man, 39, slicked-back thinning dark hair, rectangular glasses, flushed cheeks, sly half-smile, grey overcoat, white shirt, loosened burgundy tie.
Row 3 right, frame 6: hard-faced man, 33, buzz cut, stubble, cold stare, an old pale scar cutting across his left eyebrow, a small dark-blue anchor tattoo on the side of his neck, black leather jacket, open shirt collar.
Row 4 left, frame 7: stocky smug businessman, 28, short dark hair, clean-shaven, crimson raspberry-colored blazer with wide shoulders, black shirt, thick gold chain.
Row 4 right, frame 8: the same lobby completely empty, same camera, nobody in it.
```
