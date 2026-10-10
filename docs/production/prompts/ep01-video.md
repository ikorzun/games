# Промпты видео (Seedance): эпизод 1 и общие клипы сезона

Модель по умолчанию `seedance_2_0` (std, 720p, 8 s, без звука, genre `noir`, 16:9); черновики —
`seedance_2_0_mini` (480p, 4 s); продление и монтаж — `seedance_2_5`. Текст, титры и названия
в видео не генерируются — их накладывает рантайм. Каждый клип должен лупиться: последний кадр ≈
первый (просим «loopable, ends where it starts»).

| id | Где | Длит. | Промпт |
|---|---|---|---|
| `v_common_title` | `title_card` каждого эпизода | 8 s | Old CRT television static noise fills the frame for one second, then resolves into pure black; a single crimson-red horizontal plate slides in from the left and settles slightly off-centre, faint scanlines and tape tracking noise at the bottom edge, subtle glow; no text, no letters, no logos; loopable. |
| `v_common_glitch` | склейка `vhs_glitch` | 4 s | A 1993 VHS tape glitch: horizontal tearing bands, chroma bleed, a brief rewind streak and tracking noise over a black frame, ending on clean black; no text; loopable. |
| `v_common_menu` | главное меню | 8 s | Painted documentary-realist scene, Russia 1993: a small video rental corner with a CRT television on a shelf and rows of VHS cassettes with blank labels, the screen flickering with soft static; static tripod shot, very slow push-in, dust in the air, warm lamp and cold screen glow; no people, no text; loopable, ends where it starts. |
| `v_ep01_cold_open` | `s01`, фон `bg_yard_summer` (image-to-video, `start_image` = утверждённый фон) | 8 s | Courtyard of a nine-storey Soviet panel block in Moscow on a July evening; windows light up one by one as dusk deepens while one third-floor window stays dark; a street lamp flickers on; leaves move slightly; static tripod, very slow push-in toward the dark window; no people in close-up, no text; muted desaturated palette; loopable. |
| `v_ep01_chronicle` | `s03` (опционально вместо Ken Burns) | 8 s | A faded archival-looking shot of a Moscow street in 1993: closed kiosks, people in coats at a bus stop, a trolleybus passing slowly, slush; slow pan from left to right, flat grey winter light, film grain; no readable signs, no text; loopable. |
| `v_ep01_stakeout` | `s15`, фон `bg_street_night` (image-to-video) | 8 s | Narrow Moscow street at night in October rain outside a ground-floor office; rain streaks under a sodium lamp, reflections on wet asphalt, a warm office window; a parked Volga sedan; the camera holds still, then drifts slightly as if from inside a car; no people, no text; loopable. |

## Порядок генерации стиль-теста (кредиты ограничены)

1. `v_common_title` на `seedance_2_0_mini`, 480p, 4 s — проверяем, что модель держит «телевизор
   и красную плашку» без текста. При успехе — та же сцена на `seedance_2_0`, 720p, 8 s.
2. `v_ep01_cold_open` только после утверждения фона `bg_yard_summer` (image-to-video).
3. Остальные — батчем через `generate_video_batch` после пополнения кредитов.

## Приёмка клипа

- Нет текста, логотипов, узнаваемых лиц; нет современных предметов.
- Луп без видимого шва (проверить стык), длительность 4/8 с.
- Вес после конвертации ≤ 2.5 МБ (720p, H.264 CRF 28 или VP9), без звуковой дорожки.
- Клип читается и в портретном кропе по центру (для мобильной версии) либо имеет статичный дубль.
