# Комната-оранжерея: референсы (исследование 19.11)

Назначение: партнёр просит «комнату полностью с цветами, словно оранжерея или теплица». Здесь только ссылки и описания для глаз; картинки не скачивались, в игру ничего не берётся.

## Как читать и что проверено

- Прямое открытие страниц в этой сессии заблокировано (dev.to не резолвится: домен не входит в разрешённые сети). Повторных загрузок не делалось. Всё собрано из выжимок поиска; страницы целиком не читались. Факты помечены «[поиск]»; то, что дописано мной по общим знаниям и не подтверждено, помечено «[память, требует проверки]».
- Лицензии изображений: нигде не видны из выжимок, кроме отдельных оговорок ниже. Считать «все права сохранены» (требует проверки). Брать в игру не будем.
- Слабые места выборки: по настоящим советским и постсоветским теплицам и зимним садам (раздел 1) поиск дал мало прямых фото-материалов; русскоязычные подборки неполные. По кино (раздел 3) конкретных сцен-«теплиц» подтвердить не удалось. По играм (раздел 4) найдены в основном инди-хорроры и один крупный пример (Prey). Эти пробелы честно отмечены, дальше можно добирать отдельным заходом.
- Где источники расходятся, указано.

## Главные выводы для игры (7)

1. **Странность комнаты-оранжереи — в нарушении ожиданий, а не в красоте.** Лучшие примеры (Anna Schuleit «Bloom», Lisa Waud «Flower House», Kusama «Flower Obsession») работают контрастом: цветы там, где их быть не должно (психбольница, брошенный дом, обычная квартира), плюс «последний раз»: место вот-вот исчезнет. Для игры: оранжерея внутри постсоветского интерьера (коридор, вокзал, офис), а не отдельный «сад».
2. **Конструкция узнаётся по нескольким деталям, а не по полной модели:** стальной или белёный каркас, переплёты, стекло с мутной побелкой, конденсат, стеллажи с горшками, бирки с латинскими названиями, шланг, бочка, лейка, термометр. Побелка стекла (известь) — настоящий приём для затенения летом, она даёт рассеянный белёсый свет и смывается дождём пятнами (greenhousegrower, MSU). Это годится под «распад вне луча»: свет приходит сверху пятнами.
3. **Свет и влага — главный материал:** луч фонаря в тумане/влажном воздухе виден как объём; конденсат на стекле и на «объективе» при входе из холодного в тёплое — готовый эффект перехода (вход в комнату = затуманенный кадр, который медленно проясняется). Механика реальна: линза холоднее точки росы.
4. **Живое поведение растений даёт тихую странность без монстров:** цветки поворачиваются вслед за лучом (гелиотропизм), закрываются, когда луч уходит (никтинастия), никнут при долгом отсутствии света, пыльца висит в луче. Всё реагирует на фонарь, то есть на «взгляд героя». Поворот «за светом» у подсолнуха в природе реален только у молодых растений (Atamian 2016) — для игры это можно сознательно «ломать» (цветы смотрят на героя, а не на лампу).
5. **Дёшево выглядит:** одинаковые карточки-цветы одной текстуры рядами, идеальная симметрия, яркая «открыточная» палитра, зелёное «из пикселей» без вариаций (требует проверки по скриншотам; обобщение из претензий к Greenhouse/itch-играм и из правила проекта «без стыков и повторов»). Лечится: 4–6 видов с разбросом размера/наклона/цвета, увядшие и сухие экземпляры, горшки разной степени заброшенности, бирки с названиями.
6. **Техника в браузере дешёвая:** InstancedMesh + шейдерный ветер (вершинный сдвиг по высоте стебля), альфа-карточки для далёкого, схлопывание дальних листьев в вершинном шейдере, группа инстансов на уровень детализации, куллинг по чанкам. Core three.js не делает куллинг и LOD для InstancedMesh — это надо писать руками или брать InstancedMesh2. Для «собрано только там, куда смотрит герой» это естественно: рисуем только инстансы в конусе луча.
7. **Звук как половина комнаты:** у Schuleit по комнатам больницы играла запись звуков больницы; для оранжереи — капли, тик металла (остывающий каркас), насос/бойлер, шелест листьев без ветра, далёкий клапан. (Звуки описывать по правилам проекта: промпты ElevenLabs по-английски.)

---

## 1. Настоящие места

