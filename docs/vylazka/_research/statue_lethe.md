# Поиск скана античной статуи для «красной комнаты забвения» (DEPRIVATIO)

Дата: 2026-11-24. Статус: черновик исследования, всё — «требует проверки при скачивании».

## Важная оговорка о методе

Прямое открытие страниц было заблокировано: хосты `sketchfab.com`, `www.sketchfab.com`, `threedscans.com`, `zenodo.org` не резолвятся из облачной сессии (ошибка `getaddrinfo ENOTFOUND`). Повторных загрузок не делалось. Весь материал ниже взят из результатов веб-поиска (выдержки со страниц). Лицензии, где написано «по выдержке поиска», на самой странице глазами не проверены. Нужную строку «License» перед скачиванием посмотреть вручную. Чтобы я мог открыть страницы, эти домены надо разрешить в сетевых настройках сессии.

## Таблица кандидатов

| # | Фигура | Источник | Страница | Прямая загрузка | Формат | Вес / треугольники | Лицензия (как найдена) | Вход | Оценка |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Kore dressed in chiton and cape (epiblema)**, ок. 530 до н. э., слепок KAS1800 | SMK (Statens Museum for Kunst), Royal Cast Collection; загрузчик — аккаунт SMK на Sketchfab | https://sketchfab.com/3d-models/kore-dressed-in-chiton-and-cape-epiblema-185f351f4d1249749b4c88b0d2c27511 | Кнопка Download на Sketchfab; полное разрешение — smk.dk/3d (по выдержке поиска) | Sketchfab: glTF/GLB, USDZ, исходник; копия на Thingiverse — STL | 288,8 тыс. треугольников, 144,4 тыс. вершин (Sketchfab, по выдержке); уменьшенная копия на STLFinder — около 10 МБ | «CC0 Public Domain» на странице Sketchfab (по выдержке поиска); копия на Thingiverse — «Creative Commons - Public Domain Dedication» (https://3dgo.app/models/thingiverse/1894088, https://www.stlfinder.com/model/kore-dressed-in-chiton-and-cape-epiblema-RoYwsnqY/1652045). SMK просит (не как условие) написать на web@smk.dk, если сделали новую работу | Да, Sketchfab требует вход; копия на Thingiverse и smk.dk/3d — вход, по всей видимости, не нужен (не проверено) | Хорошо: стоящая женская фигура в рост, хитон и накидка-эпиблема, складки читаются по числу полигонов. Минусы: архаичная кора (не классика), нет покрывала на голове, поза прямая и «счастливая» — под тему забвения нужна подача светом и опущенной композицией. Цвет у слепка — гипс |
| 2 | **Demeter of Knidos** (слепок KAS128; оригинал в Британском музее) | Bonn Center for Digital Humanities на Sketchfab, база — слепок из Royal Cast Collection SMK | https://sketchfab.com/3d-models/demeter-of-knidos-7a2865a833c64de18083d5eaa2426065 | Кнопка Download на Sketchfab | glTF/GLB и др. (по общему правилу Sketchfab, не проверено) | 265,3 тыс. треугольников, 132,6 тыс. вершин (по выдержке поиска) | В описании: «the basis of the model is provided by the plaster cast in The Royal Cast collection (Copenhagen, Denmark) under a CC0 license» (по выдержке поиска). Лицензия самой модели в поле License не подтверждена — проверить | Да (Sketchfab) | Тема точная: Деметра — богиня скорби и утраты, голова покрыта покрывалом. Но фигура СИДЯЩАЯ, а нужна стоящая; к постаменту «подойти вплотную» можно, но как стоящую её не поставить. Как запасной вариант или для другой комнаты |
| 3 | **Venus de Milo (Aphrodite of Milos)**, слепок KAS434/1 | SMK на Sketchfab | https://sketchfab.com/3d-models/venus-de-milo-statuestexturingchallenge-smk-2983d92ac4e744f485492580ca7629f2 (есть другая выгрузка: https://www.sketchfab.com/3d-models/venus-de-milo-smk-james-hutchinson-78e0a7ea34e54805a09bb21352c187cb, 24,1 тыс. треугольников) | Download на Sketchfab | glTF/GLB | Исходная выгрузка — высокополигональная; ремикс Hutchinson — 24,1 тыс. | «CC0 Public Domain» (страница статуэтки texturing challenge, по выдержке); ремикс Hutchinson указан как «CC Attribution» — лицензии разных выгрузок отличаются | Да | Слабо по теме: обнажённый торс, драпировка только ниже пояса, руки отсутствуют. Годится как запас, если важна узнаваемость |
| 4 | Скан-архив **Three D Scans** (Oliver Laric): женских драпированных фигур в найденных источниках нет | threedscans.com; зеркало на Hugging Face https://huggingface.co/datasets/alecjacobson/threedscans (134 файла, 5,5 ГБ) | https://threedscans.com | По одному zip на объект (напр. `Siren-1.stl.zip`) | STL/OBJ-архивы, как отдаёт сайт | Высокое разрешение; цифр нет | Формулировки: «all scans can be downloaded for free and used without copyright restrictions», «Laric has said the objects are public domain and he is not claiming any copyright» (3DPrint.com https://3dprint.com/131873/3d-download-museum-pieces/, 3dart.it). Карточка зеркала на HF: на самом сайте текста лицензии нет; зеркало не ставит CC0 и просит указывать «Scan by Oliver Laric, threedscans.com» и музей. **Формальной лицензии нет** — кандидат слабый по пункту 1 | Нет | Не найдено конкретной драпированной женской статуи — каталог надо смотреть руками (Siren из Афин — не то). Точной формулировки с самой страницы получить не удалось |
| 5 | **Statue of matron**, I в. до н. э., Рим, мрамор (Musée du Cinquantenaire, Брюссель), скан Geoffrey Marchal | Sketchfab, MyMiniFactory, Zenodo | https://sketchfab.com/models/1b443b00e2b947d4b8d0aa18c4a7f3bc ; https://www.myminifactory.com/object/3d-print-76066 ; https://zenodo.org/records/10283428 | Sketchfab Download | glTF/GLB | 500 тыс. треугольников, 250 тыс. вершин | **Не подтверждена.** Zenodo помечен «Open» без названия лицензии. Другие модели Marchal на Sketchfab (Hercules pavillon, Hector and Andromache) имеют CC BY-NC-SA — риск, что и эта NC. Репозиторий keijiro/DanishStatues указывает CC BY 4.0 для своих датских статуй (https://github.com/keijiro/DanishStatues), но матрона там не найдена | Да | По позе подходит (римская матрона в драпировке, нос и нижняя часть лица — реставрация), но лицензия под вопросом |
| 6 | **Woman draped and veiled** (Лувр); **Petite Herculanaise** (Лувр); **Marble statue of a female draped in a chiton** (Mougins Museum) | Scan The World / MyMiniFactory | https://www.myminifactory.com/object/3d-print-6718 ; https://www.myminifactory.com/object/3d-print-6356 ; https://www.myminifactory.com/object/3d-print-29109 | Кнопка загрузки на MMF (STL) | STL | Не указано | **Не подтверждена.** Лицензия на Scan the World задаётся для каждого объекта: у части музеев CC0 (SMK, Nationalmuseum), у других CC BY-NC (например Velleda). Про эти три страницы в выдержках поиска лицензии нет | Да (аккаунт MMF) | Темы — именно то, что нужно (драпированная и закутанная женщина, Геракланская женщина), но, вероятнее всего, NC; проверить поле License на каждой странице. Формат STL без текстур |
| 7 | **Statue of a Draped Woman** (Lyon) и **Draped woman** (Бейрут) | Zenodo (копии Scan the World) | https://zenodo.org/records/21646387 ; https://zenodo.org/records/21165056 | — | — | — | CC BY-NC-SA (по выдержке поиска) — **не годится** | — | Исключены по лицензии |
| 8 | **Statue of a woman** (Британский музей) | Sketchfab, British Museum | https://sketchfab.com/3d-models/statue-of-a-woman-7649d69ce8c24e1299809475c19e203f | — | — | — | CC BY-NC-SA — **не годится** | — | Исключена по лицензии |
| 9 | **Woman Statue** (Kai Moisch) | Sketchfab | https://sketchfab.com/3d-models/woman-statue-efd353dcff8a4b8a81cdc6e3c8dec0a7 | «Download Free 3D model» на странице | glTF/GLB | Не указано | «CC Attribution» (по выдержке поиска) | Да | Что за статуя и драпирована ли — неизвестно; полностью проверить вручную. Запасной вариант |
| 10 | **Marble Bust 01** (Poly Haven) | Poly Haven | https://polyhaven.com/a/marble_bust_01 | Прямая загрузка на странице | glTF/Blender/FBX | ок. 17 тыс. треугольников, 0,5 м | CC0 (политика Poly Haven; на странице — по выдержке) | Нет | Только бюст, тег «man» — не годится как центральная фигура |

