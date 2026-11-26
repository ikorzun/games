# Расстановка мебели и вещей в комнатах: выжимка практик (для Untitled Session)

Метод и ограничения. Прямое открытие страниц было заблокировано (book.leveldesignbook.com, unity.com, gamehaunt.com — ошибка DNS «вне разрешённых доменов»); я не повторял загрузки. Всё ниже взято только из поисковых выдач (сниппеты и пересказы поисковика), а не из первоисточников. Пометки: [П] — источник прямой по теме, но я видел только выдержку; [Р] — пересказ/вторичный блог; [?] — источника нет, это моё рассуждение или требует проверки. Первичные тексты (слайды Smith/Worch, Neufert, Totten, Level Design Book) я НЕ читал.

Требует проверки: все числа ниже, особенно приписанные Neufert, — они из сайтов-пересказов, а не из самой книги.

---

## 1. Чтение комнаты с порога

1. Определение: environmental storytelling (Smith & Worch, GDC 2010) — оформление пространства свойствами, которые читаются как осмысленное целое; игрок сам соединяет разрозненные элементы и восстанавливает «что здесь случилось». [Р] https://slidetodoc.com/level-design-workshop-what-happened-here-environmental-storytelling/ ; https://niemanstoryboard.org/?p=695
2. Приёмы из доклада (по пересказу): цепочка событий (chain of events), «эхо» (повторение мотива истории в разных местах), системная форма (из правил игры, не расставленная вручную). [Р] тот же slidetodoc; https://lmcsheffrey.blogspot.com/2012/11/environmental-narrative-online-lecture.html
3. The Level Design Book: environmental storytelling — построить уровень так, чтобы он намекал на прошлое событие; показать то, что происходит сейчас, этим нельзя (только прошлое/статичный бэкграунд). [Р, из выдачи через зеркало] https://book.leveldesignbook.com/process/env-art/storytelling (страницу не открывал)
4. Читаемость: «какую информацию передаёт уровень», причём часть информации непреднамеренна (Blendo). [Р] https://blendogames.com/news/post/2026-06-xx-leveldesign_readability/
5. Проверять читаемость с реальных путей игрока, а не с «идеальной точки». [Р] https://pulsegeek.com/articles/seed-foreshadowing-in-level-layouts/
6. Кластеры реквизита дороги и могут ухудшать читаемость (там же, pulsegeek). Прямых правил «сколько предметов определяют комнату» в найденном нет — [?]. Для кода: одна «якорная» вещь функции комнаты у порога + 2–3 мелких подтверждающих вещи — моя гипотеза, не из источника.
7. Totten, «An Architectural Approach to Level Design» (2-е изд. 2019): есть главы о Lynch (landmarks, paths, nodes, edges, districts) и о «prospect–refuge» (Appleton); самого текста не видел. [Р] https://www.routledge.com/An-Architectural-Approach-to-Level-Design/Totten/p/book/9780815361367 ; https://salford-repository.worktribe.com/OutputFile/1490842

## 2. Ориентиры, weenie, обрамление, ведущие линии

1. Weenie/landmark: заметный объект, который тянет игрока к месту и служит точкой ориентации; термин приписывают Уолту Диснею (история с собакой и сосиской). Должен отличаться от окружения. [Р] https://unity.com/blog/level-design-basics (страницу не открывал; цитата из выдачи) ; общая выдача: https://gamedevacademy.org/guide-players-game-design-tutorial/
2. Lynch (по пересказу): landmark — точка отсчёта, внутрь которой нельзя войти; node — место, где можно находиться и которое служит фокусом; path — канал движения. [Р] https://gamedesignskills.com/game-design/level-design-books/
3. Открытая дверь — «очень эффективный» способ вести за угол; неполный силуэт тянет за угол. [Р] https://sites.google.com/carthage.edu/game-design/lessons/level-design-iii
4. Дверной проём привлекает внимание; проёмы часто ведут в «refuge»-пространство, которое психологически ощущается безопасным. [Р] выдача по запросу (по Totten/Appleton), см. п.1.7.
5. Свет: свет и яркий объект как навигация; оставленный фонарь, следы, открытые двери — подсказки к цели. [Р] https://www.uxpin.com/studio/blog/how-to-use-visual-language-for-intuitive-level-design/
6. Ведущие линии: примеры — трубы вдоль потолка, ряды, смена текстуры пола/стен. [Р] https://gamedeveloper.com/design/guiding-the-player-leading-lines-in-quot-the-vanishing-of-ethan-carter-quot-
   Спор: редактор гайда на tf2maps пишет, что идея «leading lines» «довольно основательно опровергнута» и советовать её не стоит. [Р] https://tf2maps.net/goto/post?id=312992 . Отмечаю расхождение источников.