### 1.1. Советские и постсоветские оранжереи, зимние сады (подтверждено слабо)

- **Ботанический институт им. Комарова, Санкт-Петербург** — Большая пальмовая оранжерея высотой 23,5 м; всего 27 оранжерей (22 экспозиционных, 5 служебных) по Britannica; во время войны многие оранжереи разрушены; БИН объявил конкурс на проект капремонта. https://en.wikipedia.org/wiki/Komarov_Botanical_Institute ; https://www.britannica.com/print/article/321543 ; https://binran.ru/en/istoriya-instituta/300-years/istoricheskie-svedeniya/ . Что берём: масштаб «ярусы под куполом», история «ветшание и ремонт» как повод для состояния комнаты (часть стёкол заделана, часть мутная). Конструкцию (стекло, металл) выжимка не описывает — требует проверки по фото.
- **Аптекарский огород МГУ, Москва** — оранжереи: пальмовая, суккулентная, субтропическая, коллекционные; самая старая субтропическая оранжерея на реконструкции, директор говорил, что часть оранжерей пора сносить. https://www.mos.ru/news/item/66535073/ ; https://www.hortus.msu.ru/collaboration ; https://vm.ru/society/618881-glavnyj-po-cvetochkam-aleksej-reteyum-nikogda-ne-oshushal-sebya-nachalnikom/amp . Что берём: «живое, но на грани списания» состояние. Таблички и стеллажи в выжимках не описаны — искать фото отдельно.
- **Санаторий «Металлург», Ижевск (статья об озеленении лечебного корпуса)** — тропические и субтропические растения в холлах; авторы отмечают, что зимой при выключенном свете растения иногда стоят в плохих условиях. Источник: поиск вернул ссылку на PDF https://gbk.kgasu.ru/files/N5-ARDU-5.23.pdf (название и принадлежность по выжимке, не проверены). Что берём: образ «пальма в кадке в холле при выключенном свете» — санаторный зимний сад как нормальная часть быта.
- **Hortus Botanicus (2025): «Комнатные растения в заведениях общепита в Советский период»** — столовые при НИИ и заводах, большие окна позволяли держать растения. https://hb.karelia.ru/article/genpdf_new.php?id=9605 (по выжимке; полный текст не видел, соответствие статьи ссылке требует проверки). Что берём: растения в казённых интерьерах (столовая, холл), а не только в оранжерее.
- **Госсе Д. — книга о домашних оранжереях и зимних садах (МГУ)** — история зимних садов в России около трёх столетий. https://lk.msu.ru/uploads/attachments/attachment_2671_1666599106.pdf (по выжимке). Что берём: справочный материал по видам кадочных растений.
- **Афиша Daily — «От оранжереи до дачи Сталина»: Померанцевая оранжерея в Кузьминках** (разрушающаяся, дореволюционная, усадебная). https://daily.afisha.ru/cities/23813-ot-oranzherei-do-dachi-stalina-samye-krasivye-zabroshennye-zdaniya-moskvy-i-oblasti/ . Что берём: «усадебная» ветвь — арочные окна, лепка, а не только сталь и стекло.

### 1.2. Совхозные и промышленные теплицы

- **Агро XXI (1999): Курский атомный тепличный комбинат (~1983)** — два блока по 6 га, одна теплица 1,5 га; снабжение города Курчатова овощами. https://www.agroxxi.ru/journal/199907/199907008.pdf . Что берём: сам масштаб и «блочность»: бесконечный ряд одинаковых секций, гул, ряды. Это овощи, не цветы, но конструкция та же.
- **booksite.ru — справочная статья о типовых проектах тепличных комбинатов в СССР** (Москва, Ленинград, Симферополь, Кисловодск). https://booksite.ru/fulltext/1/001/008/109/869.htm . Что берём: «типовой проект» = повторяющаяся унифицированная архитектура.
- Капельный полив в советских комбинатах поиском не подтверждён. Шланги, бочки и лейки — [память, требует проверки].

### 1.3. Заброшенные теплицы и оранжереи (урбекс)

