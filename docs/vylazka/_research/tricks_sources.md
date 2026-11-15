# Дешёвые визуальные приёмы three.js / WebGL2: источники

Контекст: three.js 0.187, WebGLRenderer (WebGL2), свои GLSL-шейдеры, телефоны, буфер 640x360...1280x720, мир из точек. Приёмы из справочника партнёра (blob shadow, AO/lightmaps, matcap, micro-normal, fresnel rim, env map, decals, caustics, volumetric beams, instanced grass, soft sprites, fog, alpha hash, thin glass, impostors/LOD, fake SSS) не повторяются.

Пометки: «выдача» = ссылка была в результатах поиска. «не проверено» = страницу не открывали, адрес не из выдачи. Лицензия указана только там, где она была видна в выдаче. Страницы целиком не читались (сеть закрыта), поэтому описания основаны на сниппетах выдачи; детали шейдеров нужно смотреть в первоисточнике. Всё, что касается пригодности для игры, требует проверки на реальном телефоне.

Для WebGLRenderer важно: многие новые примеры three.js (TSL, WebGPU) не годятся напрямую. Такие случаи помечены.

---

## A. Материалы и поверхности

### 1. Interior mapping (ложные комнаты за окном), Interior mapping
- Даёт: за стеклом окна видна «комната» с глубиной, хотя геометрии нет. Один фрагментный шейдер, луч взгляда пересекает виртуальный куб и читает кубкарту.
- Дёшево: нет лишней геометрии и проходов, цена как у одной кубкарты. Ловушка: комната плоская на стыках стен без проверки лучей, нужен запечённый кубмап на тип комнаты (память), без параллакса на вертикальных швах заметны артефакты.
- Ссылки:
  - Kristian Dixon, реализация в three.js через математику вместо ветвления (февраль 2025): https://kristian-dixon.github.io//2025/02/27/InteriorMapping.html (выдача)
  - three-fenestra, MeshStandardMaterial с interior mapping, npm, лицензия MIT (в выдаче): https://www.jsdelivr.com/package/npm/three-fenestra (выдача)
  - Обзор техники (Joost van Dongen, 2008): https://gamedeveloper.com/programming/interior-mapping-rendering-real-rooms-without-geometry (выдача)
  - Официального примера three.js не найдено.

### 2. Parallax mapping / Parallax occlusion mapping (POM)
- Даёт: рельеф кирпича, плитки, мха без геометрии; при взгляде под углом видна глубина.
- Дёшево: только фрагментный шейдер, но POM = цикл семплов на пиксель (дорого на телефоне, особенно при 1280x720). Ловушка: края полигона и силуэт остаются плоскими; ветки внутри цикла в TSL ломаются, в GLSL проще.
- Ссылки:
  - ParallaxShader из examples/jsm/shaders (режимы от простого до POM; копия r111 на Debian, устаревшая): https://sources.debian.org/src/three.js/111%2Bdfsg1-2/examples/jsm/shaders/ParallaxShader.js (выдача); типы для r124: https://cdn.jsdelivr.net/npm/three@0.124.0/examples/jsm/shaders/ParallaxShader.d.ts (выдача)
  - Форум three.js о неравномерных шагах: https://discourse.threejs.org/t/parallax-map-in-physical-material-got-wired-small-line-on-steps/60099.md (выдача)
  - @promontis/threejs-pom — только WebGPU/TSL, лицензия не проверена: https://www.pkgstats.com/pkg:@promontis/threejs-pom (выдача). Для WebGL2 не подходит напрямую.

### 3. Hex tiling / стохастический тайлинг (против «дублирования паттернов»), Hex-tiling, stochastic texturing
- Даёт: бесшовное убирание видимого повтора текстуры. Каждая шестиугольная ячейка берёт текстуру со случайным смещением, три ячейки смешиваются.
- Дёшево: 3 выборки вместо 1, без предрасчёта (версия Mikkelsen семплирует исходную текстуру напрямую, вместо histogram preservation — контрастная кривая). Ловушка: 3x выборок на каждую карту материала, для цветных текстур небольшая потеря качества; на нормалях нужно корректно вращать/смешивать нормали.
- Ссылки:
  - Morten Mikkelsen, «Practical Real-Time Hex-Tiling», JCGT 2022: https://jcgt.org/published/0011/03/05/paper.pdf (выдача)
  - Референс-демо автора: https://github.com/mmikk/hextile-demo (выдача; лицензия не проверена)
  - Порт на Godot (читается как псевдокод для GLSL): https://godotshaders.com/shader/stochastic-hex-tiling-mikkelsens-adaptation/ (выдача)
  - Разбор реализации: https://alouda.myportfolio.com/implementing-hex-tiling (выдача)
  - Обзор: https://playerunknownproductions.net/news/stochastic-texturing (выдача)
  - Готового примера three.js не найдено — нужен порт самому.

