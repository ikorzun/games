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

## Спрайты, CG, документы, UI и звук — 2026-10-10

Все записи — в `assets/ep01/manifest.json` (id → URL → целевой путь); скачивание и конвертация —
`python3 tools/fetch_assets.py assets/ep01/manifest.json` (нужен доступ к CDN Higgsfield). Лимит
одновременных задач: 4 у gpt_image_2_5, ~10 у mirelo. Расход на этот раздел ≈ 34 + 5 + 5 + 2 кредита
за картинки и ≈ 19 + 28 + 6 за звук.

### Спрайты персонажей (gpt_image_2_5, 9:16, medium/2k, фон transparent; выражения — правка базового кадра по image_references)

| id | Job id | Цель |
|---|---|---|
| `sledak.neutral` | `9ee77775-ae3e-45cb-b7e1-c24aa2de6b1b` | `assets/common/sprites/sledak/neutral.webp` |
| `sledak.tense` | `6575432e-466f-43d6-bb68-3c7b4b12144d` | `assets/common/sprites/sledak/tense.webp` |
| `sledak.tired` | `a2b66838-5372-4757-a4af-f36f93a7870a` | `assets/common/sprites/sledak/tired.webp` |
| `sledak.firm` | `a8ad8c4d-91fd-4817-a958-06e5a25cf540` | `assets/common/sprites/sledak/firm.webp` |
| `oper.neutral` | `f5871734-18ef-4863-a39b-abae54d7c081` | `assets/common/sprites/oper/neutral.webp` |
| `oper.grin` | `af63d5cc-8317-4ac8-a540-d1c82acf45d1` | `assets/common/sprites/oper/grin.webp` |
| `oper.angry` | `75865562-e3a0-48ab-8552-dd0bd4095668` | `assets/common/sprites/oper/angry.webp` |
| `oper.hurt` | `d5d48f85-d87f-4972-90a4-209ba3d44766` | `assets/common/sprites/oper/hurt.webp` |
| `expert.neutral` | `70344d43-c9e6-4f53-bcd3-32be05baf7a1` | `assets/common/sprites/expert/neutral.webp` |
| `expert.focused` | `8179a272-e445-4459-8412-3e7dcfc5f980` | `assets/common/sprites/expert/focused.webp` |
| `murashov.neutral` | `3caada8f-17f1-4158-9434-e4bb4c4d654d` | `assets/ep01/sprites/murashov/neutral.webp` |
| `murashov.smile` | `2b19a2d8-0573-4c3e-9c5d-0dc81007955a` | `assets/ep01/sprites/murashov/smile.webp` |
| `murashov.cold` | `8690f145-fd2f-4278-bc25-6078a76120ad` | `assets/ep01/sprites/murashov/cold.webp` |
| `murashov.cornered` | `4cf6d470-3f69-45a0-9848-291fc491235d` | `assets/ep01/sprites/murashov/cornered.webp` |
| `notary.neutral` | `79c2cf4c-e15a-4ab7-bf64-ea1998cb548a` | `assets/ep01/sprites/notary/neutral.webp` |
| `notary.nervous` | `4d275ebd-6630-4e8b-b926-183d77afe42c` | `assets/ep01/sprites/notary/nervous.webp` |
| `zoya.neutral` | `74ee59a5-9561-419f-a37d-ab982d222627` | `assets/ep01/sprites/zoya/neutral.webp` |
| `zoya.warm` | `51cccea6-f083-462d-8024-077bdaa5bec3` | `assets/ep01/sprites/zoya/warm.webp` |
| `zoya.worried` | `990a06d2-4e93-4d83-9527-1d4c130d736c` | `assets/ep01/sprites/zoya/worried.webp` |
| `neighbor.neutral` | `4e81409a-6fdd-4ddd-ad89-13f12180a2fa` | `assets/ep01/sprites/neighbor/neutral.webp` |
| `neighbor.worried` | `35e5af48-46d0-4fc5-8ca8-987ee7cd5225` | `assets/ep01/sprites/neighbor/worried.webp` |
| `buyer.neutral` | `acbabd68-c3b3-44b7-9642-fb4fdd9cc0d4` | `assets/ep01/sprites/buyer/neutral.webp` |
| `buyer.scared` | `acb645d4-ede7-4cdf-aab1-a816f38fe088` | `assets/ep01/sprites/buyer/scared.webp` |
| `boss.neutral` | `0f4648bc-9246-4dc2-b8a6-db2f0062426b` | `assets/common/sprites/boss/neutral.webp` |
| `boss.stern` | `915c7547-ab1b-4419-b7a6-5f6d16406e9f` | `assets/common/sprites/boss/stern.webp` |
| `boss.tired` | `3a3e867b-7fc0-4bd8-9920-67376ab1628e` | `assets/common/sprites/boss/tired.webp` |
| `accomplice.neutral` | `a6676966-33b1-4161-8643-941c3c8c1e22` | `assets/ep01/sprites/accomplice/neutral.webp` |
| `accomplice.scared` | `0c1937fc-e66b-435f-a4c5-e0df8048f511` | `assets/ep01/sprites/accomplice/scared.webp` |
| `lapin_wife.neutral` | `eb27408e-7adc-469f-8eda-3c193619ad34` | `assets/ep01/sprites/lapin_wife/neutral.webp` |
| `lapin_wife.worried` | `baa32b8f-bb17-4896-83a6-b7c874b8aa35` | `assets/ep01/sprites/lapin_wife/worried.webp` |
| `lapin_wife.angry` | `7f9367ba-31f0-447e-9196-1238bea4e6a1` | `assets/ep01/sprites/lapin_wife/angry.webp` |
| `clerk.neutral` | `67fb3438-5c9a-4e1d-833d-6583937e4f01` | `assets/ep01/sprites/clerk/neutral.webp` |
| `sledak_old.neutral` | `15414c9f-f023-441f-939c-f473f0caa0ca` | `assets/common/sprites/sledak_old/neutral.webp` |
| `sledak_old.sad` | `206ec7b3-ca2a-41e1-b744-7bea38140882` | `assets/common/sprites/sledak_old/sad.webp` |