- **Messy Nessy Chic — «A compendium of abandoned greenhouses»** — снимки по разным странам (в т.ч. Boyce Thompson Institute, США); мысль фотографа, что брошенная теплица не столько гниёт, сколько растёт. https://messynessychic.com/2015/01/15/a-compendium-of-abandoned-greenhouses . Что берём: «брошенное, но живое»: растения прорастают сквозь стёкла и стеллажи. Лицензия: фото на сайте, по всей видимости, не свободные.
- **zeli.app — «Заброшенные оранжереи: когда природа берёт своё»** (русскоязычная подборка, от викторианских дворцов до коммерческих теплиц). https://zeli.app/ru/story/50414657 . Что берём: образы по-русски; издание-источник не установлено.
- **Pikabu — «Вечерние теплички»** (обсуждение промышленных теплиц; участник замечает, что не все снимки с заброшенными). https://pikabu.ru/story/vechernie_teplichki_7504464/author . Что берём: вечерний свет сквозь ряды теплиц; осторожно с подборками, где «заброшка» на деле действующая.
- **Weburbanist — «Ghostly Floating Farms: Abandoned Rural Buildings of Russia»** (фото Andrew Qzmn) — речь про заброшенные сельские постройки, теплицы выжимкой не подтверждены. https://weburbanist.com/2016/01/01/ghostly-floating-farms-abandoned-rural-buildings-of-russia/ . Что берём: общий постсоветский сельский фон; для теплиц требует проверки.
- **National Geographic — «Apocalypse Paused: Scenes from Soviet-Era Ghost Farms»** (совхоз Sputnik под Петербургом, бывший свинарник). https://news.nationalgeographic.org/apocalypse-paused-scenes-from-soviet-era-ghost-farms/ . Что берём: «совхоз» как среда (бетон, кафель, стенды), не оранжерея.

### 1.4. Побелка, свет, конденсат (практика теплиц)

- **Greenhouse Grower — Keeping Cool With Greenhouse Shading** — побелка (известь в воде или разведённая латексная краска) наносится на внешнюю сторону стекла, рассеивает свет; затенение около 40%; дождь постепенно смывает, поэтому покрытие неравномерное. https://www.greenhousegrower.com/technology/equipment/keeping-cool-with-greenhouse-shading/ . Что берём: пятнистое белёсое стекло, свет без чётких теней.
- **MSU Extension — Greenhouse shading options** — то же, плюс сравнение с затеняющей тканью. https://www.canr.msu.edu/news/greenhouse_shading_options . Что берём: вторая версия затенения — тканевые экраны (провисшая ткань под потолком).
- Запах (земля, мокрый бетон, удобрение, прелая листва), звук (капли, насос, щёлкающий металл), термометр с картонной подложкой, бирки на палочках, ящики из деревянных реек, бочки с отстоявшейся водой — [память, требует проверки], прямых источников в выжимках нет.

---

## 2. Классические стеклянные оранжереи XIX века

- **Palm House, Kew Gardens** (Burton и Turner, 1844–48) — железо и стекло; изогнутые панели зелёного оттенка, дающие тень. Вопрос авторства (Burton vs Turner) спорный; Linda Hall Library оставляет его нерешённым. https://en.wikipedia.org/wiki/Palm_House,_Kew_Gardens ; https://www.lindahall.org/about/news/scientist-of-the-day/decimus-burton/ ; https://apollo-magazine.com/decimus-burton-at-kew-gardens/ . Что берём: изгиб каркаса как силуэт; зеленоватое стекло — зелёный оттенок света.
- **Temperate House, Kew** — строился 1862–1899, больше Palm House вдвое: 4880 м², около 15 000 стёкол, 19 м высоты. https://www.kew.org/node/9986 . Что берём: «15 тысяч одинаковых стёкол» как ритм, который можно ломать выбитыми и мутными.
- **Captured at Kew (фото-описание)** — послеполуденное солнце через стёкла Palm House освещает туман внутри, воздух в жёлтых и синих тонах. https://www.sciencemuseumgroup.org.uk/ (по выжимке; точная страница: https://collection.sciencemuseumgroup.org.uk/objects/co8228738/the-palm-house-kew-gardens-dufaycolor-print — это принт Dufaycolor, не обязательно тот текст; требует проверки). Что берём: свет как объём, жёлтое-синее.
- **Kew image library — Temperate House on a winter morning (мгла)** — https://images.kew.org/architecture/glasshouses/temperate-house-661013.html (права управляются, rights managed). Что берём: холодное утро снаружи, тёплая мгла внутри.
- **Geograph / terragalleria (фото Kew)** — для глаз: https://www.geograph.org.uk/photo/3847644 ; https://www.terragalleria.com/black-white/europe/london/kew-gardens/ (лицензии: Geograph обычно CC BY-SA, terragalleria — авторские; требует проверки). Что берём: чёрно-белые виды каркаса (форма без цвета).
- **Grace's Guide — Palm House, Kew** (технические сведения, документы XIX в.). https://gracesguide.co.uk/Palm_House,_Kew_Gardens . Что берём: сведения о конструкции.
- **John Desmond blog — Great glasshouses from Victorian times to the present day** — обзор. https://www.johndesmond.com/blog/design/great-glasshouses-from-victorian-times-to-the-present-day . Что берём: список других больших оранжерей для поиска образов.
- Про Хрустальный дворец (Paxton, 1851) поиск ничего не вернул; [память, требует проверки].

