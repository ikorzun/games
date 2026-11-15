# Untitled Session: второй заход на выбор стека (ноябрь 2026)

Независимый разбор: проект будет большим, окружение — коллаж разнородной графики, всё, чего коснулся
герой, растворяется, ориентир — .kkrieger, источник части содержимого — сканы владельца (.glb, .spz).
Вариант «нынешний выбор ошибочен» рассматривался всерьёз. Дата сбора фактов — 2026-11-14.

**Оговорка о сети.** Прямо открыть не удалось `caniuse.com`, `threejs.org`, `sparkjs.dev`,
`radiancefields.com`: эти хосты закрыты сетевой политикой сессии. Факты о них взяты из выдачи
поиска, где поисковик цитирует эти страницы. Такие места помечены «(по выдаче поиска)».

---

## 0. Что показал код (измерено в репозитории)

| Что | Число |
|---|---|
| Весь `vylazka/src` | ~23,9 тыс. строк TS |
| Файлы, которые импортируют `three` | **2**: `render/renderer.ts` (1537 строк) и `render/splats.ts` (353) |
| Шейдеры (`render/shaders.ts`) | 1324 строки GLSL строками, 20 `void main`; **без `#include` из three**, но опираются на префикс `ShaderMaterial` (`#version`, `attribute`→`in`, встроенные `projectionMatrix`/`modelViewMatrix`/`cameraPosition` — 23 места) |
| Мир, точки, уровни, реквизит, модели | чистый TS без three (`world/kit.ts` `MeshData`, `world/points.ts`), работает в Worker и тестах |
| Что из three реально используется | `WebGLRenderer`, `ShaderMaterial` (35 упоминаний), `WebGLRenderTarget` (20), `BufferAttribute`/`InstancedBufferAttribute`, `Points`, `Mesh`, `LineSegments`, `DataTexture`/`DataArrayTexture`, `DepthTexture`, матрицы/векторы, `Frustum`. Ни загрузчиков (`GLTFLoader`), ни `EffectComposer`, ни встроенных материалов и света, ни `onBeforeCompile` |
| Готовые модели | импортируются офлайн скриптом (`scripts/import_models.py`) в TS-данные (`models_data.ts`, 211 КБ исходника) — уже «рецепт при сборке», а не загрузчик в рантайме |
| Сборка | `dist/assets/index-*.js` 1,29 МБ сырого, **383 КБ gzip**; весь `dist` 2,4 МБ |

**Вывод из кода.** three.js здесь используется как тонкая обёртка над WebGL2: состояние GL, компиляция
программ, униформы, буферы кадра, матрицы. Граф сцены и «движок» почти не задействованы. Граница
рендера уже проведена и узка (≈1,9 тыс. строк). Это главный факт всего разбора: **переезд с three
стоит дёшево, и именно поэтому торопиться с ним незачем**. Дорогая часть любого переезда —
не 1,9 тыс. строк обвязки, а 1,3 тыс. строк GLSL, если целевой рендер не принимает GLSL
(three WebGPURenderer его не принимает, см. §2).

---

## 1. Критерии и веса

| # | Критерий | Вес | Почему такой вес |
|---|---|---|---|
| K1 | Свой нестандартный рендер: точки/сплаты, ~10 полноэкранных проходов, память кадра, глубина, полный контроль шейдеров | 20 | Это и есть игра. Движок, который мешает писать свои проходы, проигрывает сразу |
| K2 | Телефоны в 2026 (охват + скорость на слабом GPU) | 15 | Порталы — в основном мобильный трафик; частота кадров на телефоне до сих пор не измерена |
| K3 | Размер и время загрузки, работа в iframe портала | 12 | Ориентир .kkrieger; Playgama: «враг — время загрузки», `game_ready` после первого кадра |
| K4 | Тестируемость без GPU (headless Chromium + SwiftShader в CI) | 10 | Команда — агенты; без зелёного CI они слепнут |
| K5 | Удобство для агентов: всё текстом, типы, быстрая обратная связь, много обучающих данных | 12 | Визуального редактора не будет никогда |
| K6 | Готовое для сканов и сплатов (.glb, .spz) | 8 | Важно, но эстетика игры — «как скан», а не фотореализм сканов; часть можно сделать своими силами |
| K7 | Цена переезда | 10 | 24 тыс. строк, рабочий CI, смоук на шесть экранов |
| K8 | Срок жизни технологии, направление развития | 8 | Проект большой и долгий |
| K9 | Путь к настольной сборке | 5 | «Возможно, позже»; веб-обёртка (Electron/Tauri) решает это для любого веб-варианта |

