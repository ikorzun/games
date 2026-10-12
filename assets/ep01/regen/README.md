# Пересъёмка кадров покрытия по новым лицам — состояние и как продолжить

Задача владельца: «вобрать все кадры для истории с новыми портретами, качество 1080, проверять, чтобы
в окружении, портретах и во всей сцене не было нейронных артефактов».

С 2026-10-12 по решению владельца кадры снимаются **скиллом gpt-image** (OpenAI GPT Image 2.5 напрямую,
`~/.claude/skills/gpt-image`, ключ `OPENAI_API_KEY` в `~/.claude/settings.json`), а не через Higgsfield.

## Состояние (2026-10-12)

| Сет | Кадров | Принято по новым лицам | Применено к эпизоду |
|---|---|---|---|
| stairwell | 28 | 28 (Higgsfield) | да |
| apartment_zoya | 35 | 34 (Higgsfield, всё, кроме angle_foreground); в манифест (`v: 2`) пока записаны только wide_1–4 и medium_1–3 | нет — старые файлы сета ещё на месте |
| notary, office_day, office_evening, interrogation, bti, street_day, office_night, street_night, yard, zhek, office_now, murashov_flat | 270 | 0 | нет |

**Блокер:** у OpenAI-аккаунта кончились кредиты: пилот `sh_apartment_zoya_angle_foreground` получил
HTTP 429 `credit_balance_exhausted`. Пополняет владелец (platform.openai.com → Billing). Цена кадра ещё не
измерена: `gpt_wave.py` пишет `usage` каждого кадра в `out/<id>.json`; по пилоту посчитать $ за кадр и
записать сюда.

`registry.json` — принятые кадры по новым лицам: у кадров Higgsfield — job и URL, у кадров gpt-image — путь к PNG
и модель.

## Как устроен конвейер gpt-image

- `tools/regen/gpt_wave.py <id>… [--q low|medium] [--model flare|sunburst] [--size 1920x1088] [--dry-run]` —
  снимает кадры плана по 4 параллельно в `out/<id>.png` (+ `out/<id>.json`: модель, референсы, usage).
  Референсы идут в порядке плана (в промпте «Reference 1/2/3» позиционные): `file:<путь>` — локальный файл;
  job id — запись манифеста. Кадр Higgsfield при этом качается по url в `cache/`: локальный файл сета до его
  закрытия может быть ещё старой редакции. Лицо, фон и спрайт берутся из локального target.
- `tools/regen/gpt_accept.py <id>…` — принять: PNG → target кадра (webp 1920×1080 рецептом `fetch_assets`),
  запись в `registry.json` и в манифест: `"v": 2`, **без url**, `"job": "file:<target>"`, по этому полю
  планировщик берёт кадр референсом. Файл кадра коммитится вместе с манифестом. Бот fetch-assets записи без
  url пропускает, поэтому `git rm` старых файлов и ожидание бота больше не нужны.
- Кропы-референсы — локальные файлы `assets/ep01/refs/<set>_medium_v2.jpg` (и `_medium_solo_v2.jpg`), в
  `REGEN_REFS` в виде `file:assets/ep01/refs/…`. Загрузка в Higgsfield не нужна. Старые `refs/<set>_medium.jpg`
  вырезаны из кадров со старыми лицами — их не брать.
- У Python с python.org нет корневых сертификатов: скрипт сам ставит `SSL_CERT_FILE=/etc/ssl/cert.pem`.

## Порядок работы

Сеты — в порядке истории: apartment_zoya → notary → office_day → office_evening → interrogation → bti →
street_day → office_night → street_night → yard → zhek → office_now → murashov_flat.

1. План: `python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --regen --plan assets/ep01/regen/plan.json`
   (детерминирован; файл большой и в git не хранится).
2. Общий план `wide_1` сета снимается по фону и лицам из `faces/` (эти референсы у кадра уже есть в плане):
   `gpt_wave.py sh_<set>_wide_1 --q medium`. Остальные кадры — `--q low`. Размер 1920×1088 («качество 1080»;
   1080 не кратно 16, при конвертации обрезается до 1920×1080). Модель `flare`; если лица уходят от портрета,
   один раз сравнить тот же кадр на `sunburst` и выбрать модель.
3. Принятый `wide_1` → `gpt_accept.py sh_<set>_wide_1`. Из `out/sh_<set>_wide_1.png` вырезать два кропа и
   сохранить их в `refs/`: «средний» — доли (0.15, 0.12, 0.85, 0.82), «соло» — правая часть кадра (1920×1080,
   jpg q92). Вписать `REGEN_REFS["<set>"]` (`room`: `sh_<set>_wide_1`; `medium`/`angle`/`insert`/`medium_solo`:
   `file:…`) и пересобрать план.
4. Остальные кадры — пачками по 4–8 id через `gpt_wave.py`; при 429 из-за rate limit — подождать и повторить.
5. Каждый кадр смотреть глазами (960 px): лицо против портрета, руки и пальцы, предметы без дублей,
   надписи нечитаемы, эпоха, никто не смотрит в объектив на общих. Принятые — `gpt_accept.py`,
   отбракованные — переснять (`gpt_wave.py` перезапишет PNG).
6. Сет закрыт → строка в `assets/ep01/generation-log.md`, затем
   `python3 tools/shot_plan.py episodes/s1/ep01_murylev.json --regen --apply assets/ep01/regen/plan.json --sets <set>`,
   линтер эпизода и `npm --prefix runtime test`, коммит и пуш (файлы кадров + манифест + эпизод вместе).

## Для apartment_zoya сейчас

1. Снять `sh_apartment_zoya_angle_foreground` (референсы: `refs/apartment_zoya_medium_v2.jpg` — кроп нового
   wide_1, лица Мурашова и Зои), проверить, `gpt_accept.py`.
2. Закрыть сет: `python3 tools/regen/manifest_add.py` с id 34 кадров Higgsfield (в `registry.json`) — записи с url.
   Их файлы скачать локально (CDN доступен), а не ждать бота: `fetch_assets.fetch` + `to_webp(…, 'shot')` для
   каждой записи сета с url. Затем `--apply`, линтер, тесты, коммит.

Правило для лица Мурашова (силуэт) в ots: верхний край кадра режет его по подбородку — уже в планировщике.