### CG (gpt_image_2_5, 16:9, medium/2k)

| id | Job id | Цель |
|---|---|---|
| `cg_door_sealed` | `dbe95fc1-7cc1-4974-ba62-e8cfb18b0629` | `assets/ep01/cg/door_sealed.webp` |
| `cg_zoya_last` | `308a34ff-d076-4fec-8a4f-9d837cf1e558` | `assets/ep01/cg/zoya_last.webp` |
| `cg_arrest_night` | `a5fa6d2e-3c03-4d66-9e45-b55ea5f9c3aa` | `assets/ep01/cg/arrest_night.webp` |
| `cg_keys` | `4d01c322-7665-4259-94fe-cb200d591ecd` | `assets/ep01/cg/keys.webp` |
| `cg_verdict` | `3e736ba0-bfcb-4824-8ae8-6790e6fe59f5` | `assets/ep01/cg/verdict.webp` |

### Документы без текста (gpt_image_2_5, 3:4, medium/2k)

| id | Job id | Цель |
|---|---|---|
| `doc_power_of_attorney` | `906f888a-4b9d-4ff6-ac75-787a858cc3de` | `assets/ep01/docs/power_of_attorney.webp` |
| `doc_contract_sale` | `f1e1fce2-b6c8-4bea-8f0f-5c8239e684af` | `assets/ep01/docs/contract_sale.webp` |
| `doc_bti_card` | `c6f0b8f7-e165-4d15-bd3d-2ed4e2aaa21a` | `assets/ep01/docs/bti_card.webp` |
| `doc_newspaper_1994` | `c1feebff-972c-4076-b1cd-afd95b43a6ac` | `assets/ep01/docs/newspaper_1994.webp` |
| `doc_registration` | `91028193-2a73-4806-96ab-225385df3be6` | `assets/ep01/docs/registration.webp` |

### UI (gpt_image_2_5, 16:9)

| id | Job id | Цель |
|---|---|---|
| `ui_title_plate` | `ab4dc524-e015-4a36-b254-3e748f1a5467` | `assets/common/ui/title_plate.webp` |
| `ui_menu_video_salon` | `d66c596c-3f3c-4ff8-aa89-485eeed3cfa2` | `assets/common/ui/menu_video_salon.webp` |

### Музыка (sonilo_music, 60 с, 3,75 кредита за луп, формат m4a)