Сумма весов — 100. Оценки 1–5; итог = Σ(вес × оценка) / 5, максимум 100.

---

## 2. Факты 2026 года из сети

**WebGPU — охват.**
- caniuse (по выдаче поиска, данные на 24.08.2026): полная поддержка ≈84% просмотров в мире,
  частичная ≈3%. [enterno.io; jwatte.com]
- Chrome/Edge: десктоп с 113; Android с Chrome 121 — Android 12+, GPU Qualcomm/ARM (Adreno/Mali).
  [web.dev; developer.chrome.com, New in WebGPU 121]
- Chrome 146 (февраль 2026): «режим совместимости» WebGPU поверх OpenGL ES 3.1 для старого железа.
  Цифры охвата Android после этого не нашёл. [developer.chrome.com, New in WebGPU 146; cinevva]
- В обсуждении blink-dev (январь 2026): у 23% Android-пользователей нет Vulkan 1.1, у 15% нет
  Vulkan вообще (это про Vulkan, а не прямо про WebGPU). [groups.google.com/a/chromium.org]
- Safari 26 (сентябрь 2025): WebGPU на macOS, iOS, iPadOS, visionOS. [web.dev; webkit по выдаче]
- iOS 26 стоит на 79% всех активных iPhone и 86% iPhone последних четырёх лет (данные Apple на
  07.06.2026). [9to5mac 2026-06-10; iclarified]
- Firefox: Windows с 141 (июль 2025), Apple Silicon с 147 (январь 2026); Linux и Firefox Android —
  по умолчанию нет. [enterno.io]
- **Противоречие:** часть источников пишет «WebGPU работает во всех основных браузерах везде»,
  часть — что Linux и Android «ещё в процессе». Реальный охват WebGPU на дешёвых Android-телефонах
  (наша аудитория на порталах) достоверно не установлен. Мой вывод: **на телефонах WebGPU-путь
  в 2026 году требует WebGL2-запаски для заметной доли (оценка: 15–30%) игроков.**

**WebGL2 — охват.** Не удалось проверить caniuse в этой сессии; по памяти — ≈96–97% в мире, iOS с 15,
практически весь живой парк Android. Это ориентир, а не проверенная цифра.

**three.js WebGPURenderer и TSL.**
- Официальное руководство (по выдаче поиска): «материалы на основе `ShaderMaterial`,
  `RawShaderMaterial` и `onBeforeCompile()` в WebGPURenderer не поддерживаются; эту часть надо
  перенести на node-материалы и TSL»; `EffectComposer` тоже не поддерживается. [threejs.org/manual/en/webgpurenderer]
- TSL компилируется в WGSL (WebGPU) или GLSL (запасной WebGL2); запасной путь включается сам,
  принудительно — `forceWebGL: true`; compute-шейдеры на запасном пути не работают. [buildmvpfast.com; utsubo.com]
- О зрелости источники расходятся: «готов с r171», «r182 (дек. 2025) — рекомендуемый рендер»,
  «API TSL ещё меняется между релизами». [utsubo.com; vr.org 2026-05-06; skillselion]
- Перевод GLSL→TSL у людей идёт тяжело, особенно передача данных в вершинный этап. [discourse.threejs.org]

**Сплаты в вебе.**
- three.js r186 (08.09.2026): встроенный `GaussianSplat` — **только с WebGPURenderer**
  (включая его `forceWebGL`), с `WebGLRenderer` не работает; сортировка на GPU (на WebGL2 — в JS);
  загрузчики PLY, SPZ, .splat, .ksplat, glTF `KHR_gaussian_splatting`; **нет LOD и потоковой загрузки**.
  [radiancefields.com по выдаче; zeli.app; threejs.org/docs/pages/GaussianSplat]
