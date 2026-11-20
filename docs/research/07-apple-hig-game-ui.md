# 07. Apple HIG: правила интерфейса для игры на телефоне («дежурная часть»)

Дата сбора: 2026-11-20. Источник: Apple Human Interface Guidelines (developer.apple.com/design/human-interface-guidelines).
Страницы прочитаны целиком (markdown-вариант страницы `<url>.md`; тексты в редакции с копирайтом 2026).
Цитаты и названия разделов — в оригинале. Пометка «не подтверждено» = в HIG не найдено.
Здесь только материал; решений за дизайнера и макетов нет. Юридических/этических выводов нет.

Базовый URL: `https://developer.apple.com/design/human-interface-guidelines/`

---

## 1. Designing for games (и Game controls)

URL: `.../designing-for-games`, `.../game-controls`, `.../menus#In-game-menus`

| Правило | Число / деталь | Цитата |
|---|---|---|
| Играть сразу после установки | загрузка начального контента не дольше 30 минут (про установку; для веб-игры — аналог «быстрый старт») | "Let people play as soon as installation completes." |
| Хорошие настройки по умолчанию | не заставлять менять настройки до игры; учитывать системные настройки доступности | "Provide great default settings." |
| Обучение через игру | обучающий текст — справка, а не предусловие | "Teach through play." / "...offering it as a resource players can refer to ... instead of making it a prerequisite for gameplay." |
| Запросы (оценка, разрешения) — позже | не до начала игры | "Defer requests until the right time." |
| Размер текста iOS/iPadOS | по умолчанию 17 pt, минимум 11 pt | "ensure that it contrasts well with the background and uses at least the recommended minimum text size" |
| Размер кнопок iOS/iPadOS | по умолчанию 44x44 pt, минимум 28x28 pt | "buttons in iOS must be at least 44x44 pt to accommodate touch interaction" |
| Частые игровые контролы vs второстепенные (Touch controls) | частые — минимум 44x44 pt; менее важные (меню) — минимум 28x28 pt | "Make sure frequently used controls are a minimum size of 44x44 pt, and less important controls, such as menus, are a minimum size of 28x28 pt" |
| Расположение кнопок | вне Home indicator и Dynamic Island; частые — у большого пальца; второстепенные (меню) — вверху экрана | "Place frequently used buttons near a player's thumb... Place secondary controls, like menus, at the top of the screen." |
| Не закрывать игровое поле | меньше виртуальных кнопок поверх контента; действия — жестами по объектам | "Look for opportunities to reduce the amount of virtual controls that overlap your game content ... consider letting players tap objects to select them instead of adding a virtual selection button." |
| Показывать/скрывать контролы по контексту | скрывать недоступные действия | "You can hide controls when an action isn't available or relevant" |
| Press state | видимый + тактильный; виден при закрытии пальцем (свечение), плюс звук и haptics | "Always include visible and tactile press states." |
| Иконки действий | не абстрактные фигуры и не «A, X, R1» | "Avoid using abstract shapes or controller-based naming like A, X, or R1 as artwork" |
| Упростить ввод | заменить комбинации/последовательности жестами (двойной тап, удержание) | "Combine functionality into a single control." |
| Меню под разные пропорции | примеры пропорций: 16:10, 19.5:9, 4:3; обе ориентации; без перекрытия контента; динамическая раскладка, не фиксированная | "Make sure in-game menus adapt to different aspect ratios." / "Avoid fixed layouts as much as possible" |
| In-game menus на мобильном | при масштабировании меню может стать слишком мелким — менять размер зон касания | "modify the size of the tap targets and consider alternative ways to communicate the menu's content" |
| Тап по умолчанию | iOS: касание — основной способ; контроллер — дополнительный | "support each platform's default interaction method" |
| Настройка игроком | размер шрифта, управление, интенсивность движения, баланс звука | "give players the ability to customize parameters like type size, game control mapping, motion intensity, and sound balance" |
| Полноэкранный режим | игры часто полноэкранные | "Design for the full-screen experience." (`.../going-full-screen`) |
| Пауза | в HIG для контроллера: кнопка Menu = «открывает настройки игры или ставит на паузу» | "Menu: Opens game settings or pauses gameplay" (для сенсорной паузы отдельных правил не найдено) |
| Ориентация | обе ориентации, если поддерживаются; запрета/требования ориентации для игр в HIG нет | "even if your app is locked to a certain orientation ... it's still important to ensure your interface resizes well" (Layout) |
| Подсказка/обучение: ссылки | Onboarding, Loading, Launching | см. раздел 9 |