---

## 3. Комнаты и здания, заполненные цветами

### 3.1. Инсталляции

- **Anna Schuleit, «Bloom» (2003)** — Massachusetts Mental Health Center, Бостон, перед закрытием и сносом; около 28 000 горшечных цветов (бегонии, лилии, вереск, тюльпаны), 80 волонтёров, четыре дня; по системе оповещения зациклены звуки последних недель больницы; потом цветы раздали больницам и приютам. Источники расходятся лишь в мелочах (число волонтёров и цветов — со слов художницы). https://www.thisiscolossal.com/2012/03/anna-schuleit-haber-bloom/ ; https://boingboing.net/2012/03/18/mental-installation-filled-wit.html ; https://www.macfound.org/fellows/789/ ; https://mindhacks.com/2012/03/14/a-mental-space-filled-with-flowers ; https://humanflowerproject.com/homage-and-horror-vacui/ . Что берём: коридор казённого учреждения, где в горшках цветёт то, чего там никогда не было; звук учреждения под цветами; идея «последний раз».
- **Lisa Waud, «Flower House» (2015), Хэмтрамк, Детройт** — два выкупленных на аукционе заброшенных дома, 16 комнат, каждую florist превратил в «оазис», около 4 000 (по другим источникам до 36 000 стеблей) цветов; потом дом разобрали; Hyperallergic пишет о запахе (розы, мокрая земля). Фото Heather Saunders. Расхождение по числу — между источниками. https://hyperallergic.com/an-abandoned-house-in-detroit-blooms-with-aromatic-plants ; https://mymodernmet.com/lisa-waud-flower-house-detroit ; https://www.booooooom.com/2015/10/21/abandoned-detroit-duplex-filled-with-36000-flowers ; https://laughingsquid.com/flower-house-detroit/ . Что берём: облупленная жилая комната (обои, плинтус, радиатор) с цветами на всех поверхностях, включая пол и мебель.
- **Yayoi Kusama, «Flower Obsession» (2016–2017, NGV Melbourne; версия NYBG 2017/2021)** — обставленная квартира, которую посетители «стирают» красными (в NYBG коралловыми) наклейками-цветами; навеяно её детскими галлюцинациями о цветах на всех поверхностях и детством в теплицах семейного питомника. Даты Melbourne расходятся (2016–2017 или 2017). https://ngv.vic.gov.au/explore/collection/work/131613 ; https://mymodernmet.com/yayoi-kusama-flower-obsession/ ; https://www.mentalfloss.com/article/543724/yayoi-kusama-flower-obsession-installation-national-gallery-of-victoria ; https://concreteplayground.com/perth/?p=758871 . Что берём: бытовая мебель (стол, шкаф, телевизор) под сплошным цветочным узором; галлюцинаторный характер.
- **Rebecca Louise Law, «Community» (Toledo Museum of Art, 2018)** — около 500 000–520 000 цветов на медных проволоках, часть живых; волонтёры около 1 650 часов за 15 дней (числа расходятся между источниками). Также «Calyx», «Florilegium» (Парма), Bikini Berlin. https://mymodernmet.com/installation-art-community-rebecca-louise-law ; https://ohiomagazine.com/arts/article/rebecca-louise-law-community ; https://www.rebeccalouiselaw.com/calyx ; https://mymodernmet.com/rebecca-louise-law-hanging-flowers . Что берём: сухие цветы, подвешенные в потолочном объёме на проволоке — «потолок из цветов», сквозь который идёт луч; сухость как тишина.
- **Azuma Makoto** — Exobiotanica (букет и сосна-бонсай в стратосфере), «Mexx» (SFER IK, Мексика), «Frozen Flowers». https://visionaireworld.com/blogs/imported/azuma-makoto-s-exobiotanica ; https://www.dezeen.com/2016/03/22/makoto-azuma-artist-japanese-capsule-exhibition-chamber-gallery-new-york-usa/ ; https://www.gessato.com/makoto-azuma-frozen-flowers/ . Что берём: цветок как вещь, помещённая в неожиданную среду (замороженный, подвешенный, в воздухе): годится для «вещей, не на своём месте».
- **Ryan Koopmans и Alice Wexell, «The Wild Within» (WePresent)** — в выжимке всплыл как цветочная интерьерная работа; содержание не проверено. https://wepresent.wetransfer.com/stories/ryan-koopmans-alice-wexell-the-wild-within ; требует проверки.