- Spark (World Labs): рендер сплатов для three.js на **WebGL2 через WebGLRenderer**, сортировка в
  воркере; 2.0 (апрель 2026) — LOD, потоковый формат, подкачка памяти; бюджет по умолчанию 3 млн
  сплатов на десктопе и 1 млн на телефоне; читает SPZ, SPLAT, KSPLAT, SOG, PLY; нужен three r179+;
  текущая версия 2.4.0. Spark Radix 0.0.1 — экспериментальный WebGPU-вариант на WebGPURenderer r186.
  Независимых мобильных замеров нет — только цифры авторов. [github.com/sparkjsdev/spark; unpkg README 2.1.0; radiancefields по выдаче]
- PlayCanvas: «единый» рендер сплатов (бета, с 2.11), тени (2.15, январь 2026), SPZ v4 и glTF
  `KHR_gaussian_splatting` (2.21, июль 2026), WebGPU-сплаты (2.17); SuperSplat 3.0 на движке 2.22.
  Самый зрелый стек именно для сплатов. [developer.playcanvas.com; radiancefields по выдаче; cinevva]
- Babylon.js: сплаты с 7.0, SPZ, SOG, WebGL2 и WebGPU; `@babylonjs/lite` — облегчённая
  WebGPU-first библиотека с потоковой загрузкой сплатов. [forum.babylonjs.com; radiancefields по выдаче]

**Размеры движков (минимум, gzip).** Первичных замеров не нашёл, только сторонние:
three ≈125–170 КБ (r175–r181), PlayCanvas ≈300 КБ (неясно, gzip ли), Babylon.js от ≈350 КБ
(core) до ≈1,4 МБ (полный); пустой Unity Web 6 — ≈9,7 МБ по умолчанию и ≈2,2 МБ после урезания,
при этом ≈200 МБ памяти; Godot 4 Web — ≈5–8 МБ сжатого (2024, анекдотично). [utsubo.com; logrocket;
discourse.threejs.org; playgama.com/blog; discussions.unity.com; forum.godotengine.org]
Свой замер: наш бандл 383 КБ gzip вместе с three, миром и моделями.

**Godot 4 Web.** Только WebGL2 через Compatibility-рендер; Forward+/Mobile в вебе нет; WebGPU нет;
однопоточный экспорт по умолчанию с 4.3 (без SharedArrayBuffer/COOP/COEP), но медленнее; C# в веб
не экспортируется; в iframe для сохранений нужны сторонние cookies; на iOS — повторяющиеся
жалобы на потерю контекста и вылеты (форум, 4.3–4.4). [docs.godotengine.org 4.5; forum.godotengine.org]

**Unity Web.** С Unity 6 официально поддерживаются мобильные браузеры; WebGPU — экспериментально,
в 6.6 (сентябрь 2026) по умолчанию выключен: «не все устройства, сообщающие о WebGPU, работают
стабильно» (по вторичному источнику). [unity.com blog; cinevva 2026-09-01; alternativeto]

**Bevy/wgpu.** Сборка под WebGL2 и WebGPU одним инструментом; замеров размера WASM в 2026 году не нашёл;
статус WebGPU в релизах Bevy источники излагают противоречиво. [bevy.org/news/bevy-webgpu; cheatbook]

**Не проверено вовсе:** WebGPU в headless Chromium без GPU (SwiftShader/Dawn) на нашем CI —
по памяти, Dawn умеет SwiftShader-адаптер, но в этой сессии это не проверялось.

---

## 3. Кандидаты