Другие проверенные по поиску источники, где подходящего не найдено:
- Smithsonian Open Access (3d.si.edu): нашлись лишь слепок «Greek Slave» (CC0, Hiram Powers, XIX в., нагая фигура) и скульптура Джорджа Вашингтона (CC0). Античной драпированной женской статуи в выдержках нет. Один сторонний сайт указывает для «Greek Slave» NC-SA, что расходится с CC0 на странице Смитсоновского музея. Расхождение отмечено.
- Nationalmuseum (Швеция) на MyMiniFactory: CC0, но в найденном списке (Juno with the Infant Hercules, Neapolitan Fisherman, Bacchus, Neptune, Apollo Kitharoidos) нет подходящей драпированной женщины. «The Night» — бронза, нагая фигура с плащом, лицензия фото CC BY-SA.
- Rijksmuseum, The Met Open Access, Europeana, Hugging Face (Objaverse): целенаправленно найти подходящую статую в выдержках не удалось. Zenodo-записи из Objaverse/Sketchfab наследуют лицензию Sketchfab-автора.

## Мой выбор

**№1 — Kore dressed in chiton and cape (SMK, CC0).** Единственный найденный кандидат, где одновременно: стоящая женская фигура в рост, драпировка (хитон и эпиблема), лицензия CC0 на странице и подтверждённая копия в Public Domain на Thingiverse, плотный скан (около 289 тыс. треугольников — после децимации до 20–40 тыс. складки сохранятся). Покрывала на голове нет, но тему забвения можно сделать светом, слепком-«гипсом» в красной комнате и поворотом/наклоном модели.