| id | Job id | Цель |
|---|---|---|
| `m_theme_main` | `0c7cde77-3cfa-44f0-8942-912aead82c29` | `assets/common/music/theme_main.m4a` |
| `m_chronicle` | `a6600862-4be5-47fc-a8ca-82bdd99c66ad` | `assets/common/music/chronicle.m4a` |
| `m_investigation` | `2f3fa7ae-a88a-40e1-b3cb-218eeb63f4c6` | `assets/common/music/investigation.m4a` |
| `m_tension` | `0e637e2f-4a73-4580-94e7-e48b90406c4c` | `assets/common/music/tension.m4a` |
| `m_epilogue` | `455878da-bbb0-4c0c-91ef-d94996e2acf3` | `assets/common/music/epilogue.m4a` |

### Эмбиент (mirelo_text_to_audio, 16 с, 4 кредита, mp3)

| id | Job id | Цель |
|---|---|---|
| `amb_yard` | `21631c82-220b-4b60-9b27-d6705f7e74fb` | `assets/common/amb/yard_summer.mp3` |
| `amb_office` | `e4f4049c-0f87-44cd-8b52-4f2f5b66be57` | `assets/common/amb/office_typewriter.mp3` |
| `amb_street_day` | `0c6b8854-ec77-406f-b7d5-4eb3324d4ea8` | `assets/common/amb/street_day_car.mp3` |
| `amb_stairwell` | `9b739f39-8679-4fa4-bb90-9a3dfe64f39a` | `assets/common/amb/stairwell.mp3` |
| `amb_archive` | `7f94f4b7-5d4e-450c-b4b9-0f8fbca8fa93` | `assets/common/amb/archive_fluorescent.mp3` |
| `amb_street_night` | `f8610442-844b-4f05-86c1-591c46832c41` | `assets/common/amb/street_rain_night.mp3` |

### SFX (mirelo_text_to_audio, 2–6 с, mp3)

| id | Job id | Цель |
|---|---|---|
| `sfx_door` | `243c4baf-3ae5-4733-bc68-43fff79496d9` | `assets/common/sfx/door_apartment.mp3` |
| `sfx_shot` | `1b4bb050-c468-4d0e-8509-d61589fe73ad` | `assets/common/sfx/shot_distant.mp3` |
| `sfx_phone` | `54e8df4f-253e-4fa7-9803-803b8f096545` | `assets/common/sfx/phone_dial.mp3` |
| `sfx_typewriter` | `51a06895-99d0-4079-aa14-35347eb1a3d7` | `assets/common/sfx/typewriter.mp3` |
| `sfx_rain` | `f340ebb8-46dc-459d-859f-c61fa0bf385e` | `assets/common/sfx/rain_window.mp3` |
| `sfx_vhs` | `62dbf6dd-9b81-4bb3-992c-7707b23f41e0` | `assets/common/sfx/vhs_glitch.mp3` |
| `sfx_phone_ring` | `bd5c886d-f2e7-46eb-9d23-d5a8874347c6` | `assets/common/sfx/phone_ring.mp3` |

## Скачивание в репозиторий — 2026-10-10

- Все 78 файлов манифеста скачаны и сконвертированы workflow `.github/workflows/fetch_assets.yml` на раннере GitHub
  (из облачной среды CDN недоступен): коммит `754ad97`, 17,5 МБ; спрайты — webp с альфой 792×1400, фоны/CG/UI 1920×1080,
  бланки 1195×1600, звук как есть (m4a музыка, mp3 эмбиент и SFX).
- `ui_title_plate` (`assets/common/ui/title_plate.webp`) после скачивания **обрезан по красной полосе**: из кадра 1920×1080
  взят прямоугольник (49, 335)–(1240, 672) → 1191×337, полоса по центру (66 % × 44 % картинки); название эпизода и титры глав
  рантайм кладёт в полосу. Полный кадр остаётся в галерее Higgsfield (job `ab4dc524-e015-4a36-b254-3e748f1a5467`);
  при перекачке с `--force` обрезку повторить (поле `post` в манифесте).

## Тест «персонажи в окружении сцены» — 2026-10-11

Решение владельца: переделать ассеты так, чтобы персонажи были вписаны в окружение естественно, и подсвечивать говорящего.
Проба подхода: GPT Image 2.5 (flare, medium, 2k, 16:9), базовый промпт §1 + описание мизансцены, `image_references` =
фон `bg_office_prosecutor` (`e72bb70f-…`) + спрайты `sledak.neutral` (`9ee77775-…`) и `oper.grin` (`af63d5cc-…`).

