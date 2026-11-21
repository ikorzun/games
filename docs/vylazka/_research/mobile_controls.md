# Мобильное управление и браузерная обвязка для «Untitled Session»

Дата: 2026-11-17. Только факты, источники и советы; решений здесь нет. «Не подтверждено» = источника в выдаче не нашлось
или он вторичный. Ограничение сессии: прямая загрузка страниц (developer.mozilla.org, playgama.com, sdk.poki.com) была
заблокирована сетью, поэтому всё взято из выдачи поиска; MDN/Playgama/Poki нужно добавить в разрешённые домены, чтобы
перепроверить цитаты по первоисточнику.

## Сводка: десять советов по порядку важности

1. Держать `touch-action: none` на корне и на холсте (уже есть) и не надеяться на `user-scalable=no`: iOS Safari с iOS 10 игнорирует `user-scalable`/`maximum-scale`.
2. Закрыть краевой свайп «назад/вперёд» iOS: единственный упомянутый приём — не-пассивный `touchstart` с `preventDefault()` у краёв (~10–20 px); хрупко, проверять на устройстве. У нас этого нет.
3. Разрешение на датчик просить только из `click`/`touchend` верхней страницы; в iframe порталов на iOS датчик ненадёжен (открытый баг WebKit 301294, iOS 26) — держать тряску необязательной (так и сделано).
4. Звук: будить `AudioContext` по `touchend`/`click` (есть) и выставить `navigator.audioSession.type = 'playback'`, иначе при беззвучном режиме iPhone Web Audio молчит. У нас `audioSession` не используется.
5. Не опираться на `navigator.vibrate`: на iOS его нет; обход через `<input type=checkbox switch>` существует, но хрупок и версии расходятся — только как необязательное усиление.
6. Размеры: кнопки не меньше 44 pt (Apple) / 48 dp (Material); у нас кнопка фонаря 90 px, стик 124 px — запас есть, кнопка паузы по CSS проверить.
7. Высота: `100vh` врёт в Safari; у нас `position: fixed; inset: 0` + `ResizeObserver` — это допустимо; `dvh`/`visualViewport` явно не используются. Проверить на реальном iPhone при показе/скрытии адресной строки.
8. Не создавать лишних ресайзов холста и ограничить `devicePixelRatio`: на iOS потеря WebGL-контекста и нехватка памяти — известные случаи; у нас `setPixelRatio(1)` и обработчики потери контекста есть.
9. Режим энергосбережения iOS режет `requestAnimationFrame` до ~30 fps; считать шаг по времени кадра, а не по числу кадров; 120 Гц в Safari зависит от настроек.
10. Для порталов: подписаться на паузу платформы и на `visibilitychange` (есть), заглушить звук при уходе (Arkadium требует; Playgama советует), не делать свою кнопку полноэкранного режима (CrazyGames запрещает), поддержать касание (Poki/CrazyGames требуют).

---

## 1. Жанр: как мобильные игры от первого лица решают управление

Важное: найденные обзоры в основном про другие игры и старые; прямых разборов Slender/Granny/Backrooms на мобильных нет.