**№2 — Demeter of Knidos (Bonn CDH на основе слепка SMK).** Покрывало на голове и тема скорби подходят идеально, лицензия в описании — CC0, 265 тыс. треугольников. Но фигура сидящая, и это главный минус; поле License самой модели нужно подтвердить. Если сидящая поза недопустима — запасной вариант внутри ограничений «CC0 + стоящая» отсутствует, тогда нужно либо разрешить доступ к страницам threedscans/Sketchfab для дальнейшего поиска, либо просить у MyMiniFactory/музеев явное подтверждение лицензии на Геракланскую женщину.

## Что неизвестно и что проверить при скачивании

1. Поле License на каждой странице Sketchfab (в выдержках поиска оно видно не везде) и точные значки «CC0»/«CC BY». Для CC BY — записать автора и ссылку в титры игры.
2. Кнопка Download доступна ли без входа (Sketchfab требует аккаунт). У SMK есть прямой путь `smk.dk/3d` — страницу нужно открыть руками и посмотреть форматы и вес.
3. Вес файла glb и число треугольников — у кандидата №1 известно по поиску (288,8 тыс.), у №2 (265,3 тыс.), точные цифры сверить при загрузке. Нужна децимация и baked-карты нормалей под потолок «крупная вещь 40 тыс. треугольников» из правил проекта.
4. Состояние скана: у слепков бывают подставки/стержни, цвет — гипсовый (белый/серый); есть ли в модели текстура, или только вершинный цвет; нет ли дыр под складками и в основании; чёткие ли кисти рук (у архаичной коры одна рука держит складки, другая вытянута).
5. Масштаб и ориентация модели (ось Y, метры/миллиметры), наличие постамента в самой модели.
6. Ограничения «NoAI» на страницах некоторых авторов (Marchal) — проверить поле «Restrictions».
7. threedscans.com: на самом сайте нет текста лицензии; есть только заявления автора. Для кандидатов оттуда нужна запись о решении партнёра (как «без ограничений»). Каталог не просмотрен — можно искать драпированные женские скульптуры вручную.
8. Scan The World / MyMiniFactory (Louvre «Woman draped and veiled», «Petite Herculanaise», Mougins): значение лицензии на каждой странице не видно; часто NC. Подтверждать только при CC0/CC BY.
9. Не проверены напрямую: Hugging Face и Objaverse (модели «classical female statue high poly scan», 399,9 тыс. треугольников — лицензия неизвестна), Poly Haven (полный список), Rijksmuseum, The Met Open Access, Europeana.