| id | Job id | Файл | Результат |
|---|---|---|---|
| `test_composite_office_v1` | `515cfd63-c588-433e-bf0d-2b1aae3c7893` | `assets/_tests/composite_office_v1.webp` | свет, перспектива, тени и масштаб верные; лица и одежда как в референсах; поза опера — руки в карманах, усмешка |
| `test_composite_office_v2` | `35b573a2-c0ad-430e-9d96-539d4c359c7b` | `assets/_tests/composite_office_v2.webp` | то же, почти без отличий |

Итого 2 кредита (баланс 489,75). Вывод: подход работает; план производства — мизансцены (фон × набор персонажей) как
цельные кадры, маски персонажей для подсветки говорящего, выражения — инпейнт лица на том же кадре.


## Пробы озвучки — 2026-10-11

Четыре реплики из `docs/season1/ep01-voices.md` («Пробы») на двух движках Higgsfield; цель — выбор движка и голосов
владельцем на слух. Пресетные голоса: рассказчик — Vlad (`e5666b9c-99a2-4fac-8b4e-abee078b186d`), Громов — Alexey
(`7c2133e5-68ab-511f-9aed-9a67664382b1`), Сайко — Mark (`27c04473-84a9-4b60-a41f-c8e8458bd4f1`), Левина — Elena
(`ca83ca7f-c186-493d-bd69-0d765fa861b2`).

| # | Персонаж | Модель | Параметры | job |
|---|---|---|---|---|
| 1 | рассказчик (`ep01.s01.l001`) | `qwen_audio_tts` | `language: ru`, `speech_rate: 0.9`, `instruction` ≤ 128 зн. | `3031acf6-407f-4b65-972f-04670af679f7` |
| 2 | Громов | `qwen_audio_tts` | `language: ru`, `instruction` | `4d948b98-9799-41f6-adaa-8b359f76beac` |
| 3 | Сайко | `qwen_audio_tts` | `language: ru`, `speech_rate: 1.1`, `instruction` | `ac32483c-c824-4199-b29c-7c6990cc6fa1` |
| 4 | Левина | `qwen_audio_tts` | `language: ru`, `instruction` | `5cd910bb-a3df-47cb-9f67-39ef8999bdc0` |
| 5 | рассказчик | `text2speech_v2` / `elevenlabs` | пресет Vlad | `0d4a6038-b6ad-4561-af9a-e205d29910de` |
| 6 | Громов | `text2speech_v2` / `elevenlabs` | пресет Alexey | `6b252e49-816f-475a-bb11-0095f20365d1` |
| 7 | Сайко | `text2speech_v2` / `elevenlabs` | пресет Mark | `4abae92e-bd6f-4521-a410-cb0d91c12ad4` |
| 8 | Левина | `text2speech_v2` / `elevenlabs` | пресет Elena | `1d116e35-d42a-4e09-8df0-2d6d81571024` |

Уроки: у `qwen_audio_tts` поле `instruction` — не длиннее 128 символов (первая партия отклонена с 422); `text2speech_v2`
иногда отвечает 429 `rate_limit_reached` на параллельные запросы — повторять поштучно. Файлы проб в репозиторий не
скачивались (решение о движке ещё не принято); при необходимости — через манифест и workflow `fetch-assets`.

## Тест раскадровки — сет «кабинет прокуратуры, день» — 2026-10-11

Решение владельца: показывать сцены покрытием — общий, средний, крупный, «восьмёрка», детали, неожиданные ракурсы
(`docs/architecture/08-shot-grammar.md`, стайл-библия §1a). Технический тест на сцене s12 (Левина делит работу):
12 кадров GPT Image 2.5 (flare, medium, 2k, 16:9), `image_references` = фон `bg_office_prosecutor` + спрайты
нужных персонажей с нужным выражением; в промпте блок CAMERA заменён описанием кадра. Лимит модели — 4 задачи
одновременно (остальные отклоняются с 429, подавать волнами). Файлы — `assets/_tests/shots/` через fetch-assets.

