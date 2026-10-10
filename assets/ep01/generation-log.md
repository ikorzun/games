# Журнал генераций: эпизод 1 «Смерть за квартиры»

Формат: id ассета · модель · промпт (файл, строка) · параметры · job id · результат · статус.
Файлы результатов хранятся в Higgsfield (галерея аккаунта); в репозиторий попадают только
утверждённые и сконвертированные webp/webm по путям из `assets` в JSON эпизода.

## Стиль-тест 2026-10-10

| id | Модель | Промпт | Параметры | Job id | Статус |
|---|---|---|---|---|---|
| `bg_office_prosecutor` | Nano Banana Pro (backend: nano_banana_2) | `docs/production/prompts/ep01-images.md`, фоны → bg_office_prosecutor | 16:9, 2k, 1 вариант, 2 кредита | `1e7e99d4-f025-4f71-a9ad-4d8b531dcac6` | сгенерирован, на утверждение владельцем |
| `bg_yard_summer` | Nano Banana Pro (backend: nano_banana_2) | там же → bg_yard_summer | 16:9, 2k, 1 вариант, 2 кредита (первая попытка — 429 rate limit, повтор успешен) | `6015a979-fcf8-4aeb-9474-8005abd766f6` | сгенерирован, на утверждение владельцем |
| `v_common_title` | Seedance 2.0 Mini | `docs/production/prompts/ep01-video.md` → v_common_title | 480p, 4 s, без звука, noir (preflight: 2 кредита) | — | **не запущен**: Higgsfield ответил «Requires basic plan or higher» — видеомодели Seedance недоступны на бесплатном плане этого аккаунта |

Заметки:
- Результаты не просмотрены из облачной сессии (хост CDN заблокирован сетевой политикой); оценка стиля — за владельцем в галерее Higgsfield.
- После утверждения: сохранить png → конвертировать в webp q80 1920×1080 → `assets/ep01/bg/office_prosecutor.webp`, `assets/ep01/bg/yard_summer.webp`; утверждённые картинки использовать как `image_references` в следующих генерациях (см. `docs/production/prompts/style-bible.md` §1).

## Фоны, партия 1 — 2026-10-10

Референс стиля во всех четырёх: `image_references` = утверждённый кабинет (`1e7e99d4-f025-4f71-a9ad-4d8b531dcac6`).
Полный текст промптов: строка стиля `style-bible.md` §1 + палитра архетипа + строка из `docs/production/prompts/ep01-images.md` → «Фоны».

| id | Модель | Промпт | Параметры | Job id | Статус |
|---|---|---|---|---|---|
| `bg_apartment_zoya` | Nano Banana Pro (backend: nano_banana_2) | `ep01-images.md` → bg_apartment_zoya | 16:9, 2k (2752×1536), 1 вариант, 2 кредита | `340fc069-9689-4c3c-8d85-2e5fab87d0c2` | сгенерирован, на утверждение владельцем |
| `bg_notary_office` | Nano Banana Pro (backend: nano_banana_2) | там же → bg_notary_office | 16:9, 2k, 1 вариант, 2 кредита | `bafeae79-26f1-4a62-a040-f2f871c4e354` | сгенерирован, на утверждение владельцем |
| `bg_interrogation` | Nano Banana Pro (backend: nano_banana_2) | там же → bg_interrogation | 16:9, 2k, 1 вариант, 2 кредита (в пакете — 429 rate limit; повтор по одному успешен) | `de2c607f-0b04-4870-830f-7f0f5549d572` | сгенерирован, на утверждение владельцем |
| `bg_stairwell` | Nano Banana Pro (backend: nano_banana_2) | там же → bg_stairwell | 16:9, 2k, 1 вариант, 2 кредита (в пакете — 429; повтор успешен) | `5941808c-d85d-44aa-bd95-94f3748a514f` | сгенерирован, на утверждение владельцем |

Заметки:
- Пакетная отправка 4 промптов Nano Banana Pro стабильно даёт 429 на 2 из 4: отправлять по одному-два, ждать `completed`, потом следующий.
- Баланс после партии: 1 кредит (бесплатный план). Следующие партии (ЖЭК, Пресня днём, квартира Мурашова, БТИ, суд, улица ночью, Москва-1993, кабинет-2004) — после пополнения: 8 фонов × 2 кредита = 16 кредитов за один вариант каждого; CG ×3 и персонажи ×9 — отдельно.
- Сгенерировано по одному варианту вместо трёх по плану (экономия кредитов); варианты докручиваем только для фонов, которые владелец отклонит.
- Целевые пути после утверждения: `assets/ep01/bg/apartment_zoya.webp`, `assets/ep01/bg/notary_office.webp`, `assets/common/bg/interrogation.webp` (общий для сезона), `assets/ep01/bg/stairwell.webp`.

## Смена стиля — 2026-10-10 (решение владельца)

Все шесть сгенерированных выше фонов (`bg_office_prosecutor`, `bg_yard_summer`, `bg_apartment_zoya`,
`bg_notary_office`, `bg_interrogation`, `bg_stairwell`) **отменены**: стиль «живопись поверх
фотоосновы + VHS» заменён на фотореалистичный кинокадр в духе «Брата» Балабанова (базовый промпт —
`docs/production/prompts/style-bible.md` §1). Перегенерация — по тому же списку id.