Страница «Settings» (`.../settings`) отдельно не читалась: не подтверждено (только ссылка из Designing for games).

---

## 2. Layout

URL: `.../layout`, `.../designing-for-ios`

| Правило | Число | Цитата |
|---|---|---|
| Порядок по важности | важное — вверху и в начале строки (в порядке чтения) | "Order content by relative importance ... place the most important items near the top and leading side" |
| Выравнивание, отступы | выровненное воспринимается связанным; сдвинутое — подчинённым | "People assume that aligned items are related to each other" |
| Группировка | пустое пространство, контейнеры, разделители | "Group related items ... use negative space, container shapes, or separator lines" |
| Прогрессивное раскрытие | меньше контента сразу; остальное — меню, вложенные виды, прокрутка | "Use progressive disclosure to make layouts cleaner and easier to interact with." |
| Контролы отличать от контента | вместо подложки под контролами — scroll edge effect; фон — под панели на весь экран | "Instead of applying a solid or semi-opaque background color beneath controls, use a scroll edge effect" |
| Safe area | не перекрывать Dynamic Island, углы, системные панели | "Respecting the safe area is essential to make sure system UI and hardware features like the Dynamic Island don't obstruct content and controls." |
| Адаптация | размеры экрана, ориентация, размер окна, Display Zoom, смена размера текста, длина локализованного текста | "Design a layout that adapts gracefully and consistently." |
| Size classes | compact/regular по каждой оси; раскладку определять классом, не устройством/ориентацией | "Determine layout based on size classes, not device type or orientation." |
| Функциональность не менять от размера | меняется объём видимого (например, tab bar -> sidebar на большом экране) | "Don't change your app's functionality based on the space it occupies." |
| Фоновая картинка | не менять пропорции арта; масштабировать до полного заполнения; допускается обрезка | "don't change the aspect ratio of the artwork; instead, scale it so that it fills the screen completely" |
| Background extension | если панель закрывает важную часть фона — flip+blur зеркало под панелью | "background extension effect to flip and blur the image" |
| Тестирование | наибольший и наименьший макет; разные размеры текста и локали | "testing versions ... that use the largest and the smallest layouts" |
| Эргономика iPhone | управление в середине/нижней части экрана достижимее | "it tends to be easier and more comfortable for people to reach a control when it's located in the middle or bottom area of the display" (Designing for iOS) |
| Меньше контролов на экране | второстепенное — через минимум действий | "limiting the number of onscreen controls while making secondary details and actions discoverable with minimal interaction" |

Численных полей (margins) для iOS, ширины колонки текста — в Layout не найдено: не подтверждено (есть лишь значения для tvOS: 60/80 pt; для visionOS: центры кнопок не ближе 60 pt). Положение «главного действия» в общем виде: в toolbar — на trailing-стороне (раздел 8); для alert — default кнопка на trailing/верху (раздел 7).

---

## 3. Accessibility / Buttons: области касания и расстояния

URL: `.../accessibility`, `.../buttons`

| Правило | Число | Цитата |
|---|---|---|
| Минимум области касания (Buttons) | не менее 44x44 pt (visionOS 60x60) | "a button needs a hit region of at least 44x44 pt" |
| Размеры по платформам (Accessibility): iOS/iPadOS | default 44x44 pt, minimum 28x28 pt | "Offer sufficiently sized controls." |
| macOS / tvOS / visionOS / watchOS | 28x28 / 20x20; 66x66 / 56x56; 60x60 / 28x28; 44x44 / 28x28 (default / minimum) | таблица Accessibility |
| Расстояние между контролами | ~12 pt вокруг элементов с рамкой (bezel); ~24 pt вокруг элементов без рамки | "Consider spacing between controls as important as size." / "about 12 points of padding around elements that include a bezel... about 24 points ... without a bezel" |
| Простые жесты | без многопальцевых для частых действий | "use the simplest gesture possible — avoid custom multifinger and multihand gestures" |
| Альтернатива жесту | кнопка рядом со свайпом | "if you use a swipe gesture to dismiss a view, also make a button available" |
| Press state у своей кнопки | обязателен | "Always include a press state for a custom button." |
| Таймеры, авто-скрытие | минимизировать | "Minimize use of time-boxed interface elements ... Prefer dismissing views with an explicit action." |
| Не только жесты | основной функционал доступен >1 способом | "Offer alternatives to gestures." |
| Тесты на ассистивные технологии | VoiceOver, Voice Control, Switch Control, Full Keyboard Access | см. страницу Accessibility |
| Сложность | рассмотреть уровни сложности/сокращение критериев и времени реакции | "Consider offering difficulty accommodations in games." |