### 4. Другие способы убрать повтор текстуры: IQ texture repetition, cell bombing, двухмасштабная выборка, detail textures
- Даёт: те же эффекты, дешевле hex. Способ IQ №3: две выборки и текстура шума, выбирающая смещение; cell bombing: смещение UV по ячейке случайной хэш-функцией; многомасштабная выборка (одна карта на разных масштабах и смещениях) + затухание по дистанции.
- Дёшево: 2 выборки + шум. Ловушка: швы, если текстура не бесшовная; сильное перекрёстное смешивание («cross-fadey»).
- Ссылки:
  - Статья Inigo Quilez: https://iquilezles.org/articles/texturerepetition/ (адрес только упомянут в выдаче как «проверить напрямую», сама страница не появилась — не проверено)
  - Godot-адаптация третьего приёма IQ: https://godotshaders.com/?p=12496 (выдача)
  - Обсуждение реализации (технический художник): https://endfang.github.io/posts/ta_log_05092022 (выдача)
  - Обсуждение в Babylon про texture bombing и разномасштабные выборки: https://forum.babylonjs.com/t/texture-bombing/57833 (выдача)
  - Вопрос на форуме three.js про повтор текстур в GLSL: https://discourse.threejs.org/t/texture-repetition-drawing-lines-issue-with-glsl-shaders/68829.md (выдача)

### 5. Triplanar mapping
- Даёт: текстура без UV на скалах, рельефе, процедурных мешах, без растяжения; веса по нормали.
- Дёшево: 3 выборки на карту; можно считать в мировых координатах без UV. Ловушка: для normal map нужны правильные касательные на каждую ось; освещение — типичная жалоба форума.
- Ссылки:
  - Форум: «Triplanar and lighting»: https://discourse.threejs.org/t/triplanar-and-lighting/35241 (выдача)
  - Форум: «Implementing Triplanar Mapping in ThreeJs»: https://discourse.threejs.org/t/implementing-triplanar-mapping-in-threejs/59674 (выдача)
  - Форум: «Triplanar normal mapping»: https://discourse.threejs.org/t/triplanar-normal-mapping/8550/3 (выдача)
  - Старый официальный пример зависел от удалённой node-системы (r138), нового по результатам не подтверждено: https://github.hscsec.cn/mrdoob/three.js/issues/15048 (выдача)
  - Исходники для onBeforeCompile-патча упомянуты в gist: https://gist.github.com/arthurschiller/dc12c4ce596b21128ae8b816a298d94c (выдача; лицензия не проверена)

### 6. Vertex color AO (запечённая окклюзия в вершинах)
- Даёт: затемнение в углах и под предметами без текстур и лайтмапов; ноль выборок.
- Дёшево: атрибут вершины, умножение цвета в шейдере. Ловушка: нужна достаточная плотность вершин; запекать офлайн (Blender raycast/bake); экспорт vertex color AO через glTF в выдаче не подтверждён.
- Ссылки:
  - Форум three.js: «How would I begin to bake lighting / ao into vertex color data?»: https://discourse.threejs.org/t/how-would-i-begin-to-bake-lighting-ao-into-vertex-color-data/48689 (выдача)
  - Форум: AO против lightmaps: https://discourse.threejs.org/t/ambient-oclusion-vs-lightmaps/31333 (выдача)
  - Экспорт AO из Blender в glTF (канал R): https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html (выдача)

### 7. Octahedral impostors (импосторы с нормалями), Octahedral impostors
- Даёт: деревья/объекты как 1 квад, но с правильным освещением и сменой вида при обходе (в отличие от простого billboard). Запекаются кадры с разных ракурсов в albedo/normal/depth.
- Дёшево: 1 квад на экземпляр, демо на форуме — 200k деревьев на карте 3072x3072, заявлено, что подходит для мобильных. Ловушка: overdraw на больших квадах, прыжки между ракурсами, bounding sphere у квада (frustum culling убирает весь лес).
- Ссылки:
  - Форум three.js: https://discourse.threejs.org/t/octahedral-impostors-for-three-js/80318 (выдача); репозиторий agargaro/octahedral-impostor упомянут в выдаче текстом (лицензия не проверена)
  - Лес: https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735 (выдача)
  - Разбор: https://smailikhappy.github.io/posts/Octahedral_imposters/ (выдача); https://arycama.github.io/2024/10/05/Imposters.html (выдача)
  - Это развитие пункта «tree impostors» из справочника партнёра.

### 8. Flipbook / sprite sheet анимация, Flipbook
- Даёт: анимированные спрайты, огонь, дым, шум в кадре, мерцающие экраны за счёт атласа кадров; кадр выбирается по времени.
- Дёшево: одна текстура, смена offset/repeat или UV в шейдере. Ловушка: общий текстурный объект — смещение применяется ко всем объектам; для шейдера лучше считать UV в вершинном шейдере и не клонировать текстуры.
- Ссылки:
  - Демо Texture-Animation (stemkoski): https://stemkoski.github.io/Three.js/Texture-Animation.html (выдача; лицензия не проверена)
  - Разбор на форуме про атласы TexturePacker: https://discourse.threejs.org/t/texture-atlas-loader/1137 (выдача)

---

## B. Свет, тени, отражения

### 9. Light cookie / gobo (тень оконного переплёта и листвы текстурой), Light cookies
- Даёт: рисунок света на полу и стенах (решётка окна, листва, пятна) без реальной геометрии теней. В three.js это SpotLight.map.
- Дёшево: одна текстура на свет. Ловушка: по документации карта работает только при castShadow = true, то есть цена карты теней остаётся; transform (offset/rotate/repeat) у map, по форуму, не работает; есть артефакты проекции со смещением (bias).
- Ссылки:
  - Документация SpotLight: https://threejs.org/docs/api/en/lights/SpotLight.html (выдача); https://threejs.org/docs/pages/SpotLight.html (выдача)
  - Форум: «What does the textures map do for a SpotLight»: https://discourse.threejs.org/t/what-does-the-textures-map-do-for-a-spotlight-and-do-i-need-one/44357/4.md (выдача)
  - Артефакты: https://discourse.threejs.org/t/spotlight-map-issue-projecting-artefacts/89885 (выдача)
  - Если тень от фонаря уже одна карта — cookie можно считать самим шейдером (проекция текстуры по матрице), без SpotLight.map. Это идея для проверки, подтверждающей ссылки нет.

