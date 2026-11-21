# Flora и трава для Untitled Session: материалы исследования

Дата: 2026-11-19. Только факты, цифры, варианты; решений по игре нет.

## Ограничения сбора (важно)

- Хост `discourse.threejs.org` (и `dev.to`) из облачной сессии не резолвится (ENOTFOUND). Три ссылки партнёра **не открывались**; всё ниже о них — из сниппетов поисковой выдачи. Чтобы добрать детали, нужно разрешить `discourse.threejs.org` и `dev.to` в сетевых настройках сессии. Всё, что не подтверждено, помечено «требует проверки».
- Раздел C (растения) — общие ботанические знания модели, без открытия страниц; токсичность помечена как «требует проверки» перед любым упоминанием в игровом тексте.

---

## A. Три ссылки партнёра

### A1. Procedural trees & flowers — https://discourse.threejs.org/t/procedural-trees-flowers/40797

- Техника (по сниппету): автор строит иерархию путей (paths) и назначает на них instanced meshes; из этого выросла утилита для деревьев, цветов и прочих ассетов. Есть загрузка GLTF и простая анимация. Код — vanilla JS, нужен только THREE.js.
- Цифр (триангулы, fps, устройство), репозитория и лицензии в доступном тексте нет. Автор не установлен. Требует проверки.
- WebGPU/compute/TSL: по описанию не требуются (vanilla three.js + instancing). Это переносимо на WebGL2 как есть. Требует проверки.
- Родственные открытые проекты (из той же выдачи, не из ссылки):
  - EZ-Tree (Dan Greenheck), процедурные деревья, экспорт PNG/GLB: https://docsearch.algolia.com/mcp/docs/repo/dgreenheck/ez-tree (лицензия не проверена)
  - gltf-procedural-trees (Don McCurdy, на proctree.js): https://awesome.ecosyste.ms/projects/github.com%2Fdonmccurdy%2Fgltf-procedural-trees (лицензия не проверена)
  - Florasynth, генератор деревьев/растений: https://discourse.threejs.org/t/florasynth-procedural-tree-generator/58740 (экспорта glTF нет)
  - Procedural Instanced Forest (репозиторий `pmmathias/birdybird`): https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610
  - Старая ветка Procedural flowers (сплайны): https://discourse.threejs.org/t/procedural-flowers/22772 и https://www.ibiblio.org/e-notes/Splines/three.htm

### A2. Digital Garden (four-season, WebGPU, Houdini, glTF) — https://discourse.threejs.org/t/digital-garden-a-four-season-flower-garden-three-js-webgpu-houdini-gltf/95709

- Автор (по выдаче): Alicia Lu; сайт digitalgarden.si; статьи на DEV: https://dev.to/alicia_lu («How I Built a WebGPU 3D Garden with Houdini and Three.js», «Houdini to Three.js: Testing glTF Compression and Instancing», «Three.js WebGPU vs WebGL: Testing 1,000 Instanced Plants», «Procedural Plants for the Web: Houdini Geometry and Wind Data»).
- Техника: растения моделируются процедурно в Houdini, экспортируются в glTF (с компрессией), в three.js размножаются инстансингом; данные ветра выпекаются из Houdini («Wind Data» — вероятно vertex-атрибуты). Требует проверки: точные детали пайплайна.
- Связанный бенчмарк того же автора (вероятно): https://discourse.threejs.org/t/three-js-plant-instancing-benchmark-240-desktop-samples-csv-json-and-a-standalone-harness/95719
  - three.js 0.186.1, 240 запусков на десктопе, 48 ячеек; модель — Houdini grape hyacinth (мускари) **6 056 триангулов**, инстансы 1k / 10k / 100k; сравнение классического WebGLRenderer, native WebGPU и node-WebGL2.
  - Счётчик draw calls при 1k статичных инстансов: classic WebGL = 1, native WebGPU = 1001, node WebGL2 = 2 (по сниппету; видимо BatchedMesh). Значения fps не получены. Это десктоп, не телефон.