---

## 4. Typography

URL: `.../typography`, `.../accessibility`

Общие правила
| Правило | Число | Цитата |
|---|---|---|
| Размер текста iOS/iPadOS | default 17 pt, minimum 11 pt (для системных и своих шрифтов) | "Follow the recommended default and minimum text sizes for each platform — for both custom and system fonts" |
| Другие платформы (default/min) | macOS 13/10; tvOS 29/23; visionOS 17/12; watchOS 16/12 | таблица |
| Тонкие начертания | избегать Ultralight, Thin, Light; предпочитать Regular, Medium, Semibold, Bold; при тонком кастомном шрифте — крупнее рекомендованного | "avoid Ultralight, Thin, and Light font weights, which can be difficult to see, especially when text is small" |
| Число гарнитур | минимизировать | "Minimize the number of typefaces you use, even in a highly customized interface." |
| Иерархия | менять вес/размер/цвет; сохранять иерархию при смене размера | "Adjust font weight, size, and color as needed to emphasize important information" |
| Что увеличивать при росте текста | важное; в игре — реплики персонажа важнее мелких всплывающих чисел | "in a game, people are often more interested in a character's dialog than in transient hit-damage values" |
| Тест читаемости | на каждой платформе; при проблеме — крупнее, контрастнее, системный шрифт | "Test legibility in different contexts." |
| Заглавные буквы | в HIG для кнопок: title-style capitalization с глагола; для alert: предложение — sentence-style, фрагмент — title-style | "Using title-style capitalization, consider starting the label with a verb" (Buttons). Отдельного правила «ALL CAPS» в прочитанных разделах не найдено: не подтверждено |
| 2D-текст | без глубины/3D | "prefer 2D text" |
| Текст без подложки | делать полужирным, тени не добавлять (про visionOS-контекст; для iOS-игры не подтверждено) | см. Typography > visionOS |

Dynamic Type (Supporting Dynamic Type)
| Правило | Число | Цитата |
|---|---|---|
| Увеличение текста | идеально — минимум на 200% (watchOS 140%) | "Ideally, give people the option to enlarge text by at least 200 percent" (Accessibility) |
| Раскладка | проверять на всех размерах, включая Larger Accessibility Text Sizes | "Make sure your app's layout adapts to all font sizes." |
| Усечение | минимально; многострочность вместо обрезки | "Keep text truncation to a minimum as font size increases." |
| Перестройка | при больших размерах — стек вместо ряда, меньше колонок | "consider using a stacked layout where text appears above secondary items" |
| Иерархия | главное остаётся вверху | "keep primary elements toward the top of a view even when the font size is very large" |
| Иконки | растут вместе с текстом | "Increase the size of meaningful interface icons as font size increases." |
| Свой шрифт/Unity/веб | должен повторять поведение системного; иначе дать менять размер другим способом | "let players adjust text size in other ways" |

Стили iOS/iPadOS, размер при Large (default), pt (size / leading), emphasized weight:
| Стиль | Вес | Size | Leading | Emphasized |
|---|---|---|---|---|
| Large Title | Regular | 34 | 41 | Bold |
| Title 1 | Regular | 28 | 34 | Bold |
| Title 2 | Regular | 22 | 28 | Bold |
| Title 3 | Regular | 20 | 25 | Semibold |
| Headline | Semibold | 17 | 22 | Semibold |
| Body | Regular | 17 | 22 | Semibold |
| Callout | Regular | 16 | 21 | Semibold |
| Subhead(line) | Regular | 15 | 20 | Semibold |
| Footnote | Regular | 13 | 18 | Semibold |
| Caption 1 | Regular | 12 | 16 | Semibold |
| Caption 2 | Regular | 11 | 13 | Semibold |

Таблицы для других размеров (xSmall … xxxLarge, AX1–AX5) есть на странице Typography > Specifications; полностью не выписаны (Caption 1/2 при xSmall — 11/13). Страницу Typography использовали как источник таблицы Large (default).

---

## 5. Color и Accessibility (контраст, не только цвет, тёмное оформление)

URL: `.../accessibility`, `.../color`, `.../dark-mode`

