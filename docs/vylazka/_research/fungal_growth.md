# Рост грибов и мицелия внутри воспоминаний: сводка исследования

Дата: 2026-11-15. Метод: только поисковая выдача (WebFetch не использовался). Ни одной страницы целиком не открывал; всё, что ниже, взято из сниппетов и пересказов поиска. Оценки «строк кода», «цена» и «детерминизм» — мои инженерные оценки, не из источников (помечены «оценка»). Лицензии в большинстве случаев НЕ подтверждены — «требует проверки».

## Сводка

1. Для облака точек с нормалями проще всего рост по графу k ближайших соседей (kNN), посчитанному один раз при загрузке уровня. Рост — это волна по графу: у узла есть «время прихода», игра показывает узлы, у которых время <= текущего. Это оценка, готовых примеров именно «рост по облаку точек» поиск не нашёл.
2. Space colonization (Runions и др., 2007) — самый подходящий алгоритм для нитей мицелия/корней. Первоисточник открыт на algorithmicbotany.org. Есть открытые JS-реализации (npm space-colonization, MIT — по выдаче).
3. Physarum (Jeff Jones, 2010) даёт сети нитей «как мицелий» и хорошо ложится на GPU, но это поле в текстуре, а не геометрия на 3D-поверхности; на слабом телефоне источники показывают сокращение числа агентов (256k вместо 1M в одном проекте).
4. Модель neighbour-sensing (Meškauskas, Fricker, Moore, 2004) — единственная из найденных, которая в статье имитирует и плодовые тела, и шнуры; но она тяжелее и сложнее для реализации. Бумаги лежат на davidmoore.org.uk.
5. Плодовые тела: классика — тело вращения по силуэту (ножка, пластинки, шляпка), статья Galin и др. 2004 (PDF на perso.liris.cnrs.fr); в three.js это LatheGeometry (моё предположение, не подтверждено туториалом). Готового туториала «гриб в three.js через Lathe» поиск не дал.
6. Предрасчёт по сиду + «возраст узла» + показ доли узлов по времени — самый дешёвый по CPU/GPU вариант и полностью детерминирован; тяжёлая симуляция на телефоне не нужна. Это оценка.
7. Референсы, подтверждённые поиском: Hyphae (Nervous System; space colonization), Differential Line/Mesh и собственный Hyphae (Anders Hoff), Floraform (Nervous System), Mushroom 11 (Untame, 2015, рост клеток как механика), Physarum (Jones; Sage Jenson; Polyphorm/PolyPhy).
8. Лицензии: Hoff — лицензию репозиториев поиск не показал; PolyPhy — не показал; Jason Webb space colonization — «other» (проверять). Алгоритмы как идеи в источниках не отмечены как запатентованные, но патентный поиск я не делал — «требует проверки».
9. Узнаваемые образы для осторожности: стиль «Аннигиляции» уже заявлен в замысле; отдельно поиском я его не проверял. Cordyceps-образ (The Last of Us) и гриб-организм Mushroom 11 — в поиске не проверялись как «чужой образ»; это только список кандидатов на проверку.

---

## 1. Алгоритмы роста

Оценки строк — для простой реализации на TS, моя оценка. Цена: N — число узлов/агентов.