| Код | Кандидат | Суть |
|---|---|---|
| A | **Остаться как есть** | three 0.187 `WebGLRenderer`, свой GLSL, TS/Vite |
| A+S | A + Spark 2 для «настоящих» сплатов | Spark работает поверх WebGLRenderer — встаёт в нынешний стек |
| B | three WebGPURenderer + TSL (запаска WebGL2) | Переписать 1,3 тыс. строк GLSL в TSL, обвязку — под node-материалы |
| C | Babylon.js | Полноценный движок, сплаты, WebGL2/WebGPU |
| D | PlayCanvas (движок без редактора) | Лучший стек для сплатов, свой шейдерный «чанк»-механизм |
| E | Свой тонкий слой над WebGL2 (дух .kkrieger) | Заменить 2 файла three на ~1,5–2,5 тыс. строк своего кода (или twgl/OGL как основу) |
| F | Свой слой с двумя бэкендами WebGPU + WebGL2 | Как E, но с WGSL-путём; шейдеры в двух языках или через транслятор (naga/tint) |
| G | Godot 4 Web | Компат-рендер WebGL2, WASM |
| H | Unity Web | URP, WASM |
| I | Rust/wgpu или Bevy в WASM | Весь код на Rust |
| J | Гибрид: A + воркеры + WASM-модули для генерации | Рендер прежний, тяжёлые генераторы — в воркерах, WASM — только по профайлеру |
| — | Отброшены без оценки | Needle Engine (живёт через Unity/Blender-редактор), luma.gl/regl/OGL как самостоятельный выбор (это кирпичи для E, а не альтернатива) |

---

## 4. Таблица оценок

| | K1 рендер (20) | K2 телефоны (15) | K3 размер/iframe (12) | K4 CI без GPU (10) | K5 агенты (12) | K6 сканы (8) | K7 переезд (10) | K8 срок жизни (8) | K9 десктоп (5) | **Итог** |
|---|---|---|---|---|---|---|---|---|---|---|
| A как есть | 4 | 5 | 4 | 5 | 5 | 3 | 5 | 3 | 4 | **86,2** |
| E свой WebGL2 | 5 | 5 | 5 | 5 | 4 | 3 | 3 | 4 | 4 | **87,8** |
| J гибрид A+воркеры/WASM | 4 | 5 | 4 | 5 | 4 | 3 | 4 | 3 | 4 | **81,8** |
| F свой WebGPU+WebGL2 | 5 | 4 | 5 | 3 | 3 | 3 | 2 | 5 | 4 | **78,0** |
| A+S (Spark) | 4 | 4 | 3 | 4 | 4 | 5 | 4 | 3 | 4 | **77,6** |
| B three WebGPU+TSL | 4 | 4 | 3 | 3 | 3 | 5 | 2 | 5 | 4 | **72,4** |
| C Babylon.js | 3 | 4 | 2 | 4 | 4 | 5 | 1 | 4 | 4 | **66,8** |
| D PlayCanvas | 3 | 4 | 3 | 4 | 3 | 5 | 1 | 4 | 3 | **65,8** |
| I Rust/wgpu/Bevy | 4 | 3 | 2 | 3 | 3 | 2 | 1 | 4 | 5 | **59,6** |
| G Godot 4 Web | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 4 | 5 | **44,2** |
| H Unity Web | 3 | 2 | 1 | 1 | 1 | 3 | 1 | 4 | 5 | **43,0** |

Пояснения к спорным оценкам:
- **A, K6 = 3.** Встроенный `GaussianSplat` three r186 нам недоступен (только WebGPURenderer). Но
  .spz читается легко (gzip + шапка), а Spark встаёт в WebGLRenderer — поэтому не 2.
- **A, K8 = 3.** WebGLRenderer не умирает, но всё новое в three (сплаты, compute, TSL) идёт в
  WebGPURenderer. Это медленный дрейф, а не обрыв.
- **E выше A на 1,6 балла** — в пределах погрешности моих оценок. Это ничья, а не победа.
  Выигрыш E — 130–170 КБ gzip и полный контроль; проигрыш — свой код, который надо поддерживать.
- **B, K4 = 3.** Запасной WebGL2-путь тестируется в нашем CI, а основной WebGPU-путь в headless без
  GPU — не проверен. То есть в CI мы гоняли бы не то, что видит большинство игроков.
- **B, K5 = 3.** TSL — JS-DSL с типами, но обучающих примеров мало, API ещё сдвигается,
  ошибки компиляции узлов читать труднее, чем ошибки GLSL.
- **C/D, K1 = 3.** Свои проходы возможны, но приходится работать сквозь чужую модель материалов,
  чанков и рендер-пайплайна; наши 10 проходов с памятью кадра — не тот сценарий, под который их
  строили.
- **G/H.** Против ключевых условий: редактор-центричность (K5), вес и память (K3), слабые телефоны
  в вебе (K2), headless-CI без редактора и лицензии (K4).

