# .kkrieger / werkkzeug3 — исследование для Untitled Session

Дата: 2026-11-14. Только факты и ссылки; выводов «что делать» нет, кроме раздела «Что переносимо технически».

## Ограничения сбора (важно)
- Из песочницы открывались только github.com и raw.githubusercontent.com. Не открылись (ENOTFOUND): fgiesen.wordpress.com, en.wikipedia.org, news.ycombinator.com, gamedeveloper.com, hugi.scene.org, github.blog, 64k-scene.github.io, in4k.github.io. Чтобы читать их напрямую, их нужно разрешить в сетевых настройках сессии.
- Поэтому посты ryg, интервью и Wikipedia читались только через пересказ поисковика (помечено «через поиск»). Числа оттуда — «требует проверки».
- Всё, что в отчёте помечено «из памяти», в сессии не подтверждено ссылкой.

## 1. Что в репозитории jaromil/kkrieger-werkkzeug3

- Это форк/копия исходников Farbrausch с каталогом `werkkzeug3_kkrieger` («kkrieger branch»). README: .kkrieger — немецкий FPS от .theprodukkt (бывшее подразделение Farbrausch), exe 96 КБ, DirectX 9+; текстуры хранятся как «история создания», сетки строятся из простых тел и деформируются; звук — синтезатор V2 по MIDI в реальном времени; werkkzeug3 — инструмент, которым игру сделали. https://github.com/jaromil/kkrieger-werkkzeug3 , https://raw.githubusercontent.com/jaromil/kkrieger-werkkzeug3/master/README.MD
- Каталоги верхнего уровня (по странице репо): `.github/workflows`, `docs`, `genthree`, `ktg`, `kkrunchy`, `v2`, `werkkzeug3_kkrieger` (внутри `fried`, `materials`, `player_demo`, `player_intro`, `player_kkrieger`, `pngloader`, `shadercompile`, `werkkzeug3`), `yasm-1.3.0`. https://github.com/jaromil/kkrieger-werkkzeug3
- Язык: страница GitHub не показала разбивку; по составу — C++ и ассемблер (`.asm`: depacker, `_viruz2a.asm`), сборка через Visual Studio + YASM. Список файлов `werkkzeug3_kkrieger`: `genbitmap`, `genmesh`, `genmaterial`, `genscene`, `engine`, `kkriegergame`, `_lekktor`, `_viruz2`, `depacker`, `exepacker`, `LICENSE.txt`, `concept.txt`, `history.txt`. https://github.com/jaromil/kkrieger-werkkzeug3/tree/master/werkkzeug3_kkrieger
- Зависимости: YASM 1.3.0 (в репо, BSD), Visual Studio, DirectX 9; внутри — `_ogg`, `_mp3` библиотеки. Только Windows. https://raw.githubusercontent.com/jaromil/kkrieger-werkkzeug3/master/README.MD
- Собирается ли сегодня: README форка — «должно собираться без особых проблем» на Visual Studio 2022 Community, более ранние VS и другие платформы не проверялись; нужно добавить YASM в PATH. Реально собрать не пробовал (требует проверки). Оригинальный README Farbrausch, наоборот, предупреждает: werkkzeug3 «messy», сборка kkrieger «unlikely to work». https://raw.githubusercontent.com/farbrausch/fr_public/master/README.md
- Расхождение: бейдж сборки в форке ведёт на репозиторий другого аккаунта (steven-schronk/Kkrieger-Werkkzeug3). Видимые коммиты форка — февраль 2023 (заметки «Notes on KOp retrieval and VBO/EBO inits», «Update notes.txt»); всего 69 коммитов на странице. https://github.com/jaromil/kkrieger-werkkzeug3/commits/master
- Важное предупреждение авторов: каталог `werkkzeug3_kkrieger` в fr_public — «not the actual kkrieger code», включает правки, сделанные более чем через год после релиза kkrieger (2004). https://raw.githubusercontent.com/farbrausch/fr_public/master/README.md , https://github.com/tul/fr_public
- Исходные данные игры: `werkkzeug3/data` — «Source data for kkrieger and some test projects» (есть и debris, theta). https://raw.githubusercontent.com/farbrausch/fr_public/master/README.md
- Когда выложено: официальный fr_public — апрель 2012 (README/страница: «Released April 2012»; обновлён октябрь 2014 под Altona2); 376 коммитов. https://github.com/farbrausch/fr_public . Русская Википедия-зеркало тоже даёт апрель 2012. https://ru.ruwiki.ru/wiki/.werkkzeug . Поисковый пересказ geeks3d: «Source Code of Farbrausch's Demo Tools 2001-2011» — это про период инструментов, не дату выкладки. https://glslhacker.geeks3d.com/?p=8264
- Авторы: Dierk Ohlerich (chaos), Fabian Giesen (ryg), Thomas Mahlke (fiver2) — см. LICENSE ниже.

