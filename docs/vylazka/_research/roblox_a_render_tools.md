# Roblox: рендер, процедурка, инструменты — сводка фактов (ноябрь 2026)

Метод и ограничения. Прямое открытие страниц было заблокировано (create.roblox.com, devforum.roblox.com и др. не резолвятся из этой сессии). Всё ниже взято только из сниппетов веб-поиска, страницы целиком не читались. Каждый факт помечен как «официальная дока» (create.roblox.com), «официальный DevForum-пост» (сотрудник Roblox), «пользователь» (реплика сообщества) или «сторонний». Даты источников в большинстве случаев неизвестны. Всё, что требует проверки, помечено «требует проверки». Выводов и решений здесь нет.

---

## A. Рендер и свет

### A1. Future lighting и локальные источники света
- Future lighting на Android включается в опыте с Future при графическом уровне 4/10 и выше (сниппет поиска из треда «Future is Bright on Android is fully rolled-out [Client Beta]»; на телефонах выше ~уровня 4 ПК-эквивалента не подняться — реплика пользователя). Источник: https://devforum.roblox.com/t/future-is-bright-on-android-is-fully-rolled-out-client-beta/3235808 . Статус тезиса: официальный пост + пользователь, дата неясна, требует проверки.
- Старая реплика пользователя: Future не включается (откат на ShadowMap), пока графика не 5+. Источник: https://devforum.roblox.com/t/do-mobile-devices-get-future-lighting/1152409 . Источник старый (≈2021), до выхода Future на Android. Расходится с пунктом выше (4 vs 5), требует проверки.
- Устройства без поддержки откатываются на ShadowMap или Voxel (реплика сотрудника Roblox): https://devforum.roblox.com/t/future-is-bright-phase-3-released/878634 . Старый источник.
- Future добавляет теневые источники поверх воксельной сетки света для ближних ламп (реплика разработчика): https://devforum.roblox.com/t/future-is-bright-on-android-is-fully-rolled-out-client-beta/3235808?page=3 .
- Дальность PointLight/SpotLight/SurfaceLight увеличена с 60 до 120 студов: https://devforum.roblox.com/t/extended-light-ranges-doubling-the-limit-to-120/3954367 . Официальный пост, дата не подтверждена (id темы 3954367 указывает на конец 2025).
- Дальность «по-пиксельного» света зависит от текущего уровня качества (сотрудник): https://devforum.roblox.com/t/increase-range-limit-of-lights/68336/170 .
- Запрос разработчиков на контроль размера shadow atlas отдельно для мобильных («mobile hardware can't always handle realtime lighting at desktop performance»): https://devforum.roblox.com/t/future-lighting-needs-to-expose-more-internal-hardcoded-properties-for-light-instances/2580333 . Это запрос, не возможность.
- Рекомендация ограничивать число светов с тенями на телефонах без числа: сторонний https://nilo.io/articles/roblox-studio-light-mobile .
- НЕ НАЙДЕНО: официальный лимит числа одновременных теневых источников и точное правило автоснижения Future на низких уровнях.

### A2. Atmosphere, Lighting-свойства, пост-эффекты
- Страница «Post-processing effects» (официальная дока): эффекты в Lighting действуют на всех игроков, в Camera — на одного; описаны Bloom, Blur, DepthOfField, ColorCorrection, SunRays. Для Studio: при низком Editor Quality Level часть эффектов не видна. https://create.roblox.com/docs/environment/post-processing-effects
- Enum QualityLevel (официальная дока): на низких уровнях часть пост-эффектов может быть полностью отключена, дальние объекты не рисуются; влияние уровня на конкретные фичи «зависит от платформы и устройства и не может считаться гарантированным». https://create.roblox.com/docs/reference/engine/enums/QualityLevel.md
- Мобильный отчёт (пользователь): графика уровня 3+ даёт сильные CPU-скачки: https://devforum.roblox.com/t/graphics-level-3-causing-immense-lag-on-mobile/3230028 .
- Конкретные свойства Atmosphere/Ambient/OutdoorAmbient/ExposureCompensation: специальных источников в поиске не получено. НЕ ПОДТВЕРЖДЕНО в этой сессии (общеизвестно существуют, но по документам не проверено).
- Практика «тёмного» хоррора (сторонний/пользовательский совет): понизить ambient, чёрный туман, повысить контраст, опора на фонарь: https://devforum.roblox.com/t/horror-game-lighting/1086876 . Предупреждение: Future + плотная Atmosphere + grain + много скриптов лагают на слабых устройствах (то же).

### A3. SurfaceAppearance, Highlight, ViewportFrame
- Highlight: по официальной доке в клиенте одновременно показывается до 255 Highlight; лишние молча игнорируются; выключенный Highlight всё равно занимает слот; HighlightDepthMode: AlwaysOnTop=0, Occluded=1. https://create.roblox.com/docs/reference/engine/classes/Highlight.md , https://create.roblox.com/docs/reference/engine/enums/HighlightDepthMode.md . Старый лимит 31 (устаревшее, расхождение): https://devforum.roblox.com/t/displaying-multiple-highlightsoptimization/2824562 ; пост об увеличении до 255 найден в виде сниппета: https://devforum.roblox.com/t/lights-camera-more-highlights/4061534 .
- SurfaceAppearance (PBR) и ViewportFrame: поиск ничего не вернул. НЕ ПОДТВЕРЖДЕНО.

### A4. EditableMesh / EditableImage — статус
- Исходный анонс «[Client Beta] In-experience Mesh & Image APIs now available in published experiences»: бета в опубликованных опытах, Roblox пересматривает бюджет памяти и ограничения разрешений; требуется ID-верификация (цель — подотчётность создателей). https://devforum.roblox.com/t/client-beta-in-experience-mesh-image-apis-now-available-in-published-experiences/3267293
- Требование 13+ / ID-верификации относится только к владельцу опыта или группы, а не к каждому игроку — реплика пользователя, НЕ официально: https://devforum.roblox.com/t/client-beta-in-experience-mesh-image-apis-now-available-in-published-experiences/3267293?page=12 (страница точно не проверена). Требует проверки.
- Пост «[Full Release] EditableMesh Batching APIs & Parallel Queries» (дата в сниппете — 15 сентября 2026): https://devforum.roblox.com/t/full-release-editablemesh-batching-apis-parallel-queries/4779401 . Это самый свежий источник. В нём в списке дорожной карты упомянуто «reconciling the extra ID Verification requirement to use Editable* APIs», то есть требование на тот момент ещё существовало и пересматривалось. Что именно вышло в «full release» (весь Editable* или только батч-API) — НЕЯСНО, требует проверки.
- Пост «EditableMesh and EditableImage Improvements»: https://devforum.roblox.com/t/editablemesh-and-editableimage-improvements/3818624 (содержание не прочитано).
- «EditableMesh restrictions»: https://devforum.roblox.com/t/editablemesh-restrictions/4566101 (содержание не прочитано).
- Общие ассеты: «EditableMesh and EditableImage Now Support Shared Assets» — можно загружать любой ассет, явно расшаренный вам или группе, владение не обязательно: https://devforum.roblox.com/t/editablemesh-and-editableimage-now-support-shared-assets/4578818 . Раньше только свои ассеты (если опыт принадлежит человеку/группе). Встроенные R6-ассеты недоступны (https://devforum.roblox.com/t/how-to-access-r6-avatar-mesh-vertices/3979013 ).
- Память: официальная дока — на клиенте строгие бюджеты памяти; сервер, Studio и плагины без лимита; FixedSize помогает уложиться. https://create.roblox.com/docs/en-us/reference/engine/classes/EditableMesh.md . Бюджет в МБ не публикуется. Создание может вернуть nil/ошибку при исчерпании бюджета: https://devforum.roblox.com/t/editable-mesh-memory-budget-reached/3469104 , https://devforum.roblox.com/t/failed-to-create-empty-editableimage-that-was-requested-due-to-reaching-memory-budget-limits-error/3490799 . Сотрудник: Unbounded и FixedSize делят один бюджет, он не считается по числу объектов (https://devforum.roblox.com/t/where-to-find-editablemesh-data-limits/3313112 , https://devforum.roblox.com/t/bypassing-8-editablemesh-limit-on-client/3683517/1 ). Пользователи сообщают о «8 мешей» на клиенте — анекдотично.
- Лимиты на меш (пользователь, ссылаясь на доки): 20 000 треугольников и 60 000 вершин: https://devforum.roblox.com/t/where-to-find-editablemesh-data-limits/3313112 . Требует проверки.
- EditableImage: жёсткий лимит — обновление одного EditableImage за кадр (сотрудник): https://devforum.roblox.com/t/editablemesh-and-editableimage-improvements/3818624?page=3 . Дата неизвестна.
- Roblox работает над вытеснением из памяти и увеличением бюджета; даты нет. Там же.
- Публикация в живых играх: клиентская бета была объявлена именно для опубликованных опытов (первая ссылка этого раздела); текущий статус «бета/GA» — НЕЯСЕН.

### A5. Свои шейдеры / пост-процесс
- Официальных кастомных шейдеров или пользовательского пост-процесса не найдено; сообщество всё ещё просит: «Material graph based custom shaders» (активность до февраля 2026, ~60 ответов): https://devforum.roblox.com/t/material-graph-based-custom-shaders/236718 ; «We. want. shaders»: https://devforum.roblox.com/t/we-want-shaders/3985196 ; «More lighting effects»: https://devforum.roblox.com/t/more-lighting-effects/4755018 ; «Add support for basic refraction/distortion effects without Glass»: https://devforum.roblox.com/t/add-support-for-basic-refractiondistortion-effects-without-glass/3652654 . Утверждение «нет доступа к frame buffer» — слова пользователей. В списке тега найден заголовок «Visual Shader Graph Editor for Custom Materials and Rendering Effects» (октябрь 2026), не открывался — статус неизвестен (https://devforum.roblox.com/tag/shaders/138 ). Вывод «шейдеров нет» подтверждён только отсутствием анонса; требует проверки.

### A6. Как делают тьму, зерно, виньетку, фонарь
- Зерно: полупрозрачный полноэкранный ImageLabel: https://devforum.roblox.com/t/grainy-image-filter/1866620 .
- Виньетка: традиционно полноэкранное изображение; на экранах с вырезом нужна осторожность с UI-insets (IgnoreGuiInset): https://devforum.roblox.com/t/vignette-post-process/2952893 .
- Совет запечь grain и vignette в одну текстуру: сторонний https://robloxvhseffectscriptcamera.pages.dev (SEO-ресурс, низкая надёжность).
- VHS/ретро-фильтр: https://devforum.roblox.com/t/vhs-retro-filter-how-would-i-go-by-doing-this/1639868 , https://devforum.roblox.com/t/i-made-a-realistic-vhs-effect/3169359 .
- Фонарь: «shadowmap-based» свет с текстурой для тёмных колец: https://devforum.roblox.com/t/flashlight-for-horror-games/318440 , проекция: https://devforum.roblox.com/t/light-projection-for-flashlights/889608 .
- Хроматическая аберрация: найден тред о «Sharpness, Fisheye, Renderscale, and Chromatic Aberration shaders»: https://devforum.roblox.com/t/sharpness-fisheye-renderscale-and-chromatic-aberration-shaders/3986400 (содержание не читалось; как реализовано — НЕ ПОДТВЕРЖДЕНО).
- Анимированные текстуры для зерна: прямых источников не найдено.

---

## B. Процедурка и геометрия

### B1. Luau производительность
- Native codegen: официальная дока — включается `--!native` в скрипте или атрибутом `@native` на функции; только серверные скрипты (по формулировке доки); не советуют ставить во все скрипты (деоптимизация); код с числами/массивами выигрывает, UI — нет; на неподдерживаемом железе — интерпретация. https://create.roblox.com/docs/en-us/luau/native-code-gen
- Совместимость с Parallel Luau: нативный код компилируется один раз и переиспользуется всеми Actors; по умолчанию не включён: https://devforum.roblox.com/t/luau-native-code-generation-preview-update/2961746 (дата ≈2024).
- Типовые подсказки заметно влияют на скорость (бенчмарк пользователя, «плохая» подсказка ≈4× медленнее): https://devforum.roblox.com/t/optimizing-native-code-performance-with-type-hints-and-magic/4247690/1 . Отчёты о Vector3-коде разнятся от ускорения до замедления.
- «Только сервер»: НЕ ПОДТВЕРЖДЕНО в 2026, возможно изменилось; проверить в доке.
- Random.new(seed), Instance.new vs Clone, число частей, лимиты на телефонах: поиском не подтверждено. Официального числового лимита частей/места на мобильных не найдено.

### B2. Треугольники на MeshPart
- Историческая цепочка: 5k → 10k → ~20-21k (сотрудник: «лимит — жёсткое ограничение рендера, на самом деле 21K, кажется»): https://devforum.roblox.com/t/3d-importer-support-for-gltf-files-beta/2320761/15 ; старый пост про 10k: https://devforum.roblox.com/t/increased-polygon-limit-for-csg-parts-and-mesh-parts/195604 ; запрос поднять 20k: https://devforum.roblox.com/t/increase-the-max-triangle-limit/4650221 .
- Сторонний Nilo: «по состоянию на июнь 2026 жёсткий лимит 21 000 треугольников на MeshPart» (https://nilo.io/articles/vibe-code-roblox-triangle-limit ); другие его статьи дают 20 000 и 10 000 — расхождение, не надёжно (https://nilo.io/articles/optimize-3d-models-roblox-limit-2 ).
- Итог: ~20-21k на меш, официальной страницы 2025-26 не найдено. Требует проверки.

### B3. StreamingEnabled
- Официальная дока: режимы ModelStreamingMode: Default, Atomic (модель и потомки стримятся вместе; атомарность только при первичной репликации), Persistent (модель присылается целиком вскоре после входа, до события Workspace.PersistentLoaded; Model:RemovePersistentPlayer()). Persistent внутри Atomic делает атомарную модель фактически постоянной. StreamingMinRadius — высший приоритет; StreamingTargetRadius — максимальная дальность; при равенстве радиусов буфера нет, возможны сетевые паузы. https://create.roblox.com/docs/workspace/streaming , https://create.roblox.com/docs/workspace/streaming/techniques , https://create.roblox.com/docs/reference/engine/enums/ModelStreamingMode.md
- StreamingEnabled включено по умолчанию для новых мест; свойство нельзя менять скриптом; BaseParts исключены из первичной репликации: https://create.roblox.com/docs/en-us/workspace/streaming.md . Режим «slim» (https://create.roblox.com/docs/en-us/workspace/streaming/slim ) не читался.

### B4. CollisionFidelity, BulkMoveTo, AssetService
- Доки производительности: Box — наименьшая нагрузка памяти; Default и Precise дороже; мелким якорным частям безопасно ставить Box: https://create.roblox.com/docs/en-us/performance-optimization/improve.md . Побочный эффект Box + Future: странные тени (пользователь): https://devforum.roblox.com/t/meshpart-usage-performance-optimizations/1319217/13 .
- BulkMoveTo: официальной страницы в поиске нет. Пользователь: 5000 частей — 5 мс в одном кадре, 31 мс в другом (физика пересчитывается), совет — anchored и CanCollide=false: https://devforum.roblox.com/t/worldrootbulkmoveto-is-weirdly-inconsistent-with-seemingly-the-amount-same-parts-each-time/4008273 ; осиротевшие сварки: https://devforum.roblox.com/t/bulkmoveto-appears-to-leave-behind-welded-parts/3269822 .
- AssetService:CreateMeshPartAsync (официальная дока): создаёт MeshPart с заданными Collision/Render/FluidFidelity; параметр изменён на словарь options (релиз 619); повторный вызов пересчитывает коллизию после правок. https://create.roblox.com/docs/reference/engine/classes/AssetService/CreateMeshPartAsync.html . Известные проблемы (форум): неточная коллизия при правках после вызова (https://devforum.roblox.com/t/editablemeshs-collision-box-innacurate-to-fidelity-views/3592911 ), медленный PreciseConvexDecomposition на сгенерированных вокселях (https://devforum.roblox.com/t/meshpartapplymesh-not-working-correctly/3603822 — тред ApplyMesh; тред по Precise — в результатах поиска без точного URL), CreateEditableMeshAsync из существующего меша — FixedSize по умолчанию.
- Число частей / производительность на телефонах: числовых официальных лимитов не найдено.

---

## C. Инструменты

### C1. Rojo
- Последняя найденная версия 7.7.0 (зеркало SourceForge датирует 2026-07-02); главное новое — `rojo syncback` (place → файлы), websocket вместо long-polling (7.7.0-rc.1). https://sourceforge.net/projects/rojo.mirror/files/v7.7.0/ , https://newreleases.io/project/github/rojo-rbx/rojo/release/v7.7.0 . Страница newreleases.io устарела (показывает 7.5.x как последнюю) — расхождение. Официальная страница не открывалась: https://github.com/rojo-rbx/rojo/releases . Требует проверки.
- Двусторонняя синхронизация в плагине Studio — всё ещё с пометкой experimental (сторонний обзор, https://skillsmp.com/creators/nonlooped/roblox-suite/roblox-rojo ). Основной поток — файлы → Studio.
- Roblox docs: «Fully managed Rojo» (CI: rojo build на каждый PR, stylua --check, selene; на merge — сборка и публикация): https://create.roblox.com/docs/projects/rojo/fully-managed

### C2. roblox-ts
- Последняя найденная стабильная версия 3.0.0 (changelog: нужен @rbxts/roact 3.0.1+, roblox-lua-promise 4.0.0, `--optimizedLoops` включён по умолчанию): https://unpkg.com/roblox-ts@3.0.0/CHANGELOG.md ; сторонний пост 2026 (без даты) называет 3.0.0 текущей, бета — `roblox-ts@next`: https://rowatcher.com/news/roblox-ts-in-2026-typescript-for-serious-roblox-dev . Репозиторий: https://github.com/roblox-ts/roblox-ts (страница не читалась). Вышло ли что-то новее 3.0.0 — НЕ ПОДТВЕРЖДЕНО.
- Ограничения: roblox-ts — «Roblox с синтаксисом TypeScript», многих JS API нет; список неподдерживаемых фич (labels, getters, bitwise и др.) не проверен — смотреть https://roblox-ts.com/docs/ . НЕ ПОДТВЕРЖДЕНО.
- Трансформеры: https://roblox-ts.com/docs/guides/typescript-transformers . Тесты: @rbxts/jest (https://socket.dev/npm/package/@rbxts/jest ), форк @isentinel/jest-roblox.
- Дискуссия «Luau vs. TypeScript (roblox-ts) for Production Roblox Games»: https://devforum.roblox.com/t/luau-vs-typescript-roblox-ts-for-production-roblox-games/4757257 (не читалась).

### C3. Wally, тесты
- Wally: последняя версия в результатах 0.3.2, но страница-зеркало старая: https://github.com/UpliftGames/wally , https://crates-io.ganymede-static.progval.net/crates/wally/0.3.2 . Появляются альтернативы: Forest (https://devforum.roblox.com/t/forest-package-manager-the-modern-package-platform-for-roblox/4766024 ), Cealshell (https://devforum.roblox.com/t/cealshell-a-registry-less-package-manager-for-roblox-studio/4685819 ). Актуальный статус Wally — НЕ ПОДТВЕРЖДЕНО.
- jest-lua (jsdotlua): соответствует Jest 27.4.7; по доке запускается только внутри Roblox, для CLI нужен run-in-roblox; Lune/Luvit помечены как «нужна помощь»: https://jsdotlua.github.io/jest-lua , https://github.com/jsdotlua/jest-lua . Сторонний индекс (на конец 2024): «обновлялся в прошлом году». Roblox/jest-roblox — read-only зеркало: https://github.com/Roblox/jest-roblox .
- TestEZ: признаков депрекейта не найдено (но и свежего подтверждения нет). run-in-roblox (архивирован ли репозиторий) — НЕ ПОДТВЕРЖДЕНО.
- Lune: самая свежая найденная версия 0.10.4 (AUR-запись от 2026-06-05): https://github.com/lune-org/lune/releases , https://aur.archlinux.org/cgit/aur.git/log/?h=lune . Примеры: release.luau (https://gist.github.com/boatbomber ), rbxasset (Lune ≥0.9.3, https://github.com/Roblox/rbxasset ).
- StyLua, selene, Luau LSP: версии и статус не найдены. НЕ ПОДТВЕРЖДЕНО (StyLua и selene упомянуты в доке Roblox «Fully managed Rojo» как проверки PR).

### C4. Open Cloud
- Luau Execution API: запуск Luau в месте через Open Cloud, для автотестов/конфигурации/процедурной генерации. POST /cloud/v2/universes/{universeId}/places/{placeId}/luau-execution-session-tasks; опрос задачи, результаты и логи отдельными эндпоинтами; до 5 минут на задачу; 10 одновременных задач на место; лимиты 5 вызовов/мин на владельца ключа, 45/мин на IP; ключ в x-api-key со scope universe.place.luau-execution-session read/write. https://create.roblox.com/docs/cloud/reference/features/luau-execution.md . Бета-тема: https://devforum.roblox.com/t/beta-open-cloud-engine-api-for-executing-luau/3172185 . Статус «бета/GA» — НЕЯСЕН (тема помечена [Beta], дата снятия метки не найдена).
- Ограничения среды: в теме о среде «как в Studio» разработчики жалуются на отличия окружения и неудобство для плагинов: https://devforum.roblox.com/t/luau-open-cloud-execution-should-provide-an-environment-similar-to-studio/3955280 . В одном из сообщений упомянуто включение доступа к Source скриптов (дата без года, 20 ноября — год неясен).
- Тесты в CI через Execution API: вопрос на форуме без решения: https://devforum.roblox.com/t/cicd-setup-with-rojo-wally-testez/3610450 ; рецепт публикации и запуска у Nevermore: https://quenty.github.io/NevermoreEngine/docs/deploy .
- Place Publishing: rbxcloud CLI публикует .rbxl (есть пример GitHub Actions): https://docs.rs/crate/rbxcloud/0.17.0/source/docs/cli/cli-experience.md ; автоматизация: https://devforum.roblox.com/t/how-to-automate-place-publishing-with-partially-managed-rojo/2443196 . Прямой страницы Place Publishing API не читали.
- Assets API: типы по доке — Audio, Decal, Image, Model, Mesh, Video (+ Animation); меш — только контент из Asset delivery API, обычные 3D-файлы — через Importer; меши не обновляются; в доке есть оговорка о бета-эндпоинтах. Загрузка POST /v1/assets, прогресс через Get Operation, обновление PATCH. Модели: .fbx/.gltf/.glb/.rbxm (сторонняя обёртка: + .rbxmx). https://create.roblox.com/docs/cloud/guides/usage-assets , https://create.roblox.com/docs/en-us/cloud/reference/features/assets.md , https://devforum.roblox.com/t/open-cloud-upload-support-for-more-asset-types/4022082 . Требует проверки по живой таблице.

### C5. Типичный CI (из найденного)
1. PR: `rojo build` (проверочная сборка), `stylua --check`, `selene`; провал — падает PR.
2. Merge в main: `rojo build -o build/place.rbxl`, публикация в Dev через Open Cloud (rbxcloud или скрипт Lune).
3. Тест-запуск: Luau Execution API со scope `universe.place.luau-execution-session:write`, concurrency group против перекрытий (Nevermore deploy).
4. Тег: публикация в Stable, затем Prod после подтверждения.
Источники: https://create.roblox.com/docs/projects/rojo/fully-managed , https://quenty.github.io/NevermoreEngine/docs/deploy , https://devforum.roblox.com/t/how-to-automate-place-publishing-with-partially-managed-rojo/2443196 .

---

## Не удалось подтвердить
- Прямое чтение любой страницы (все хосты заблокированы); всё — из сниппетов поиска.
- Точный лимит теневых источников и правило автопонижения Future на телефонах; точные пороги качества (4 vs 5).
- Свойства Atmosphere/Ambient/OutdoorAmbient/ExposureCompensation, SurfaceAppearance, ViewportFrame — документы не получены.
- Статус EditableMesh/EditableImage на ноябрь 2026 (бета или GA), актуальность ID-верификации и 13+, числовой бюджет памяти.
- Новости 2026 о шейдерах: тред «Visual Shader Graph Editor…» (октябрь 2026) не открыт.
- Точный лимит треугольников MeshPart в 2025-26 (20k vs 21k).
- Random.new, Instance.new vs Clone, лимит частей, производительность на телефонах, native codegen на клиенте.
- Версии: roblox-ts новее 3.0.0, актуальный Wally, StyLua, selene, Luau LSP, статус run-in-roblox и TestEZ.
- Неподдерживаемые TS-фичи roblox-ts.
- Статус Luau Execution API (бета/GA) и подтверждённый рабочий рецепт тестов в CI.
- Хроматическая аберрация и анимированное зерно в хоррорах Roblox — конкретной реализации не найдено.
