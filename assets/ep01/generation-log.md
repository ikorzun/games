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