7. Реквизит-навигатор: следы на снегу по правильному пути, мусор, притягивающий взгляд к проёму. [Р] https://www.strayspark.studio/blog/level-design-fundamentals-blockout-flow ; https://coreydelorenzo.squarespace.com/designblog/tag/Map
8. Для кода (моя гипотеза, [?]): цель в комнате ставить в линию взгляда от входа или рядом с одной яркой/освещённой вещью; в дальнем углу — только с «приманкой» (свет, звук, пятно на полу).

## 3. Поток, проходы, периметр, зоны

1. Прямых источников о «критическом пути» и о том, что мебель «по периметру» выглядит фальшиво, я не нашёл. Помечено [?].
2. Из процедурной литературы: в генераторе интерьеров комнаты ставятся по ранжированным вариантам, избегают неудобной связности (в ванную только через три комнаты). [П] https://colepowered.com/2019/02/ (Shadows of Doubt DevBlog #13). Про мебель у стен против центра там ничего.
3. В академической работе по расстановке мебели у предмета есть родитель, ориентация задаётся относительно него, иначе случайная — то есть группы «вокруг якоря», а не просто вдоль стен. [Р] https://blog.hslu.ch/games/files/2021/11/Manuel_Lampert_Procedural_generation_of_interior_settings.pdf ; направление по правилам интерьерного дизайна (Merrell и др.): https://diglib.eg.org/handle/10.2312/CGF.v28i8pp2068-2078 [Р]
4. Для кода (гипотеза, [?]): сначала резервировать коридор «дверь–дверь» и подход к цели (клетки 3×3 м → полоса не уже 1 м), потом ставить группы; крупное — не вплотную ко всем четырём стенам, а группа в центре клетки с отступом от стены (задним ходом стул/кровать).

## 4. Группы по функции

Единого авторитетного источника не нашёл; ниже — известные интерьерные практики, помеченные по тому, что смог подтвердить.
1. Гостиная: диван лицом к ТВ; журнальный стол перед диваном ~40–45 см. [Р] выдача по Neufert-запросу (coohom/Houzz-сайты, см. раздел 5). Подтверждено только число, но не «правило группы».
2. Спальня: кровать + тумбочка — источника нет [?]; зазоры у кровати см. раздел 5.
3. Кухня: рабочий треугольник холодильник–мойка–плита, сумма сторон ≲ 6,4 м (21 фут); другие источники дают 13–26 фут. [Р] https://blog.designfiles.co/kitchen-dimensions/ ; https://www.houzz.com.sg/ideabooks/109239110 (расхождение отмечено).
4. Переговорная (стол по центру, стулья вокруг): источника нет [?]; для стула — зона отодвигания (раздел 5).
5. Склад/архив: стеллажи рядами, проход между рядами ≥ 36 in (914–915 мм), предпочтительно 42 in (1065–1067 мм); поперечный проход 48 in (1225 мм) [последнее — U.S. Courts Design Guide, проектное, не ADA]. [П] https://www.corada.com/documents/1991ADAStandards/8-5 ; https://regulations.justia.com/states/massachusetts/521-cmr/title-521-cmr-12/section-12-2 ; https://gsacriteria.tpub.com/courts/courts0297.htm
6. Процедурная практика: у каждого типа комнаты свой список мебели и свои правила (школа — парты рядами). [Р] https://www.nullpointer.co.uk/procjam-25-diary-p3-bells-and-whistles.html

## 5. Числа (см. итоговую таблицу). Замечания

- Neufert напрямую не открывал. Сайты, где значения названы «по Neufert/Panero & Zelnik», — вторичные (Studio Matrx и др.); их цифры расходятся с другими (50–55 см против 700–900 мм у кровати). Всё — «ориентир, проверять по книге».
- Отдельно: юридический минимум (пожарные нормы) в найденном не указан.

## 6. Хоррор-специфика