| # | Кадр | Содержание | Job id |
|---|---|---|---|
| 1 | `wide` | установочный общий, трое в кабинете | `5ba07831-5c53-4adc-96dd-ced1709fe62d` |
| 2 | `medium_low` | средний с уровня стола, папки на переднем плане | `0c43fbac-70d1-4615-8184-3112652d67aa` |
| 3 | `ots_sledak_expert` | через плечо Громова на Левину | `9e330712-613e-4ed2-86af-a2815ef6b971` |
| 4 | `ots_expert_sledak` | обратный: через плечо Левиной на Громова | `3411997a-3f49-428c-a5b9-f3e162a988ed` |
| 5 | `close_expert_focused` | крупный, Левина focused | `2d419ddb-9fe3-4271-888c-f7b0dde06f5a` |
| 6 | `close_oper_grin` | крупный, Сайко grin у окна | `83eb275c-0175-4441-a63d-2d8ce2a08968` |
| 7 | `close_sledak_tense` | крупный, Громов tense, лампа + окно | `602c716b-d13f-4205-9238-e3e182be52ef` |
| 8 | `insert_hands` | деталь: руки Левиной, документ с печатью, стакан чая | `6d6bd9a4-f957-4ac6-bbd8-90574c2263e7` |
| 9 | `angle_low` | нижний ракурс с пола, потолок и сейф | `19ac153e-aefb-4be2-a69f-e8eb348ab848` |
| 10 | `angle_doorway` | из коридора через полуоткрытую дверь | `095be313-5c96-4d46-b443-e72bd2a1be61` |
| 11 | `angle_high` | верхний ракурс со шкафа | `50b1d9b0-758a-48e9-be56-59a0ccaa0df4` |
| 12 | `reaction_oper` | реакция: Сайко замолкает, профиль Левиной на переднем плане | `63c5e84e-b100-46a1-9633-77f1e61f99f4` |

Итого 12 кредитов (баланс 476,05). Оценка старшей модели после скачивания (`assets/_tests/shots/`):

- **Консистентность.** Лица, причёски, одежда и комплекция трёх персонажей держатся во всех 12 кадрах, включая
  крупные планы 85 мм и нижний/верхний ракурсы; у Сайко виден сломанный нос, у Левиной — очки на цепочке и пучок.
  Комната одна и та же: календарь, серый сейф, зелёная лампа, машинка, батарея, окно с панорамой панельных домов.
- **Ось и монтаж.** Пара OTS (3 → 4) соблюдает правило 180°: Громов слева, Левина справа; кадры режутся между собой.
  Реакция (12) и крупные планы (5–7) сочетаются с общим (1) и средним (2) по свету и по положению людей.
- **Свет.** Мотивированный: окно слева/сзади, лампа тёплая на лице Громова (7), люминесцентная трубка в нижнем
  ракурсе (9); без рим-лайта и глянца.
- **Ракурсы.** Нижний (9), через дверь (10) и верхний (11) читаются как задумано: давление, наблюдение, «система
  над людьми»; лица не искажены на 28 мм.
- **Композиция под интерфейс.** В общих и средних планах нижняя треть занята столом и папками — текстовое окно в
  ландшафте перекроет их, лица остаются выше; в крупных планах глаза на высоте 35–45 % кадра — безопасно.
- **Замечания.** Деталь (8): печать с гербом и подпись правдоподобны, текст нечитаем — норма; подстаканник со
  звездой — допустимая деталь эпохи. В (1) и (10) Сайко стоит у окна в одной позе — для разнообразия сетов нужны
  2–3 варианта расстановки (у шкафа, на стуле у стола).

Вывод: подход «кадры по сетам с референсами фон + спрайты» годится для производства; промпт-шаблон §1a стайл-библии
закреплён как рабочий.

## Музыка по ДНК главной темы — 2026-10-11 (решение владельца)

Владелец: главную тему передачи (Игорь Назарук, 1995) использовать на заставке и как «музыкальную ДНК» фоновой
музыки — от спокойной до тревожной. Справка по теме, авторству, версиям заставки и словарь для промптов —
`docs/research/05-kr-theme-and-brand.md`. Официального релиза темы нет, из рабочей среды запись не достать:
**оригинальную запись по лицензии загружает владелец** в `assets/common/music/theme_main.m4a` (m4a/AAC, луп для
меню); до этого на заставке и в меню играет сгенерированная «вступительная тема» в характере оригинала.