### 10. Projective texture / проекционное текстурирование (общая основа cookie и анаморфозы), Texture projection
- Даёт: текстура «проецируется» на объекты как слайд-проектор; используется для gobo, декалей, анаморфоз и «картинки, складывающейся с одной точки».
- Дёшево: матрица проекции передаётся в вершинный шейдер, одна выборка. Ловушка: при движении объекта проекция «плывёт» — нужно хранить исходные позиции.
- Ссылки:
  - Codrops «Playing with Texture Projection in Three.js»: https://tympanus.net/codrops/2020/01/07/playing-with-texture-projection-in-three-js/ (выдача)
  - Анаморфное слово (Artificial Noodles, three.js): https://www-artificialnoodles-com.pages.dev/blog/the-sweet-spot (выдача)
  - Родственный Codrops-материал: https://tympanus.net/codrops/?p=45827 (выдача)

### 11. God rays: screen-space light shafts, Crepuscular rays
- Даёт: лучи от источника света через радиальный блюр маски яркости/глубины. Эффект привязан к положению света на экране.
- Дёшево: один дополнительный проход в малом буфере; радиальный блюр 30–60 выборок. Ловушка: эффект исчезает, когда источник света ушёл за кадр; лишний полноэкранный проход; новый GodraysNode в three.js — TSL, плюс требует полной настройки теней (не наш рендерер).
- Ссылки:
  - GodRaysShader в three.js (радиальный блюр по маске глубины): https://threejs.org/docs/pages/module-GodRaysShader.html (выдача); старая копия: https://app.unpkg.com/three@0.139.2/files/examples/jsm/shaders/GodRaysShader.js (выдача)
  - pmndrs/postprocessing GodRaysMaterial (ссылается на Despoulain 2012 и GPU Gems 3): https://pmndrs.github.io/postprocessing/public/docs/class/src/materials/GodRaysMaterial.js~GodRaysMaterial.html (выдача)
  - three-good-godrays (screen-space с картой теней): https://discourse.threejs.org/t/three-good-godrays-screen-space-godrays-for-three-js/43422 (выдача)
  - Название примера webgl_postprocessing_godrays из выдачи подтверждено не было — страница примера не появилась (не проверено).

### 12. Fake volumetric light rays (Codrops), Volumetric light rays
- Даёт: лучи света в виде шейдера на геометрии/полноэкранном квад: работает и когда источник за кадром.
- Дёшево: один квад/конус с шумом. Ловушка: прозрачность и overdraw, лучи плохо смотрятся вблизи. Близко к пункту «fake volumetric beams» из справочника партнёра; здесь лишь лучший источник.
- Ссылки:
  - Codrops, «Volumetric Light Rays with Three.js» (2022): https://tympanus.net/codrops/2022/06/27/volumetric-light-rays-with-three-js (выдача; код и тип геометрии не подтверждены)
  - Обсуждение: https://discourse.threejs.org/t/recreating-a-volumetric-light-effect/31387 (выдача)

### 13. Планарные отражения: Reflector и «мокрый пол», Planar reflections
- Даёт: честное зеркало или лужа на плоскости; на мокром полу плюс размытие и затухание отражения по расстоянию.
- Дёшево относительно SSR и кубкарты на плоскость: один лишний рендер сцены (дорого: удвоение вызовов), можно в половинном разрешении и без теней, MSAA у Reflector по умолчанию 4 (можно 0). Ловушка: Reflector не размывает; для мокрого пола нужен свой шейдер поверх (размытие по расстоянию, нормаль воды), стоит рендерить отражение упрощённой сценой.
- Ссылки:
  - Официальная документация Reflector (WebGL только; для WebGPU — ReflectorNode): https://threejs.org/docs/pages/Reflector.html (выдача); исходник для r187 в той же ветке: https://app.unpkg.com/three@0.187.0/files/examples/jsm/objects/Refractor.js (выдача, рядом лежит Reflector.js)
  - Пример webgl_mirror упомянут в сниппете выдачи (страницы примера не было).
  - Идея «размытие по расстоянию» (drei MeshReflectorMaterial, R3F, лицензия не проверена): https://drei.docs.pmnd.rs/shaders/mesh-reflector-material (выдача)
  - Форум: «Blurred reflections»: https://discourse.threejs.org/t/blurred-reflections/33296 (выдача)
  - Форум: «What's the best way to make a reflective floor»: https://discourse.threejs.org/t/whats-the-best-way-to-make-a-reflective-floor/37438 (выдача)

### 14. Мягкие тени: PCF / VSM / тень одной картой, Soft shadows
- Даёт: дешёвое смягчение края тени; у фонаря с одной картой — настройка радиуса и размера.
- Дёшево: тип карты — выбор между PCFSoftShadowMap (радиус по документации не действует; смягчать уменьшением mapSize) и VSMShadowMap (radius и blurSamples, но свет «просачивается» у тонкой геометрии и есть доп. блюр-проход). Ловушка: источники расходятся — для точечного света PCF тоже использует radius (проверять в исходнике r187).
- Ссылки:
  - Описание LightShadow (radius, blurSamples по умолчанию 8, типы теней): https://www.crachecode.net/vendor/three.js/docs/api/en/lights/shadows/LightShadow.html (выдача; старая копия документации); типы: https://cdn.jsdelivr.net/npm/@types/three@0.184.1/src/lights/LightShadow.d.ts (выдача)
  - Сравнение VSM и PCFSoft: https://salivity.github.io/three.js/article/vsmshadowmap-vs-pcfsoftshadowmap-in-three-js (выдача)
  - Форум об оптимизации: https://discourse.threejs.org/t/how-to-optimize-shadow-rendering-in-three-js-for-better-performance/64681.md (выдача)