| Правило | Число | Цитата |
|---|---|---|
| Минимальный контраст (WCAG AA, как в Accessibility Inspector) | текст до 17 pt — 4.5:1; 18 pt — 3:1; любой жирный — 3:1 | "Strive to meet color contrast minimum standards." |
| Dark Mode: минимум | не ниже 4.5:1 | "make sure the contrast ratio between colors is no lower than 4.5:1" |
| Dark Mode: цель для своих цветов | 7:1, особенно для мелкого текста | "strive for a contrast ratio of 7:1, especially in small text" |
| Increase Contrast | если нет достаточного контраста по умолчанию — дать повышенный вариант | "ensure it at least provides a higher contrast color scheme when the system setting Increase Contrast is turned on" |
| Проверка в обоих режимах | светлый и тёмный | "check the minimum contrast in both light and dark appearances" |
| Не только цвет | добавлять формы, иконки, подписи; красный-зелёный и синий-оранжевый — проблемные пары | "Convey information with more than color alone." / "Offer visual indicators, like distinct shapes or icons, in addition to color" |
| Color: то же | подписи/глифы для различия объектов и состояний | "Avoid relying solely on color to differentiate between objects, indicate interactivity, or communicate essential information." |
| Один цвет — один смысл | не использовать брендовый цвет и для интерактива, и для обычного текста | "Avoid using the same color to mean different things." |
| Варианты цвета | light, dark, increased contrast — для каждого своего цвета | "supply light and dark variants, and an increased contrast option for each variant" |
| Системные цвета | предпочитать; не хардкодить значения | "Prefer system-defined colors." / "Avoid hard-coding system color values" |
| Свет/улица | тестировать при ярком и тусклом освещении | "In bright surroundings, colors look darker and more muted." |
| Культурные значения цвета | учитывать | "Consider how the colors you use might be perceived in other countries and cultures." |
| App-specific тёмная/светлая тема | не делать переключатель в приложении (в HIG); тёмная-only допустима «редко» для иммерсивных медиа | "Avoid offering an app-specific appearance setting." / "In rare cases, consider using only a dark appearance" (для веб-игры — требует проверки) |
| Белое в тёмной теме | смягчать белые фоны картинок | "Soften the color of white backgrounds." |
| Картинки/иконки | проверять в обеих темах | "Make sure full-color images and icons look good in both appearances." |
| Значения системных красных (для справки) | Red light RGB 255/56/60; dark 255/66/69; с повышенным контрастом 233/21/45 | Color > Specifications; значения «могут меняться» — "Avoid hard-coding" |

---

## 6. Buttons: иерархия, стили, деструктивные действия, подписи

URL: `.../buttons`, `.../alerts`

| Правило | Число | Цитата |
|---|---|---|
| Главная кнопка | выделяется стилем на самое вероятное действие; число prominent — одна или две на вид | "Keep the number of prominent buttons to one or two per view." |
| Различать стилем, не размером | одинаковые размеры у равноправных вариантов | "Use style — not size — to visually distinguish the preferred choice among multiple options." |
| Размер зоны | не менее 44x44 pt; нужен запас вокруг | "enough space around a button so that people can visually distinguish it" |
| Роли | Normal, Primary, Cancel, Destructive; Primary — default, Destructive — красный | "A system button can have one of the following roles" |
| Primary не деструктивной | даже если это самое вероятное действие | "Don't assign the primary role to a button that performs a destructive action, even if that action is the most likely choice." |
| Подписи | короткий текст, title-style, глагол в начале; иконки — знакомые | "start the label with a verb ... for example ... 'Add to Cart.'" |
| Иконка vs текст | текст, если короткая подпись яснее иконки | "Consider using text when a short label communicates more clearly than an icon." |
| Индикатор в кнопке | при неинстантном действии — activity indicator и новая подпись («Checking out…») | "Configure a button to display an activity indicator" |
| Цвет подписей | не похожий на фон контента | "Avoid applying a similar color to button labels and content layer backgrounds." |
| Alert: подписи кнопок | 1–2 слова, глагол; «OK» только в информационных; «Yes/No» избегать; «Cancel» для отмены | "Aim for a one- or two-word title that describes the result of selecting the button." |
| Alert: деструктивный стиль | для действия, которое человек не выбирал сознательно | "Use the destructive style to identify a button that performs a destructive action people didn't deliberately choose." |
| Alert: расположение | главная — справа (trailing) в ряду или сверху в стопке; Cancel — слева или внизу | "Always place the default button on the trailing side of a row or at the top of a stack." |
| Alert: Cancel | не делать default; при деструктиве Cancel обязателен | "Note that you don't want to make a Cancel button the default button." |
| Press state и звук/haptics | см. разделы 1, 9 | — |

