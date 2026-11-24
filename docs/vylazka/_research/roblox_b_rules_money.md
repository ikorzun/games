# Roblox: правила площадки, деньги, доступность, хорроры, мультиплеер (разделы D–I)

Дата исследования: 2026-11-19.

## Оговорка о методе (важно)

- Прямое открытие страниц заблокировано: `create.roblox.com` не резолвится в сессии (`getaddrinfo ENOTFOUND`). По брифу повторных попыток не делал.
- Все факты ниже взяты из поисковых выдач и их кратких пересказов, а не из прочитанных целиком официальных страниц. Официальные страницы указаны как URL, где факт заявлен, но их текст я не читал.
- Многие цифры идут от сторонних сайтов (rolearn.dev, rowatcher.com, nilo.io, endsights.com и т. п.) и помечены «сторонний источник».
- Дата источника указана, если она видна из выдачи. Если даты нет, стоит «дата не видна».
- Только факты, без решений. Всё юридическое и связанное с аккаунтом — «требует проверки».

---

## D. Ассеты и лицензии

### D1. Авторство CC-BY моделей
- Официального поля «attribution» для чужих CC-BY-ассетов, судя по выдаче, нет. Официального правила тоже не найдено (дата не видна). Страницы IP-licensing на create.roblox.com относятся к лицензированию IP для игр, а не к CC-BY: https://create.roblox.com/docs/en-us/ip-licensing/creators
- Практика сообщества по ответам на DevForum (мнения игроков, не правила Roblox):
  - писать кредиты в описании игры, во вкладке «credits» или на внутриигровой доске;
  - ставить маленькую табличку или SurfaceGui на модели.
  - Источники: https://devforum.roblox.com/t/where-should-i-give-credits-to-the-creator-of-3d-model-i-used-in-my-project/769859 , https://devforum.roblox.com/t/creative-attributions/2893112 , https://devforum.roblox.com/t/scpf-licensing-creative-commons-attributions/3320941 , https://devforum.roblox.com/t/nicos-nextbots-licensing-information-creative-commons-attributions
- Известный конфликт (тред про CC-аудио): либо ассет без нужного кредита нарушает лицензию, либо кредит в описании ассета нарушает Community Guidelines. Обходной путь — ссылка на пост DevForum с полными кредитами, но автор треда сомневается, что это безопасно: https://devforum.roblox.com/t/better-guidelines-or-support-for-uploading-licensed-assets-that-require-appropriate-credit/587565
- Требует проверки: ограничения Roblox на внешние ссылки и текст в описании игры и то, где именно допустимо размещать кредиты.
- Тред про CC BY-NC (для сведения): https://devforum.roblox.com/t/using-cc-by-nc-meshes-in-roblox-games/3000720

### D2. Лимиты мешей
- Форматы импорта: FBX, OBJ, glTF/GLB (сторонние пересказы; glTF в 3D Importer — анонс DevForum, дата не видна): https://devforum.roblox.com/t/3d-importer-gltf-file-support-full-release/2584034/14
- Лимит треугольников на один меш, источники расходятся:
  - 21k через 3D Importer и 10k через Asset Manager (пост DevForum): https://devforum.roblox.com/t/roblox-import-3d-bug/2506325
  - 20 000 «по словам сотрудника Roblox» (сторонняя статья, сам пост не найден): https://nilo.io/articles/vibe-code-roblox-triangle-limit
  - Рабочая планка «до 10k» — сторонний совет.
- Размер файла: «20 MB» — только сторонние источники (meshy.ai, nilo.io): https://www.meshy.ai/tutorials/3d-model-for-roblox-workflow
- Масштаб: 1 м Blender = 100 студов при импорте по умолчанию (сторонний источник): https://nilo.io/articles/optimize-model-for-roblox-export
- Модерация: новые загрузки проходят очередь модерации и до одобрения видны только владельцу. Это сказано про аудио (см. D3), для мешей подтверждения в выдаче нет.
- Требует проверки по официальным документам: точные числа треугольников, размера файла и вершин, формат glTF.