- Зависимость: рендерер WebGPU (TSL). Но сам приём «цветок из glTF + InstancedMesh + ветер в вершинном шейдере» — это WebGL2. Бенчмарк прямо включает WebGL-пути. Требует проверки.
- Лицензия и репозиторий: не выяснены (у бенчмарка заявлен «standalone harness», CSV/JSON — ссылка в ветке).
- Для ориентира: 6 056 тр. на цветок — это дорого для мобильного бюджета комнаты 60 000 тр.; нужен LOD (см. B).

### A3. High-Performance Grass Rendering in Three.js + WebGPU — https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175

- Это анонс **коммерческого** продукта Three.js Grassworks (WebGPU + TSL; страница продукта по выдаче: grassworks.techredux.co, не проверена). Ветка также называется «I Built a Real-Time Grass System for Three.js + WebGPU». Открытого репозитория нет; лицензия коммерческая. Требует проверки.
- Техника (по сниппетам): плотные поля, LOD v1.1.0 — смешение LOD-геометрий с пространственным dithering (нижние LOD убирают лезвия верхних, оставшиеся стоят на тех же местах → нет «попинга»); есть culling, color map. Тег ветки: culling, LOD, TSL.
- Цифры (число лезвий, fps, устройство): в доступном тексте не найдены; демо заявлено как «стабильная производительность», без чисел.
- Зависит от WebGPU/TSL: вся реализация. Переносимые идеи: LOD по плотности с сохранением позиций (стабильная выборка по индексу/хэшу) — делается в WebGL2 через `gl_InstanceID`/атрибут-ранг и discard в вершинном шейдере (схлопывание вершин в точку).
- Родственная ветка с compute: Codrops «False Earth» — миллионы лезвий через compute + indirect draw (WebGPU-only): https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/
- Сторонний агентский skill-файл (не официальный, не бенчмарк): per-patch frustum culling, дистанционные уровни плотности, far-field клампы/impostor-карты; WebGL-fallback — CPU-размещение + InstancedMesh: https://skills.cat/skills/ck42bb/procedural-grass-threejs

---

## B. WebGL2-подходы к траве на средних телефонах

Общая картина (из выдачи): узкое место на слабых Android — **вершинный шейдер и число вершин/триангулов**, а не draw calls.

1. **al-ro, «Grass» (WebGL, three.js-основа)** — https://al-ro.github.io/projects/grass
   - 100 000 инстансов квада из 8 триангулов (≈800k тр.), ветер = две синусоиды, вращающие вершины вокруг основания лезвия; по мотивам Eddie Lee «Realistic real-time grass rendering». Цифры fps на телефонах не найдены. Лицензия: не указана в выдаче — требует проверки (репозиторий al-ro на GitHub).
2. **Kea Kaukas (keaukraine), «Efficient WebGL vegetation rendering»** — https://keaukraine.medium.com/efficient-webgl-vegetation-rendering-b09a7fa904cc, зеркало https://dev.to/keaukraine/efficient-webgl-vegetation-rendering-4g2g; связанный демо-репозиторий WebGL2 fur: https://awesome.ecosyste.ms/projects/github.com%2Fkeaukraine%2Fwebgl-fur
   - Выводы автора: на бюджетных Android тормозит вершинная стадия при множестве инстансов; приём — instanced клампы/карточки с дешёвым ветром. Лицензии репозиториев (в выдаче есть LICENSE.txt, тип не назван) — требует проверки.