---

## 7. Modality, Sheets, Alerts, Action sheets (confirmation dialog)

URL: `.../modality`, `.../sheets`, `.../alerts`, `.../action-sheets`

| Правило | Число | Цитата |
|---|---|---|
| Когда использовать модальность | только при явной пользе; задача простая и короткая | "Present content modally only when there's a clear benefit." / "Aim to keep modal tasks simple, short, and streamlined." |
| Нет «приложения в приложении» | не строить иерархию экранов внутри модального; один путь | "Take care to avoid creating a modal experience that feels like an app within your app." |
| Очевидный способ закрыть | iOS: кнопка в верхней панели или свайп вниз | "Always give people an obvious way to dismiss a modal view." |
| Подтверждение при потере данных | action sheet с вариантом сохранить | "getting confirmation before closing a modal view" |
| Название задачи | заголовок модального вида | "Make it easy to identify a modal view's task." |
| Не накладывать модальные | один sheet за раз; закрыть первый перед показом второго; alert может быть поверх, но не более одного alert | "Display only one sheet at a time from the main interface." / "you never want to display more than one alert at the same time" |
| Sheet: назначение | узкая задача, связанная с контекстом | "A sheet helps people perform a scoped task that's closely related to their current context." |
| Sheet: не для сложных потоков | для долгих — полноэкранная модальность | "For complex or prolonged user flows, consider alternatives to sheets." |
| Sheet: кнопки | Cancel — слева сверху, Done — справа; не показывать вместе Cancel+Done+Back; Done не единственный выход | "Provide an alternative to the Done button." / "Avoid showing all three buttons — Cancel, Done, and Back — together." |
| Sheet: detents (iPhone) | два системных: large (полная высота) и medium (~ половина полной высоты); можно свои | "medium is about half of the fully expanded height" |
| Sheet: medium detent | для постепенного раскрытия; для композиции/длинного — только full | "consider supporting the medium detent to allow progressive disclosure" |
| Sheet: grabber | включать в изменяемый по высоте sheet; тап по нему переключает detents; работает с VoiceOver | "Include a grabber in a resizable sheet." |
| Sheet: закрытие жестом | свайп вниз; при несохранённых изменениях — action sheet | "Support swiping to dismiss a sheet." |
| Sheet: iPad | page или form sheet (по центру, затемнённый фон) | "Prefer using the page or form sheet presentation styles in an iPadOS app." |
| Sheet: немодальный (iOS/iPadOS) | можно нон-модальный — взаимодействие с родительским видом без закрытия | "a sheet can be either modal or nonmodal" |
| Alert: когда | критичная и желательно действенная информация; нечасто | "Use alerts sparingly." / "Avoid using an alert merely to provide information." |
| Alert: не для частых отменяемых действий | в т.ч. деструктивных | "Avoid displaying alerts for common, undoable actions" |
| Alert: при запуске | не показывать | "Avoid showing an alert when your app starts." |
| Alert: состав | заголовок, необязательный текст, до трёх кнопок | "up to three buttons" |
| Alert: заголовок | не длиннее двух строк; не «Error» | "avoid overly long titles that wrap to more than two lines" |
| Alert: прокрутка | избегать | "avoid displaying an alert that scrolls" (iOS) |
| Alert: отмена | запасные способы закрыть | "Provide alternative ways to cancel an alert when it makes sense." |
| Action sheet (confirmation dialog) | для вариантов при намеренном действии, не alert | "Use an action sheet — not an alert — to offer choices related to an intentional action." |
| Action sheet: заголовок | на одной строке | "Aim to keep titles short enough to display on a single line." |
| Action sheet: Cancel | внизу; деструктивные — вверху и в деструктивном стиле | "Place the Cancel button at the bottom"; "place these buttons at the top of the action sheet" |
| Action sheet: прокрутка (iOS) | избегать | "Avoid letting an action sheet scroll." |
| Action sheet: число кнопок | в iOS не задано; для watchOS — не более 4 включая Cancel (для iOS числа не найдено) | "Avoid displaying more than four buttons in an action sheet, including the Cancel button." (watchOS) |

---

## 8. Segmented controls, Tab bars, Toolbars

URL: `.../segmented-controls`, `.../tab-bars`, `.../toolbars`