**Итог таблицы:** нынешний выбор (three.js на WebGL2, свои шейдеры) **не ошибочен**. Он и свой
тонкий слой E — две верхние строки с отрывом от всех остальных. Движки (Babylon, PlayCanvas,
Godot, Unity) проигрывают не из-за качества, а потому что игра почти целиком состоит из своего
рендера, а их сила — в том, чего нам не надо (физика, редактор, стандартные материалы, свет).
Переход на WebGPU сейчас (B, F) — это оплата будущего охвата текущей надёжностью и тестируемостью.

---

## 5. Не только рендер

**Модель данных и состояния. ECS не нужен.** Нет физики, нет взаимодействий, сущностей мало
(игрок, фонарь, Осыпь, десятки «кусков» коллажа, тысячи точек — но точки живут в GPU-буферах, а не
в объектах). Фреймворк ECS (bitECS, miniplex) добавит слой косвенности без выигрыша. Нужно
другое: **реестр кусков коллажа** — плоские типизированные записи `Piece { id, kind, recipe | asset,
transform, bounds, budget, dissolve: {state, t, seed, variant} }` в массивах, плюс системы-функции
(`systems/*`), которые их обходят. Механика «коснулся — растворилось — вернулось после щелчка
фонаря, может, в другом месте» — это детерминированный конечный автомат на куске с сидом
«поколения» (`seed ⊕ счётчик щелчков`): тогда возврат «в другом виде и месте» — чистая функция,
воспроизводимая в тестах без рендера. Состояние игры — одно сериализуемое дерево, рендер его
только читает (так уже устроен `FrameView`).

**Формат содержимого: рецепты-данные + генераторы-код.** Дух .kkrieger — хранить не результат,
а рецепт, и разворачивать его при загрузке. У нас это уже сделано для уровней (сид → план → сетки
в Worker). Для большого проекта: генераторы и примитивы — код на TS (типы, тесты, рефакторинг
агентами), а **сборка мира — данные**: JSON-рецепты миров/комнат/кусков со схемой (JSON Schema
или zod, проверка в `npm test`), ссылки на генераторы по имени и параметры. Не делать
универсальный «граф операторов» как в werkkzeug — он окупается только с визуальным редактором,
а у нас его не будет; агентам проще и надёжнее писать типизированные функции.

**Форматы ассетов.** На входе — glTF/GLB и SPZ (их даёт Scaniverse). **В сборку их не класть
как есть**: офлайн-конвейер в Node (как нынешний `import_models.py`) переводит их в свои
компактные бинарные блобы: сетка — квантованные позиции/нормали (16 бит) + индексы, по желанию
meshopt-сжатие (декодер ≈десятки КБ, сжатие сильное); облака точек/сплатов — квантованные позиции,
цвет 8 бит, размер, без сферических гармоник (вид «с бодикама» их съест), прорежённые до бюджета
куска. Текстуры — WebP для плоских картинок и экранов (уже так), KTX2/Basis — только если появится
много больших текстур на GPU (транскодер весит ≈200+ КБ, сейчас не окупится). Бюджеты (КБ на
кусок, точки на кусок, МБ на мир) — проверка в `check_dist.mjs`, как сейчас для архива. Миры
грузить по требованию (одним файлом на мир), а ядро держать в нынешних ~400 КБ gzip.

**Сборка и тесты.** Vite + TS strict + vitest — оставить. Добавить: правило «`three` импортируется
только в `src/render/`» (тест-grep или ESLint `no-restricted-imports`); «нулевой» бэкенд рендера
для юнит-тестов систем; эталонные кадры по фиксированным ракурсам с допуском (на SwiftShader
кадр детерминирован достаточно) — это то, что ловит поломки шейдеров при любом будущем переезде;
замер на реальном телефоне (облачная ферма устройств или телефон владельца по ссылке
`?bench=1`) — единственное, чего CI не даст.

**Звук.** Голый WebAudio (уже так), без Howler/Tone — лишний вес. Файлы — в двух форматах не
нужно: AAC (m4a) или MP3 играются везде, Opus/OGG в старых Safari капризен. Пространственность —
`PannerNode`/HRTF, без библиотек. Решение «только файлы, без синтеза» оставить.