ДНК в промптах (по источникам, не по слуху): медленная «тяжёлая поступь» ≈ 60–85 BPM, минор, холодные
синтезаторно-сэмплерные тембры начала 1990-х с лёгкой ленточной сатурацией, сэмплированные струнные стабы,
металлическая перкуссия, низкий пульсирующий бас, без вокала и живых инструментов. От «спокойной» к «тревожной»
сохраняются тембр, лад и «шаг», растут темп (66 → 80 → 96 BPM), плотность и динамика.

sonilo_music (аудио-референс модель не принимает — ДНК передаётся словами), m4a; 20 с = 1,25 кредита, 60 с = 3,75.

| id | Роль | Длит. | Job id (`hf_20261011_…`) |
|---|---|---|---|
| `m_theme_main` | вступительная тема: марш-поступь 68 BPM, нарастание 12 с к финальному удару, затем низкий дрон; заглушка заставки и меню до оригинала | 20 с | `115622_db77ddcc-b389-45b9-a6a0-29c08d1dfe93` |
| `m_calm` | спокойная: тихий кабинетный андерскор 66 BPM, мягкий холодный пэд, сдержанный пульс баса, без мелодии на первом плане | 60 с | `115736_4c73a844-5ddf-4435-a9c2-a0609358dd96` |
| `m_investigation` | следственная: ровный «тикающий» пульс, приглушённое остинато баса, далёкие струнные на минорном аккорде, 80 BPM, без кульминации | 60 с | `115622_e1dd771a-c286-4a1f-9726-ad9fcc4a1a53` |
| `m_tension` | тревожная: настойчивое минорное остинато синтезатора, стаккато струнных, медленно растущий диссонирующий пэд, 96 BPM, без разрешения | 60 с | `115622_797233a5-9150-4986-9697-23fdfcfc25d7` |

Итого 12,5 кредита (баланс 463,55). Прежние лупы `m_theme_main`, `m_investigation`, `m_tension` (партия 2026-10-10,
без ДНК темы) заменены — их job id остаются в таблице партии 2 для отката; `m_chronicle` и `m_epilogue` (рояль:
хроника и эпилог) пока прежние — ДНК-версии на них не делались. Раскладка по эпизоду: `b06_investigation_1`
(s16–s19, рутина кабинета) — `m_calm`; `b05_discovery`, `b08_investigation_2` — `m_investigation`; cold open,
преступление, погоня, очная ставка — `m_tension`. Скачивание — манифест + workflow `fetch-assets`: ручной запуск
с `force` приложению недоступен (403), поэтому три прежних файла сняты из репозитория коммитом, и workflow скачал
новые как отсутствующие (`calm.m4a` 1,85 МБ, `investigation.m4a` 1,84 МБ, `tension.m4a` 1,85 МБ, `theme_main.m4a`
0,61 МБ — 20 с). В рабочей среде звука нет — лупы оценены по
описанию, не прослушаны; слушает и принимает владелец.

## Оригинальная тема вместо заглушки — 2026-10-11

Владелец передал оригинальную запись главной темы передачи (Игорь Назарук, 1995): mp3 192 кбит/с, 44,1 кГц, стерео,
63,4 с, 1,45 МБ; громкость −10,1 LUFS, пик +1,1 dBTP (так смастерен источник). Файл положен без перекодирования в
`assets/common/music/theme_main.mp3` (`m_theme_main`, `license: licensed`), сгенерированная «вступительная тема»
`theme_main.m4a` удалена, запись `m_theme_main` снята с манифеста (это не генерация). Громкость лупов по ДНК темы
−11,1…−13,2 LUFS — с оригиналом сходится, компенсация громкости не нужна.

Решение владельца: заставки «коснитесь, чтобы начать» нет, игра открывается сразу главным меню, тема звучит на нём.
Автозапуск: рантайм запускает тему при показе меню; если браузер запрещает звук без жеста, трек помечается
заблокированным и стартует при первом касании, клике или клавише (`HtmlAudioBackend.installUnlock`).

## Сезон фонов — 2026-10-11 (ошибка, найденная владельцем)

Под титром «Москва, лето 1993 года» (хроника, s06) стоял зимний кадр `bg_moscow_1993` (партия 2: «flat grey winter
daylight, slush»). Решение: панорама хроники перегенерирована летней; прежний зимний кадр оставлен как
`bg_moscow_1994` для суда и эпилога (1994). В эпизод добавлены `season` у фонов, CG и блоков, линтер сверяет
сезон картинки с сезоном блока/сцены и с текстом титров-дат (`tools/validate_episode.py`, функция `seasons`).