| Правило | Число | Цитата |
|---|---|---|
| Segmented: назначение | близкие варианты, влияющие на объект/состояние/вид; один выбор | "Use a segmented control to provide closely related choices that affect an object, state, or view." |
| Segmented: число сегментов | iPhone — не более ~5; широкий интерфейс — ~5–7 | "no more than about five to seven segments in a wide interface and no more than about five segments on iPhone" |
| Segmented: содержимое | либо текст, либо картинки, не смешивать; равная ширина; подписи — существительные в title-style | "Prefer using either text or images — not a mix of both" |
| Segmented: iOS | переключение между близкими под-видами; между разделами приложения — tab bar | "For switching between completely separate sections of an app, use a tab bar instead." |
| Tab bar: назначение | навигация между разделами, не действия | "Use a tab bar to support navigation, not to provide actions." |
| Tab bar: положение iOS | плавает внизу экрана на Liquid Glass | "A tab bar floats above content at the bottom of the screen." |
| Tab bar: число | не задано числом для iPhone («appropriate number»); меньше проще; избегать More (переполнения) | "it's generally easier to navigate among fewer tabs"; для iPad при кастомизации — по умолчанию ≤5 |
| Tab bar: не скрывать/не отключать вкладки | объяснять пустой раздел | "Don't disable or hide tab bar buttons, even when their content is unavailable." |
| Tab bar: подписи | одно слово; значок сверху над подписью в compact | "Use single words whenever possible." |
| Toolbar: назначение | команды, навигация, поиск; действия над контентом вида | "A toolbar provides convenient access to frequently used commands, controls, navigation, and search." |
| Toolbar: без перегруза | выбирать пункты, остальное — More menu | "Choose items deliberately to avoid overcrowding." |
| Toolbar: группы | не более трёх | "aim for a maximum of three" |
| Toolbar: главное действие | один prominent (Done/Submit) справа (trailing) | "Only specify one primary action, and put it on the trailing side of the toolbar." |
| Toolbar: Back/Close | стандартные символы, без текста Back/Close | "don't use a text label that says Back or Close" |
| Toolbar: заголовок | короче 15 символов | "keep the title under 15 characters long" |
| Toolbar: символы | предпочтительны вместо текста; текстовые кнопки разделять отступом | "Prefer simple, recognizable symbols for items instead of text, except for actions like edit" |
| Toolbar: iOS | только самое важное в основной области; остальное в More | "Prioritize only the most important items for inclusion in the main toolbar area." |
| Скрытие панелей | можно временно, но дать вернуть | "offer ways to reliably restore hidden interface elements" |

---

## 9. Onboarding и Feedback (звук, haptics)

URL: `.../onboarding`, `.../feedback`, `.../playing-haptics`, `.../playing-audio`, `.../accessibility`

| Правило | Число / деталь | Цитата |
|---|---|---|
| Onboarding: цель | быстрый, увлекательный, необязательный | "design a flow that's fast, fun, and optional" |
| Учить действием | пробовать механику безопасно | "Teach through interactivity." |
| Подсказки в контексте | рядом с нужной областью; вместо одного потока | "Consider providing a collection of context-specific tips instead of a single onboarding flow." |
| Короткий поток | без запоминания | "doesn't require people to memorize a lot of information" |
| Туториал необязателен | пропущенный не показывать снова; оставить в справке/настройках | "If you let people skip the tutorial ... don't present it again on subsequent launches" |
| Только про свою игру | не учить пользоваться устройством | "they don't need to learn how to use the system or the device" |
| Splash | коротко | "Briefly display a splash screen if necessary." |
| Юр. текст в онбординге | избегать | "Avoid displaying licensing details within your onboarding flow." |
| Отложить настройку | разумные настройки по умолчанию | "Postpone nonessential setup flows or customization steps." |
| Feedback: общее | цвет + текст + звук + haptics, чтобы работало без звука/зрения | "when you provide feedback using color, text, sound, and haptics, people can receive it whether they silence their device, look away from the screen, or use VoiceOver" |
| Feedback: подтверждение | только для значимых действий; сообщать, почему команда невыполнима | "Show people when a command can't be carried out and help them understand why." |
| Feedback: статус | рядом с описываемым элементом, пассивно | "Consider integrating status feedback into your interface." |
| Звук + haptics | звук не единственный канал | "Use haptics in addition to audio cues." (Accessibility) |
| Звук + визуал | подкреплять звук визуальными подсказками | "Augment audio cues with visual cues." |
| Диалоги не только звуком | субтитры/титры; кастомизация вида текста | "dialogue and crucial information about your app or game isn't communicated through audio alone" |
| Haptics: смысл | системные паттерны — по документированному смыслу; одинаковый паттерн = одинаковый исход | "Use system-provided haptic patterns according to their documented meanings." |
| Haptics: паттерны iOS | notification: success / warning / error; impact: light, medium, heavy, rigid, soft; selection | раздел Playing haptics > iOS |
| Haptics: умеренность | короткие, на дискретные события | "Avoid overusing haptics." / "prefer playing short haptics that complement discrete events" |
| Haptics: опциональность | можно отключить | "Make haptics optional." |
| Haptics + анимация | совпадать по интенсивности и резкости | "match the intensity and sharpness of a haptic with the intensity and sharpness of the animation" |
| Звук: Silent | в беззвучном режиме не играть несущественные звуки (эффекты, саундтрек) | "they also want to silence nonessential sounds, such as keyboard clicks, sound effects, game soundtracks" |
| Звук: громкость | подчиняться системной; микшировать относительно, не менять общий уровень | "the system volume always governs the final output" |
| Звук: категория | Solo ambient (игра с саундтреком): отвечает на silent, не микшируется; Ambient: микшируется | таблица Playing audio |
| Звук: наушники | отключение — пауза сразу | "when disconnecting headphones, they expect playback to pause immediately" |
| Звук: прерывания | игра может возобновлять звук сама | "a game doesn't need to check the interruption type before automatically resuming playback" |
| Управление медиа | не автовоспроизводить без управления; глобальная опция | "Avoid autoplaying audio and video content without also providing controls to start and stop it." |
| Настройки звука в игре | «баланс звука» — игрок настраивает (Designing for games); отдельного числа/ползунка в HIG для игр не найдено: не подтверждено | — |