### D3. Аудио
- Загрузка требует верификации личности (ID verification) и принятия Audio Terms of Use (create.roblox.com, сводка выдачи): https://create.roblox.com/docs/audio/assets
- Месячные квоты по сообщению сотрудника Roblox в DevForum (год поста не виден, возможно устарело):
  - 10 аудио в месяц без ID-верификации;
  - 100 аудио в месяц с ID-верификацией.
  - Источник: https://devforum.roblox.com/t/public-sound-effects-upload-are-now-available-for-creators/2980704
- Есть тред с просьбой поднять дефолтные лимиты и ввести платные: https://devforum.roblox.com/t/increase-default-audio-upload-limits-and-offer-paid-options/3629892 (дата не видна; текущие квоты не подтверждены).
- Макс. длительность: в выдаче не найдена. Звуковые эффекты короче 10 с можно распространять в Creator Store: https://create.roblox.com/docs/production/creator-store
- Загруженное аудио автоматически классифицируется как «sound effect» или «song». SFX не показываются на странице игры: https://create.roblox.com/docs/audio/assets
- Новые загрузки идут в очередь модерации и видны только владельцу на вкладке Audio в Creator Dashboard (там же).
- Приватность аудио: анонс «[Action Needed] Upcoming Changes to Asset Privacy for Audio» (DevForum, 2022): https://devforum.roblox.com/t/action-needed-upcoming-changes-to-asset-privacy-for-audio/1701697 , итог «[Update] Changes to Asset Privacy for Audio»: https://devforum.roblox.com/t/update-changes-to-asset-privacy-for-audio/1715717 . Текст этих постов я не читал. Из выдачи нельзя восстановить, что именно сделано и как сейчас устроено владение и разрешения на аудио. Требует проверки.
- AI-звуки (ElevenLabs): официальной политики Roblox именно про AI-сгенерированные загрузки в выдаче не найдено. Единственный источник — неофициальное мнение на DevForum: https://devforum.roblox.com/t/ai-generated-music-safe-to-use/3140052
- Условия сторонних сервисов, например лицензия ElevenLabs на коммерческое использование, в этом исследовании не проверялись. Требует проверки.

### D4. Картинки / декали
- Конкретных правил для декалей и фото реальных людей в выдаче не найдено. Общий ориентир: Rules of Conduct запрещают реалистичные изображения экстремального гора и насилия: https://en.help.roblox.com/hc/en-us/articles/203313410-Roblox-Rules-of-Conduct
- Требует проверки: правила про фото реальных людей и лица, модерацию декалей, права на фотоматериалы. По теме есть русскоязычные заметки проекта о запрете на узнаваемых живых людей.

### D5. Open Cloud Assets API
- База: `https://apis.roblox.com/assets/v1/assets`. Авторизация — API-ключ в заголовке `x-api-key` или OAuth 2.0 (scopes `asset:read`, `asset:write`). Ключ создаётся в Creator Dashboard: https://create.roblox.com/docs/cloud/guides/usage-assets
- Статус операции: `GET /assets/v1/operations/{operationId}` (там же).
- Обновление содержимого: PATCH, по документации только для `.fbx`, создаёт новую версию (там же).
- Типы: DevForum говорит об аудио, декалях и моделях: https://devforum.roblox.com/t/opencloud-assets-api/2298007 . Расширение типов: https://devforum.roblox.com/t/open-cloud-upload-support-for-more-asset-types/4022082 (дата не видна).
- Ключ для групповых ассетов создаётся на группе, владельца потом сменить нельзя.
- Расширение через v2: https://create.roblox.com/docs/en-us/cloud/reference/features/assets.md

---

## E. Правила площадки

### E1. Метки зрелости (Content Maturity Labels)
- Метки: Minimal, Mild, Moderate, Restricted. Описания из выдачи по странице https://create.roblox.com/docs/production/promotion/content-maturity (дата страницы не видна):
  - Minimal: изредка лёгкое насилие, лёгкая нереалистичная кровь.
  - Mild: повторяющееся лёгкое насилие, более обильная нереалистичная кровь.
  - Moderate: умеренное насилие, умеренный страх (по сводке выдачи — «moderate fear-based content»), лёгкая реалистичная кровь.
  - Restricted: описана в Restricted Content Policy, доступна только возрастно-верифицированным 18+.