| Алгоритм | Вид | Цена | Детерминизм (оценка) | Строк (оценка) | Первоисточник | Открытая реализация (лицензия) |
|---|---|---|---|---|---|---|
| Space colonization | ветвящиеся нити, корни, «жилки» | на шаг: для каждой точки-аттрактора ближайший узел; со сеткой — ~O(A) | да при целочисленном ГСЧ и фикс. порядке | 80–150 | Runions, Lane, Prusinkiewicz 2007: algorithmicbotany.org/papers/colonization.egwnp2007.html | npm space-colonization (nicknikolov, MIT по выдаче; без three.js, на regl); jasonwebb/2d-space-colonization-experiments (лицензия «other» — проверить) |
| DLA / Eden | DLA: кораллы, дендриты; Eden: компактные пятна | DLA дорог (случайные блуждания); Eden дёшев (выбор случайной граничной клетки) | да при своём ГСЧ | DLA 40–80; Eden 20–40 | Witten, Sander 1981, PRL 47, 1400: ifisc.uib-csic.es/~tomas/MFCS/EdenDLA/PhysRevLett.47.1400.pdf; Eden 1961, Proc. 4th Berkeley Symp. (ссылка на сам текст не найдена) | в поиске готовой JS-реализации с лицензией не найдено |
| L-системы | регулярные ветвления, фракталы | дёшево (раскрытие строки) | да | 60–120 | Prusinkiewicz, Lindenmayer, The Algorithmic Beauty of Plants: algorithmicbotany.org/papers/abop/abop.pdf | не искал отдельно |
| Differential growth (line/mesh) | складчатые, «кораллово-лишайниковые» кромки, кружево | O(N) с сеткой для отталкивания; требует вставки узлов | да при фикс. порядке | 120–250 | Hoff (inconvergent): inconvergent.net/generative/differential-mesh; Nervous System, Floraform | github.com/inconvergent/differential-line (лицензия не подтверждена); inca/blender-differential-growth (Blender License, по выдаче) |
| Reaction–diffusion (Gray–Scott) | пятна, лабиринты, «лишайник» в текстуре | N клеток × шаги; на GPU — один проход на шаг | да при одинаковых float на GPU?? — на разных GPU возможны расхождения (оценка, проверять) | 40–70 (шейдер) | Karl Sims, RD-Tool: karlsims.com/rdtool-help.html (сама статья Gray–Scott 1984 мной не искалась) | robinhouston gist (ed597847175cf692ecce), piellardj/reaction-diffusion-webgl, PedroRavaglia/Reaction-Diffusion (WebGL2) — лицензии не подтверждены |
| Клеточные автоматы роста | пятна, плесень, рост «по клеткам» | дёшево, O(N) по клеткам | да | 20–60 | Eden 1961 и Witten–Sander (см. выше); отдельный «CA гриба» не искал; в выдаче есть CA-модель Rhizoctonia solani 2008 (автор не назван) | нет |
| Модели гиф: кончик + ветвление + слияние | нити, сети, шнуры, плодовые тела | O(число кончиков × соседи) | да при свой ГСЧ | 150–300 | Meškauskas, Fricker, Moore 2004, Mycol. Res.: cambridge.org/core/journals/mycological-research/article/simulating-colonial-growth-of-fungi-with-the-neighboursensing-model-of-hyphal-growth/2B917C7CB7B9930D34F44A54D7624BD5; математика модели: davidmoore.org.uk/CyberWEB/Cyber03.htm; Fricker, Boddy, Bebber 2007 «Network Organisation of Mycelial Fungi» | исходники не найдены; CyberWEB — исследовательский сайт, не игра; MycoRust (github ezeoleaf/mycorust, Rust, лицензия не проверена) |
| Physarum (Jones) | сети нитей, транспортные сети | N агентов × 3 сенсора на пиксель текстуры; на GPU миллионы | на GPU зависит от порядка записи — слабый детерминизм (оценка) | 60–120 (шейдеры) | Jones 2010, Artificial Life 16(2): DOI 10.1162/artl.2010.16.2.16202 (uwe-repository.worktribe.com/output/980579) | Amanda Ghassaei, gpu-io physarum; brandosha/physarum; Bleuje/interactive-physarum; maximilianklein «Fast Physarum Simulation in the Browser with WebGL2» — лицензии не подтверждены |
| Случайные блуждания и рост по графу kNN | нити по поверхности точек | O(N·k) построение графа один раз; рост O(число активных) | да | 40–100 | отдельного первоисточника нет — это приём; ближайшая теория: DLA/Eden на графе (оценка) | нет |

Замечания и расхождения:
- Про neighbour-sensing: Wikipedia и Cambridge-аннотация сходятся — вектор роста кончика считается по окружающему мицелию, модель имитировала плодовые тела; номера страниц у разных источников расходятся — «требует проверки».
- Про Hyphae: источники расходятся в происхождении. Nervous System: Hyphae — space colonization (Bridges 2024 по выдаче); Hoff пишет, что его «Hyphae» делал, пытаясь воспроизвести Hyphae от Nervous System. То есть это два разных проекта с одним именем.
- Detеrminизм GPU-вариантов (Gray–Scott, Physarum) — моя оценка: числа с плавающей точкой в шейдерах на разных устройствах могут давать разное. Для «детерминизма по сиду» это риск; лучше предрасчёт на CPU целочисленно.

## 2. Рост по поверхности трёхмерной сцены

Источников, где именно «рост по облаку точек» описан, поиск не нашёл. Ниже — варианты и мои оценки.