---

## 10. Motion и Reduce Motion

URL: `.../motion`, `.../accessibility`

| Правило | Число | Цитата |
|---|---|---|
| Анимация по делу | не ради анимации | "Add motion purposefully, supporting the experience without overshadowing it." |
| Опциональность движения | не единственный канал; дополнять haptics и звуком | "Make motion optional." |
| Краткие обратные анимации | коротко и точно привязаны к действию | "Aim for brevity and precision in feedback animations." |
| Частые действия | не анимировать лишний раз | "generally avoid adding motion to UI interactions that occur frequently" |
| Не заставлять ждать | прерываемость | "Let people cancel motion." |
| Частота кадров игры | 30–60 fps | "maintaining a consistent frame rate of 30 to 60 fps typically results in a smooth, visually appealing experience" |
| Настройки производительности | позволять экономить батарею | "Let people customize the visual experience of your game to optimize performance or battery life." |
| Быстрые/мигающие анимации | осторожно: отвлечение, головокружение, эпилепсия | "Be cautious with fast-moving and blinking animations." |
| Reduce Motion: что убрать | автоматические и повторяющиеся анимации, включая zoom, scaling, периферийное движение | "ensure your app or game responds by reducing automatic and repetitive animations, including zooming, scaling, and peripheral motion" |
| Reduce Motion: приёмы | жёстче пружины (меньше «отскок»); анимация следует за жестом; не анимировать глубину по z; переходы по x/y/z заменять fade; не анимировать вход/выход из blur | список Accessibility |
| Мигание | уважать Dim Flashing Lights для видео | "Allow people to opt out of flashing lights in video playback." |
| Реальные числа длительности анимаций (мс) | в HIG не найдено: не подтверждено | — |

---

## 11. Что изменилось в 2025: Liquid Glass; Hierarchy / Harmony / Consistency

URL: `.../materials`, `.../layout`, `.../color`, `.../buttons`, `.../tab-bars`, `.../toolbars`; видео WWDC25 356, 102

Даты из Change log страниц: Layout — 9 июня 2025 («Added guidance for Liquid Glass»); Materials — 9 июня и 9 сентября 2025; Color, Buttons, Toolbars, Tab bars — 16 декабря 2025 (Liquid Glass); Designing for games и Game controls — 9 июня 2025 («Updated guidance for touch-based controls»); Motion — 9 сентября 2025; Sheets — 24 марта 2026 («Updated guidance for button placement»); Tab bars — 8 июня 2026 («Updated terminology and art»); Layout — 9 сентября 2026.