- Доступ по меткам (по той же сводке): Minimal и Mild доступны Roblox Kids (5–8) и Roblox Select (9–15). Moderate — Select и обычные аккаунты 16+. Restricted — только верифицированные 18+.
- Требует проверки: границы возрастных групп. Другой источник даёт «Select 9–15», а ниже есть ссылки на 17+ для сильной реалистичной крови.
- Опыты без заполненной информации о зрелости Roblox трактует как Moderate: https://create.roblox.com/docs/production/promotion/content-maturity
- Опросник «Maturity & Compliance Questionnaire» — после отправки выдаётся метка с дескрипторами и результат по региональной совместимости. Заполнение «настоятельно рекомендуется»; сказано, что без него игра приравнивается к Moderate. Обязателен ли он строго — в выдаче чётко не сказано, требует проверки. Обновление опросника: https://devforum.roblox.com/t/updates-to-our-maturity-compliance-questionnaire/3860056
- Для Restricted нужна верификация 18+. Метку Restricted нельзя вернуть назад, обновлять можно только дескрипторы (там же).
- Старое название «Experience Guidelines» переименовано в «Content Labels»: https://devforum.roblox.com/t/upcoming-changes-to-experience-guidelines/3070343 (анонс 2024, точная дата не видна). Справка: https://en.help.roblox.com/hc/articles/8862768451604
- Обновление политик: https://devforum.roblox.com/t/updates-to-content-maturity-and-compliance-moderation-policies/3709028

### E2. Хоррор, страх, кровь
- Страшные элементы нужно раскрывать в опроснике. В примерах: скримеры, жуткие NPC, зловещая музыка (пост DevForum про Experience Guidelines): https://devforum.roblox.com/t/upcoming-changes-to-experience-guidelines/3070343
- Для Moderate есть дескриптор «moderate fear-based content» (сводка выдачи, страница content-maturity).
- Реалистичные или чрезмерные сцены насилия и крови могут модерироваться вне зависимости от метки (там же).
- Сильная реалистичная кровь — только верифицированные игроки 17+ (там же, сводка выдачи). Rules of Conduct запрещают реалистичный экстремальный гор, графическое насилие и смерть: https://en.help.roblox.com/hc/en-us/articles/203313410-Roblox-Rules-of-Conduct
- Отдельных правил именно про «неожиданные скримеры» в выдаче не найдено; упоминание есть только как пример страшного элемента для опросника.
- Для хоррора без крови выдача подтверждает метку Moderate по описанию «moderate fear-based content». Но выбор Mild или Moderate для конкретной игры определяет сам опросник; точные условия требуют проверки.

### E3. Возраст и проверка возраста
- С января 2026 глобально проверка возраста (facial age estimation или ID, вендор Persona) обязательна для доступа к чату. Этапы: пилот в отдельных странах в декабре 2025, глобально с начала января 2026.
  - https://techcrunch.com/2025/11/18/roblox-will-require-all-users-to-perform-age-checks-to-access-chat-from-january
  - https://www.nasdaq.com/press-release/roblox-requires-users-worldwide-age-check-access-chat-2026-01-07
  - https://devforum.roblox.com/t/age-check-requirement-to-chat-now-live-globally/4226101
- Изображения удаляются после проверки (заявление Roblox, пересказ СМИ): https://www.biometricupdate.com/202511/roblox-to-make-age-assurance-for-chat-mandatory-as-of-january-2026
- Верифицированных пользователей группируют по возрастным диапазонам для чата (там же).
- Новые аккаунты младших возрастов: Roblox Kids (5–8) и Roblox Select (9–15) упомянуты в сводке docs и в сообщениях о РФ: https://insights.finalboss.io/briefings/roblox-announces-a-5-optional-sub-and-two
- Требует проверки: конкретные ограничения доступа к играм для младше 9 и младше 13, детали возрастных диапазонов и родительское согласие.

---

## F. Деньги

### F1. DevEx
- Курс, по выдаче и сторонним сайтам: 0.0038 USD за 1 Earned Robux; 30 000 Earned Robux = 114 USD; минимум вывода 30 000 Earned Robux. Earned Robux, полученные до 5 сентября 2025, выводятся по старому курсу 0.0035, и такие остатки выводятся первыми.
  - https://create.roblox.com/docs/production/monetization/developer-exchange
  - сторонний пересказ: https://rowatcher.com/news/the-real-roblox-devex-rate-in-2026-it-s-not-0-0035