**Сейвы.** Один ключ `profile` через `bridge.storage` (уже так), версия схемы в самом JSON и
цепочка функций миграции `v1→v2→…` с тестом на каждую. Мир не сохраняется — он из сида; при
появлении «долгих» состояний коллажа хранить сиды и счётчики, а не геометрию.

---

## 6. Рекомендация

**В двух фразах.** Оставить three.js на WebGL2 со своими GLSL-шейдерами: для игры, которая почти
целиком — свой рендер, это лучший баланс охвата телефонов, тестируемости в CI и удобства агентов, и
он уже проведён через узкую границу (2 файла). Не переезжать ни на движок, ни на WebGPU сейчас, а
вложиться в то, что делает любой будущий переезд дешёвым: описание проходов данными, шейдеры без
привязки к three, свой конвейер ассетов и эталонные кадры.

**Сейчас (1–3 недели работы агентов):**
1. Закрепить границу рендера: интерфейс `RenderBackend` (создать буферы куска, обновить униформы,
   нарисовать кадр по `FrameView`) и правило «three только в `src/render/`» в тестах.
2. Описать цепочку проходов данными: список `{name, shader, inputs, outputs, size, blend, depth}`.
   Тогда исполнитель проходов — единственное место, которое знает про API GPU.
3. Шейдеры: оставить GLSL ES 3.00, разнести по модулям, общие функции (растворение, память,
   шум) — строковыми вставками нашего же сборщика. Сейчас они опираются на то, что подставляет
   `ShaderMaterial`: `#version 300 es`, перевод `attribute`/`varying`, встроенные `projectionMatrix`,
   `modelViewMatrix`, `cameraPosition` и т. п. (23 упоминания). Перейти на `RawShaderMaterial`
   с явными объявлениями — тогда шейдеры перестают зависеть от three вовсе, переносятся в голый
   WebGL2 без правок и годятся для машинной трансляции в WGSL (naga/tint), если до неё дойдёт.
4. Ввести тип `Piece` и единый контракт растворения для всех видов графики (болванки, модели,
   скан-сетки, облака точек, плоские, проволока): у каждого вида свой вершинный путь, но общая
   функция растворения по униформам куска.
5. Офлайн-конвейер сканов: `.glb`/`.spz` → свои бинарные блобы с бюджетом; рендерить облака
   сканов **своим** точечным шейдером (`SPLAT_VERT`), а не чужим сплат-рендером: эстетика игры —
   мягкие точки, сходящиеся под светом, а это ровно наш шейдер, а не фотореалистичный 3DGS.
6. Замерить частоту кадров на 2–3 реальных телефонах (дешёвый Android с Mali, средний, iPhone).
   Без этого любые решения о рендере — гадание.

**Позже, по сигналу (не по календарю):**
- **Spark (A+S)** — если какой-то кусок коллажа должен быть настоящим сплатом с анизотропией и
  зависимостью от ракурса и наш точечный шейдер явно не тянет. Spark встаёт в нынешний
  WebGLRenderer; бюджет — ≤1 млн сплатов на телефоне по данным самих авторов.
- **Свой тонкий слой E** — если замеры покажут, что three съедает заметную долю кадра на CPU
  телефона, или если бандл станет узким местом. Благодаря шагам 1–3 это механическая замена двух
  файлов (оценка: 1,5–2,5 тыс. строк, неделя-две агентов + эталонные кадры).
- **WebGPU (B или F)** — когда понадобятся compute-шейдеры (GPU-сортировка миллионов точек,
  симуляция осыпания на GPU) **и** WebGPU в headless-CI будет проверен **и** охват на дешёвых
  Android станет понятен. Выбор между B и F тогда: если three к тому моменту объявит
  WebGLRenderer устаревшим и TSL устоится — B; иначе — F с трансляцией наших GLSL в WGSL.
- **WASM** — только для горячих мест, найденных профайлером (посев сейчас ≈14 тыс. точек/мс в TS —
  этого хватает). Тяжёлые генераторы — сначала в Worker на TS.

**Никогда (для этой игры):** Unity, Godot, Bevy как основа; фреймворк ECS; физический движок;
любой процесс, требующий визуального редактора; хранить сканы в сборке в исходном виде.