| id | Job id | Промпт | Кредиты |
|---|---|---|---|
| `bg_moscow_1993` (лето) | `64a5cfcc-d457-4527-a98a-92dc71932802` | базовый §1 + SCENE TO DEPICT из `ep01-images.md` (July 1993, kiosks, bus stop, trolleybus, poplars in leaf, no snow) | 1 |

Баланс после генерации ≈ 462,5. Оценка после скачивания: сезон читается однозначно (июль, тополя в листве, лёгкая
одежда, дымка), киоски, остановка и троллейбус сохранены, вдали сталинская высотка — узнаваемая Москва; принят.

## Кадры покрытия, сет office_day — 2026-10-11

Производство по `tools/shot_plan.py` (сеты × грамматика 08): gpt_image_2_5, 16:9, medium, 2k, 1 кредит/кадр;
референсы — фон сета и спрайты состава (job id из манифеста), волнами по 4. Промпт базовый §1 стайл-библии с
блоками CAMERA (по виду кадра), PHOTOGRAPHIC REALISM и CONTINUITY (§1a), словесными приметами людей и LAYOUT
комнаты. Каждый кадр просмотрен на артефакты (руки, лица, повтор предметов, читаемый текст, геометрия) и на
непрерывность (те же люди, та же одежда, та же сторона комнаты).