- Расхождения источников: rolearn.dev называет минимум 100 000, totalcalchub — 50 000. Эти страницы выглядят устаревшими: https://rolearn.dev/guidance/roblox-devex-requirements-2026
- Отдельный курс «U.S. 18+»: страница https://create.roblox.com/docs/en-us/production/monetization/18-plus-devex-rate существует. Цифра 0.0054 с 8 июня 2026 — только по сторонним сайтам, не подтверждена, для «qualifying spend only».
- Требования (возраст, верификация, страна, Premium): страницу не удалось прочитать. Заявлено, что Roblox не гарантирует одобрение, все заявки проверяются. Выплаты идут через Tipalti: https://en.help.roblox.com/hc/pl/articles/27985018895124-Tax-and-DevEx-Portal-Tipalti-Information
- Требует проверки: возраст, ID-верификация, Premium, страны.

### F2. Доля Roblox
- Подтверждённой цифры доли Roblox с продаж в выдаче нет. Требует проверки по официальным документам.
- Есть пост «Earn a Higher Revenue Share for $9.99+ Paid Access Experiences» (повышенная доля для платных доступов от $9.99; детали не читал): https://devforum.roblox.com/t/earn-a-higher-revenue-share-for-999-paid-access-experiences/3294010
- Сторонний заголовок про изменение доли для 2D-предметов (с 70% до 30%) и подписку Roblox Plus — не проверено, отношения к опыту может не иметь: https://tech-insider.org/roblox-2d-creator-revenue-share-cut-2026/

### F3. Платный доступ (Paid Access)
- Цена 25–1000 Robux, разовая. Аккаунту не менее 30 дней, опыт публичный. Выплата с задержкой (escrow) до 7 дней, возвратов нет, на Xbox недоступно: https://create.roblox.com/docs/production/monetization/paid-access-robux
- Страница Creator Hub обновлена 17 августа 2026 (по выдаче); сведений об отмене функции не найдено: https://create.roblox.com/docs/production/monetization/paid-access
- Россия указана среди стран, где пользователи не могут покупать платный доступ в местной валюте (пост DevForum, дата не видна): https://devforum.roblox.com/t/earn-a-higher-revenue-share-for-999-paid-access-experiences/3294010 . Требует проверки.

### F4. Game Passes и Developer Products
- В выдаче нет конкретных условий. Для обзора: https://create.roblox.com/docs/en-us/production/monetization . Требует проверки.

### F5. Engagement-Based (Premium) Payouts
- Официально: выплата Robux пропорционально доле времени, которое Premium-подписчики проводят в опыте, независимо от размера игры: https://create.roblox.com/docs/production/monetization/engagement-based-payouts
- Фиксированной ставки «за 1000 минут» в официальных источниках нет. Оценки rolearn.dev (5–15 Robux за пользователя в день) — сторонние и не подтверждены: https://rolearn.dev/insights/roblox-creator-rewards-payout-guide

### F6. Реклама
- Rewarded video: на CES 2026 Roblox сообщил, что формат используют более чем в 400 опытах, завершаемость свыше 90%, видимость выше 95%: https://about.roblox.com/newsroom/2026/01/roblox-expands-advertising-platform
- На RDC 2026 анонсирован плагин Studio для rewarded video, ожидается в Q4 2026 (сводка MediaPost): https://www.mediapost.com/publications/article/417959/
- С 4 мая 2026 интеграции брендовой рекламы нужно регистрировать и отправлять ассеты на модерацию. Rewarded-реклама и ряд категорий запрещены для пользователей младше 13 (сторонняя сводка выдачи, источник неясен). Требует проверки.
- Условия доступа (число игроков, Premium Payouts, верификация) — только по сторонним руководствам. Требует проверки: https://rolearn.dev/guidance/ad-monetization-rewarded-video
- Ставки: rolearn.dev называет CPM $5–15 (оценка); пользователь DevForum — около $0.43 CPM (единичный случай): https://devforum.roblox.com/t/more-creators-can-now-use-rewarded-video-ads/3838678
- Immersive Ads: общая страница есть только в сторонних источниках: https://endsights.com/roblox-immersive-ads . Условия не проверены.