- Чувствительность обзора — самая частая претензия. Alien: Isolation (мобильная) — «вертишься как балерина» при первом повороте: https://www.pocketgamer.com/alien-isolation/review ; на itch.io разработчики пишут про слишком высокую чувствительность правого стика и свайпов (результаты поиска: https://itch.io/post/12732467, https://itch.io/post/15877952 — формулировки пересказаны поиском, не проверены по странице).
- Общий вывод обзоров: нужна настраиваемая чувствительность, отключаемые автодействия (автобег/автоприсед в Alien: Isolation) и меньше случайных движений камеры в напряжённый момент (https://www.pocketgamer.com/alien-isolation/review).
- Layers of Fear (мобильная): «капризное управление», предложены две схемы — виртуальные кнопки и «тап-чтобы-идти»: https://gurugamer.com/reviews/layers-of-fear-review-a-solid-game-but-not-fit-for-the-mobile-platform-7420
- Forgotten Memories: сенсорное управление называют проблемой для хоррора (https://www.148apps.com/reviews/forgotten-memories-review, https://www.idownloadblog.com/?p=352369); Slenderman RE: Light Edition — «управление и камера ужасны до неиграбельности», фонарь включается отдельной кнопкой без батареи (https://playtested.pages.dev/article/2023-03-24-yet-another-uninspired-slender-man-experience-full-review-slenderman-re-light-edition).
- Тап-чтобы-идти против стика: Stardew Valley на мобильных даёт оба режима («tap to move» и «follow my finger»), игрок выбирает: https://wiki.stardewvalley.net/Mobile_Controls ; жалоба на задержку свайпа, обход — тап: https://forums.stardewvalley.net/threads/touch-control-delay-responsiveness-issue-on-android-v1-6-15-3.54450/
- Автоход: в VRChat Mobile двойной тап с удержанием — идти вперёд автоматически: https://help.vrchat.com/hc/en-us/articles/19659443577491-VRChat-Mobile-Controls
- Батарейка/зарядка фонаря: найдено, что система подзарядки в мелких играх бывает «не идеальна»/ломает темп (https://itch.io/post/16335475 по пересказу поиска); игр с «зарядкой удержанием/тряской» в выдаче нет — не подтверждено, что это устоявшийся приём. Обзор Slenderman RE: Light — без батареи.
- Выбор взглядом с удержанием: в VR-литературе типичное время задержки 1000–2000 мс (GazeScope/GazeIntent: https://arxiv.org/html/2404.13829v1 ); Microsoft советует задержку только запасным вариантом и учитывает, что новички терпят дольше, опытные — нет: https://learn.microsoft.com/en-us/windows/mixed-reality/design/gaze-and-dwell-eyes . Для мобильного FPS источника нет — не подтверждено.
- Гироскоп как опция обзора: источников по мобильным хоррорам не найдено; для академии есть сравнение касание/наклон в двух-стиковых играх (Carleton, https://www.csit.carleton.ca/~rteather/pdfs/ec2017.pdf — только заголовок, содержание не читалось).
- Одна рука, портрет/ландшафт: общие тезисы «зона большого пальца», «портрет даёт игру одним пальцем» (https://unfgaming.net/?p=11067, https://parachutedesign.ca/blog/thumb-zone-ux/ — маркетинговые/дизайн-блоги); источника по FPS нет — не подтверждено. У нас ландшафт, портрет показывает просьбу повернуть (styles.css:274).
- Общая работа по тач-управлению: Zach Gage, GDC «Controls You Can Feel» (https://gdcvault.com/play/1015404/Controls-You-Can-Feel-Putting) и «Let's Talk About Touching» (https://www.gamedeveloper.com/design/let-s-talk-about-touching-making-great-touchscreen-controls) — найдены только аннотации.

## 2. Жесты браузера и системы

- Viewport: с iOS 10 Safari не учитывает `user-scalable`, `minimum-scale`, `maximum-scale` (WebKit: https://webkit.org/?p=7367 ; обзор https://www.quirksmode.org/blog/archives/2020/12/userscalableno.html). Chrome Android их учитывает. Наш метатег (index.html:7) безвреден, но на iOS не защищает.
- Двойной тап/300 мс: задержка снимается `width=device-width` (Chrome-блог про 300 мс, упоминает iOS 9.3: https://developer.chrome.com/blog/300ms-tap-delay-gone-away). `touch-action: manipulation` в той же статье назван неподдерживаемым Safari (статья старая, ~2016); ответ на StackOverflow сообщает, что на iOS 11.1 он работает (https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/a/41166167 — пересказ поиска). Расхождение: проверять на устройстве.
- Щипок: на iOS только `touch-action` (`none`/`pan-*`) останавливает; WebKit имеет тест pointercancel при щипке (https://webkit.googlesource.com/WebKit/+/0eb814e8516b5fc2385656771ee77851fce98167/LayoutTests/pointerevents/ios/touch-action-pointercancel-pinch-zoom-expected.txt). `gesturestart` в выдаче не подтверждён — не подтверждено, что `preventDefault()` на нём работает в актуальной iOS.
- Потянуть вниз/«оттяжка»: `overscroll-behavior` в iOS Safari с 16.0 (https://developer.chrome.com/blog/overscroll-behavior). Расходится: баг 2024 «`none`/`contain` не отключает pull-to-refresh на iOS 16» (https://bugs.webkit.org/show_bug.cgi?id=275947); сообщение, что в iOS 18 pull-to-refresh при навигации внутри браузера работает. Chrome-блог: `overscroll-behavior-y: none` отключает pull-to-refresh, но свайп-навигацию оставляет. Надёжнее держать страницу без прокрутки (`position: fixed`, `overflow: hidden`) — у нас так (styles.css:18–31).
- Краевой свайп назад/вперёд iOS: с iOS 13.4 не-пассивный `touchstart` + `preventDefault()` у краёв блокирует его, по описанию блога (https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4); значения 10–20 px — из ответов StackOverflow (https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/questions/50156425/prevent-swiping-between-web-pages-in-ipad-safari). Сообщается, что WebKit сломал/изменил жест намеренно, поэтому хрупко (WebKit 136531: https://bugs.webkit.org/show_bug.cgi?id=136531). Не подтверждено для iOS 26 (форум Xojo о правом свайпе: https://forum.xojo.com/t/swipe-right-in-ios-26/87734).
- Долгое нажатие, лупа, выноска: `-webkit-touch-callout: none` не всегда помогает; на iOS 26.1 сообщение «не работает» (https://developer.apple.com/forums/thread/808606); лупа на долгом нажатии появляется и при `user-select: none` с iOS 15 (WebKit 231161: https://bugs.webkit.org/show_bug.cgi?id=231161); для холста советуют полный набор CSS на холсте, контейнере и `html/body` плюс `touch-action: none` (https://forum.babylonjs.com/t/prevent-unwanted-inputs-in-ios-safari-hold-click-selects-canvas/21409, https://abratabia.com/game-controls/touch-controls.php). Работает ли `contextmenu`+`preventDefault` против лупы — не подтверждено.
- Chrome Android: `touchstart`/`touchmove` на window/document/body по умолчанию пассивные, `preventDefault()` там игнорируется (https://developer.chrome.com/blog/scrolling-intervention). Для краёв iOS нужен `{ passive: false }` явно.

## 3. Pointer Events против Touch Events

- WebKit: баг «при начале жеста UA отправлять `pointercancel` и прекращать события для касаний» исправлен; нужен слушатель одного из pointerdown/move/up, чтобы `pointercancel` пришёл (https://bugs.webkit.org/show_bug.cgi?id=193962 и https://bugs.webkit.org/show_bug.cgi?id=194173 — по пересказу поиска).
- С `touch-action: manipulation` на iOS `pointercancel` при прокрутке не приходит (https://bugs.webkit.org/show_bug.cgi?id=240917); у `pan-x pan-y pinch-zoom` — приходит. При `touch-action: none` браузер жест не забирает; прямого источника по `none` нет — не подтверждено.
- `preventDefault()` в `pointermove` не останавливает прокрутку по Y на iOS 13.2 (WebKit 198560, https://bugs.webkit.org/show_bug.cgi?id=198560); надёжен `touch-action`.
- Захват указателя: сообщение, что на iOS Safari цель `pointermove` может «залипать» на первом элементе (https://coderapp.vercel.app/answer/64883428 — вторичный). Наш `setPointerCapture` на корне — разумный ответ.
- Предел касаний: iPhone — 5 одновременных (6-е отменяет все), iPad — 11 (форум разработчиков, не официально: https://developer.apple.com/forums/thread/17606). Не подтверждено Apple.
- Системные жесты многопальцевые (3–5 пальцев) могут давать `pointercancel`; источника нет — не подтверждено.

## 4. Экран, ориентация, полноэкранность

- `dvh/svh/lvh`: Safari iOS с 15.4 (https://ishadeed.com/article/new-viewport-units/ , https://dev.to/frehner/css-vh-dvh-lvh-svh-and-vw-units-27k4). Открытые баги: `svh/lvh` неверны в сторонних браузерах iOS 18 (https://bugs.webkit.org/show_bug.cgi?id=279998), `svh` = `dvh`, когда нет панели вкладок (https://bugs.webkit.org/show_bug.cgi?id=261185).
- Клавиатуры у нас нет (нет полей ввода); `visualViewport` тогда нужен только как запасной источник размера. Рекомендуемого шаблона из официальных источников в выдаче нет — не подтверждено.
- Безопасные зоны: `viewport-fit=cover` + `env(safe-area-inset-*)` — источник в этом сеансе не открывался (MDN недоступен) — не подтверждено ссылкой; в коде используется.
- Fullscreen API на iPhone: `requestFullscreen` на не-видео элементах там не работает; на iPad с Safari 16.4; расходятся сообщения о Safari 17.2 для iPhone (https://developer.apple.com/forums/thread/133248 , https://bugs.webkit.org/show_bug.cgi?id=240312). Единственный путь на iPhone — `<video>`, закрывающий пользовательский интерфейс. Проверять на актуальной iOS.
- Экран «Домой»: установленное веб-приложение даёт псевдо-полноэкран, но не для отдельного элемента (из обсуждения на developer.apple.com/forums/thread/133248); справка по `display: standalone` на текущей iOS не найдена — не подтверждено. Для порталов (iframe) неприменимо.
- Блокировка ориентации: `screen.orientation.lock()` в Chrome Android с 38 и требует полноэкранного режима; в Safari iOS не поддерживается (caniuse: https://caniuse.com/wf-screen-orientation-lock — расходится с общей таблицей https://caniuse.com/screen-orientation ; WebKit 257695: https://bugs.webkit.org/show_bug.cgi?id=257695). Chromium собирается сделать отказ на не-телефонах (https://groups.google.com/a/chromium.org/g/blink-dev/c/Hjo6zse3tvg). Практика: определять ориентацию и показывать просьбу повернуть (у нас так — styles.css:274).
- Playgama (канал YouTube Playables): портрет обязателен, ландшафт необязателен (https://playgama.com/publish-your-game-on-youtube-playables/) — важно, если игру отправят туда; для обычного Playgama-портала не подтверждено.

## 5. Датчики и отклик

- `DeviceMotionEvent.requestPermission()`: нужна transient activation и HTTPS (MDN: https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static ). Блог 2020: Safari не считает `touchstart` жестом, `touchend` — считает (https://yal.cc/?p=1395) — подтверждено вторично.
- iframe: на iOS 14 метод не существует в cross-origin iframe даже с политикой (https://bugs.webkit.org/show_bug.cgi?id=221399); в WebKit-тестах — «заблокированы, пока явно не разрешены `accelerometer` и `gyroscope`» (https://webkit.googlesource.com/WebKit/+/0f9dda3eb5e8bee1224032800f3b156cd5ce812d/LayoutTests/http/tests/device-orientation/device-motion-third-party-iframe-denied-expected.txt); на iOS 26 разрешение выдаётся, но события в iframe не приходят (https://bugs.webkit.org/show_bug.cgi?id=301294, открыт на ноябрь 2025). Совет в выдаче: спросить в верхней странице и передавать данные — на порталах нам недоступно. Chrome 66+ требует `allow="accelerometer; gyroscope"` (только форум itch.io: https://itch.io/t/1305008 — не подтверждено официально). Решает не мы, а портал (Playgama советует явно задавать `allow`, но про датчики не пишет: https://playgama.com/blog/business-faqs/cross-origin-and-iframe-problems-when-embedding-games/).
- Вибрация: `navigator.vibrate` в iOS Safari не реализован (результаты по web-haptics: https://npmjs.com/package/ios-haptics , https://sumitsahoo.github.io/web-haptic-engine/docs/guide/platform-support.html). Обход — `<input type="checkbox" switch>` с `label.click()`: версия расходится (17.4 по библиотекам / 18.0 по WebKit-баге 285120: https://bugs.webkit.org/show_bug.cgi?id=285120); в баге просят требовать пользовательскую активацию — хрупко. Законность/правила Apple не оценивались.

## 6. Звук

- iOS: `navigator.audioSession.type = 'playback'` возвращает звук Web Audio при беззвучном режиме (Safari 16.4+, по другим сообщениям — работает с iOS 17: расходится): https://bugs.webkit.org/show_bug.cgi?id=251532 , https://developer.mozilla.org/docs/Web/API/AudioSession/type , https://www.w3.org/TR/audio-session/ . Баг 262781: «беззвучный режим играет сжатое аудио, но не несжатое» (https://lists.webkit.org/pipermail/webkit-unassigned/2023-October/1126029.html). `AudioContext` всё равно приостанавливается в фоне (https://bugs.webkit.org/show_bug.cgi?id=261554).
- Микрофон переключает сессию в `play-and-record` и снижает громкость (WebKit 236219) — нам не нужен.
- Пауза при уходе: Playgama советует слушать `visibilitychange` и паузить+глушить (https://playgama.com/blog/business-faqs/how-to-handle-page-visibility-change-and-pause-states-in-bro/ ); Arkadium требует заглушать при потере фокуса (https://arkadiumsdk.z19.web.core.windows.net/docs/technical-requirements); CoolGames — проверка в чеклисте (https://www.coolgames.com/?p=1196).

## 7. Производительность и питание

- Режим энергосбережения iOS ограничивает rAF до ~30 fps (https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe , https://bugs.webkit.org/show_bug.cgi?id=215745 — было сломано в iOS 14, позже поведение менялось). 120 Гц: флаг «Prefer Page Rendering Updates near 60fps» в Safari (https://forums.macrumors.com/threads/enable-smoother-120hz-browsing-in-safari.2476442) — источники расходятся о значении по умолчанию; WebKit 173434 о 120 Гц rAF на iPad (https://lists.webkit.org/pipermail/webkit-unassigned/2023-August/1116032.html).
- Потеря WebGL-контекста: iOS 17 «Context Lost» при `setPixelRatio(devicePixelRatio)` (https://discourse.threejs.org/t/three-js-broken-on-ios-17-with-context-lost/58025 , WebKit 264684: https://bugs.webkit.org/show_bug.cgi?id=264684); предел памяти — программный потолок Safari, не объём ОЗУ (https://bugs.webkit.org/show_bug.cgi?id=300782); частые ресайзы холста приводят к сбою (https://lightrun.com/answers/mrdoob-three-js-ipad-ios-14-safarichrome-crashes-after-several-canvas-resizes); память WebGL при уходе со страницы может не освобождаться (https://bugs.webkit.org/show_bug.cgi?id=290623). Конкретного числа предела нет — не подтверждено; потолок DPR 1,5–2 в сводке поиска — мнение, не источник.
- Wake Lock: Safari 16.4 (https://developer.chrome.com/articles/wake-lock/); в «экране Домой» не работал (https://bugs.webkit.org/show_bug.cgi?id=254545, статус неясен); после `visibilitychange` на главном экране не переполучается (https://bugs.webkit.org/show_bug.cgi?id=255363). Обходы (NoSleep, скрытое видео) нашлись; не оценивались. У нас игра с касаниями часто — экран гаснет реже; необходимость не подтверждена.

## 8. Порталы

- Poki: игры должны поддерживать мобильные и планшеты, занимать весь экран в портрете или ландшафте; показывать мобильное управление на телефоне и подсказки клавиатуры на компьютере; принудительно мобильные схемы на планшетах (https://sdk.poki.com/requirements , https://sdk.poki.com/new-requirements — по выдаче поиска, страница не открывалась). Полноэкранный режим — на усмотрение Poki (https://sdk.poki.com/fullscreen).
- CrazyGames: касание обязательно, если заявлена мобильная поддержка; ориентацию выбирают при отправке, поворот показывает портал; своя кнопка полного экрана запрещена; 16:9 и читаемость при `devicePixelRatio` 1 (https://docs.crazygames.com/requirements/technical/ , https://docs.crazygames.com/requirements/gameplay/ — по выдаче; сторонний пересказ: https://www.summerengine.com/make-great-games/publish-an-html5-game ). Пауза+звук на рекламе — сторонний пересказ.
- Playgama: событие паузы `PAUSE_STATE_CHANGED`, сигнал `game_ready` (https://tessl.io/registry/skills/github/popey/gamedev.sh-skills/playgama-bridge-js-sdk — сторонний реестр); блог про iframe — `allow`, CORS, `postMessage` (https://playgama.com/blog/business-faqs/cross-origin-and-iframe-problems-when-embedding-games/). Официальные требования вики не найдены — не подтверждено. CoolGames: «без полос прокрутки в iframe» (https://www.coolgames.com/?p=1196).

## 9. Пороговые числа

- Apple: кнопка 44×44 pt; Material: 48×48 dp (вторичные пересказы: https://frontendchecklist.io/rules/accessibility/touch-targets , https://support.google.com/accessibility/android/answer/7101858?hl=en). WCAG 2.2 AA — 24×24 CSS px, AAA — 44×44 (тот же источник).
- Android: тап ~100 мс до долгого нажатия «минус» (эвристика Chromium: короткое нажатие ≈ долгое − 100 мс: https://chromium.googlesource.com/chromium/src/+/d4afc97b7/ui/events/gesture_detection/gesture_configuration_android.cc ); конкретные значения `ViewConfiguration` (долгое нажатие 400/500 мс, slop 8 dp) в выдаче не подтверждены.
- iOS: SwiftUI `LongPressGesture` — 0,5 с и 10 pt (https://developer.apple.com/documentation/uikit/handling-long-press-gestures.md , значения из пересказа); для UIKit — «общепринято», не документировано.
- Наши числа (touch_gestures.ts:12–22): удержание 180 мс, тап <260 мс, slop 12 px, стик 54 px, чувствительность 0,0052 рад/px. Удержание 180 мс короче системных 400–500 мс — то есть «идти» срабатывает раньше долгого нажатия iOS/Android; выноска системы (лупа) может сработать позже, поэтому два порога не конфликтуют, но источников «правильного» значения нет — не подтверждено.
- Взгляд: 1000–2000 мс (раздел 1).

---

## Что у нас уже сделано и чего нет

Сверено по коду (только чтение). Формат: совет — статус — где.

| Совет | Статус | Файл:строка |
|---|---|---|
| `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, прозрачная подсветка | есть | styles.css:36–40, 284, 339 |
| `overscroll-behavior: none`, нет прокрутки, `position: fixed` | есть | styles.css:18–31 |
| Метатег viewport с `viewport-fit=cover` (`user-scalable=no` на iOS игнорируется) | есть | index.html:7 |
| Безопасные зоны для HUD, кнопки фонаря, паузы | есть | styles.css:57, 343–344, 411, 534 |
| Pointer Events, `pointercancel` как отпускание, `setPointerCapture`, `contextmenu` гасится | есть | touch_controls.ts:85–90, 141 |
| `preventDefault()` на `pointerdown` | есть, но на прокрутку не действует (по WebKit 198560) | touch_controls.ts:139 |
| Закрыть краевой свайп iOS (не-пассивный `touchstart`, края 10–20 px) | есть с 17.11 (полоса 24 px, кнопки не трогаются) | platform/mobile_guard.ts: `guardTouch` |
| Запрет масштаба по `gesturestart` | есть с 17.11 | platform/mobile_guard.ts: `guardTouch` |
| Шаг по тапу (<260 мс, <12 px), ходьба удержанием (180 мс), стик слева, луч справа | есть | touch_gestures.ts:12–22, 60–97 |
| Многопальцевость: стик одним пальцем, луч другим; предел 5 касаний не обрабатывается | частично | touch_gestures.ts:60–64 |
| Фонарь: удержание дольше 0,25 с заряжает (slop 30 px, grace 600 мс), короткий тап (< 0,25 с, < 14 px, по отпусканию) — выключатель | есть (после разбора: смахивание заменено тапом по словам партнёра 09:23 и 10:04) | touch_controls.ts: `TAP`, `HOLD`, `lightTapped`, `lightHeld` |
| Кнопка паузы слева вверху | есть | touch_controls.ts:77–81, 91–93 |
| Размер кнопок ≥ 44 pt | фонарь 90 px, стик 124 px; размер кнопки паузы в этом разборе не проверялся | styles.css:347–348 |
| Тряска: разрешение по `click`, `requestPermission` только на iOS, активна после первого настоящего значения | есть | motion.ts:23–54, overlay.ts:188, app.ts:829–835 |
| Политика iframe для датчиков, передача данных из верхней страницы | нет (зависит от портала) | комментарий в motion.ts:2–5 |
| Вибрация `navigator.vibrate` только на тач-режиме с проверкой наличия | есть | app.ts:921–988 |
| Обход вибрации для iOS (`switch`-чекбокс) | нет | — |
| Разблокировка звука на `pointerdown/up`, `touchend`, `keydown` | есть | app.ts:233–234, engine.ts:187–198 |
| `navigator.audioSession.type = 'playback'` | есть с 17.11 (по слову партнёра «Да, звук нужен») | platform/mobile_guard.ts: `playThroughSilentSwitch`, вызов в audio/engine.ts `unlock` |
| Пауза по `visibilitychange`, по событию платформы, по потере контекста | есть | app.ts:305, 380–384, lifecycle |
| Потеря WebGL-контекста: `preventDefault`, восстановление | есть | renderer.ts:589–593, app.ts:305–307 |
| `setPixelRatio(1)`, внутренний размер от `devicePixelRatio` и качества | есть | renderer.ts:585, 1224–1231 |
| Пересборка целей рендера при каждом ресайзе | на телефоне с 17.11 — только когда размер успокоится (160 мс) | app.ts (ResizeObserver), platform/mobile_guard.ts: `RESIZE_SETTLE_MS` |
| Размер по `ResizeObserver` на корне | есть | app.ts:365–372 |
| `dvh`, `svh`, `visualViewport` | нет (корень fixed inset:0) | — |
| Просьба повернуть в портрете (только `pointer: coarse`) | есть | styles.css:274–278, overlay.ts:303 |
| Блокировка ориентации `screen.orientation.lock`, обработка `orientationchange` | нет | — |
| Полноэкранный режим (элемент), «на экран Домой», манифест | нет | — |
| Screen Wake Lock | есть с 17.11: на время игры, отпускается на паузе | platform/mobile_guard.ts: `ScreenAwake` |
| Подсказка поворота показывается и при смене ориентации во время игры | не проверено в коде (только CSS-медиазапрос) | styles.css:274 |
| Режим энергосбережения/30 fps: шаг по реальному времени кадра | не проверено в этом разборе | — |
| Чувствительность обзора (3 уровня), настройка в меню | есть (`sens`) | app.ts:229 |
| Выбор взглядом с удержанием 1–2 с | не проверялось (вне списка файлов) | — |

Расхождения внутри кода (для сведения): на момент разбора `touch_controls.ts` гасил смахиванием, а `motion.ts` упоминал «тереть кнопку фонаря». Обе формулировки исправлены основной моделью сразу после разбора: короткий тап — выключатель, заряжает удержание.

## Источники (сводно)

Поиск (прямая загрузка заблокирована): webkit.org/?p=7367; quirksmode.org/blog/archives/2020/12/userscalableno.html; developer.chrome.com/blog/overscroll-behavior; developer.chrome.com/blog/scrolling-intervention; developer.chrome.com/blog/300ms-tap-delay-gone-away; developer.chrome.com/articles/wake-lock; bugs.webkit.org (136531, 193962, 194173, 198560, 221399, 231161, 240312, 240917, 251532, 254545, 255363, 257695, 261185, 261554, 264684, 275947, 279998, 285120, 290623, 300782, 301294, 215745); pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4; yal.cc/?p=1395; developer.apple.com/forums (133248, 808606, 17606); caniuse.com/wf-screen-orientation-lock; groups.google.com blink-dev Hjo6zse3tvg; w3.org/TR/audio-session; discourse.threejs.org (58025); popmotion.io блог; sdk.poki.com; docs.crazygames.com; playgama.com блог и страница YouTube Playables; arkadiumsdk docs; coolgames.com guideline; pocketgamer.com Alien Isolation review; gurugamer.com Layers of Fear; wiki.stardewvalley.net Mobile_Controls; help.vrchat.com; arxiv.org/html/2404.13829v1; learn.microsoft.com gaze-and-dwell-eyes; gdcvault.com 1015404.
