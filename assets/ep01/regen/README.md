# Пересъёмка кадров покрытия по новым лицам — состояние и как продолжить

Задача владельца: «вобрать все кадры для истории с новыми портретами, качество 1080, проверять, чтобы
в окружении, портретах и во всей сцене не было нейронных артефактов».

## Состояние (2026-10-12, 11:20 UTC)

| Сет | Кадров | Принято по новым лицам | Применено к эпизоду |
|---|---|---|---|
| stairwell | 28 | 28 | да |
| apartment_zoya | 35 | 34 (всё, кроме angle_foreground); в манифест (`v: 2`) пока записаны только wide_1–4 и medium_1–3 | нет — старые файлы сета ещё на месте |
| notary, office_day, office_evening, interrogation, bti, street_day, office_night, street_night, yard, zhek, office_now, murashov_flat | 270 | 0 | нет |

Баланс Higgsfield после 35 принятых кадров: 81,05 кредита. Остаток работы ≈ 298 кадров × 0,25 ≈ 75 кредитов
без пересъёмок. Фоны и спрайты не перегенерируются.

`registry.json` — принятые кадры по новым лицам (id кадра → job и URL). Каждый из них уже записан в
`assets/ep01/manifest.json` с `"v": 2`; реестр нужен скриптам волн.

## Порядок работы

Сеты — в порядке истории: apartment_zoya → notary → office_day → office_evening → interrogation → bti →
street_day → office_night → street_night → yard → zhek → office_now → murashov_flat.

1. План: `python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --regen --plan assets/ep01/regen/plan.json`
   (детерминирован; файл большой и в git не хранится).
2. Общий план `wide_1` сета — по фону и лицам из `faces/` (у кадра уже есть эти референсы в плане),
   `quality: medium`, `resolution: 1k`. Остальные кадры — `quality: low`, `resolution: 1k`.
3. Принятый `wide_1` → `python3 tools/regen/manifest_add.py sh_<set>_wide_1` (без этого планировщик не
   возьмёт его референсом для ots). Два кропа этого кадра загрузить в Higgsfield (`media_upload`):
   «средний» — доли (0.15, 0.12, 0.85, 0.82), «соло» — правая часть кадра; их `media:<id>` вписать в
   `REGEN_REFS` в `tools/shot_plan.py` и пересобрать план.
4. Волны по 4 запроса (`python3 tools/regen/wave_build.py wNNN <id>…` собирает `wNNN.json` с готовыми
   запросами для `generate_image_batch`); больше 4 одновременно — ответ 429.
5. Каждый кадр смотреть глазами (960 px): лицо против портрета, руки и пальцы, предметы без дублей,
   надписи нечитаемы, эпоха, никто не смотрит в объектив на общих. Принятые — `reg_add.py`.
6. Сет закрыт → `manifest_add.py` для всех его кадров, `git rm` старых `assets/ep01/shots/<set>/*.webp`
   (иначе fetch-assets их не перекачает), строка в `assets/ep01/generation-log.md`, коммит и пуш.
7. После коммита бота «Ассеты: скачаны по манифесту» — `git pull`, затем
   `python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --regen --apply assets/ep01/regen/plan.json --sets <set>`,
   линтер эпизода и `npm --prefix runtime test`, коммит.

## Для apartment_zoya сейчас

В `registry.json` принятые кадры; в манифест (`v: 2`) пока записаны только wide_1–4 и medium_1–3 — остальные
добавить `manifest_add.py` при закрытии сета. Из `pending.json` — посмотреть 8 готовых кадров (job id), принятые
занести `reg_add.py`. Правило для лица Мурашова (силуэт) в ots: верхний край кадра режет его по подбородку —
уже в планировщике.


`REGEN_REFS["apartment_zoya"]` уже заполнен (кропы принятого wide_1). Следующие волны: восемь `ots_*`,
затем `medium_4`, крупные планы, реакции, вставки и три ракурса.