---

## C. Пространство, порталы

### 15. Порталы: stencil buffer и render target, Portals / impossible spaces
- Даёт: «окно» в другое пространство, невозможные комнаты (внутри больше, чем снаружи), дверь, ведущая в другую локацию.
- Дёшево: stencil-маска рисует вторую сцену только в проёме; вариант через render target — картинка на материале. Ловушка: stencil плохо переносит несколько порталов; render targets не делят общий depth/stencil буфер; рекурсия порталов растёт по цене; render target даёт проблемы с параллаксом, если не пересчитывать камеру.
- Ссылки:
  - Talin, «Creating portals in Three.js» (dev.to): https://dev.to/viridia/creating-portals-in-three-js-2dbm (выдача)
  - Форум: «Portal rendering with stencil buffer» (демо BarthaBRW): https://discourse.threejs.org/t/portal-rendering-with-stencil-buffer/22425 (выдача)
  - Peter Coolen, портал через render target: https://medium.com/@petercoolen/breaking-down-the-portal-effect-how-to-create-an-immersive-ar-experience-9654aa882c13 (выдача)
  - Maxime Heckel, render targets в WebGL: https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/ (выдача; связь с порталами не подтверждена)
  - Рекурсивные порталы, студенческая работа: https://www.cs.rpi.edu/~cutler/classes/advancedgraphics/S21/final_projects/metzlr.pdf (выдача)
  - Оптимизация порталов: https://discourse.threejs.org/t/advice-on-optimizing-portals/41589 (выдача)

---

## D. Точки, частицы, облака точек

### 16. GPU particles / FBO particles и curl noise, GPGPU particles
- Даёт: сотни тысяч частиц с движением по потоку без CPU: позиции живут в текстуре, ping-pong; curl noise даёт завихрения «как дым/пыль».
- Дёшево: цена = размер текстуры состояния плюс отрисовка точек. Ловушка: float/half float текстуры как render target не везде одинаковы (на части телефонов half float даёт артефакты); отдельный проход simulate.
- Ссылки:
  - Particle-Curl-Noise (three.js FBO + curl noise по примеру edankwan): https://uithub.com/juniorxsound/Particle-Curl-Noise (выдача; лицензия не проверена), каталог: https://awesome.ecosyste.ms/projects/github.com%2Fjuniorxsound%2Fparticle-curl-noise (выдача)
  - nicoptere/FBO: https://www.github.com/nicoptere/FBO (выдача; лицензия не проверена)
  - Bridson, curl noise (разбор): https://prideout.net/blog/old/blog/index.html@p=67.html (выдача)
  - Форум GPGPU particles (2026): https://discourse.threejs.org/t/gpgpu-particles/90558 (выдача)
  - Официальный GPUComputationRenderer упоминается в примерах three.js, см. пункт про птиц.

### 17. Частицы, собирающиеся в модель (morph между облаками точек), Particle morphing
- Даёт: рассыпание и сборка предмета/лица из точек, подходит под «память, которая собирается».
- Дёшево: два атрибута позиции + mix(a, b, progress) в вершинном шейдере; для сложной динамики — через FBO + curl noise. Ловушка: число точек должно совпадать (MeshSurfaceSampler); не подмешивать морф-таргеты three.js в ShaderMaterial напрямую (на WebGL2 renderer ждёт текстуру морфов).
- Ссылки:
  - Форум: «Morphing between geometries of Points system on GPU»: https://discourse.threejs.org/t/morphing-between-geometries-of-points-system-on-gpu/37688 (выдача)
  - «Particles Transition»: https://discourse.threejs.org/t/particles-transition/89134 (выдача); «Particles Transition Bloom»: https://discourse.threejs.org/t/particles-transition-bloom/89382 (выдача)
  - Форум о морфе между моделями с разным числом вершин (MeshSurfaceSampler): https://discourse.threejs.org/t/how-can-i-morph-objects-with-different-number-of-vertices/61371/6 (выдача)

### 18. Размер точек по расстоянию и cloud-rendering, Point size attenuation
- Даёт: точка читается как «пятно скана»; на расстоянии мельчает, вблизи растёт; ключ к визуалу «мир из точек».
- Дёшево: gl_PointSize в вершинном шейдере; без геометрии. Ловушка: размер ограничен ALIASED_POINT_SIZE_RANGE (на телефонах часто 64 px и менее); при отдалении точки исчезают; точки круглые только через текстуру или discard (overdraw); в WebGPU PointsMaterial.size не работает (для нас неважно).
- Ссылки:
  - Документация PointsMaterial (sizeAttenuation, лимиты): https://threejs.org/docs/pages/PointsMaterial.html (выдача)
  - Форум: исчезновение точек при отдалении: https://discourse.threejs.org/t/pointsmaterial-how-do-i-prevent-vanishing-points-on-zoom-out/9776 (выдача); плавное исчезновение: https://discourse.threejs.org/t/how-do-points-smoothly-disappear-with-increasing-distance/48152 (выдача)
  - Масштаб от камеры: https://discourse.threejs.org/t/scaling-particles-based-on-camera-distance/5818 (выдача)
  - Примеры webgl points (sprites, billboards, BufferGeometry points) перечислены в документации PointsMaterial.