3. **Spacejack (Mike Linkovich), «Terra» — трава вершинным шейдером** — https://github.com/fabiodr/terra (форк); ветер + высота рельефа в вершинном шейдере. Лицензия не подтверждена.
4. **Codrops, «How to make the fluffiest grass with three.js»** (2025) — https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/ : fps падает задолго до 500k инстансов; рекомендации — лезвия с меньшим числом вершин на удалении, ступенчатые «графические пресеты» для мобильных. Лицензия кода не проверена.
5. **Forum «[Performance] Optimizing 3M Instanced Grass»** — https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286 : предел задаёт полигональный бюджет (совет «около 3M тр. суммарно», ≈20 тр. на лезвие нереально для 3M лезвий); слияние лезвий в клампы смещает узкое место с трансформов на вершины.
6. **Forum «Grass Disappears on Mobile with InstancedMesh»** — https://discourse.threejs.org/t/grass-disappears-on-mobile-with-instancedmesh/77180 : известная проблема пропадания на мобильных (причина в выдаче не подтверждена; типичные подозрения — precision/ограничения атрибутов, неверные bounds при смещении вершин в шейдере). Требует проверки.
7. Forum «Is an alpha texture or custom geometries more performant?» — https://discourse.threejs.org/t/whats-the-most-performant-way-to-make-grass/39774 : спор карточки (alpha) vs геометрия лезвий. Общее место: alpha-test/blend на телефонах бьёт по fill-rate и overdraw (tile-based GPU); геометрия без альфы дешевле по заполнению, но дороже по вершинам. Выводов с цифрами в сниппете нет.
8. Дополнительно: «billboarding grass gives much denser grass at very low cost than blades» — https://discourse.threejs.org/t/migrating-my-grass-system-to-webgpu-and-making-a-robust-grass-plugin/92893 (WebGPU-ветка, идея переносима).
9. Рабочий каркас для WebGL2 (сводка приёмов из источников выше; не рекомендация):
   - клампы 3–7 лезвий в одном инстансе (≈6–14 тр. на кламп), 1 draw call на чанк;
   - чанки (например, сетка по 4–8 м) с собственным bounding sphere → штатный frustum culling; ветер/изгиб целиком в вершинном шейдере (uniform `time`, фаза по мировой позиции инстанса);
   - дистанционный LOD: 2–3 меша (кламп / 1 карточка-треугольник / ничего) либо схлопывание вершин по порогу в шейдере;
   - «стабильная» прореженность по хэшу индекса (как в Grassworks) вместо мигающего отбора;
   - лезвие = 1–3 сегмента, без alpha-test.
   - Типичных подтверждённых цифр «X лезвий = 60 fps на среднем телефоне» в источниках не нашлось. Нужно мерить на целевом устройстве.

---

## C. Растения для советского/постсоветского быта и сна о болезни/тревоге

Источник по умолчанию: общие знания; ссылки Wikipedia (не открывались, требует проверки): ботаника и токсичность — https://ru.wikipedia.org/wiki/ + название растения. Колонки: сигнатура с 2–3 м в тёмной комнате под фонарём / ядовитость.

Комнатные:
1. Фикус каучуконосный (Ficus elastica) — крупные тёмные глянцевые овальные листья с бликом под фонарём, один вертикальный ствол; сок раздражает кожу, слабая токсичность (для животных выше). Требует проверки.
2. Алоэ (столетник) — розетка толстых мечевидных листьев с зубчиками по краю, силуэт «пятерня»; латекс слабительный, внутрь токсичен умеренно.
3. Каланхоэ (Kalanchoe daigremontiana, «живородящее») — мясистый лист с выводковыми «детками» по краю, пятнистый; бufadienolides, токсично (особенно животным).
4. Сансевиерия («тёщин язык») — вертикальные жёсткие мечи, поперечные полосы; сапонины, слабо токсична.
5. Хлорофитум — фонтан узких полосатых листьев и свисающие «дети» на стрелках; нетоксичен.
6. Декабрист (Schlumbergera) — свисающие членистые побеги с ярко-розовыми цветами на концах; нетоксичен.
7. Герань/пеларгония — округлые листья с тёмным кольцом, шаровые красные/розовые зонтики, резкий запах; слабая токсичность (для животных).
8. Традесканция/«бабье сплетенье» — свисающие побеги с полосатыми листьями-«лодочками»; сок раздражает кожу.
9. Монстера — крупный лист с прорезями и дырами, узнаваем силуэтом; щавелевокислый кальций, токсична.
10. Аспидистра (чугунное растение) — тёмные длинные лопатообразные листья из земли, без стебля; практически нетоксична.
11. Бальзамин («ванька мокрый») — лёгкие яркие цветки (красные/розовые) на водянистых стеблях, роняет капли; нетоксичен/слабо.