### 3.2. Кино

- **Annihilation (2018, Alex Garland)** — мутировавшие цветы всех цветов, антропоморфные кусты, дом в яркой плесени; AV Club отмечает влияние Тарковского (Stalker, Solaris). https://www.avclub.com/what-annihilation-learned-from-andrei-tarkovsky-s-sovie-1819005171 ; https://www.rollingstone.com/movies/news/annihilation-modern-weird-sci-fi-renaissance-w517110 . Что берём: красота как тревога — одна ботаническая «ошибка» (куст в форме человека, цветок из разных видов на одном стебле).
- **Tarkovsky: Stalker, Solaris, Mirror** — Stalker: заросшая Зона, вода над зелёными водорослями, трава; Mirror: растения и вода через замедление и рассинхрон звука; в Solaris оранжерейной сцены поиск не подтвердил. https://www.bfi.org.uk/features/tarkovsky/ ; https://reactormag.com/stalker-journey-into-the-landscape-of-the-human-soul/ ; https://www.criterion.com/current/posts/4739-stalker-meaning-and-makin ; https://www.sensesofcinema.com/2002/great-directors/tarkovsky/ . Что берём: природа в казённом/индустриальном месте, медленная камера, звук не совпадает с картинкой (капли, ветер без ветра).
- Конкретные «оранжерейные» сцены (Suspiria, The Shining, Little Shop of Horrors и др.) поиском не подтверждены — [память, требует проверки]; не опираться.

### 3.3. Что делает такую комнату странной, а не открыткой (синтез, не источник)

- Контекст не тот (больница, квартира, вокзал), цветы поверх бытовых вещей (Kusama, Waud).
- Исчезновение: комната будет разобрана или распадётся (Schuleit, Flower House).
- Сплошное покрытие без «композиции»: нет центра и «красивого угла» (Kusama).
- Масштаб ошибочен или повтор слишком идеален (Law: сотни тысяч одинаковых элементов).
- Звук учреждения под цветами (Schuleit).
- Несовместимое в одном стебле/месте (Annihilation).

---

## 4. Игры

- **Prey (2017, Arkane), Arboretum** — единственная зелёная зона станции Talos I: плотная растительность поверх холодного металла; внутри есть заражённая оранжерея и сад; Typhon часто появляется там. Источники расходятся по размеру зоны (небольшая vs одна из крупнейших). https://www.gamespot.com/reviews/prey-review/1900-6416678/ ; https://www.gamesradar.com/bringing-the-outside-in-how-games-use-natural-interiors-to-create-a-greater-sense-of-time-and-place ; https://www.tomshardware.com/news/prey-talos-i-space-station,34191.html ; https://fredricknolting.artstation.com/projects/PmWvNn . Что берём: единственный зелёный остров в серой эстетике = событие; контраст холодного металла и живого.
- **Greenhouse (7D Games, 2025)** — психологический хоррор: растения закрывают следы и записки; растения замедляют и гнутся при проходе; можно менять погоду; критика — медленный темп и «полярность»; комментарий игрока: хотелось больше взаимодействия с растениями (полив, изменение со временем). https://store.steampowered.com/app/3207210/Greenhouse ; https://sevendgames.itch.io/greenhouse ; https://itch.io/post/14739699 . Что берём: растения реагируют на проход героя; чего не хватало — изменений во времени.
- **Strange Horticulture (Bad Viking, 2022)** — не хоррор-исследование, а детектив с растениями; «уютно, но жутко»; PC Gamer 90; критика — однообразие игрового цикла. https://pcgamer.com/strange-horticulture-review ; https://techraptor.net/gaming/reviews/strange-horticulture-review ; https://wireframe.raspberrypi.com/articles/strange-horticulture-review-sowing-the-seeds-of-love . Что берём: идентификация растений как загадка; бирки и названия как текст мира.
- **Nightmare Corridor, Chapter 4: The Greenhouse Maze (Ludum Dare-подобный инди)** — лабиринт хищных растений, токсичный туман, сдвигающиеся стены. https://nightmarestudi0.itch.io/nightmare-corridor/devlog/908137/-nightmare-corridor-chapter-4-the-greenhouse-maze- . Что берём: туман как ограничитель видимости; чего не берём: экшн-угроза.
- **Botanica (Futuregames, PSX-стиль)** — ночной смотритель ухаживает за оранжереей. https://futuregames.itch.io/botanica . Что берём: ритуальный уход (полив, проверка) как действие игрока; PSX-эстетика как пример низкого разрешения.
- **Imaginarium Dr. Greenhouse** — упомянут в выдаче; суть не проверена. https://gamebrain.co/game/imaginarium-dr-greenhouse ; требует проверки.
- Что работает/выглядит дёшево — по этим источникам подтверждено лишь частично (в основном из отзывов и комментариев): работает контраст среды (Prey), реакция растений на игрока и интерактив во времени (Greenhouse); «дёшево» — динамика, где растения только декор. Остальное — выводы по правилам проекта. Steam-отзывы целиком не читались.