### 19. Eye-Dome Lighting (EDL) для облаков точек
- Даёт: объёмность и читаемость формы безликих точек — по буферу глубины подсвечиваются разрывы глубины как контур/затенение. Без нормалей и без источников света.
- Дёшево: один постпроход с чтением глубины (8 соседей); работает на безнормальных точках. Ловушка: нужна текстура глубины (render target с depthTexture), лишний проход; артефакты на очень разреженных точках.
- Ссылки:
  - Potree (на three.js), автор Markus Schütz, лицензия BSD 2-clause (по выдаче): https://www.ep.sci.hokudai.ac.jp/~mkuriki/potree-1.5/src/viewer/sidebar.html (выдача, зеркало интерфейса); диссертация TU Wien: https://www.cg.tuwien.ac.at/research/publications/2016/SCHUETZ-2016-POT/SCHUETZ-2016-POT-thesis.pdf (выдача)
  - Обсуждение портирования шейдера (адаптация из CloudCompare): https://forum.babylonjs.com/t/eye-dome-lighting-edl-for-point-clouds/21737 (выдача)
  - Описание: https://fsl.dev/docs/features/edl/ (выдача)
  - Готового пакета EDL для three.js в выдаче не было — шейдер Potree нужно портировать самому.

### 20. Gaussian splats в three.js, Gaussian splatting
- Даёт: фотореалистичный «скан» реального места, как будто воспоминание, реконструированное из кадров.
- Дёшево? Нет, как правило тяжело на телефоне (сортировка и overdraw), потому в списке с оговоркой: полезно разве что для коротких вставок или как референс.
- Ссылки:
  - Spark (World Labs), рендерер для three.js, лицензия MIT (в выдаче), нужен three 0.179+, WebGL2, WebGLRenderer создавать с antialias: false: https://github.com/sparkjsdev/spark (выдача); документация: https://sparkjs.dev/docs/overview/ (выдача)
  - Три нативный рендерер splats для WebGPU в r186 (не для нас): https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186 (выдача)