| Изменение | Что влияет на раскладку/контролы | Цитата |
|---|---|---|
| Два слоя | Liquid Glass — слой контролов и навигации над слоем контента | "Liquid Glass forms a distinct functional layer for controls and navigation elements" |
| Не в слое контента | для фонов и контента — стандартные материалы | "Don't use Liquid Glass in the content layer." |
| Редко | ограничивать самыми важными функциональными элементами | "Use Liquid Glass effects sparingly." |
| Варианты | regular — для много текста (alert, popover); clear — только поверх богатого медиа-фона | "Only use clear Liquid Glass for components that appear over visually rich backgrounds." |
| Затемнение под clear | при ярком фоне — тёмный слой 35% непрозрачности | "consider adding a dark dimming layer of 35% opacity" |
| Цвет на стекле | сдержанно; цвет — на фон главного действия, не на символ/текст; не красить фон нескольких контролов | "Apply color sparingly ... To emphasize primary actions, apply color to the background rather than to symbols or text." |
| Контролы над контентом | без подложки — scroll edge effect; контент идёт под панели | см. Layout |
| Tab bar | плавающий внизу; может сворачиваться при прокрутке | см. Tab bars > iOS |
| Toolbar | группы по функции (макс. 3), prominent-действие справа; меньше тонировки | см. раздел 8 |
| Концентрические углы | стандартные компоненты — скругление, концентричное углам панели | "ensure that its corner radius is also concentric with the bar's corners" (Toolbars) |
| Тёмный/светлый | даже для одной темы — свои light и dark цвета для адаптивности стекла | "Even if your app ships in a single appearance mode, provide both light and dark colors" |
| Движение стекла | реагирует на касание сильнее | "movement of Liquid Glass responds to direct touch interaction with greater emphasis" (Motion) |
| Hierarchy / Harmony / Consistency | три принципа нового дизайна: Hierarchy — иерархия слоёв и группировка, а не декор; Harmony — согласованность с системой и концентрические углы; Consistency — единое поведение на размерах окон/платформах | Источник — только сниппет поиска к WWDC25 102 и 356 (страницы видео целиком не читались; в HIG-страницах слов «Hierarchy/Harmony/Consistency» как заголовков принципов не найдено): частично не подтверждено |

Для веб-игры: Liquid Glass — системный материал Apple; применимость к вебу в HIG не обсуждается (не подтверждено).

---

## Что не найдено / не подтверждено

- Числовые поля (margins) для iPhone и ширина строки текста в Layout — нет (только tvOS 60/80 pt).
- Правило ALL CAPS для текста в iOS-интерфейсе — не найдено.
- Число кнопок в action sheet для iOS — не задано (только watchOS: ≤4).
- Число вкладок tab bar на iPhone — числом не задано (на iPad при кастомизации — по умолчанию ≤5).
- Пауза на сенсорном экране — отдельных правил нет (только «Menu = settings/pause» для контроллера).
- Страница Settings не читалась.
- Длительности/кривые анимаций в мс — нет.
- Формулировки принципов Hierarchy / Harmony / Consistency — только через сниппет поиска к WWDC25 102/356.
- Реальный минимум размера текста для веб-игры (CSS px vs pt) — HIG даёт pt; соответствие px требует проверки.

---

## Источники

- https://developer.apple.com/design/human-interface-guidelines/designing-for-games
- https://developer.apple.com/design/human-interface-guidelines/game-controls
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.apple.com/design/human-interface-guidelines/typography
- https://developer.apple.com/design/human-interface-guidelines/color
- https://developer.apple.com/design/human-interface-guidelines/dark-mode
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/modality
- https://developer.apple.com/design/human-interface-guidelines/sheets
- https://developer.apple.com/design/human-interface-guidelines/alerts
- https://developer.apple.com/design/human-interface-guidelines/action-sheets
- https://developer.apple.com/design/human-interface-guidelines/segmented-controls
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://developer.apple.com/design/human-interface-guidelines/toolbars
- https://developer.apple.com/design/human-interface-guidelines/menus
- https://developer.apple.com/design/human-interface-guidelines/onboarding
- https://developer.apple.com/design/human-interface-guidelines/feedback
- https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- https://developer.apple.com/design/human-interface-guidelines/playing-audio
- https://developer.apple.com/design/human-interface-guidelines/motion
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/videos/play/wwdc2025/356/ (только сниппет поиска)
- https://developer.apple.com/videos/play/wwdc2025/102/ (только сниппет поиска)
- https://developer.apple.com/videos/play/meet-with-apple/243/ (сниппет: 44 pt по умолчанию, 28 pt для менее важных; не читалась целиком)