Проверка моделей под новый стиль:
- `gpt_image_2_5` — 0,25 кредита за кадр, лучший выбор для фотореализма, но на бесплатном плане
  Higgsfield недоступна («Requires basic plan or higher»).
- `nano_banana_pro` — 2 кредита за кадр, доступна; 14 фонов эпизода = 28 кредитов за один вариант.
- Баланс на момент записи: 1 кредит. Стиль-тест не запущен.

## Фоны, фотореализм — партия 2, 2026-10-10 (план Lite, 251 кредит на старте)

Модель `gpt_image_2_5` (OpenAI GPT Image 2.5, вариант flare), 16:9, quality `medium`, resolution `2k`,
1 кредит за кадр; промпт = базовый промпт `style-bible.md` §1 + SCENE TO DEPICT из таблицы
`docs/production/prompts/ep01-images.md` с пометкой «empty room, no people» для фонов под спрайты.
Стиль-тест кабинета на quality `low`/1k (0,25 кредита): job `c31bd25d-0605-4422-8456-0437cb7a1453`.
Лимит одновременных задач модели — 4 (пятая и дальше получают 429); отправляли четвёрками.

| id | Job id | Файл результата (CDN) | Статус |
|---|---|---|---|
| `bg_yard_summer` | `5ef998f9-61fd-442b-9f3c-43f9a71199c5` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175444_5ef998f9-61fd-442b-9f3c-43f9a71199c5.png | сгенерирован, на утверждение владельцем |
| `bg_apartment_zoya` | `6f2de885-05e5-4980-8f4f-fe00f4735b41` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175444_6f2de885-05e5-4980-8f4f-fe00f4735b41.png | сгенерирован, на утверждение владельцем |
| `bg_moscow_1993` | `75524648-8227-43d5-b071-deeda09d9d84` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175444_75524648-8227-43d5-b071-deeda09d9d84.png | сгенерирован, на утверждение владельцем |
| `bg_office_prosecutor` | `e72bb70f-73bb-4e90-a2d5-078f2f7b8c6b` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175443_e72bb70f-73bb-4e90-a2d5-078f2f7b8c6b.png | сгенерирован, на утверждение владельцем |
| `bg_interrogation` | `60dc2ae6-f754-43d5-a045-5b602f88dbc1` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175607_60dc2ae6-f754-43d5-a045-5b602f88dbc1.png | сгенерирован, на утверждение владельцем |
| `bg_bti_archive` | `00f06b70-1242-4942-b694-35cee853c14a` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175607_00f06b70-1242-4942-b694-35cee853c14a.png | сгенерирован, на утверждение владельцем |
| `bg_street_night` | `dc36bcb7-08c6-4f2d-a24b-0b036fcd039e` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175608_dc36bcb7-08c6-4f2d-a24b-0b036fcd039e.png | сгенерирован, на утверждение владельцем |
| `bg_courtroom` | `76f4338d-ff57-467d-90b0-6f8e5abdf9d4` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175608_76f4338d-ff57-467d-90b0-6f8e5abdf9d4.png | сгенерирован, на утверждение владельцем |
| `bg_office_now` | `a51a359f-26a0-4c80-b805-e49751eb9224` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175719_a51a359f-26a0-4c80-b805-e49751eb9224.png | сгенерирован, на утверждение владельцем |
| `bg_stairwell` | `64969bdd-a1b4-4296-815d-6987b5010aa7` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175718_64969bdd-a1b4-4296-815d-6987b5010aa7.png | сгенерирован, на утверждение владельцем |
| `bg_notary_office` | `a73221be-7326-4dc5-b8ef-16fbdc83000e` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175718_a73221be-7326-4dc5-b8ef-16fbdc83000e.png | сгенерирован, на утверждение владельцем |
| `bg_zhek` | `16313ee9-1a71-499f-93f8-71f9544a620d` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175827_16313ee9-1a71-499f-93f8-71f9544a620d.png | сгенерирован, на утверждение владельцем |
| `bg_street_day` | `8602f470-a138-4fdb-9e47-7941f832509d` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175827_8602f470-a138-4fdb-9e47-7941f832509d.png | сгенерирован, на утверждение владельцем |
| `bg_murashov_flat` | `6fd9f454-b7e5-41cc-88f7-1b5c6f9576be` | https://d8j0ntlcm91z4.cloudfront.net/user_310L9D8Y4NaRvux6342dGvDF7W8/hf_20261010_175827_6fd9f454-b7e5-41cc-88f7-1b5c6f9576be.png | сгенерирован, на утверждение владельцем |

Итого 14 кредитов + 0,25 за тест. Следующий шаг после утверждения: конвертация в webp q80 1920×1080
по путям из `assets.backgrounds` эпизода; отклонённые — перегенерация 2 вариантами (при необходимости
quality `high`, 2,75 кредита). Дальше: 5 CG (16:9) и 9 персонажей (базовый кадр + выражения).