1. Amnesia: главный источник напряжения — прятаться; игрок прячется за мебелью, вжимается в углы; бой сильно ограничен/убран. [Р] https://metagearsolid.org/2017/02/elementary-horror-games/ ; https://intothespine.com/2021/02/19/the-hunter-versus-the-hunted/
2. Resident Evil 7: по анализу, сильнейшие моменты — «вжаться в тень» и «бежать по коридору»; в отличие от Amnesia отношения игрок–враг динамичные. [Р] https://uat4.www.digitaltrends.com/gaming/how-resident-evil-7-made-itself-in-the-model-of-modern-horror-games ; https://intothespine.com/2021/02/19/the-hunter-versus-the-hunted/
3. P.T.: обыденная тесная обстановка (коридор, ванная, радио) — игрок «знает каждый дюйм», поэтому малейшее изменение пугает. Это довод за повторное использование знакомых комнат с мелкими отклонениями. [Р] https://deepwavegame.github.io/news/why-pt-still-haunts-level-designers
4. Планировка как ритм: опасные коридоры между безопасными комнатами — напряжение/разрядка. [Р] https://gamehaunt.com/deconstructing-the-level-design-of-iconic-horror-mansions (в выдаче; страницу не открывал)
5. Темп: вторая половина хорроров часто слабее первой (повтор «прячься/беги/умри»). [Р] https://www.gamedeveloper.com/design/the-back-half-problems-of-horror-design
6. Слепые углы, соотношение открытого и закрытого, лабиринт: количественных правил в найденном нет [?]. Gone Home и Visage по этим вопросам источников не дали. Про Gone Home найдено лишь: расстановкой занимался Steve Gaynor, линейные уровни делались «нелинейными по ощущению» через планировку и декор (GDC 2015 «Level Design in a Day»; содержание не видел). [Р] https://gdcvault.com/play/1022112/Level-Design-in-a-Day ; https://gamedeveloper.com/design/video-making-linear-level-design-feel-non-linear-in-i-gone-home-i-
7. Для кода (гипотеза [?], не из источника): «укрытие» = высокий предмет, оставляющий подход; не загораживать им единственный путь; чередовать плотные и пустые клетки; игроку без врага (исследование) — «слепой угол» работает как неизвестность, а не как мешающая преграда.

## 7. Против повторов в процедурной расстановке

1. Генератору нужно достаточно случайности, чтобы не копировались узнаваемые черты, но не столько, чтобы расстановка перестала быть правдоподобной. [Р] https://ianparberry.com/techreports/LARC-2010-01.pdf (по выдаче); сходно: https://link.springer.com/content/pdf/10.1007/978-3-642-24500-8_57.pdf
2. Повтор — известная проблема PCG из-за самих алгоритмов. [Р] https://ar5iv.arxiv.org/html/1906.05094
3. Рычаг вариации: свой набор вещей и правил на тип комнаты. [Р] https://www.nullpointer.co.uk/procjam-25-diary-p3-bells-and-whistles.html
4. «Рассказ» в каждой комнате: цепочка событий и эхо из Smith/Worch (п.1.2) — ставить 1 «событие» (след, пропажа, сдвинутая вещь) на комнату. [Р] + применение к генератору — гипотеза [?].
5. Асимметрия и «аномалия»: прямого источника нет [?]; логика P.T. (п.6.3) намекает, что одна неправильность в знакомом поверхностно-типовом интерьере работает сильнее, чем полный хаос.

---

## Таблица чисел (проверять по первоисточникам)

| Что | Значение | Источник (тип) |
|---|---|---|
| Комфортный проход, чистая ширина | ≈ 900 мм | studiomatrx.org/students/space-planning-ergonomics/space-standards-and-clearances (Р, вторичный) |
| Доступный проход (инвалидное кресло) | ≈ 1200 мм | studiomatrx.org (там же) (Р) |
| Минимальный проход «боком» одного человека | ≈ 600 мм | studiomatrx.org (Р; в выдаче оговорено, что это не ширина коридора) |
| Сбоку от кровати | 700–900 мм (с приписью Neufert; Panero & Zelnik) | studiomatrx.org (Р); другой источник 50–55 см вокруг двуспальной; третий минимум 60 см (Р) |
| У изножья кровати | ≈ 900 мм | studiomatrx.org (Р) |
| Диван — ТВ | 2–3 ширины экрана; или 2,75 ширины; или 200–300 см (источники расходятся) | houzz.com.sg/ideabooks/109239110 и др. (Р) |
| Диван — журнальный стол | 40–45 см | выдача coohom/Houzz (Р) |
| Стул у стола: отодвинуть | ≈ 900 мм (встать); 1050–1200 мм (чтобы пройти сзади); минимум 750 мм | arcedior.com/blog/chair-clearance-behind-dining-tables; rayon.design/knowledge-base/dining-room/rules (Р) |
| Кухня, «рабочий треугольник» | сумма ≲ 6,4 м (21 фут); диапазон 13–26 фут; сторона 4–9 фут | blog.designfiles.co/kitchen-dimensions (Р) |
| Кухня-«коридор» (проход между рядами) | 1000 мм мин.; 1100–1200 мм; >1300 мм хуже | studiomatrx/designfiles (Р) |
| Проход между стеллажами | 36 in (914–915 мм) мин.; 42 in (1065–1067 мм) предпочт.; поперечный 48 in (1225 мм) | corada.com/documents/1991ADAStandards/8-5; justia 521-cmr 12.2; gsacriteria courts (П/Р) |
| Отступ перед дверью (площадка) | источника не нашёл [?] | — |
| Ширина дверного проёма (игра) | источника не нашёл (Level Design Book metrics-страницу открыть не удалось) [?] | book.leveldesignbook.com/process/blockout/metrics (не прочитано) |