### F7. Россия и выплаты
- Официального перечня стран DevEx не найдено. Roblox пишет, что не может проводить платежи в отдельные страны и лицам по юридическим причинам, и отсылает к покрытию Tipalti: https://en.help.roblox.com/hc/pl/articles/27985018895124-Tax-and-DevEx-Portal-Tipalti-Information
- Единичные сообщения российских разработчиков (2022–2023): из-за санкций невозможно выбрать способ выплаты, Robux копятся, но вывести нельзя: https://devforum.roblox.com/t/about-devex-payments-in-russia/2137256 . Дата 2023 по номеру темы, текущий статус неизвестен.
- Список стран DevEx: https://devforum.roblox.com/t/what-countries-is-devex-supported-in/3510524 . Содержимое не читал.
- Требует проверки: поддерживается ли сейчас Россия в DevEx и Tipalti.

### F8. Playgama (для сравнения)
- Расхождение источников:
  - Блог Playgama: ступенчатая доля — 70% до $1000, затем 80%, затем 90% свыше $3000. Источники: https://playgama.com/blog/business-faqs/what-revenue-share-do-game-catalogs-pay/ , https://playgama.com/blog/business-faqs/poki-vs-crazygames-vs-gamedistribution-revenue-share/
  - Другой FAQ Playgama: на самом playgama.com и в iframe-партнёрской сети разработчик получает 50%; ступенчатая шкала относится к игре на партнёрских сайтах (неясно).
  - Сообщение на форуме о 40% — ненадёжно: https://scriptstribe.com/forums/thread/220/PlayGama-Info-What-is-the-commission
- Порог выплат: от $100 (FAQ Playgama): https://playgama.com/blog/business-faqs/what-are-typical-payment-thresholds-for-game/
- Playgama запустила собственные рекламные продукты (февраль 2026): https://nextbiggames.com/2026/02/12/playgama-ad-web-gaming-advertising-solution/
- Требует проверки: текущие условия Playgama в консоли и договоре партнёра.

---

## G. Доступность в России

### G1. Блокировка и разблокировка
- 3 декабря 2025: Роскомнадзор заблокировал Roblox. Заявлены «экстремистские материалы», «пропаганда ЛГБТ», недостаточность модерации для защиты детей. Это не пересказ выводов, а заявленные мотивы.
  - https://www.bnnbloomberg.ca/business/2025/12/03/russia-blocks-access-to-us-childrens-gaming-platform-roblox/
  - https://interfax.com/newsroom/top-stories/115142/
  - https://meduza.io/en/feature/2025/12/04/russia-bans-roblox-over-child-safety-fears