---

## 5. Поведение растений для игровой странности

- **Atamian et al., Science 2016 — Circadian regulation of sunflower heliotropism** — молодые подсолнухи днём следят за солнцем с востока на запад, ночью возвращаются к востоку (часы); у зрелых головки замирают, смотрят на восток; восточные цветки привлекали втрое-впятеро больше опылителей (в KQED «в пять раз»). https://ui.adsabs.harvard.edu/abs/2016Sci...353..587A ; https://www.kqed.org/science/900592/the-mystery-of-why-sunflowers-turn-to-follow-the-sun-solved ; https://harmerlab.plantclock.org/papers/Atamian-Science . Что берём: цветок «помнит» направление света и возвращается к утреннему положению; поворот медленный, с задержкой (эффект «смотрят на тебя»).
- **Nastic movements (Wikipedia-зеркала)** — ненаправленные движения: фото-, терма-, никтинастия; тюльпан и крокус открываются от тепла, энотера ночью, одуванчик закрывается к сумеркам; механизм — тургор. https://en.wikipedia-on-ipfs.org/wiki/Nastic_movements ; https://encyclopedia.com/plants-and-animals/botany/botany-general/nastic-movement . Что берём: открывание/закрывание цветков от луча и «тепла фонаря»; часть видов — наоборот открывается ночью (инверсия).
- **Discover Magazine — why some plants close their leaves at night** и **Irish Examiner — Opening hours** — закрытие защищает пыльцу, от холода и ночных гостей; маргаритки, бессмертник закрываются; «ночные красавицы» (4 o'clock) открываются к вечеру. https://discovermagazine.com/planet-earth/why-some-plants-close-their-leaves-at-night ; https://www.irishexaminer.com/lifestyle/outdoors/arid-41841918.html . Что берём: список видов для «закрыт днём/ночью».
- **Конденсат на объективе** — линза ниже точки росы запотевает при входе в тёплое влажное помещение; протирание не помогает, пока не прогреется; холодный сенсор тоже. https://photographylife.com/protect-camera-humidity ; https://www.uniquephoto.com/community/qa/how-can-i-protect-my-camera-from-condensation-when-moving-into-hot-humid-places ; https://www.diyphotography.net/?p=80169 . Что берём: эффект запотевания и медленное прояснение при входе; протирание рукой не решает, а повторно запотевает.
- **Увядание, пыльца в луче** — прямых источников в выжимках нет: увядание как потеря тургора (из Nastic) — [поиск по косвенным]; пыльца как точки в луче — [память, требует проверки]; техника луча с пылью — в разделе 6 (volumetric).

---

## 6. Техника для браузера

- **DEV Community — Efficient WebGL vegetation rendering (keaukraine)** — трава и цветы рисуются похожими шейдерами с общей инстанс-позицией; вершинная анимация ветра у высокой травы; у одуванчиков зеркальный блик на стеблях. Страница не открывалась (домен недоступен), по выжимке. https://dev.to/keaukraine/efficient-webgl-vegetation-rendering-4g2g ; зеркало: https://keaukraine.medium.com/efficient-webgl-vegetation-rendering-b09a7fa904cc . Что берём: готовый разбор «цветы + трава» в WebGL.
- **Codrops — How to make the fluffiest grass with three.js (2025)** — трава-карточки с альфа-тестом (billboard grass) как LOD-ступень вдали. https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/ . Что берём: карточки с альфа-вырезом вместо геометрии цветка вдали.
- **Codrops — Three.js Instances: Rendering Multiple Objects Simultaneously** — основы InstancedMesh. https://tympanus.net/codrops/?p=96795 . Что берём: базовый шаблон для горшков, стеблей и бирок.
- **three.js Discourse — Simple instanced grass example** — короткий пример InstancedMesh + ShaderMaterial с ветром. https://discourse.threejs.org/t/simple-instanced-grass-example/26694 . Что берём: стартовый код шейдерного ветра.
- **al-ro — Grass (InstancedBufferGeometry)** — старый, но подробный разбор. https://al-ro.github.io/projects/grass . Что берём: структуру атрибутов; названия классов устарели.
- **three.js Discourse — Performance: Optimizing 3M Instanced Grass** и **Migrating my Grass System to WebGPU** — чанки, куллинг, LOD. https://discourse.threejs.org/t/performance-optimizing-3m-instanced-grass-in-three-js/81286 ; https://discourse.threejs.org/t/migrating-my-grass-system-to-webgpu-and-making-a-robust-grass-plugin/92893 . Что берём: разбивку на чанки; фреймтайм-цифр независимо не нашли — только анекдотические.
- **three.js Discourse — LOD + Instancing** — в core three.js нет куллинга и LOD для InstancedMesh; совет — отдельная группа инстансов на уровень LOD, проверки по чанкам. https://discourse.threejs.org/t/lod-instancing/20524 . Что берём: схему «ближние инстансы / карточки / ничего».
- **InstancedMesh2 (@three.ez/instanced-mesh)** — per-instance куллинг на BVH, сортировка, видимость; LOD в старых версиях помечен «в работе», требует r159+; проверять текущие доки. https://discourse.threejs.org/t/instancedmesh2-easy-handling-and-frustum-culling/58622 ; https://www.npmjs.com/package/%40three.ez%2Finstanced-mesh . Что берём: если нужен куллинг по конусу луча — готовое решение (проверить совместимость с версией проекта).
- **Octahedral impostors (Discourse) и cinevva «imposters»** — для деревьев/пальм вдали: плоская картинка, запечённая под углы; цена — память атласа. https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735 ; https://app.cinevva.com/blog/2026-05-04-open-world-browser-part-19-imposters . Что берём: пальмы и фикусы вдали без геометрии (в нашей комнате вряд ли нужно; для длинного проёма).
- **Procedural Instanced Forest (Discourse)** — листья схлопываются в вершинном шейдере вдали, 60 fps на среднем десктопе (заявлено автором). https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610 . Что берём: схлопывание дальних листьев шейдером = естественный «распад вне луча».
- **Свет и пыль в луче:**
  - Codrops — Volumetric Light Rays with Three.js: https://tympanus.net/codrops/2022/06/27/volumetric-light-rays-with-three-js
  - Maxime Heckel — On Shaping Light (ray-marched конус): https://blog.maximeheckel.com/posts/shaping-light-volumetric-lighting-with-post-processing-and-raymarching/
  - Andrew Berg — Volumetric Light Scattering in three.js: https://medium.com/@andrew_b_berg/6e1850680a41
  - «Storm Drive» (демо туманного ray-march ~22 шага): https://kody-w.github.io/learnwithkody/examples/storm-drive/
  - Что берём: конус-меш с шумовой плотностью внутри луча (а не спрайты-частицы) — по обсуждению на Discourse; пыльцу — как мелкие точки в той же плотности.
- **«Цветы из точек»** — прямых примеров не найдено; для цветка из THREE.Points с лепестками из 8–20 точек и шейдерным размером по расстоянию — [память, требует проверки], стоит прототипа. В проекте это согласуется с «миром из точек» под лучом.
- Цифры производительности в источниках — анекдотические; сравнения «карточки vs точки vs частицы» для цветов не найдено, нужен свой замер.