- Сетка треугольников: нужны меши; у нас мир — облако точек и AABB-коробки, треугольников нет — для нашей игры не подходит без доп. работы (оценка).
- Точки-сэмплы + граф kNN: граф считается один раз по пространственной сетке (клетки 3 м уже есть); рост = обход графа с задержками по рёбрам (Dijkstra/BFS с весами «длина ребра / скорость»). Нормали точек позволяют отсекать рёбра между разными стенами (угол между нормалями). Самый дешёвый и совпадающий с тем, как мир уже хранится (оценка).
- Текстурное пространство (reaction–diffusion, Physarum в UV): нужны UV; у облака точек их нет, но у каждой коробки (стена, пол) можно завести плоскую текстуру-поле (оценка). Примеры 2D RD и Physarum на WebGL2 есть (Ghassaei, piellardj).
- Воксельная сетка: space colonization и Eden естественно делать в 3D-решётке; цена памяти растёт кубом; для клеток 3 м и мелких вокселей — много (оценка).

## 3. Плодовые тела

- Galin и др., 2004 («2004-mushroom.pdf», perso.liris.cnrs.fr/egalin/Articles/2004-mushroom.pdf): поверхность вращением силуэта; силуэт делится на три части — ножка, пластинки, шляпка. Силуэт можно рисовать в сплайн-редакторе или брать с фото. Страницу открыть не удалось, пересказ из поиска.
- arXiv 2306.09310 («Infinite Photorealistic Worlds using Procedural Generation», Infinigen): грибы по родам Agaricus и Phallus; шляпка — звёздчатая сетка, протягиваемая по оси Z; звёздчатая сетка даёт складки шляпки и пластинки под ней. Из сниппета.
- HackerNoon, «How to draw generative NFT mushrooms with three.js» (sia.hackernoon.com/how-to-draw-generative-nft-mushrooms-with-threejs): ножка — замкнутый контур, выдавленный по CatmullRomCurve3; в сниппете упомянуты чешуйки на ножке.
- Gamasutra «Modelling by Numbers» часть 2b — упоминает грибы (шляпка и ножка), но метод я не подтвердил.
- Моё предложение (не подтверждено): профиль-кривая шляпки и ножки по сиду -> LatheGeometry, вариации — радиус, наклон, число складок; гроздья — разброс по графу kNN и по нормали.
- Нейросенсинг (Meškauskas и др.) в статье даёт «формы, похожие на плодовые тела» — как альтернативу, но дорого.

## 4. Референсы

Подтверждено поиском:
- Hyphae, Nervous System: space colonization, лампы/скульптуры (Bridges 2024, archive.bridgesmathart.org/2024/bridges2024-2.pdf; Vimeo «Hyphae - growth of the Rhizome cuff»).
- Floraform, Nervous System: дифференциальный рост поверхностей; три типа роста, среди них tip splitting (n-e-r-v-o-u-s.com/blog/?cat=267).
- Anders Hoff (inconvergent): Differential Line, Differential Mesh (начат, чтобы имитировать лишайник), Hyphae (inconvergent.net/generative). Страница inconvergent.net/2016/shepherding-random-growth есть в выдаче, содержание не читал.
- Sage Jenson и Physarum: статья xCoAx 2020 (2020.xcoax.org/pdf/xCoAx2020-Jenson.pdf); развитие модели Jones: параметры сенсоров зависят от считываемого значения, убрано ограничение «один агент на пиксель».
- Elek и др., Monte Carlo Physarum Machine / Polyphorm (arXiv 2009.02441) и PolyPhy (github.com/PolyPhyHub/PolyPhy) — вероятностное обобщение модели Jones на облаках точек (космическая паутина).
- Mushroom 11 (Untame, 2015, Global Game Jam 2012): игрок стирает клетки организма, он отращивает новые в нужную сторону — рост как механика.
- Mycelio (itch.io, Godot Wild Jam 85) — рост мицелия кликом; MycoRust — симуляция гиф с избеганием и сигналами (Rust).
- Демо WebGL: Amanda Ghassaei «Physarum Transport Network» (apps.amandaghassaei.com/gpu-io/examples/physarum/); piellardj reaction-diffusion-webgl; maximilianklein physarum (WebGL2).
- Другое: Adrian Ton «differential growth» (adrianton3.github.io/blog/art/differential-growth/differential-growth) — в выдаче есть, содержание не проверял.

Поиск не нашёл (не утверждаю, что нет): WebGL-демо роста мицелия по облаку точек; игры, где мицелий растёт по 3D-стенам от первого лица.

## 5. Бюджет реального времени