## Что НЕ найдено (не выдумываю)

- Первичные тексты: слайды Smith/Worch, Neufert, Totten, страницы Level Design Book — не читались.
- Количественные правила хоррор-расстановки (слепые углы, ритм плотно/пусто), анти-лабиринт, Visage.
- Отступ перед дверью; ширина дверей; «периметр выглядит фальшиво».
- Gone Home: расстановка вещей по критическому пути (в выдаче только организационные факты).

Совет следующему шагу: разрешить сессии домены book.leveldesignbook.com, unity.com, gamehaunt.com и прочитать их первоисточники; Neufert — по бумажной книге.

## Список источников

- https://www.gdcvault.com/play/1012647 ; https://www.gdcvault.com/play/1012696 (Smith/Worch, страницы GDC Vault; контент не читал)
- https://slidetodoc.com/level-design-workshop-what-happened-here-environmental-storytelling/
- https://niemanstoryboard.org/?p=695
- https://lmcsheffrey.blogspot.com/2012/11/environmental-narrative-online-lecture.html
- https://book.leveldesignbook.com/process/env-art/storytelling (через зеркало в выдаче)
- https://www.routledge.com/An-Architectural-Approach-to-Level-Design/Totten/p/book/9780815361367
- https://salford-repository.worktribe.com/OutputFile/1490842
- https://gamedesignskills.com/game-design/level-design-books/
- https://unity.com/blog/level-design-basics
- https://gamedevacademy.org/guide-players-game-design-tutorial/
- https://gamedeveloper.com/design/guiding-the-player-leading-lines-in-quot-the-vanishing-of-ethan-carter-quot-
- https://tf2maps.net/goto/post?id=312992
- https://sites.google.com/carthage.edu/game-design/lessons/level-design-iii
- https://www.uxpin.com/studio/blog/how-to-use-visual-language-for-intuitive-level-design/
- https://www.strayspark.studio/blog/level-design-fundamentals-blockout-flow
- https://coreydelorenzo.squarespace.com/designblog/tag/Map
- https://blendogames.com/news/post/2026-06-xx-leveldesign_readability/
- https://pulsegeek.com/articles/seed-foreshadowing-in-level-layouts/
- https://colepowered.com/2019/02/
- https://blog.hslu.ch/games/files/2021/11/Manuel_Lampert_Procedural_generation_of_interior_settings.pdf
- https://diglib.eg.org/handle/10.2312/CGF.v28i8pp2068-2078
- https://ianparberry.com/techreports/LARC-2010-01.pdf
- https://link.springer.com/content/pdf/10.1007/978-3-642-24500-8_57.pdf
- https://ar5iv.arxiv.org/html/1906.05094
- https://www.nullpointer.co.uk/procjam-25-diary-p3-bells-and-whistles.html
- https://metagearsolid.org/2017/02/elementary-horror-games/
- https://intothespine.com/2021/02/19/the-hunter-versus-the-hunted/
- https://uat4.www.digitaltrends.com/gaming/how-resident-evil-7-made-itself-in-the-model-of-modern-horror-games
- https://deepwavegame.github.io/news/why-pt-still-haunts-level-designers
- https://gamehaunt.com/deconstructing-the-level-design-of-iconic-horror-mansions
- https://www.gamedeveloper.com/design/the-back-half-problems-of-horror-design
- https://gdcvault.com/play/1022112/Level-Design-in-a-Day
- https://gamedeveloper.com/design/video-making-linear-level-design-feel-non-linear-in-i-gone-home-i-
- https://www.studiomatrx.org/students/space-planning-ergonomics/space-standards-and-clearances
- https://www.houzz.com.sg/ideabooks/109239110
- https://blog.designfiles.co/kitchen-dimensions/
- https://arcedior.com/blog/chair-clearance-behind-dining-tables
- https://www.rayon.design/knowledge-base/dining-room/rules
- https://www.corada.com/documents/1991ADAStandards/8-5
- https://regulations.justia.com/states/massachusetts/521-cmr/title-521-cmr-12/section-12-2
- https://gsacriteria.tpub.com/courts/courts0297.htm