**Что делать, чтобы смена рендера стоила дёшево** — это шаги 1–3 и эталонные кадры. Критерий
готовности: «новый бэкенд = новый исполнитель проходов + новые сборщики буферов; системы игры,
мир, генераторы и данные не меняются, а эталонные кадры совпадают с допуском».

---

## 7. Что изменило бы мой вывод

- **Замеры на телефонах** показывают, что узкое место — накладные расходы three на CPU → E сразу.
- **Нужен compute** (сортировка, GPU-симуляция десятков миллионов точек) как основа эстетики → B/F
  раньше, несмотря на цену.
- Владелец решает, что **фотореалистичные сканы — главное содержимое**, а не один из видов коллажа →
  серьёзнее смотреть на A+S, а при большом объёме сплатов — на PlayCanvas (D): там сплатовый стек
  самый зрелый, и цена переезда (одна-две недели на 1,9 тыс. строк обвязки + шейдеры через их
  механизм) может окупиться.
- **three объявляет WebGLRenderer устаревшим** или перестаёт его чинить → B.
- В команде появляются **люди-художники с редактором** → Babylon/PlayCanvas с редактором, а при
  десктопе-в-первую-очередь — Godot.
- **Настольная или консольная сборка становится главной**, а веб — вторичным → Godot или Rust/wgpu.
- **WebGPU в headless Chromium без GPU доказанно работает** в нашем CI и охват на дешёвых Android
  > 90% → штраф B по K2/K4 снимается, и B выходит почти вровень с A.

---

## 8. Адвокат дьявола

Самый сильный довод против: **«сейчас — самый дешёвый момент для перехода на WebGPURenderer и
TSL, и он будет только дорожать».** Шейдеров 1,3 тыс. строк, а в большом проекте их станет 5–10
тысяч; каждая новая строка GLSL — будущий долг. Всё новое в three (встроенные сплаты r186, GPU-
сортировка, compute, Spark Radix) уже идёт только в WebGPURenderer; WebGLRenderer дрейфует к
статусу «поддерживается, но не развивается». WebGPU есть у ≈84% просмотров, Safari на iOS 26
стоит на ~80% iPhone, а для остальных у WebGPURenderer есть автоматическая запаска на WebGL2
из того же TSL — то есть охват не теряется. Отложив переход, мы через год будем переписывать
вчетверо больше.

Почему я всё же против прямо сейчас: (1) запасной WebGL2-путь из TSL — это то, что увидят дешёвые
телефоны и что будет гоняться в нашем CI, а основной путь в CI не проверяется — тестируем не то,
что видят игроки; (2) API TSL ещё сдвигается, а агенты пишут его хуже GLSL; (3) наши шейдеры не
привязаны к three, поэтому их рост не увеличивает долг перед three — при переезде на F их можно
транслировать, при переезде на B — переписать по эталонным кадрам. Довод сильный и честный, и
его стоит пересматривать каждые 3–4 месяца по условиям из §7.

---

## Источники

Дата обращения ко всем — 2026-11-14. «(выдача)» — страница не открывалась, факт взят из цитаты
поисковика.