Садовые и полевые:
12. Пион — крупная шаровидная розовая/белая/бордовая голова, видна как светлый «шар» в темноте; слабо токсичен.
13. Ирис — «флаги»: три отогнутых лепестка + вертикальные мечевидные листья; корневища токсичны (раздражение ЖКТ).
14. Мак — красная чашка на тонком волосистом стебле, чёрный центр, коробочка; опийный мак содержит алкалоиды (токсичен/наркотичен) — чувствительный мотив, требует отдельной проверки.
15. Василёк — тонкий стебель и голубая «взъерошенная» корзинка, резко цветной в холодном свете; нетоксичен.
16. Ромашка — белые лепестки вокруг жёлтого диска, самый читаемый светлый «колёсный» силуэт на тёмном; нетоксична (аллерген).
17. Подсолнух — тёмный диск + лучи, поникшая тяжёлая голова на толстом стебле; нетоксичен.
18. Сирень — конусная кисть мелких цветов, лиловая/белая; в основном нетоксична (требует проверки).
19. Наперстянка (Digitalis) — высокий стебель с рядом свисающих колокольчиков вдоль одной стороны, пятнистое зево; **сильно ядовита** (сердечные гликозиды).
20. Одуванчик — жёлтая голова; после — шар из пушинок, который разлетается от луча/шагов; нетоксичен.
21. Лилия (и белая «лилия на гробах») — крупные отогнутые лепестки, тычинки; Lilium токсичны для кошек; ландыш (ещё одно растение, возможна замена) — **ядовит** (сердечные гликозиды). Требует проверки.

Сводка читаемости: из темноты хорошо различаются светлые шары/диски (пион, ромашка, одуванчик), вертикальные мечи (сансевиерия, ирис), ряд колокольчиков (наперстянка), красная чашка мака; тёмно-зелёная листва без цветка (фикус, аспидистра) читается блеском листа.

---

## D. Идеи «удивляющей/завораживающей/шокирующей» травы (реализуемые в WebGL2)