### Лицензия (точные формулировки)
- README fr_public и форка: «All of this is released either under a BSD license or put in the public domain (stated per project).» (дословно приведено в ответах инструмента; в форке: «either under a BSD license or put in the public domain as stated per project»). https://raw.githubusercontent.com/farbrausch/fr_public/master/README.md , https://raw.githubusercontent.com/jaromil/kkrieger-werkkzeug3/master/README.MD
- `werkkzeug3_kkrieger/LICENSE.txt` — BSD 2-clause: «Copyright (c) 2002-2012, Dierk Ohlerich, Fabian Giesen, Thomas Mahlke,» … «Redistribution and use in source and binary forms, with or without modification, are permitted provided that…» (1) в исходниках сохранять уведомление об авторстве, список условий и отказ от гарантий; (2) в бинарниках воспроизводить то же в документации/материалах. Далее стандартные «AS IS» и ограничение ответственности. https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/LICENSE.txt
- Расхождение по kkrunchy: списки упаковщиков называют его то public domain, то BSD (через поиск, 64k-scene resources). Требует проверки по файлам `kkrunchy/` и `kkrunchy_k7/`. https://64k-scene.github.io/resources.html
- Уточнение: лицензия касается кода; права на игру .kkrieger как продукт (контент, ассеты, музыка) из репо не следуют — требует проверки (юр. выводов не делаю). Заметка: каталог `werkkzeug3/data` содержит исходные данные игры, лицензия на них отдельно не проверена.

## 2. Как .kkrieger умещается в 96 КБ