Числа из источников (все — самоотчёты хобби-проектов, без замеров телефонов):
- WebGL2 Physarum: 1M+ частиц (в README без устройства); «1M агентов на MacBook Pro 2019» (brandosha/physarum). Один проект: 1024x1024 агентов на десктопе, 512x512 (256k) на мобильных — без FPS (maximilianklein).
- WebGPU Physarum (schmelczer.dev): стартует с 1M, снижает на 200k в секунду при сглаженном FPS ниже 54, минимум 50 000 — полезный приём адаптивного числа агентов.
- Transform feedback (WebGL2) держит состояние частиц на GPU; «тысячи частиц на 60 FPS» из блога без устройства.
- Замеров для слабых телефонов с узлами графа/space colonization в выдаче нет. Что я нашёл — только оценки: CPU-рост на несколько тысяч узлов раз в несколько кадров должен быть дёшев; предрасчёт при загрузке — дешевле; GPU-поле — для текстур, не для узлов (всё это оценки, требуют измерения на целевых устройствах).

Три варианта:
- A. CPU раз в N кадров: узлы 1–5 тысяч (оценка); цена — GC и разброс кадра.
- B. Предрасчёт по сиду + возраст узла: при входе в воспоминание считается всё; во время игры только сравнение возраста с временем в шейдере (uniform + атрибут). Цена в кадре практически нулевая; цена при загрузке зависит от N (оценка).
- C. GPU (Physarum/Gray–Scott в текстуре на стенах): миллионы агентов на десктопе по сообщениям; на телефоне — урезать; детерминизм слабый.

## 6. Риски

- Лицензии: у большинства найденных открытых реализаций лицензия в выдаче не указана. Известно по выдаче: nicknikolov/space-colonization — MIT; EZ-Tree (dgreenheck) — MIT (не space colonization, а деревья на three.js); jasonwebb 2D space colonization — «other»; inca/blender-differential-growth — Blender License (аддон). Для inconvergent и PolyPhy — не найдено, проверять в репозиториях. Сами алгоритмы — идеи из статей; свой код с нуля снимает вопрос лицензий кода, но не обязывает отдельно проверять условия статей — «требует проверки».
- Патенты: в выдаче упоминаний патентов на эти алгоритмы не встретилось; патентный поиск не делался — «требует проверки».
- Чужие образы: Hyphae и Floraform (Nervous System) — узнаваемый стиль студии; в выдаче замечено, что работы Hoff основаны на их идеях. Стиль «Аннигиляции» и Cordyceps — в поиске не исследовался. Решение — за владельцем.
- Технический риск: слабый детерминизм GPU-симуляций; для сида лучше целочисленный CPU-предрасчёт.

---

## Что проще всего написать у нас: микродвижки под облако точек

Все три — моя разработка; готовых аналогов под облака точек не нашлось.

### Вариант 1. Волна по графу kNN (самый простой)
```
// при загрузке: для каждой точки i соседи k=6..8 из сетки 3 м; рёбра только если dot(n_i,n_j) > порог
// сид: (rng) выбирает 1..m точек-зародышей (тёмные углы, место касания игрока)
for each seed s: t[s] = 0
priority queue by t:
  pop i; for j in nbr(i): w = dist(i,j) / v * (0.7 + 0.6*rng(i,j))   // rng детерминирован от (сид,i,j)
    if t[i]+w < t[j]: t[j] = t[i]+w; push j
// атрибут age[i] = t[i] -> шейдер: растёт, если (time - age) > 0; размер/цвет по (time-age)
```
Цена: ~40–80 строк. Построение графа и Dijkstra один раз при загрузке (оценка: десятки тысяч точек — единицы-десятки мс на нормальном CPU; на телефоне надо измерять). Даёт пятна, потёки, «налёт»; нитей нет.

### Вариант 2. Space colonization по поверхности + предрасчёт возраста
```
attractors = подвыборка точек облака в тёмных местах (по сиду)
nodes = [зародыши]; loop до maxN:
  для каждого аттрактора a: n = ближайший узел в радиусе R (сетка), если нет — пропуск
  для каждого узла с аттракторами: dir = сумма нормализованных (a-n) -> проекция на плоскость поверхности (по нормали ближайшей точки), шаг D
  новый узел = n.pos + dir*D, parent = n, age = n.age + D/speed; удалить аттракторы ближе kill
рёбра узел-родитель -> линии/толстые точки; в шейдере показ по age
```
Цена: ~100–150 строк; расчёт один раз; в кадре только uniform времени. Даёт ветвящиеся нити мицелия/корни. Проекция на поверхность по нормали — моё дополнение, не из статьи.

### Вариант 3. Реакция–диффузия или Physarum на текстуре плоских стен
```
для каждой коробки-стены: поле 128x128 (Float16/RGBA8)
шаг (шейдер): A' = A + (Da*lap(A) - A*B*B + f*(1-A)) ; B' = B + (Db*lap(B) + A*B*B - (k+f)*B)
раз в 2–4 кадра; семя — несколько клеток по сиду; результат -> альфа/плотность на точках стены через UV
```
Цена: ~50 строк шейдера + управление текстурами, GPU-память растёт с числом стен; детерминизм GPU слабый (оценка). Параметры из выдачи: F=0.0545, K=0.062, Da=0.2, Db=0.1 (gist Робина Хьюстона).

