# Мебель «как у IKEA» для Untitled Session: исследование

Дата: 2026-11-14. Решений о праве здесь нет: всё, что касается права, помечено «требует проверки».

**Ограничение метода.** Прямое открытие страниц было заблокировано (`getaddrinfo ENOTFOUND` для ikea.com, kenney.nl, polyhaven.com, extensions.blender.org, needle.tools, digitalproduction.com). Все факты ниже взяты из результатов веб-поиска (выдержки и пересказы поисковика). Дословных цитат с первоисточников почти нет. Кавычки означают текст, как он дан в выдаче поиска. Каждую лицензию нужно сверить на самой странице до использования. Повторных загрузок не делалось.

## 1. Официальные 3D-модели IKEA

- **Публикуемое IKEA.** Модели на страницах товаров, Kreativ и AR-приложение IKEA Place существуют (https://www.ikea.com/us/en/home-design/blog/scan-a-space , https://techcrunch.com/?p=2340297). Отдельного публичного пакета «для разработчиков» или «для планировщиков» с лицензией в выдаче нет. Не найдено: страница IKEA с условиями именно на 3D-модели. Статус: не найдено.
- **Скачивание моделей.** Неофициальные скрипты и дополнения берут GLB прямо с сайта (https://greasyfork.org/en/scripts/490780-ikea-3d-model-downloader , https://github.com/GazButane/IMD , https://80.lv/articles/download-ikea-furniture-as-3d-models-with-this-script). Файл сохраняется как «[Product Name] - [Color].glb». Это обход, а не документированный API (https://www.creativebloq.com/3d/free-ikea-3d-model-downloader-is-a-goldmine-for-interior-design-planning , https://digitalproduction.com/2026/02/09/download-ikea-furniture-as-3d-models-minus-the-trolley/). Описание модели, взятое из Kreativ, как «упрощённых автоматически» — предположение автора статьи (https://bigdragon.neocities.org/posts/gltf2/gltf2).
- **Единственная явная лицензия на модель IKEA, которую удалось найти.** Это тестовый файл `PlaysetLightTest.glb` (Khronos glTF-Sample-Assets). Цитата из выдачи: «The IKEA 3D Model [PlaysetLightTest.glb] (the "Licensed Material") is licensed by Inter IKEA Systems B.V. ("IKEA") under the Creative Commons, Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)». Лицензия, по той же странице, ограничена данными/технологией 3D-моделирования и не включает продукты IKEA, а IKEA сохраняет права на дизайн и IP (https://asset-explorer.needle.tools/PlaysetLightTest). Это один файл, не общая лицензия. Он NC, поэтому для игры на порталах (возможна монетизация) не годится. Не проверено: что в репозитории Khronos лежит именно эта версия файла.
- **Условия сайта IKEA (пересказ поиска, по регионам).** Тексты различаются по странам.
  - AU/NZ: сайт и содержимое принадлежат Inter IKEA Systems B.V., защищены авторским правом, использование только личное, некоммерческое (https://www.ikea.com/au/en/customer-service/terms-condition , https://www.ikea.com/nz/en/customer-service/terms-conditions).
  - NL: информацию можно просматривать для личного некоммерческого использования; любое иное использование, включая воспроизведение и публикацию, требует предварительного письменного согласия IKEA (https://www.ikea.com/nl/en/customer-service/terms-conditions/gebruikersvoorwaarden-pub92fe171d).
  - SG: скачивать материалы можно «for non-commercial, home personal use only», с сохранением уведомлений об авторском праве (https://www.ikea.com/sg/en/customer-service/terms-conditions).
  - IN: нельзя воспроизводить, копировать, продавать и иначе использовать в коммерческих целях без письменного согласия (https://www.ikea.com/in/en/customer-service/terms-conditions/ikea-online-terms-and-conditions-pubdc62f660/).
  - MY: запрещено отключать функции, ограничивающие копирование (https://www.ikea.com/my/en/customer-service/terms-conditions).
  - Страница `ikea.com/us/.../terms-conditions` не открылась. Это пересказ, не цитаты; про 3D-модели ни в одном тексте ничего не найдено.
- **Вывод по фактам.** Из найденного права класть модели IKEA в игру и в открытый репозиторий нет, есть только пересказы ограничений «личное/некоммерческое»: требует проверки (в т. ч. запрос в IKEA).

## 2. Наборы данных и инструменты вокруг IKEA

- **IKEA ASM.** Датасет и бенчмарки по лицензии Creative Commons Attribution-NonCommercial 4.0 International; для коммерческой лицензии — писать авторам; код — MIT (https://ikeaasm.github.io). Это видео и позы, а не 3D-библиотека.
- **IKEA-Manual** (NeurIPS 2022): лицензия на данные в выдаче не найдена (https://cs.stanford.edu/~rcwang/projects/ikea_manual , https://arxiv.org/abs/2302.01881v1). Лицензия arXiv относится только к статье. Требует проверки на странице проекта.
- **3D-FUTURE** (Alibaba): доступ через заявку на Tianchi, «under the 3D-FUTURE Terms of Use» (https://tianchi.aliyun.com/specials/promotion/alibaba-3d-future). hyper.ai указывает лицензию «Other» (https://hyper.ai/datasets/20084). Текст условий не найден. Это не IKEA-модели; в игру без чтения условий не брать.
- **Blender «IKEA Browser»**. Лицензия кода — GPL-3.0 или новее (https://extensions.blender.org/add-ons/ikea-browser/). Он импортирует модели с сайта IKEA (https://blendernation.com/2024/09/20/direct-import-furniture-models-from-ikea-to-blender). GPL относится к коду дополнения, а не к моделям IKEA. Условий на модели не найдено.
- **Платные «Ikea Library Collection» (Superhive/Blender Market)**: https://superhivemarket.com/products/ikea-asset-library/docs . Условия не просмотрены.
- **Sketchfab.** Бесплатные модели в основном под CC (в большинстве — с атрибуцией); у каждой модели свой тип лицензии (https://sketchfab.com/licenses , https://help.sketchfab.com/en/articles/16152221-choosing-your-model-s-license). Про IKEA-модели и жалобы правообладателя в выдаче ничего нет. CGTrader: у одной модели IKEA (ÖRFJÄLL) лицензия editorial-only (https://www.cgtrader.com/free-3d-models/interior/living-room/cute-orfjall-chair-by-ikea).
- **Trimble 3D Warehouse.** Модели под «General Model License»; загрузчик даёт royalty-free лицензию и сохраняет авторство (https://embed-3dwarehouse-classic.sketchup.com/tos/ , https://help.sketchup.com/zh-hant-tw/3d-warehouse/3d-warehouse-terms-use-faq). Форумные ответы о коммерческом использовании противоречат друг другу (https://forums.sketchup.com/t/is-it-illegal-to-use-wall-and-door-models-in-3d-warehouse-as-backdrops-for-my-comic/310452.md). Не найдено: что 3D Warehouse даёт право на чужой бренд/дизайн. Требует проверки. Polantis и BIMobject: условия не найдены.

## 3. Товарные знаки и дизайн

- **Спор IKEA с хоррор-игрой (2022).** IKEA направила требование (cease-and-desist) разработчику хоррора в магазине «STYR» (позже The Store Is Closed). Претензии — к ассоциации с товарными знаками и trade dress, недобросовестной конкуренции и ложной рекламе; студия утверждала, что купила обычные пакеты мебели, и свернула проект (https://www.crowell.com/en/insights/client-alerts/ikea-s-battle-against-horror-games-the-importance-of-intellectual-property-rights , https://todaysgeneralcounsel.com/?p=80557 , https://says.com/my/tech/ikea-cease-and-desist-indie-horror-game-the-store-is-closed). Спор касался имитации магазина и названий, не одной мебели.
- **CJEU, Mio/Konektra (C-580/23 и C-795/23), 4.12.2025.** Прикладное искусство защищается авторским правом на тех же условиях (оригинальность), без повышенной планки; авторское право и дизайн-право не в отношении «правило-исключение» (https://intellectual-property-helpdesk.ec.europa.eu/news-events/news/cjeu-confirms-utilitarian-objects-are-subject-same-originality-requirements-any-other-work-2025-12-05_en , https://www.jonesday.com/en/insights/2025/12/copyright-in-applied-art-cjeu-sets-a-clearer-stricter-test , https://cms.law/en/nld/legal-updates/o-sole-mio-cjeu-s-tune-on-copyright-protection-of-works-of-applied-art). Источники — обзоры юрфирм, не текст решения. Требует проверки.
- **Споры вокруг дизайна самой IKEA:** Emeco v. IKEA (стул 20-06, мировая) (https://grshop.com/blog/knock-off-unlicensed/fakes-in-the-marketplace-emeco-settles-with-ikea-over-copyright-question.html); Mag Instrument v. IKEA (Швеция, фонарь) (https://www.dezeen.com/?p=1016205); e15 в Германии (там же). Это про копирование дизайна IKEA другими или наоборот; про BILLY, KALLAX, POÄNG споров не найдено.
- **Названия (BILLY, KALLAX, POÄNG).** Регистрации знаков и судебной практики в выдаче не найдено; про защиту форм конкретных изделий (промобразцы) — тоже. Статус: не найдено; требует проверки (реестры EUIPO/TMview).
- **Правило безопасности по источникам.** Poly Haven не публикует цифровые копии реальных дизайнов мебели (https://polyhaven.com/contribute). CC0 на модель не снимает права на знак или дизайн реального изделия (комментарий поиска, не источник).

## 4. Очень похожее и свободное

| Набор | Лицензия (по источнику) | Число, формат | Похожесть на IKEA |
|---|---|---|---|
| Kenney Furniture Kit https://kenney.nl/assets/furniture-kit | Creative Commons CC0 | 140 файлов (Kenney); «120 objects» на OpenGameArt https://opengameart.org/content/furniture-kit; OBJ + PNG, Unity-пакет; low poly | Упрощённая мебель: столы, стулья, кровать, книжные шкафы. Полигональность и картинки не просмотрены |
| Quaternius «Furniture Low Poly» https://opengameart.org/content/furniture-low-poly | CC0 (OpenGameArt, 2017) | zip ~2,9 МБ; число не уточнено; low poly | Стол, стул, диван, лампа (по тегам) |
| KayKit Furniture Bits https://kaylousberg.itch.io/furniture-bits | CC0 v1.0 (itch.io, https://godotengine.org/asset-library/asset/2125) | «50+», выдача обрезана; low poly | Мультяшная мебель |
| Poly Haven (модели) https://polyhaven.com/a/wooden_table_02 | CC0 («all our assets are released under the CC0», https://polyhaven.com/faq) | сканы/PBR, тяжелее; число не определено | Не «IKEA»-стиль; нужен выбор по каждой модели |
| ambientCG | «everything available under a universal CC0 license» (выдача) | в основном материалы; 3D-мебели не найдено | Нет |
| Poly Pizza https://poly.pizza | У каждой модели своя: CC0 и CC-BY; «7000+» моделей (https://poly.pizza/docs/press). Пример: Ultimate Interior Props Pack почти весь CC-BY (https://poly.pizza/bundle/Ultimate-Interior-Props-Pack-9KfkK2H0ve) | glTF/GLB | Нужна проверка лицензии каждой модели |
| itch.io, Nemeliss «Furniture lowpoly CC0» https://nemeliss.itch.io/furniture-lowpoly-cc0 | CC0 | 22 предмета: кровати, шкафы, столы, стулья, табуреты | Мультяшный стиль |
| itch.io, Mehrasaur «3D Furniture Pack» https://mehrasaur.itch.io/3d-furnitre-pack | CC0 (по выдаче) | .blend/.obj/.fbx | Не проверено |
| itch.io, SereinArt «Living Room Furniture» https://sereinart.itch.io/living-room-furniture | CC0 v1.0 Universal; «commercial use allowed» | 14 моделей в бесплатной части | Стилизованный уют |

- Реально «стеллаж-сетка», «книжный шкаф», «комод»: Kenney содержит книжные шкафы, остальное — не подтверждено; изображения не просматривались. Ни один набор не проверен по картинкам.
- «Кровать с ящиками», «кресло из гнутой фанеры», «диван-двойка»: подтверждения нет.

## 5. Собрать самим (типовые размеры)

Конструкции из плит и ножек — общие типы мебели, но размеры ниже даны для IKEA-ассортимента из каталога (itemfits, источник сторонний): https://itemfits.com/dimensions/ikea/ikea-kallax , https://itemfits.com/data/catalog/ikea . Чтобы не копировать конкретную модель, берите диапазоны.

- **Стеллаж с квадратными ячейками:** 2x2 — 77 x 39 x 77 см (Ш x Г x В). 5x5 — около 182 см по стороне (itemfits).
- **Книжный шкаф:** 80 x 28 x 202 см (itemfits).
- **Столик на 4 ножках:** 55 x 55 x 45 см (itemfits).
- **Общие эргономические значения** (розничные блоги, значения в дюймах пересчитаны): высота сиденья ~46 см (https://designsbystudioc.com/standard-sizes-custom-diy-furniture-builds-seating/); обеденный стол 71–81 см, источники расходятся (https://www.bassettfurniture.com/standard-furniture-dimensions.html); комод глубиной ~46 см (единичное значение). Кровать 90x200 и глубина книжного шкафа 30 см этими источниками не подтверждены.
- **Каркас кровати, табурет, полка-кронштейн:** надёжных открытых размеров не найдено. Нужен отдельный поиск (ГОСТ, учебные таблицы по эргономике, https://wmfph6.yolasite.com/resources/2%20Ergonomics%20of%20Furniture%20Standard%20Sizes.pdf).

## 6. Генерация 3D (коротко, на основе обзоров, не первоисточников)

- **TRELLIS и TRELLIS.2 (Microsoft):** MIT (https://www.3daistudio.com/state-of-ai-3d-generation-2026). Весы открыты.
- **Hunyuan3D 2.1 (Tencent):** community-лицензия, по обзору исключает ЕС, Великобританию, Южную Корею и требует отдельной лицензии свыше 1 млн MAU; у версии 1.0 лицензия строже (там же). Требует проверки.
- **Meshy:** источники расходятся: бесплатный тариф — CC BY 4.0 или только личное/академическое использование (https://www.3daistudio.com/blog/best-free-ai-3d-model-generators-2026).
- **Tripo:** бесплатно — CC BY 4.0; платные тарифы — коммерческое использование без атрибуции (https://www.tripo3d.ai/blog/commercial-use-ai-3d-models).
- **Rodin:** условия не найдены.
- Качество для мебели и формат в выдаче не оценивались; у обзоров свои оговорки. Генерация «по картинке IKEA» — отдельный риск (производная от защищённого дизайна), требует проверки.

## Таблица вариантов

| Вариант | Лицензия | В открытый репозиторий и в игру (по тексту лицензии) | Что требует проверки |
|---|---|---|---|
| Модели IKEA с сайта/Kreativ (GLB) | Лицензии нет; условия сайта: личное/некоммерческое, иное — с письменного согласия (пересказ) | Нет оснований: нужно согласие | Текст условий на странице, запрос в IKEA |
| IKEA PlaysetLightTest.glb | CC BY-NC-SA 4.0 | Нет (NC; SA) | Не относится к продуктам IKEA |
| IKEA ASM, 3D-FUTURE, IKEA-Manual | CC BY-NC 4.0; Terms of Use; не найдено | Нет / неясно | Всё про исследования, не про игры |
| Blender IKEA Browser | GPL-3.0+ (код) | Сам код да; модели IKEA — нет | Условия на модели |
| Sketchfab / 3D Warehouse / CGTrader | Лицензия каждой модели; General Model License; editorial-only | По лицензии каждой модели; чужой дизайн/знак не снимается | Происхождение модели; условия 3D Warehouse |
| Kenney Furniture Kit | CC0 | Да, по тексту | Подтвердить на kenney.nl; картинки, формат, число |
| Quaternius Furniture Low Poly | CC0 | Да, по тексту | Подтвердить на quaternius.com |
| KayKit Furniture Bits | CC0 | Да, по тексту | Число моделей; формат |
| Poly Haven | CC0 | Да, по тексту | Подбор моделей по стилю |
| Poly Pizza | CC0 / CC-BY по модели | CC0 — да; CC-BY — с атрибуцией | Лицензия каждой модели |
| itch.io (CC0-паки) | CC0 (по листингу) | Да, по тексту | Лицензия на странице; подлинность автора |
| Сборка кодом из плит | Своя | Да | Не копировать конкретную форму/названия; сверка с правами |
| Генерация 3D | По сервису: MIT / community / CC BY / платная | Зависит от тарифа и версии | Актуальные ToS; исходное изображение |

## Список источников

IKEA: https://www.ikea.com/au/en/customer-service/terms-condition ; https://www.ikea.com/nl/en/customer-service/terms-conditions/gebruikersvoorwaarden-pub92fe171d ; https://www.ikea.com/sg/en/customer-service/terms-conditions ; https://www.ikea.com/in/en/customer-service/terms-conditions/ikea-online-terms-and-conditions-pubdc62f660/ ; https://www.ikea.com/my/en/customer-service/terms-conditions ; https://www.ikea.com/us/en/home-design/blog/scan-a-space
Инструменты и датасеты: https://asset-explorer.needle.tools/PlaysetLightTest ; https://extensions.blender.org/add-ons/ikea-browser/ ; https://github.com/GazButane/IMD ; https://greasyfork.org/en/scripts/490780-ikea-3d-model-downloader ; https://80.lv/articles/download-ikea-furniture-as-3d-models-with-this-script ; https://digitalproduction.com/2026/02/09/download-ikea-furniture-as-3d-models-minus-the-trolley/ ; https://ikeaasm.github.io ; https://cs.stanford.edu/~rcwang/projects/ikea_manual ; https://tianchi.aliyun.com/specials/promotion/alibaba-3d-future ; https://hyper.ai/datasets/20084 ; https://sketchfab.com/licenses ; https://embed-3dwarehouse-classic.sketchup.com/tos/
Право: https://www.crowell.com/en/insights/client-alerts/ikea-s-battle-against-horror-games-the-importance-of-intellectual-property-rights ; https://todaysgeneralcounsel.com/?p=80557 ; https://intellectual-property-helpdesk.ec.europa.eu/news-events/news/cjeu-confirms-utilitarian-objects-are-subject-same-originality-requirements-any-other-work-2025-12-05_en ; https://www.jonesday.com/en/insights/2025/12/copyright-in-applied-art-cjeu-sets-a-clearer-stricter-test ; https://grshop.com/blog/knock-off-unlicensed/fakes-in-the-marketplace-emeco-settles-with-ikea-over-copyright-question.html ; https://www.dezeen.com/?p=1016205
Свободные наборы: https://kenney.nl/assets/furniture-kit ; https://opengameart.org/content/furniture-kit ; https://opengameart.org/content/furniture-low-poly ; https://kaylousberg.itch.io/furniture-bits ; https://godotengine.org/asset-library/asset/2125 ; https://polyhaven.com/faq ; https://polyhaven.com/contribute ; https://poly.pizza/docs/press ; https://nemeliss.itch.io/furniture-lowpoly-cc0 ; https://mehrasaur.itch.io/3d-furnitre-pack ; https://sereinart.itch.io/living-room-furniture
Размеры: https://itemfits.com/dimensions/ikea/ikea-kallax ; https://itemfits.com/data/catalog/ikea ; https://www.bassettfurniture.com/standard-furniture-dimensions.html ; https://designsbystudioc.com/standard-sizes-custom-diy-furniture-builds-seating/
Генерация 3D: https://www.3daistudio.com/state-of-ai-3d-generation-2026 ; https://www.3daistudio.com/blog/best-free-ai-3d-model-generators-2026 ; https://www.tripo3d.ai/blog/commercial-use-ai-3d-models