Все пункты лицензий — «требует проверки».

## Источники

- https://sketchfab.com/3d-models/kore-dressed-in-chiton-and-cape-epiblema-185f351f4d1249749b4c88b0d2c27511
- https://www.stlfinder.com/model/kore-dressed-in-chiton-and-cape-epiblema-RoYwsnqY/1652045
- https://3dgo.app/models/thingiverse/1894088
- https://sketchfab.com/3d-models/demeter-of-knidos-7a2865a833c64de18083d5eaa2426065
- https://sketchfab.com/3d-models/venus-de-milo-statuestexturingchallenge-smk-2983d92ac4e744f485492580ca7629f2
- https://www.sketchfab.com/3d-models/venus-de-milo-smk-james-hutchinson-78e0a7ea34e54805a09bb21352c187cb
- https://sketchfab.com/smkmuseum/collections/smk2-presents-digital-casts
- https://www.infodocket.com/2016/12/28/national-gallery-of-denmark-releases-digital-casts-of-seven-sculptures-into-public-domain/
- https://blog.smk.dk/ghost-in-the-scan-3d-scans-of-casts-in-the-smks-collections
- https://huggingface.co/datasets/alecjacobson/threedscans
- https://3dprint.com/131873/3d-download-museum-pieces/
- https://www.3dart.it/en/3d-scan-free-download/
- https://github.com/keijiro/DanishStatues
- https://sketchfab.com/models/1b443b00e2b947d4b8d0aa18c4a7f3bc
- https://zenodo.org/records/10283428
- https://www.myminifactory.com/object/3d-print-76066
- https://www.myminifactory.com/object/3d-print-6718
- https://www.myminifactory.com/object/3d-print-6356
- https://www.myminifactory.com/object/3d-print-29109
- https://zenodo.org/records/21646387
- https://zenodo.org/records/21165056
- https://sketchfab.com/3d-models/statue-of-a-woman-7649d69ce8c24e1299809475c19e203f
- https://sketchfab.com/3d-models/woman-statue-efd353dcff8a4b8a81cdc6e3c8dec0a7
- https://polyhaven.com/a/marble_bust_01
- https://3d.si.edu/object/3d/model-greek-slave:8edffe56-c358-4c3a-a61f-019f615ccef0
- https://artsandculture.google.com/story/iwVRoZTqASecVQ (Nationalmuseum, Scan the World)