1. web.dev — WebGPU is now supported in major browsers: https://web.dev/blog/webgpu-supported-major-browsers
2. enterno.io — WebGPU adoption 2026 (цитирует caniuse на 24.08.2026): https://enterno.io/en/s/research-webgpu-adoption-browsers-2026
3. jwatte.com — WebGPU everywhere: https://jwatte.com/blog/webgpu-everywhere-delete-server-fallback/
4. Chrome — New in WebGPU 121 (Android): https://developer.chrome.com/blog/new-in-webgpu-121
5. Chrome — New in WebGPU 146 (февраль 2026): https://developer.chrome.com/blog/new-in-webgpu-146
6. blink-dev — Intent to Ship: WebGPU on Android / Compatibility mode: https://groups.google.com/a/chromium.org/g/blink-dev/c/YFWuDlCKTP4 , https://groups.google.com/a/chromium.org/g/blink-dev/c/N3RlLGCOTJ4/m/loneRTlPBwAJ
7. Chromium WebGPU blocklist: https://chromium.googlesource.com/chromium/src.git/+/main/gpu/config/webgpu_blocklist_impl.cc
8. gpuweb — Implementation Status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
9. 9to5mac — iOS 26 adoption (2026-06-10): https://9to5mac.com/2026/06/10/ios-26-adoption-grows-but-still-lags-slightly-behind-ios-18/
10. iclarified — iOS 26 adoption 86%/79%: https://www.iclarified.com/101140/ios-26-adoption-reaches-86-on-recent-iphones-79-overall-chart
11. three.js manual — WebGPURenderer (выдача): https://threejs.org/manual/en/webgpurenderer
12. three.js docs — GaussianSplat (выдача): https://threejs.org/docs/pages/GaussianSplat.html
13. radiancefields — three.js r186 native Gaussian splat renderer (выдача): https://radiancefields.com/three.js-ships-its-native-gaussian-splat-renderer-and-splat-raycasting-in-r186
14. zeli.app — Three.js r186 adds native Gaussian splats: https://zeli.app/story/49624366
15. utsubo — WebGPU + Three.js migration guide (2026): https://www.utsubo.com/blog/webgpu-threejs-migration-guide
16. buildmvpfast — three.js WebGL→WebGPU migration (2026): https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026
17. vr.org — WebGPU baseline 2026 (2026-05-06): https://vr.org/articles/webgpu-baseline-2026-three-js-webxr-default
18. discourse.threejs.org — TSL and WebGL2 vs WebGPU: https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974
19. discourse.threejs.org — 8 KB gzip increase in 0.181: https://discourse.threejs.org/t/8kb-gzipped-size-increase-in-0-181-0-recommendation-on-tooling-to-analyze-package-size/87880
20. Spark — GitHub: https://github.com/sparkjsdev/spark ; README 2.1.0: https://unpkg.com/@sparkjsdev/spark@2.1.0/README.md
21. Spark — LoD renderer docs (выдача): https://sparkjs.dev/docs/new-spark-renderer/
22. World Labs — Spark 2.0: https://worldlabs.ai/blog/spark-2.0
23. radiancefields — Spark Radix (выдача): https://radiancefields.com/spark-radix-brings-webgpu-splat-rendering-to-threejs
24. PlayCanvas — Unified Splat Rendering: https://developer.playcanvas.com/user-manual/gaussian-splatting/building/unified-rendering
25. PlayCanvas — Splat Rendering Architecture: https://developer.playcanvas.com/user-manual/gaussian-splatting/building/rendering-architecture
26. radiancefields — PlayCanvas 2.21 SPZ/glTF (выдача): https://radiancefields.com/playcanvas-engine-v2.21.0-adds-gltf-and-spz-gaussian-splat-loading
27. Babylon.js forum — SPZ support: https://forum.babylonjs.com/t/new-feature-niantic-spz-gaussian-splatting-and-spherical-harmonics/55124
28. Babylon.js forum — bundle size: https://forum.babylonjs.com/t/babylon-bundle-size/48068
29. utsubo — three vs Babylon vs PlayCanvas (2026): https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison
30. Godot docs 4.5 — Exporting for the Web: https://docs.godotengine.org/en/4.5/tutorials/export/exporting_for_web.html
31. Godot forum — iOS context loss 4.3: https://forum.godotengine.org/t/webgl-context-loss-and-app-crash-in-godot-4-3-exported-web-on-ios-browsers/81024
32. Godot forum — iOS crashes HTML export: https://forum.godotengine.org/t/game-crashes-randomly-on-ios-devices-html-export/114043
33. Unity blog — Web runtime updates: https://unity.com/blog/engine-platform/web-runtime-updates-enhance-browser-experience
34. cinevva — Unity 6.6 WebGPU (2026-09-01): https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production
35. Playgama blog — empty Unity build 10→2 МБ: https://playgama.com/blog/unity/how-to-shrink-empty-unity-build-from-10mb-to-2mb/
36. Unity discussions — Unity 6 web memory: https://discussions.unity.com/t/web-build-memory-consumption-on-unity-6/1613334
37. Bevy — Bevy + WebGPU: https://bevy.org/news/bevy-webgpu/
38. .kkrieger / werkkzeug3 (принцип): https://github.com/jaromil/kkrieger-werkkzeug3