- Предупреждения были раньше: 10 июля 2025 РКН сообщил об удалении трёх материалов, 29 ноября 2025 — аналогичное заявление (пересказ выдачи, источник: https://en.thairath.co.th/news/foreign/2899971).
- 9 июня 2026: Минцифры и РКН попросили правоохранительные органы поддержать снятие ограничений, сославшись на гарантии Roblox: https://meduza.io/en/news/2026/06/09/russia-s-digital-ministry-seeks-to-lift-roblox-ban-saying-the-platform-has-agreed-to-meet-government-requirements , https://interfax.com/newsroom/top-stories/118003/
- 10 июня 2026: блокировка снята. Минцифры заявило, что Roblox «полностью выполнил требования законодательства о безопасности пользователей». Доступ делится на возрастные категории «Roblox Kids» и «Roblox Select»:
  - https://meduza.io/en/news/2026/06/10/russia-ends-roblox-block
  - https://interfax.com/newsroom/top-stories/118028/
  - https://www.thestar.com.my/tech/tech-news/2026/06/10/russia-lifts-roblox-ban-interfax-reports
  - https://united24media.com/world/63000-russian-children-successfully-petition-kremlin-to-overturn-roblox-platform-ban-19667
- 11 июня 2026: у российских пользователей недоступен чат («Chat is not available in your region»): https://meduza.io/en/news/2026/06/11/russian-kids-can-play-roblox-again-they-just-can-t-talk-to-anyone-in-the-game . Восстановили ли чат — не найдено.
- Статус на ноябрь 2026: новее июня материалов не найдено. Требует проверки, не было ли повторных ограничений.
- Studio из РФ, публикация и тестирование, риски аккаунта: в выдаче не найдено. До разблокировки играли через VPN (констатация, не рекомендация): https://www.tomsguide.com/computing/online-security/russia-blocks-roblox-and-demand-for-vpns-skyrockets . Требует проверки: работает ли Studio и Cloud API из РФ, влияние на аккаунт.
- Заявления Roblox о сделке с властями РФ не найдено, всё идёт от российских ведомств и СМИ.

### G2. Аудитория по регионам
- Q3 2025: 151.5 млн DAU (Reuters/GamesBeat): https://gamesbeat.com/roblox-had-151m-daily-active-users-in-q3-2025/
- Q3 2026 (по одному стороннему блогу, ссылающемуся на письмо акционерам; сам отчёт не найден): США и Канада 24 млн (−10% г/г), Европа 32 млн (−5%), APAC 42 млн (−9%), Rest of World 40 млн (−11%), всего 138 млн (−9% г/г, +12% к/к): https://www.gamingamigos.com/post/roblox-q3-2026 . Outlook Respawn подтверждает 138 млн и рост Индии на 37%: https://respawn.outlookindia.com/gaming/gaming-news/roblox-q3-2026-india-growth-amid-ai-push-and-falling-bookings
- Бразилия и Латинская Америка отдельной строкой в выдаче не найдены (в отчётах идут в Rest of World). Требует проверки.
- Россия отдельным регионом не выделена.

### G3. Автоперевод
- Расхождение источников, критично:
  - Creator Hub docs (сводка выдачи, страница обновлена 20 октября 2026): 13 языков, в списке арабский, китайский (упр. и трад.), английский, французский, немецкий, хинди, индонезийский, итальянский, японский, корейский, польский, португальский. Русского и испанского в сводке нет: https://create.roblox.com/docs/production/localization/automatic-translations . Список мог быть обрезан сводкой.
  - Roblox Help Center (сводка): 17 языков, включая португальский и испанский, без русского: https://en.help.roblox.com/hc/en-us/articles/40269095851284-Enabling-Automatic-Translations-in-Account-Settings
  - Сторонний блог (около месяца назад): 18 языков, включая португальский, русский и испанский: https://gamertagmythras.com/blog/roblox/roblox-localization-translation-guide
  - DevForum 2024: автоперевод между 16 языками: https://devforum.roblox.com/t/automatic-translation-now-available-between-16-languages/2912942
- Бразильский ли португальский — не выяснено.
- Таблицы локализации: автоперевод собирает строки, встреченные при тестировании или игре, и переводит их в таблицу локализации опыта. Квоты считаются по символам и языкам (docs, там же). Ручная загрузка переводов остаётся возможностью.
- Требует проверки: список языков в Creator Hub, Languages tab.

---

## H. Хорроры на Roblox

Данные в основном сторонние, без дат снятия. Цифры расходятся.

- Doors: посещений 5–7.5 млрд (разные источники); пик одновременных около 12 000 в июле 2026 (сторонний трекер); награда Best Horror на Roblox Innovation Awards 2024; кооп до 4 игроков:
  - https://rowatcher.com/games/2440500124
  - https://rolearn.dev/games/2440500124/
  - https://www.pcgamesn.com/roblox/doors-horror-game
- The Mimic: более 1.3 млрд посещений (список к Хэллоуину 2026); рецензенты называют его лучшим одиночным хоррором: https://www.gfinityesports.com/article/top-10-best-horror-games-for-halloween-on-roblox-2026 , https://www.itechguides.com/how-to-choose-between-doors-the-mimic-and-apeirophobia/ . Верифицированных данных о концурренси нет.
- Apeirophobia: более 1 млрд (один источник) или 438.5 млн посещений и ~12k пика (другой); команда якобы строит преемника «Elsewhere»; спор о владении (сторонний источник): https://www.rotrends.com/game/3761186887/Apeirophobia , https://www.endsights.com/best-horror-games/
- Pressure: 2–4 игрока, подводная станция, более 500 млн посещений (сторонний агрегат); данных о концурренси подтверждённых нет: https://endsights.com/horror-game-design
- Forsaken: около 135 тыс. игроков на момент сбора, 99 Nights in the Forest — около 226 тыс. (сторонние данные; это скорее кооп-выживание, не медленный соло-хоррор): https://www.endsights.com/best-horror-games/ , https://axeetech.com/best-roblox-horror-games/
- Dandy's World, Piggy, The Rake, Dead Silence: в выдаче цифр нет, требуют отдельного поиска.
- Приёмы (сторонний разбор Doors, Pressure, Apeirophobia — свет, звук, ограничение обзора): https://endsights.com/horror-game-design . Это не первичный источник.
- Монетизация, длина сессии, метки зрелости конкретных игр: в выдаче нет. Требует проверки по страницам игр и трекерам.
- Успешные одиночные медленные хорроры: данных кроме The Mimic (соло по рецензиям) не найдено.
- Рейтинги и топ-списки: https://www.playnews.gg/en/guides/roblox-the-10-best-horror-games-in-2026 , https://rowatcher.com/news/10-best-roblox-horror-games-in-2026-from-dandy-s-world-to-hidden-gems

---

## I. Мультиплеер и одиночный режим

- Строго одиночная игра возможна по описаниям DevForum:
  - выставить лимит игроков 1 для плейса и телепортировать игроков в него;
  - использовать reserved servers (`TeleportService:ReserveServer` и `TeleportAsync`) — на такой сервер попадает только тот, кого телепортировали.
  - Источники (ответы сообщества, не официальные документы): https://devforum.roblox.com/t/teleport-a-single-player-to-a-reserved-server/862190 , https://devforum.roblox.com/t/only-1-player-servers-but-player-can-invite-friends/1308199 , https://devforum.roblox.com/t/limit-game-to-only-1-server/3096613
- Известные проблемы: сообщения об ошибках HTTP 403 при `ReserveServer` и о том, что reserved slots не учитывались в `TeleportAsync`: https://devforum.roblox.com/t/http-403-error-is-occuring-when-calling-reserveserver/2661417 , https://devforum.roblox.com/t/teleportserviceteleportasync-does-not-respect-server-reserved-slots/1778264
- Влияние на рекомендации и обнаружение: в выдаче не найдено. Требует проверки.
- Стоимость серверов для разработчика: фактов в выдаче нет; нулевая стоимость по умолчанию не подтверждена, но и платы за хостинг в найденных материалах не упоминается. Требует проверки.

---

## Неподтверждённое (сводка)

1. Лимит треугольников и размер файла мешей: 20k, 21k или 10k; 20 MB (сторонние источники).
2. Месячные квоты аудио (10/100), макс. длительность аудио и текущие правила приватности аудио после 2022.
3. Официальная политика Roblox по AI-звукам; лицензия ElevenLabs.
4. Официальное правило про CC-BY и размещение кредитов; ограничения на ссылки в описании.
5. Правила по фото реальных людей, декалям, лицам.
6. Обязательность опросника и точные границы Mild/Moderate для хоррора без крови; правила про скримеры.
7. Ограничения доступа к играм для младше 9 и младше 13.
8. Доля Roblox с продаж; Game Passes и Developer Products; курс «U.S. 18+» (0.0054).
9. Требования DevEx (возраст, верификация, страны, Premium).
10. Работа DevEx и Tipalti для россиян сейчас; единственные свидетельства — анекдоты 2022–2023.
11. Статус Roblox в РФ на ноябрь 2026; работает ли Studio и публикация из РФ; восстановлен ли чат; риски для аккаунта.
12. Региональная раскладка DAU Q3 2026 (один сторонний блог); Бразилия и Латинская Америка отдельно.
13. Список языков автоперевода (13/17/18; русский и испанский спорны); бразильский ли португальский.
14. Цифры хорроров (посещения и онлайн) — сторонние и расходящиеся; Dandy's World, Piggy, The Rake, Dead Silence не охвачены.
15. Условия и ставки rewarded video и Immersive Ads; условия Playgama (50% против ступенчатой шкалы).
16. Влияние одиночного режима на рекомендации и стоимость серверов.
17. Связь «Roblox Plus» с публикацией и изменения доли для 2D-предметов — упомянуты только в стороннем заголовке.

Домен `create.roblox.com` недоступен для открытия страниц в этой сессии; для проверки пунктов выше его нужно разрешить в сетевых настройках сессии.