### 21. Анаморфоза / проекционный маппинг (картинка собирается с одной точки)
- Даёт: хаотичные осколки в пространстве складываются в слово/силуэт, если смотреть с одной позиции. Хороший пазл-приём для игры от первого лица (стоять в «точке»).
- Дёшево: достаточно проекции текстуры или расчёта позиции осколков; без новых проходов. Ловушка: допуск по позиции игрока и FOV; на любой другой позиции видно только мусор — это и задумка.
- Ссылки:
  - см. пункт 10 (Codrops texture projection; Artificial Noodles «The Sweet Spot»: https://www-artificialnoodles-com.pages.dev/blog/the-sweet-spot (выдача))
  - Фон по оптике: https://perspectiveresearchcentre.com/anamorphic-perspective/ (выдача)
  - Off-axis проекция по лицу (MediaPipe) — как контрпример: https://80.lv/articles/projection-illusion-that-allows-you-to-explore-3d-objects-using-face-tracking (выдача)

---

## E. Пост-эффекты

### 22. Ordered dither / stipple-прозрачность, Dithering
- Даёт: «печатный» дрожащий растр; для прозрачности — стипплинг (отброс пикселей по матрице Байера) вместо настоящего alpha blending, без сортировки.
- Дёшево: один шаг в шейдере (4x4 Bayer как константный массив или текстура). Ловушка: при масштабировании внутреннего буфера на экран растр «плывёт» (рисовать в пикселях внутреннего буфера); на телефонах нет проблем.
- Ссылки:
  - Codrops «Building a Real-Time Dithering Shader» (2025): https://tympanus.net/codrops/2025/06/04/building-a-real-time-dithering-shader/ (выдача)
  - Maxime Heckel, «The Art of Dithering and Retro Shading for the Web»: https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web (выдача)
  - niccolofanton/dithering-shader (R3F, лицензия не проверена): https://github.com/niccolofanton/dithering-shader (выдача)
  - Это развитие пункта «alpha hash dissolve» справочника: матрица Байера даёт упорядоченный, а не шумовой дизеринг.

### 23. Datamosh / pseudo pixel sorting / feedback, Datamosh, pixel sorting
- Даёт: «сломанная память» — кадры залипают, цвета тянутся по направлению движения.
- Дёшево: один проход с предыдущим кадром (ping-pong); настоящая сортировка пикселей на GPU дорога, поэтому «псевдо» — смещение UV по порогу яркости. Ловушка: нельзя читать текстуру, в которую пишешь (два буфера); память под ещё один буфер.
- Ссылки:
  - Codrops «Breaking the Frame: Building a Real-Time Datamosh Effect with Three.js» (Niccolò Fanton, 2026): https://tympanus.net/codrops/2026/09/02/breaking-the-frame-building-a-real-time-datamosh-effect-with-three-js/ (выдача)
  - Pseudo Pixel Sorting (Godot-шейдер, CC0 по выдаче, совместим с WebGL): https://godotshaders.com/shader/pseudo-pixel-sorting/ (выдача)
  - glitch-gl (npm, three.js r128): https://cdn.jsdelivr.net/npm/glitch-gl@1.0.6/README.md (выдача; лицензия не проверена)

### 24. Long exposure / motion trails: AfterimagePass, Afterimage
- Даёт: шлейф от движения фонаря и света, «длинная выдержка», призрачные следы.
- Дёшево: один проход + ping-pong с damp; память под буфер предыдущего кадра. Ловушка: не зависит от fps без поправки на dt; шлейфы заметны только на тёмном фоне; пикселизация краёв из-за антиалиасинга; в последних версиях ломались импорты.
- Ссылки:
  - Документация AfterimagePass: https://threejs.org/docs/pages/AfterimagePass.html (выдача)
  - Форум о fps и damp: https://discourse.threejs.org/t/afterimage-example-damp-fps/70404 (выдача)
  - Фон: https://discourse.threejs.org/t/afterimagepass-on-white-scene-background/51939.md (выдача)
  - Codrops про персистенцию (Adding a Persistence Effect to Three.js Scenes): https://tympanus.net/codrops/author/georgi (выдача, страница автора)
  - Пример webgl_postprocessing_afterimage в выдаче не открывался (не проверено).

### 25. Heat haze / рефракция по карте искажений, Heat distortion
- Даёт: марево над горячим, дрожание воздуха, стекло-«вода»: фон читается со смещением по анимированной нормал-карте или шуму.
- Дёшево: в постпроходе или на квад-«линзе» перед объектом, одна доп. выборка карты искажений. Ловушка: нужно, чтобы линза читала уже отрисованный кадр (render target); границы линзы — подмешивать по маске, иначе виден шов.
- Ссылки:
  - Codrops «Animated Heat Distortion Effects with WebGL» (2016): https://tympanus.net/codrops/2016/05/03/animated-heat-distortion-effects-webgl/comment-page-1 (выдача)
  - Heat haze shader для SFML (GLSL): https://github.com/SFML/SFML/wiki/Source:-HeatHazeShader (выдача)
  - Готового примера three.js не найдено — комбинировать с постпроходом самому.

### 26. Chromatic aberration, барель-дисторсия, CRT-scanlines, Lens distortion
- Даёт: искажение объектива, цветная кайма по краям, строки CRT: «плёночный/видео» взгляд. Уже есть в пост-проходе игры; ниже — источники для улучшения.
- Дёшево: всё в одном проходе, формулы радиальные. Ловушка: лучше склеивать в один проход (меньше полноэкранных чтений); лицензия: один найденный CRT-шейдер восходит к GPL-коду — не копировать без проверки.
- Ссылки:
  - three-lens-distortion (радиальная дисторсия для EffectComposer): https://github.hscsec.cn/ycw/three-lens-distortion (выдача; лицензия не проверена)
  - Форум: раздельная CA и бочка (gkjohnson): https://discourse.threejs.org/t/chromatic-aberation/20044 (выдача)
  - CRT.js в examples/jsm/tsl/display (кривизна и scanlines, но TSL, не GLSL; для сверки математики): https://app.unpkg.com/three@0.183.1/files/examples/jsm/tsl/display/CRT.js (выдача)
  - Babylon, «Retro CRT shader: a post-processing effect study»: https://babylonjs.medium.com/retro-crt-shader-a-post-processing-effect-study-1cb3f783afbc (выдача)

### 27. Fake depth of field / bokeh, Depth of field
- Даёт: размытие вдали и вблизи, блики-«шестиугольники»; в игре из точек полезен как «фокус памяти».
- Дёшево: BokehPass из three.js — один проход с буфером глубины; «fake bokeh» спрайтами без теста глубины ещё дешевле, но требует отдельных спрайтов. Ловушка: настоящие размытия ядрами — дорогие (число колец RINGS и SAMPLES); у BokehPass известные швы на некоторых версиях.
- Ссылки:
  - Пример webgl realistic depth-of-field bokeh (dof2): https://threejs.org/examples/webgl_postprocessing_dof2 (выдача)
  - Документация BokehPass: https://threejs.org/docs/pages/BokehPass.html (выдача); BokehShader2: https://threejs.org/docs/pages/module-BokehShader2.html (выдача)
  - «How To Fake Bokeh (And Make It Look Pretty Good)» (MJP): https://therealmjp.github.io/posts/bokeh (выдача)
  - Форум про шов: https://discourse.threejs.org/t/seam-in-bokeh-filter/9114 (выдача)

---

## F. Небо, атмосфера

### 28. Звёзды с параллаксом, аврора, небо одним проходом, Starfield / aurora
- Даёт: небо в один фрагментный шейдер, без текстур: слои звёзд с разной скоростью и мерцанием, аврора из fBm-шума.
- Дёшево: ограничить число октав шума (мерзнет на слабых GPU). Ловушка: плоская аврора на меше «разваливается» при движении камеры — нужен параллакс по слоям или фиксация в небесной сфере.
- Ссылки:
  - Описание на основе Shadertoy XtGGRt (аврора), 3slXDB (ночное небо): https://godotshaders.com/shader/aurora-sky-shader/ (выдача)
  - Raymarched aurora (Toni Sagrista): https://tonisagrista.com/blog/2024/rendering-aurorae-nebulae/ (выдача)
  - Сами страницы Shadertoy в выдаче не открывались (не проверено).

### 29. Дешёвые объёмные облака (raymarch в малом буфере), Volumetric clouds
- Даёт: облака/туман с объёмом, без геометрии; низкая детализация и апскейл маскируют мягкость.
- Дёшево: только при рендере в малом буфере (четверть разрешения) и ограничении шагов; на телефоне всё равно риск. Ловушка: render target теряет глубину, облака рисуются поверх всего без depth-aware прохода; артефакты апскейла.
- Ссылки:
  - Форум: «Efficient volumetric clouds»: https://discourse.threejs.org/t/efficient-volumetric-clouds/66067 (выдача)
  - three-volumetric-pass (ameobea, поверх pmndrs postprocessing): https://www.npmjs.com/package/three-volumetric-pass-fork (выдача; лицензия не проверена)
  - @takram/three-clouds: https://www.npmjs.com/package/@takram/three-clouds (выдача); автор сам советует preset «Low» или skybox вместо клаудов на слабых устройствах
  - Для телефона честнее брать слой шумовых спрайтов/небесных плоскостей.

---

## G. Эффекты на мешах

### 30. Hologram / сканирующая линия / fresnel-«призраки», Hologram shader
- Даёт: призрачные прозрачные силуэты: fresnel (яркий край), бегущие линии, редкий глитч-сдвиг в вершинном шейдере.
- Дёшево: один материал, аддитивная смесь. Ловушка: прозрачность и сортировка; overdraw при большом числе призраков.
- Ссылки:
  - threejs-holographic-material (ektogamat, R3F и vanilla gist): https://github.com/ektogamat/threejs-holographic-material (выдача; лицензия не проверена)
  - Vanilla-вариант gist: https://gist.github.com/ektogamat/b149d9154f86c128c9fea52c974dda1a (выдача)
  - Three.js From Zero, hologram: https://masterallarts.pages.dev/learn/threejs-from-zero/s0-06-hologram-shader/ (выдача)
  - Три глича: форум https://discourse.threejs.org/t/hologram-shader-actual-hologram-and-a-not-cool-3d-effect/31126.md (выдача)

### 31. Ветер и «дыхание» поверхностей в вершинном шейдере, Vertex wind / breathing
- Даёт: деревья, занавески, трава; «дыхание» стен — та же формула с медленной синусоидой по нормали. Амплитуда растёт с высотой/маской (вершинный цвет).
- Дёшево: считается в вершинном шейдере, без CPU. Ловушка: тени (карта теней) должны использовать тот же смещённый материал (customDepthMaterial), иначе тень не шевелится; деформация после мировой трансформации.
- Ссылки:
  - al-ro, grass (инстансинг, ветер синусоидами): https://al-ro.github.io/projects/grass (выдача)
  - Форум: деревья через onBeforeCompile: https://discourse.threejs.org/t/generate-realistic-procedural-trees/65341 (выдача)
  - Godot «Making trees» (приём: сила ветра в вершинном цвете): https://docs.godotengine.org/en/3.4/tutorials/shaders/making_trees.html (выдача)
  - Отдельной ссылки именно про «дыхание» поверхности не найдено — приём выводится из ветра (не проверено).

### 32. SDF-текст (troika-three-text), SDF/MSDF
- Даёт: чёткий текст на 3D-поверхностях при любом масштабе, обводка, свечение, дрожание шрифтом внутри шейдера.
- Дёшево: атлас SDF + шейдер; troika строит атлас на лету из ttf/otf. Ловушка: загрузка шрифта и первая генерация атласа (preload), нужна версия troika под нашу версию three; поддержка кириллицы зависит от шрифта.
- Ссылки:
  - troika-three-text README: https://cdn.jsdelivr.net/npm/troika-three-text@0.52.4/README.md (выдача; лицензия не проверена)
  - Форум: https://discourse.threejs.org/t/troika-3d-text-library-for-sdf-text-rendering/15111 (выдача)
  - three-text (альтернатива на HarfBuzz, alpha): https://scour.ing/p/https://github.com/countertype/three-text (выдача)

### 33. Shell texturing (мех, мох), Shell texturing
- Даёт: «пушистая» поверхность из N слоёв мешa, каждая со своим порогом по текстуре травы/волос.
- Дёшево? Нет: N проходов по мешу, overdraw. Допустимо для 1–2 небольших объектов; на телефоне — 8–16 слоёв максимум. Ловушка: силуэт плох (нужны fins).
- Ссылки:
  - mate-h/shell-texturing (three.js): https://awesome.ecosyste.ms/projects/github.com%2Fmate-h%2Fshell-texturing (выдача)
  - piellardj/fur-threejs: https://awesome.ecosyste.ms/projects/github.com%2Fpiellardj%2Ffur-threejs (выдача)
  - Lengyel 2001 (оригинальная работа): https://people.csail.mit.edu/ericchan/bib/pdf/p227-lengyel.pdf (выдача)
  - NVIDIA «Fur shells and fins»: https://developer.download.nvidia.com/SDK/10.5/direct3d/Source/Fur/doc/FurShellsAndFins.pdf (выдача)
  - Hair cards: готового источника для three.js не найдено (в выдаче только общий вывод, что в three.js своей системы волос нет) — без надёжной ссылки.

---

## Блок «Птицы»

Задача партнёра: «добавить птиц, пока не понимаю куда и как». Ниже способы от дешёвого к дорогому; места в игре — предложения для проверки, не из источников.

### Способ 1. Сильно дальние птицы: инстансы треугольников/квадов с взмахом в шейдере
- Одна «птица» = 2–4 треугольника, взмах = sin(time + фаза инстанса) по высоте крыльев (расстояние вершины от оси тела); ориентация по скорости. Один InstancedMesh на всю стаю, позиции по простому движению (орбита, ветер).
- Ссылки:
  - Daniel John Morris, boids во three.js: 150 low-poly птиц, 1 InstancedMesh, взмах крыльев в вершинном шейдере по расстоянию от центральной линии тела: https://danieljohnmorris.com/writing/threejs-boids-flocking/ (выдача; лицензия не проверена)
  - Описание «две треугольника + sin времени с фазой инстанса» — в сниппете выдачи (demo notes): https://chatbotkit.com/hub/blueprints/threejs-demo-bot/conversations/tphkqinkp6uc1szywj1sss3l (выдача; неофициально, часть спекулятивна)
  - Barradeau, инстансинг с translation/rotation/scale в атрибутах (старый API addAttribute): https://barradeau.com/blog/?p=1109 (выдача)
  - Бесплатный вариант для точечного мира: птицы как Points со спрайт-атласом (flipbook, пункт 8) — идея, подтверждающей ссылки нет.

### Способ 2. Billboard-птицы вдали (силуэты на небе)
- Квады, повёрнутые к камере, с атласом из 2–4 кадров взмаха. На небе вдали достаточно силуэта.
- Ссылки:
  - Billboard для InstancedMesh: https://discourse.threejs.org/t/instancedmesh-implement-billboard/29354 (выдача); https://discourse.threejs.org/t/lookat-billboard-vertex-shader-for-instancedmesh-instances/86227 (выдача)
  - Billboard по двум осям: https://discourse.threejs.org/t/mesh-points-to-the-camera-on-only-2-axis-with-shaders/21555.md (выдача)
  - Ловушка: простая формула иногда рисует лишь один инстанс — нужен учёт матрицы экземпляра (из обсуждения выше).

### Способ 3. Официальный GPU-бойдс: webgl_gpgpu_birds
- GPUComputationRenderer хранит позиции и скорости в текстурах, три шейдера симуляции (скорость, позиция), итоговый вершинный шейдер читает данные; есть вариант webgl_gpgpu_birds_gltf.
- Ссылки:
  - Живой пример: threejs.org/examples/webgl_gpgpu_birds.html (адрес приведён в тексте выдачи; страницы не открывались, название файла подтверждено форумами и разбором)
  - Разбор примера (кит.): https://blog.csdn.net/mu399/article/details/129580394 (выдача)
  - Форум: форма птиц: https://discourse.threejs.org/t/gpu-birds-example-changing-shape/3172 (выдача)
  - Форум: half float на телефонах даёт сбои: https://discourse.threejs.org/t/gpgpu-birds-example-using-half-float-to-store-position/6190.md (выдача)
  - PR #23435 (draw range в glTF-варианте): https://github.com/mrdoob/three.js/pull/23435 (выдача)
  - Сравнение производительности: https://forum.babylonjs.com/t/what-makes-this-three-js-implementation-of-the-boids-algorithm-so-performant-exactly/13146 (выдача)
  - Ловушки: инвертирование скорости по z (иначе птицы летят вверх ногами), стая внутри ограниченного объёма, симуляция по O(N^2) — брать малую текстуру (например 32x32 = 1024 птицы).
  - Вариант WebGPU (webgpu_compute_birds) нам не подходит: упомянут в выдаче через Three.js Blocks: https://www.threejs-blocks.com/docs/BirdGeometry (выдача; TSL/WebGPU).

### Способ 4. Анимация взмаха через Vertex Animation Texture (VAT)
- Цикл взмаха запекается в текстуру (кадр x вершина), инстансы со своей фазой читают её по vertex ID. Нужен, если птицы — реальные модели с «настоящим» взмахом.
- Ссылки:
  - Форум: «InstancedMesh animations, like with SkinnedMesh?»: https://discourse.threejs.org/t/instancedmesh-animations-like-with-skinnedmesh/12388 (выдача)
  - Форум: «Playback the animation of many low-poly models»: https://discourse.threejs.org/t/playback-the-animation-of-many-low-poly-models-as-they-are-moved-around/42205 (выдача)
  - Форум: «Baking Animation» (VAT из морф-данных): https://discourse.threejs.org/t/baking-animation/75242 (выдача)
  - Форум: мягкие тела из Houdini в three.js: https://discourse.threejs.org/t/bringing-soft-and-fluid-body-vertex-animations-from-houdinifx-to-threejs/7411.md (выдача)
  - Объяснение VAT: https://medium.com/tech-at-wildlife-studios/texture-animation-techniques-1daecb316657 (выдача)
  - Готового примера «VAT + InstancedMesh» именно для three.js WebGL в выдаче не нашли; чаще проще пункт 1 или 3.

### Способ 5. Птицы как облако точек (подходит под визуал игры)
- Стая — подмножество точек, управляемое шумом/curl noise (пункт 16) или boids; вблизи собирается из точек в силуэт (морф, пункт 17). Подтверждающей ссылки на «птицы из точек» нет; опирается на пункты 16–18.

### Где это в игре (предложения для обсуждения, не из источников)
- Силуэты в небе вдали (способ 1–2): почти бесплатно, работает как «часы» сцены.
- Стая как событие (способ 3): один раз, пролетает над залом ожидания/окном; можно пустить сквозь окно с interior mapping (пункт 1) как «что-то в комнате за стеклом».
- Мёртвые/замершие птицы: статические инстансы, VAT не нужен.

---

## Источники (общий список)

Все ссылки выше даны в тексте пунктов. Незакрытые места:
- iquilezles.org/articles/texturerepetition/ — адрес не из выдачи.
- threejs.org/examples/webgl_gpgpu_birds.html — название файла подтверждено вторичными источниками, страница не открывалась.
- webgl_postprocessing_godrays, webgl_postprocessing_afterimage, webgl_mirror — названия упоминаются в запросах/сниппетах, страницы примеров в выдаче не появлялись.