Достоверно из исходников/README:
- Содержимое — граф операторов (в коде `KOp`, `KEnvironment`). Концепт-документ: операторы бывают «Init()» (выполняются при инициализации и создают объекты) и «Paint()» (рисуют кадр); рассматривались подходы Execute (всё дерево каждый кадр с кэшем), Record (выполнить один раз при старте, потом только рисовать) и гибридный. https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/concept.txt
- Текстурные операторы (объявления в `genbitmap.hpp`): Flat, Format, RenderTarget, Merge, Color, Range, GlowRect, Dots, Blur, Mask, HSCB, Rotate, RotateMul, Distort, Normals, Light, Bump, Text, Perlin, Cell, Wavelet, Gradient, Twirl, Sharpen, Import, ColorBalance, Unwrap, Bricks, Bulge, Render, RenderAuto. Пиксель — `sU64` (64 бит, 16 бит на канал; раскладка каналов в заголовке не задана). Размер — степень двойки, есть смещение разрешения текстур (меньше/норма/больше). https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genbitmap.hpp
- Операторы сеток (`genmesh.hpp`): примитивы Cube, Cylinder, Torus, Sphere, Grid, SingleVert; Extrude, ExtrudeNormal, Subdivide, Bevel, Bend/Bend2/BendS, Displace, Perlin, Multiply; Transform, Triangulate, Cut, DeleteFaces, Add; выделения (All, Cube, Sphere, Random, Logic, Grow, Face, Angle); CalcNormals, Crease/UnCrease, SmoothAngle, Color, UVProjection, ShadowEnable; AutoCollision, CollisionCube; импорт XSI, BSP, ToMin (мини-сетка). https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genmesh.hpp
- Материалы: `GenMaterial` — массив проходов (`GenMaterialPass`: материал, usage, «finalizer»-программа, Pass); сетка связывается с материалом по проходу (`Mesh_MatLink`). https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genmaterial.hpp
- Свет/рендер (концепт-заметка, это план, не итог): порталы с «сопротивлением» 1–10, заливка видимых сегментов; фазы отрисовки Lightmap, Prebump, Light, Mul, Add, Specular, Extra; идея «fake lighting»: один bump на сетку, динамическая shadow map на 3 источника, статический лайтмап. Реально реализованное в kkrieger — требует проверки по `engine.cpp`. https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/concept.txt
- Уровни: хранятся тем же графом — сцена из сеток, порталов/сегментов и коллизий (`Mesh_AutoCollision`, `GenScene`); отдельного формата карты в списке нет. Детали — требует проверки по `genscene.cpp`/`kkriegergame.cpp`.
- Журнал изменений: «3.178 severely improved memory usage in player»; «3.043 found 100MB unused data»; «3.087 improved texture memory management», настройка Texture Cache по объёму RAM (128 МБ ОЗУ → ≤64 МБ кэша; 256 → 64–128; 512 → 128–256; ≥1 ГБ → ≥192); «3.186 texture: most ops are in-place now». https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/history.txt
- Сжатие exe: kkrunchy — упаковщик x86 исполняемых файлов от Фабиана Гизена, де-факто стандарт для 64k-интро с 2006 г. (через поиск). Каталоги `kkrunchy/` (0.23alpha) и `kkrunchy_k7/` (0.23a4, новейшая). https://github.com/farbrausch/fr_public , https://64k-scene.github.io/resources.html . Принцип (из памяти, требует проверки): разбор секций кода/данных, фильтр для x86-вызовов, контекстное смешивание; в kkrieger применялся отдельный ранний упаковщик (`exepacker.cpp`, `depack2.asm` в дереве).
- Lekktor: каталог `lekktor/` — README: «May summon Eldritch Abominations. Handle with care.» Больше в README нет. Википедия через поиск: авторы написали собственный анализатор кода, вырезающий неиспользуемые части (имя «lekktor» поиск не подтвердил). Принцип (из памяти): анализ графа вызовов исходников C++ и удаление недостижимых функций, плюс `_lekktor.cpp` в дереве. Требует проверки. https://github.com/farbrausch/fr_public , https://en.wikipedia.org/wiki/.kkrieger
- Звук V2: синтезатор Tammo «kb» Hinrichs, выпущен в конце 2004; 16-канальный мультитембральный сабтрактивный синтезатор с глобальными реверберацией, дилеем, фильтрами и компрессором; музыка хранится как MIDI-подобные данные + патчи, рендерится в реальном времени. Через поиск KVR. https://www.kvraudio.com/news/farbrausch_v2_synthesizer_system_released_2794 . Исходники — `v2/` в fr_public.
- Время и память разворачивания:
  - Память: сообщения сообщества и поиска — «около 300 МБ» при работе (источники форумные: https://www.allegro.cc/forums/thread/586453/0 , через поиск); авторы называли «200–300 МБ» для классического хранения (Shamus Young/поиск, не первоисточник). https://www.shamusyoung.com/twentysidedtale?p=537
  - Ryg (через поиск, «Debris: Opening the box»): генерация текстур была самым ёмким по памяти шагом, нужна большая рабочая область. https://fgiesen.wordpress.com/2012/02/13/debris-opening-the-box/
  - Время: числа не найдены; источники лишь говорят, что при загрузке всё содержимое геймплея генерируется заново (Wikipedia через поиск). Требует проверки.
- Расхождение: Mastodon-тред Гизена 2025 (через поиск, не открыт): размер в рантайме — в основном текстуры, несжатые RGBA8; утверждение «текстуры синтезировались на лету в пиксельном шейдере, поэтому тормозило» — неверно. Требует проверки по первоисточнику. https://mastodon.gamedev.place/@rygorous/113919421632985069

## 3. За счёт чего выглядит хорошо (по описаниям авторов)
- Достоверно только то, что видно в коде: 16-бит на канал в генераторе (меньше полос при цепочках операторов); операторы Normals/Bump/Light (карты нормалей и освещение из высотных карт), Perlin/Cell/Wavelet (шум), Distort/Twirl/Bulge (искажения), Bricks, GlowRect, Gradient. `genbitmap.hpp` ссылка выше.
- Концепт-документ: несколько проходов материала (prebump, light, specular), shadow volumes (`Mesh_ShadowEnable`, «several shadow volumes»), лайтмапы, порталы. Ссылка выше.
- Что именно отвечает за туман/блики/попиксельный свет в итоговой игре — в сессии не подтверждено; нужно читать `engine.cpp`, `materials/`, `shadercompile/`.
- Ryg о Debris (через поиск): движок тот же werkkzeug3/kkrieger «с новой системой света/материалов; модели и текстуры по-прежнему генерируются»; exe 181 248 байт, zip 180 КиБ. https://www.linuxreviews.org/Fr-041:_d_e_b_r_i_s
- Для Debris/kkrieger «в нескольких статьях» разговор о вкусе: работа художника (Thomas Mahlke / fiver2) и режиссура; см. интервью fiver2 в Hugi 33 (не открыто). https://hugi.scene.org/online/hugi33/hugi%2033%20-%20demoscene%20interviews%20magic%20debris%20-%20fiver2%20in%20focus.htm

## 4. Первоисточники
(открыть не удалось, описания — через поиск / из памяти; везде «требует проверки»)
- Fabian «ryg» Giesen, «Debris: Opening the box» (2012-02-13): разбор Debris, текстурный генератор писался в конце 2002/начале 2003, самый памятный шаг; в конце список его постов о мешах («Mesh generation in Farbrausch demos», «Half-edge based mesh representations»). https://fgiesen.wordpress.com/2012/02/13/debris-opening-the-box/
- Fabian Giesen, «Metaprogramming for madmen» (2012-04-08): как выжимали последние байты, чтобы уложиться в 96 КБ (по заголовку и HN). https://fgiesen.wordpress.com/2012/04/08/metaprogramming-for-madmen/ ; обсуждение https://news.ycombinator.com/item?id=14409457
- Блог/домашняя страница ryg: https://fgiesen.wordpress.com/about/ , https://www.farbrausch.de/~fg/
- Gamedeveloper.com, «Interview: Frugal Fragging with .kkrieger» (2004) — интервью авторов. https://www.gamedeveloper.com/design/interview-frugal-fragging-with-i-kkrieger-i-
- Hugi 33, «Debris — fiver2 In Focus» — интервью Thomas Mahlke. https://hugi.scene.org/online/hugi33/hugi%2033%20-%20demoscene%20interviews%20magic%20debris%20-%20fiver2%20in%20focus.htm
- Hugi 22, «Making of fr-08: .the .product». https://hugi.scene.org/online/coding/hugi%2022%20-%20adfr08.htm
- Dierk Ohlerich (chaos): отдельных статей не найдено; в fr_public он автор Altona/werkkzeug4 — требует проверки.
- Репозиторий/документация: https://github.com/farbrausch/fr_public , https://github.com/jaromil/kkrieger-werkkzeug3 (`docs/index.md` — на странице один заголовок, содержания нет).
- GIGAZINE (2023), интервью с одним из авторов: https://gigazine.net/gsc_news/en/20230905-kkrieger-96kb-fps (не открыт).
- Guinness World Records: 97 280 байт («fewest bytes for an FPS»). https://www.guinnessworldrecords.com/world-records/421923-fewest-bytes-for-a-first-person-shooter-fps-videogame
- Activision Blizzard newsroom, «A brief history of the world's smallest first-person shooter». https://newsroom.activisionblizzard.com/p/a-brief-history-of-the-worlds-smallest

## 5. Что есть для браузера сегодня
Порт именно kkrieger/werkkzeug в WASM поиск не нашёл (результаты только общие про Emscripten) — «порта не найдено, требует проверки». Ближайшие вещи:
- Webbzeug (9elements) — веб-версия идеи werkkzeug для текстур: операции Rectangle, Circle, Fractal, Pixels, Flat, Cellular; Combine, Invert, Blur, Light, Mirroring; MIT; репозиторий в архиве с 12.08.2020, блог помечает «deprecated», «still alpha»; первый canvas-подход оказался медленным с blur/light. Не жив. https://github.com/9elements/webbzeug , https://9elements.com/blog/webbzeug-procedural-texture-editor-for-your-browser/
- OpenKTG (ktg/ в fr_public, 2007) — эталонная реализация текстурного генератора; чистый код, 16 бит на канал, правила семплирования совпадают с GL/D3D10+; в README прямо сказано, что его можно превратить в пиксельные шейдеры и JavaScript для WebGL; редактора нет; BSD/public domain по проекту. https://raw.githubusercontent.com/farbrausch/fr_public/master/ktg/README.md , https://github.com/tul/fr_public
- mrdoob/texgen.js — генератор текстур на canvas (шум, градиенты, чекер, turbulence, смешивание/варп); лицензия MIT по зеркалу SourceForge (проверить в репо); размер не найден; давно не обновлялся (не проверено). https://github.com/mrdoob/texgen.js
- tonym128 «TexGen» (2026): ~15 КБ библиотека, GLSL-шейдеры, текстуры кодируются в компактные строки; лицензия ISC — по пакетному листингу, привязка к репо не подтверждена. https://tonym128.github.io/texgen , https://tonym128.github.io/2026/03/04/texgen-procedural-texture-generator.html
- Прочие JS-текстурные библиотеки (из поиска): schalkt/tgen https://github.com/schalkt/tgen ; jdiemke/es6-texgen-lib https://github.com/jdiemke/es6-texgen-lib ; MagnusThor/demolishedTexture https://github.com/MagnusThor/demolishedTexture ; boytchev/tsl-textures (three.js TSL) https://github.com/boytchev/tsl-textures . Лицензии/размеры/активность не проверены.
- Редакторы графов (десктоп, не для рантайма): Material Maker (MIT, Godot) https://github.com/nn6n/material-maker ; NeoTextureEdit http://neotextureedit.sourceforge.net/ ; Graph.ical (MIT, веб, PROCJAM 2018) https://kchapelier.itch.io/graphical .
- Rust: SamiPerttu/funutd — процедурная текстурная библиотека https://github.com/SamiPerttu/funutd (лицензия/состояние не проверены).
- Шум: simple-noise `simplex-noise` (npm), tooloud (npm). Только ссылки через поиск.
- Игры в стиле «всё генерируется при старте»: Google CUB (2015; текстуры, геометрия, звуки, музыка при запуске) https://experiments.withgoogle.com/cub ; Q1K3 (13 КБ, текстуры моделей в рантайме) https://phoboslab.org/log/2021/09/q1k3-making-of ; «Yet Another Doom Clone in 13kb» (процедурные текстуры на Perlin) https://engineered.at/articles/yet-another-doom-clone-in-13kb-of-javascript ; Bellwoods (js13k, графика и звук процедурные) https://blog.kodewerx.org/2015/09/ ; andrei-drexler/q321 https://github.com/andrei-drexler/q321 (по названию, не проверен).
- Процедурные сетки в JS: подразделение, CSG и операторные стеки — конкретной библиотеки в сессии не подтверждено; поиск вернул Geotoy (Rust/WASM, https://cprimozic.net/blog/the-tech-behind-geotoy/) как пример стека операций над сеткой. Требует доп. поиска (three.js SubdivisionModifier, three-bvh-csg и др. — из памяти, не проверены).
- Звук в браузере: ZzFX (MIT, ~1 КБ в micro-версии; npm) https://npmjs.com/package/zzfx ; ZzFXM (музыка поверх ZzFX, Keith Clark) https://keithclark.co.uk/articles/zzfxm/ ; SoundBox (bitsnbites, для 4K/8K JS-демо; ранний SoundBox Lite — GPL) https://www.bitsnbites.eu/the-soundbox-synth/ ; Sonant-X (WebAudio; основан на js-sonant под zlib, оригинал Sonant CC-BY-NC-SA 2.5) https://github.com/nicolas-van/sonant-x ; WaveSabre (Logicoma, MIT) — нативный, не браузерный; V2 нативный. Нативные 64k-синты: 64klang https://github.com/w23/64klang .

## 6. Цена подхода
- Память и время: см. §2 — рантайм-память определяется развёрнутыми текстурами (RGBA8/16 бит); оценка «≈300 МБ» неточна и форумная; для телефона это существенно (проверять по лимитам WebGL/вкладки).
- Журнал werkkzeug показывает, что генерация текстур упиралась в RAM: понадобился «Texture Cache» по объёму памяти, in-place операции, «100 МБ лишних данных», утечки в событиях/частицах. history.txt ссылка выше.
- Инструмент: werkkzeug — графический редактор операторов, без него контент не делали; сама игра воспроизводит граф. Исходники werkkzeug3 названы авторами «messy». fr_public README.
- Автоматизированные утверждения, что «медленно, потому что в шейдере» оспорены Гизеном (через поиск, см. §2).
- Для игры, которую пишут кодом: пересборка графа в коде вместо редактора — отдельных источников нет; в fr_public ближе всего OpenKTG (код-ориентированный, без редактора). Webbzeug показал, что операторный стек на canvas 2D быстро упирается в производительность (blur/light).
- Платформенное: Windows+DX9 only, нужна адаптация под WebGL2 (шейдеры `shadercompile`, `_viruz2a.asm` не переносятся).

## 7. Современные продолжатели
- werkkzeug4 / Altona (`altona_wz4`) — «самый полезный» компонент fr_public, полноценный конструктор демо, бинарники работают без правок кода. https://github.com/farbrausch/fr_public . Werkkzeug5/Altona2 — «not yet released» (2014); Kebby/Werkkzeug4 репо https://github.com/kebby/Werkkzeug4 (по результату поиска).
- RauschGenerator 2 (RG2) — для нескольких 64k-интро (dopplerdefekt, einschlag, flybye, welcome_to). fr_public.
- Conspiracy (apEx, KKP analyzer): KKP — анализ размера кода/данных поверх сжатия kkrunchy; релизы universal sequence, When Silence Dims The Stars Above и др. https://conspiracy.hu/about/faq/ , https://conspiracy.itch.io/universal-sequence . Деталей apEx в сессии не получено.
- Logicoma: squishy (упаковщик 64k, «намного тяжелее» движок сжатия, с 2016, обычно лучше kkrunchy по размеру, но медленнее), WaveSabre (MIT), Engage (2018, лучшее high-end 64k). https://vivianvoss.net/blog/bytes-of-art-logicoma-engage , https://64k-scene.github.io/resources.html
- Ctrl-Alt-Test: Shader Minifier (минификация GLSL/HLSL) https://github.com/laurentlb/shader-minifier ; «15 Years of Shader Minification» (2025) https://www.ctrl-alt-test.fr/2025/15-years-of-shader-minification ; «A dive into the making of Immersion» (64k, SDF + raymarching) https://www.ctrl-alt-test.fr/2018/a-dive-into-the-making-of-immersion
- Отличие от 2004 по источникам: рейцмаршинг по SDF в шейдере для 64k (Ctrl-Alt-Test), разделение кода и данных при упаковке (Conspiracy), тяжёлый упаковщик squishy, минификаторы шейдеров. Подробности «шейдерная генерация текстур/сеток» — частично из памяти, требует доп. проверки.
- Браузерные 64k/4k: 0mix (0b5vr, Revision 2023, WebGL, исходники открыты) https://vivianvoss.net/blog/bytes-of-art-0mix ; RE: SIMULATED (gam0022, Revision 2020, 1-е место PC 64K, WebGL) https://github.com/gam0022/resimulated ; chromatiq (WebGL-движок для 64K) https://github.com/gam0022/chromatiq ; Until (FMS_Cat, TDF 2018, 64 КБ WebGL HTML) https://github.com/FMS-Cat/until/ ; Incendium (Revision 2025, 4K на WebGPU, графика и музыка) https://github.com/Bercon/incendium ; elusive (Deadline 2023, JS+WebGPU) https://github.com/mgnauck/elusive .
- Про Cluster/Leviathan: поиск пакера «Cluster» не подтвердил (поиск ничего не нашёл).

## Что переносимо технически
- Граф операторов, разворачиваемый при запуске по сиду (Record-подход из concept.txt): в браузере: да — это просто код на TS; цена — время старта и память (см. §6).
- Текстурные операторы Perlin/Cell/Wavelet/Blur/Distort/Normals/Bump/Light/Bricks (набор из `genbitmap.hpp`): в браузере: да — на CPU (TypedArray) или GLSL; Webbzeug показал, что canvas-2D медленный для blur/light, шейдеры быстрее.
- 16-бит на канал при цепочках операторов: с оговорками — в WebGL2 есть RGBA16F/Float через расширения; на мобильных зависит от устройства.
- OpenKTG как эталон набора операторов: да — авторы сами предлагают порт на JS/шейдеры; код BSD/PD по проекту.
- Карты нормалей из высот и попиксельный свет: да — стандартный WebGL2.
- Теневые объёмы/shadow volumes и порталы: с оговорками — возможно, но на WebGL2 чаще используют shadow maps; в kkrieger точная схема не подтверждена.
- Сетки из операторов (Cube/Extrude/Subdivide/Bevel/Bend/Displace, выделения): да — чистая геометрия на TS (half-edge в мешах Farbrausch, через пост Pouet).
- Упаковка exe (kkrunchy, squishy, Crinkler): нет — это для нативных PE-файлов; в вебе аналоги — gzip/brotli, минификаторы JS и Shader Minifier.
- Lekktor (вырезание неиспользуемого кода): с оговорками — в вебе роль играют tree-shaking бандлера и минификация.
- Софт-синтезатор V2/WaveSabre: нет как есть (нативный x86); с оговорками — синтез в AudioWorklet/WebAudio по образцу ZzFX/Sonant-X/SoundBox.
- Генерация на лету в шейдере (SDF/рейцмаршинг, как у современных 64k): с оговорками — в WebGL2 работает, но тяжёло для слабых телефонов; пригодно для эффектов, а не для карты уровня.
- Авторский графический редактор графа (werkkzeug): с оговорками — в вебе существуют Webbzeug (мёртв), Graph.ical; для игры «кодом» не обязателен.

## Источники
- https://github.com/jaromil/kkrieger-werkkzeug3
- https://raw.githubusercontent.com/jaromil/kkrieger-werkkzeug3/master/README.MD
- https://github.com/jaromil/kkrieger-werkkzeug3/commits/master
- https://github.com/jaromil/kkrieger-werkkzeug3/tree/master/werkkzeug3_kkrieger
- https://github.com/farbrausch/fr_public
- https://raw.githubusercontent.com/farbrausch/fr_public/master/README.md
- https://github.com/tul/fr_public
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/LICENSE.txt
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/concept.txt
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/history.txt
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genbitmap.hpp
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genmesh.hpp
- https://raw.githubusercontent.com/farbrausch/fr_public/master/werkkzeug3_kkrieger/genmaterial.hpp
- https://raw.githubusercontent.com/farbrausch/fr_public/master/ktg/README.md
- https://ru.ruwiki.ru/wiki/.werkkzeug
- https://glslhacker.geeks3d.com/?p=8264
- https://en.wikipedia.org/wiki/.kkrieger
- https://fgiesen.wordpress.com/2012/02/13/debris-opening-the-box/
- https://fgiesen.wordpress.com/2012/04/08/metaprogramming-for-madmen/
- https://news.ycombinator.com/item?id=14409457
- https://mastodon.gamedev.place/@rygorous/113919421632985069
- https://www.gamedeveloper.com/design/interview-frugal-fragging-with-i-kkrieger-i-
- https://hugi.scene.org/online/hugi33/hugi%2033%20-%20demoscene%20interviews%20magic%20debris%20-%20fiver2%20in%20focus.htm
- https://www.linuxreviews.org/Fr-041:_d_e_b_r_i_s
- https://www.shamusyoung.com/twentysidedtale?p=537
- https://www.allegro.cc/forums/thread/586453/0
- https://www.guinnessworldrecords.com/world-records/421923-fewest-bytes-for-a-first-person-shooter-fps-videogame
- https://gigazine.net/gsc_news/en/20230905-kkrieger-96kb-fps
- https://64k-scene.github.io/resources.html
- https://conspiracy.hu/about/faq/
- https://www.kvraudio.com/news/farbrausch_v2_synthesizer_system_released_2794
- https://github.com/9elements/webbzeug
- https://9elements.com/blog/webbzeug-procedural-texture-editor-for-your-browser/
- https://github.com/mrdoob/texgen.js
- https://tonym128.github.io/texgen
- https://github.com/schalkt/tgen , https://github.com/jdiemke/es6-texgen-lib , https://github.com/MagnusThor/demolishedTexture , https://github.com/boytchev/tsl-textures , https://github.com/SamiPerttu/funutd
- https://github.com/nn6n/material-maker , http://neotextureedit.sourceforge.net/ , https://kchapelier.itch.io/graphical
- https://www.bitsnbites.eu/the-soundbox-synth/ , https://npmjs.com/package/zzfx , https://keithclark.co.uk/articles/zzfxm/ , https://github.com/nicolas-van/sonant-x , https://github.com/w23/64klang
- https://experiments.withgoogle.com/cub , https://phoboslab.org/log/2021/09/q1k3-making-of , https://engineered.at/articles/yet-another-doom-clone-in-13kb-of-javascript , https://blog.kodewerx.org/2015/09/
- https://github.com/laurentlb/shader-minifier , https://www.ctrl-alt-test.fr/2025/15-years-of-shader-minification , https://www.ctrl-alt-test.fr/2018/a-dive-into-the-making-of-immersion
- https://vivianvoss.net/blog/bytes-of-art-logicoma-engage , https://vivianvoss.net/blog/bytes-of-art-0mix
- https://github.com/gam0022/resimulated , https://github.com/gam0022/chromatiq , https://github.com/FMS-Cat/until/ , https://github.com/Bercon/incendium , https://github.com/mgnauck/elusive
- https://github.com/kebby/Werkkzeug4 , https://cprimozic.net/blog/the-tech-behind-geotoy/