| Волна | Кадры | Итог |
|---|---|---|
| 1 (пилот) | wide_1, ots_sledak_oper, close_sledak_tense, insert_1 | 3 приняты; ots отбракован — люди поменялись местами |
| 2 | ots_sledak_oper (повтор), wide_2, wide_3, wide_4 | все приняты: приметы в тексте референсов и явное «кто спиной, кто лицом» сработали |
| 3 | medium_1…4 | все отбракованы: модель повторила кадр фона, medium_3 пересёк линию действия |
| 4–5 | ots ×7, close_oper_neutral | 4 ots приняты; 3 ots пересекли линию действия, «крупный план» вышел общим — перегенерация |
| 6 | medium_1…4 (повтор) | только medium_2 стал средним; остальные — снова копия общего плана |
| 7–8, 10 | close ×12 | 1 принят (close_boss_neutral), 11 — общие планы: модель копирует кадр фона из референса |
| 9 | ots ×3, close (повтор с LAYOUT) | ots_boss_sledak принят; пара expert/oper снова не на тех сторонах — для ots введены явные стороны экрана (ORDER) |
| 11 | medium_1, 3, 4, close_oper_grin (референс — принятый близкий кадр) | все четыре приняты: при близком референсе модель держит крупность |
| 12 | insert_2, angle_low/high/doorway | insert_2 и angle_high приняты; angle_low и angle_doorway — копии общего плана (камера не сдвинулась) |
| 13–15 | close ×12 (близкий референс) | все 12 приняты: лица, руки, одежда и комната без артефактов; у Сайко «сломанный нос» модель читает как след перелома на переносице — одинаково во всех крупных планах, оставлен |
| 16–17 | reaction ×5, ots_expert_oper / ots_oper_expert (явные стороны экрана) | все 7 приняты: слушающий с мягким плечом говорящего у края кадра; пара expert/oper впервые на верных сторонах |
| 18 | angle_low, angle_foreground — по конкретному описанию места камеры; каждый в двух вариантах референса (общий план / средний план) | с общим планом в референсе оба кадра поменяли людей местами (опер за машинкой, следователь у окна); со средним планом оба приняты: камера на столе под абажуром, потолок в кадре; взгляд вдоль стола из-за папок. Сет office_day закрыт: 41 кадр из 41, применён к эпизоду (`assets.shots`, `coverage`) |
| 19 | пилот office_night: wide ×2 (референс — дневной фон), close_sledak_tense и medium_1 (дневные близкие референсы, LIGHT NOW: ночь) | все 4 приняты: чёрное окно, голая лампочка и настольная лампа, расстановка как днём — дневные референсы с оговоркой о свете работают; дальше ночной сет ссылается на свои кадры |
| 20–25 | office_night: medium_2, ots ×6, close ×8, reaction ×3, insert ×2, angle ×3 (референсы — принятые ночные кадры сета: wide_1 как комната, medium_1, close_sledak_tense) | все 23 приняты, брака нет; сет office_night закрыт: 27 из 27, применён к эпизоду |
| 26 | пилот interrogation: wide_1 и medium_1 (референс — фон), close_sledak_firm без референса комнаты (только спрайт и текст SUBJECT) | крупный план принят: комната (решётка, зелёная панель, лампа) собрана по тексту; wide и medium отбракованы — опер сел за стол, следователь встал к двери: модель читает порядок списка «People in frame» как порядок на экране. Правило: люди перечисляются слева направо по ORDER, а места в STAGING названы по геометрии (правый край стола, у двери на правой стене) |
| 27–30 | interrogation: wide ×4, medium_1, ots ×4, close ×6 | крупные планы 6/6 и ots 4/4 приняты (явные стороны экрана работают и здесь); wide_3, wide_4 приняты; wide_1 дважды и wide_2 отбракованы — при двух ролях справа (следователь за столом, опер у двери) модель сажает за стол человека в кожаной куртке, кого бы ни называл текст; medium_1 с новой расстановкой принят. Правило: референсы людей тоже идут слева направо, а в списке People к имени добавлена ключевая одежда («the one in the grey wool coat») |
| 31–33 | interrogation: wide_1 (третья попытка), medium ×3, close ×4, ots ×3, reaction_sledak | все 12 приняты: референсы слева направо плюс одежда у имени сняли перестановку ролей (в ots_oper_sledak следователь сел ближе к лампе — мелкое расхождение с общим планом, оставлено) |
| 34–36 | interrogation: ots_buyer_oper, close ×2, reaction ×4, insert ×2, angle_low/high/foreground | 11 из 12 приняты (вставки: руки над протоколом и пепельница со стаканом — без артефактов; низкий ракурс со стола под абажуром и верхний из угла — камера действительно сдвинулась при среднем плане в референсе); angle_foreground отбракован — «из-за края двери» модель дорисовала вторую дверь в переднем плане при настоящей двери в глубине. Нотариус: у «нейтрального» крупного плана и у реакции мизансцена STAGING («вытирает лоб платком») дала нервное действие — оба кадра перегенерированы, мизансцена в планировщике теперь зависит от выражения (платок в работе только у «нервного») |
| 37–38, 40 | interrogation: close_notary_neutral и reaction_notary (повтор с платком в руке), angle_foreground (второй и третий варианты) | оба кадра нотариуса приняты (платок сложен в руке, нервного действия нет). Ракурс с передним планом: «через окошко двери из коридора» — снова вторая дверь в глубине (STAGING ставит опера «у двери в правой стене», и дверь появляется где угодно); «пепельница и стакан на переднем плане» — модель дорисовала второй стол. Четвёртый вариант — из-за спинки стула подозреваемого |
| 39 | пилот apartment_zoya: wide_1 (Мурашов спиной в дверях, Зоя у серванта), wide_2 (следователь и эксперт), medium_1, close_zoya_warm без референса комнаты | wide ×2 и крупный план приняты с первого раза (свет по сету: «дневной свет сквозь тюль, лампы выключены» — общий словарь LIGHTING просил настольную лампу, которой в квартире нет); medium_1 по фону вышел общим планом. Решение: для средних и ракурсов сета референс — кроп принятого wide_1 по пояс (`assets/ep01/refs/`), загруженный в Higgsfield по публичному URL из репозитория (прямая загрузка из песочницы закрыта прокси) |

Правила, добавленные по итогам: словесные приметы каждого референса (`docs/production/prompts/ep01-images.md`,
таблица персонажей); для `ots` — «камера за спиной X, лицом к камере Y, людей не менять местами» и явные
стороны экрана по порядку мест (`ORDER` в планировщике); для `medium`/`close` — размер головы в долях кадра;
LAYOUT фона слева направо от двери против пересечения линии; реквизит «как в референсе, ничего не добавлять»
(модель рисовала чехол на машинке). Главное открытие: **референс комнаты задаёт крупность** — с общим планом
фона первым референсом модель в 11 случаях из 12 повторяла его кадрирование, с принятым близким кадром того же
сета (`REF_SHOTS`) средние и крупные планы выходят с первого раза. Отбраковка до этого правила — 26 кадров из 44
(59 %), после — 0 из 4.