1. **Трава сквозь пол** (асфальт, паркет, плитка, линолеум): тот же кламповый инстанс-мех, посеянный по маске трещин/швов (список позиций в чанке); основание лезвия в шейдере прячется ниже плоскости пола (z-фаза), пол с вырезанными щелями. Ссылка на технику ветра/клампов: https://al-ro.github.io/projects/grass.
2. **Между рельсами/шпалами**: узкие полосы плотности (спавн по тексельной маске/сплайну); в вершинном шейдере лезвия слегка наклонены от рельса. Источник приёма — чанки + маска плотности: https://skills.cat/skills/ck42bb/procedural-grass-threejs (skill, не бенчмарк).
3. **Трава на весь пол помещения**: один чанкованный слой с дистанционным LOD и стабильной прореженностью (идея Grassworks, https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175); в комнате с фонариком достаточно плотной «зоны взгляда» (собранное только там, куда смотрит герой — это уже правило проекта), остальное — дешёвая карточка/ничего.
4. **Под «офисными деревьями»** (фикус/пальма в кадке): низкая трава и ростки в круге вокруг кадки, тот же инстансинг по маске радиуса.
5. **Реакция на луч фонаря**: передать в шейдер uniform позиции/направления/угла конуса; лезвия внутри конуса поворачиваются к свету (фототропизм), выпрямляются или, наоборот, «вжимаются»; вне луча — расслабленный ветер. Расчёт — по формуле конуса в вершинном шейдере, один uniform vec4×2. Ссылка по теме интерактивной травы: https://discourse.threejs.org/t/how-do-i-make-interactive-grass-patches/65340.
6. **Реакция на шаги**: кольцевой буфер последних N (например, 8–16) позиций игрока в uniform-массиве; вмятина/полегание лезвий вблизи с затуханием по времени (альтернатива — трансформ-карта следов, RenderTarget 128×128 над зоной игрока; обе — WebGL2). Источник идеи: тот же thread 65340 + Codrops fluffiest grass https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/.
7. **Шок**: трава, растущая «против гравитации» (потолок, стена), или резко выпрямляющаяся в одном направлении, когда луч уходит (трава «смотрит» на героя): смена оси роста и направления в шейдере, без доп. геометрии. Источник — общая техника вершинного ветра, https://al-ro.github.io/projects/grass.
8. **Шок/завораживание**: цветы и колосья, одновременно поворачивающие головы к игроку (вращение головы instanced-цветка по направлению к камере в вершинном шейдере); одуванчиковый «взрыв» пушинок — отдельный `Points`/инстансы из 200–500 частиц от луча.
9. **Тишина/звук травы**: ветер при отсутствии ветра в закрытой комнате (рябь по полю без источника) — просто параметр фазы; чисто шейдерный приём.
10. Приёмы, **не** переносимые в WebGL2: compute-размещение и indirect draw (False Earth, Grassworks) — заменяются CPU-раскладкой на этапе генерации комнаты и чанками.

Бюджет для ориентира (из условий проекта и источников): 60 000 тр. статики на комнату; цветок 6 056 тр. (бенчмарк A2) × 10 = ≈60k, т.е. цветочным «головам» нужен LOD до 100–500 тр. на удалении; кламп травы 6–14 тр. на 50–100 клампов в видимом чанке = единицы тысяч. Расчёты прикидочные.

---

## Источники

- https://discourse.threejs.org/t/procedural-trees-flowers/40797 (не открыта; по сниппету поиска)
- https://discourse.threejs.org/t/digital-garden-a-four-season-flower-garden-three-js-webgpu-houdini-gltf/95709 (не открыта)
- https://discourse.threejs.org/t/high-performance-grass-rendering-in-three-js-webgpu/94175 (не открыта)
- https://discourse.threejs.org/t/three-js-plant-instancing-benchmark-240-desktop-samples-csv-json-and-a-standalone-harness/95719
- https://dev.to/alicia_lu
- https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/
- https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/
- https://al-ro.github.io/projects/grass
- https://keaukraine.medium.com/efficient-webgl-vegetation-rendering-b09a7fa904cc
- https://dev.to/keaukraine/efficient-webgl-vegetation-rendering-4g2g
- https://github.com/fabiodr/terra
- https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286
- https://discourse.threejs.org/t/grass-disappears-on-mobile-with-instancedmesh/77180
- https://discourse.threejs.org/t/whats-the-most-performant-way-to-make-grass/39774
- https://discourse.threejs.org/t/migrating-my-grass-system-to-webgpu-and-making-a-robust-grass-plugin/92893
- https://discourse.threejs.org/t/how-do-i-make-interactive-grass-patches/65340
- https://skills.cat/skills/ck42bb/procedural-grass-threejs
- https://discourse.threejs.org/t/florasynth-procedural-tree-generator/58740
- https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610
- https://discourse.threejs.org/t/procedural-flowers/22772
- https://awesome.ecosyste.ms/projects/github.com%2Fdonmccurdy%2Fgltf-procedural-trees
- https://docsearch.algolia.com/mcp/docs/repo/dgreenheck/ez-tree
- https://awesome.ecosyste.ms/projects/github.com%2Fkeaukraine%2Fwebgl-fur