Плодовые тела отдельно: профиль (ножка + шляпка) -> LatheGeometry с сидом; ставятся в точках, где age[i] прошёл порог; разброс по нормали (оценка; метод описан Galin и др. 2004).

---

## Источники

Страницы целиком мной не открывались; все сведения — из поисковой выдачи (сниппеты).

- https://algorithmicbotany.org/papers/colonization.egwnp2007.html — выдача
- https://www.algorithmicbotany.org/papers/venation.sig2005.html — выдача
- https://algorithmicbotany.org/papers/abop/abop.pdf — выдача
- https://uwe-repository.worktribe.com/output/980579 — выдача (Jones 2010)
- https://arxiv.org/pdf/2204.01256.pdf — выдача (MCPM)
- https://arxiv.org/pdf/2009.02441 — выдача (Polyphorm)
- https://www.github.com/PolyPhyHub/PolyPhy — выдача
- https://en.wikipedia.org/wiki/Neighbour-sensing_model — выдача
- https://www.cambridge.org/core/journals/mycological-research/article/simulating-colonial-growth-of-fungi-with-the-neighboursensing-model-of-hyphal-growth/2B917C7CB7B9930D34F44A54D7624BD5 — выдача
- https://davidmoore.org.uk/CyberWEB/Cyber03.htm — выдача
- https://researchgate.net/profile/Daniel-Bebber/publication/226743773_Network_Organisation_of_Mycelial_Fungi/links/02bfe510b7efb49ec1000000/Network-Organisation-of-Mycelial-Fungi.pdf — выдача
- https://inconvergent.net/generative — выдача
- https://inconvergent.net/generative/differential-mesh — выдача
- https://inconvergent.net/2016/shepherding-random-growth — выдача (только заголовок)
- https://uithub.com/inca/blender-differential-growth — выдача
- https://n-e-r-v-o-u-s.com/blog/?cat=267 — выдача (Floraform)
- https://archive.bridgesmathart.org/2024/bridges2024-2.pdf — выдача (Hyphae, Nervous System)
- https://vimeo.com/21373187 — выдача
- https://2020.xcoax.org/pdf/xCoAx2020-Jenson.pdf — выдача
- https://apps.amandaghassaei.com/gpu-io/examples/physarum/ — выдача
- https://www.github.com/brandosha/physarum — выдача
- https://github.com/Bleuje/interactive-physarum — выдача
- https://maximilianklein.github.io/showcase/physarum — выдача
- https://schmelczer.dev/articles/fleeting-garden-webgpu-drawing/ — выдача
- https://gist.github.com/robinhouston/ed597847175cf692ecce — выдача
- https://karlsims.com/rdtool-help.html — выдача
- https://www.github.com/piellardj/reaction-diffusion-webgl — выдача
- https://www.github.com/PedroRavaglia/Reaction-Diffusion — выдача
- https://ifisc.uib-csic.es/~tomas/MFCS/EdenDLA/PhysRevLett.47.1400.pdf — выдача (Witten–Sander)
- https://npmjs.com/package/space-colonization — выдача (MIT по выдаче)
- https://jasonwebb.github.io/2d-space-colonization-experiments — выдача
- https://torstengustafsson.github.io/pages/projects/treegeneration — выдача (three.js, space colonization)
- https://awesome.ecosyste.ms/projects/github.com%2Fdgreenheck%2Fez-tree — выдача (EZ-Tree, MIT по выдаче)
- https://perso.liris.cnrs.fr/egalin/Articles/2004-mushroom.pdf — выдача
- https://arxiv.org/pdf/2306.09310 — выдача (Infinigen)
- https://sia.hackernoon.com/how-to-draw-generative-nft-mushrooms-with-threejs — выдача
- https://gamedeveloper.com/business/modelling-by-numbers-part-two-b — выдача (содержание не проверено)
- https://www.mobygames.com/game/76617/mushroom-11/ — выдача
- https://www.pocketgamer.com/articles/066992/r/ — выдача
- https://narth0287.itch.io/mycelio — выдача
- https://awesome.ecosyste.ms/projects/github.com%2Fezeoleaf%2Fmycorust — выдача
- https://adrianton3.github.io/blog/art/differential-growth/differential-growth — выдача (только заголовок)
