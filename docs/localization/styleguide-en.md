# Стайлгайд перевода: английский (США, en-US)

Для переводчиков и редакторов `en`; входит в системный промпт машинного черновика (`../architecture/05-localization.md` §3) и служит чеклистом редактора-носителя.
Читать вместе с `05-localization.md` §4–6, `../architecture/07-narrator-styleguide.md` и `glossary.md` (приоритет у глоссария). Примеры — из `locales/en/ep01_murylev.json`. Статус: черновик без проверки носителями.

## 1. Вариант языка и аудитория

- **American English (en-US).** `en` обязателен на Playgama (язык по умолчанию и fallback) и служит опорным текстом для es/pt, поэтому он точен, ничего не опускает и не строится на игре слов, которую нельзя пересказать.
- **Аудитория** — широкая публика порталов, для многих английский второй язык: короткие конкретные фразы, минимум фразовых глаголов и идиом; реалии объясняем через глоссарий, а не отсылками к США.
- **Британизмы не использовать:** -our/-re/-ise (neighbour → neighbor, centre → center, dramatised → dramatized); flat → apartment, lift → elevator, queue → line, lorry → truck, whilst/towards → while/toward; `Mr` → `Mr.`; `4 July 1991` → `July 4, 1991`.
- **На момент написания в ep01 ещё есть:** neighbour (×3), viewings → showings, bedside table → nightstand, the fourteenth of June → June fourteenth, `dramatised` в `ui.json`; в `glossary.md` — centre, remand prison, identikit, parlour, five-storey.

## 2. Два голоса

- **Рассказчик** — сухо, документально, 3-е лицо; точность вместо транскреации; без шуток и обращения к игроку. Simple past для фактов, настоящее — только где оно в ru; без сокращений (*did not*), без оценок, кроме *brutal / brazen / incredible* (жестокий / дерзкий / невероятный).
- Канцелярит протоколов — устойчивыми формулами: *was detained, testified, released on his own recognizance, was dropped from the indictment*. **Документ** (доверенность, карточка БТИ): формулы делового английского (*I, …, authorize…*, *Certified by notary…*), заголовки капсом и порядок полей бланка как в оригинале.
- **Персонажи** — транскреация, живая речь 90-х: сокращения (*I'm, won't*), короткие фразы, умеренный сленг без анахронизмов (*dude, legit, sketchy*) и без «мафиозной» лексики США (*wise guy, made man*): русская братва — не Коза Ностра; свидетель — испуганная, обрывистая речь. Внутренний голос (`narrate`, `style: inner`) — короткие фрагменты.
- **«Вы» / «ты»** не различаются — регистр делаем лексикой. Следователь → подозреваемый, свидетель: полные фразы, *Mr. Murashov*; опер → задержанный («ты»): рубленые фразы, фамилия или *you*, без *please*; соседка → пенсионерка: *Zoya Pavlovna* и вежливые обороты; бандит → следователь: холодная вежливость.
- «Трясти» (опер) — *lean on / squeeze*, не *shake down*: это вымогательство, «наезд» из глоссария.

| Ключ, голос | ru | Плохо | Хорошо |
|---|---|---|---|
| `s20.l004` рассказчик | …не дал показаний в суде. Эпизод с его квартирой выпал из обвинения. | Lapin did not give any indications in court. The episode with his apartment fell out of the accusation. | Lapin never testified in court. The count concerning his apartment was dropped from the indictment. |
| `s10.l001` рассказчик | …разговаривать с милицией. | …never to talk to the militia again. | …never to talk to the police again. |
| `s09.l002` опер → Лапин | Ты живёшь в квартире женщины, которую никто не видел два месяца. | You are residing in the apartment of a woman whom nobody has seen for two months. | You're living in the apartment of a woman nobody has seen for two months. |
| `s17.l001` бандит → следователь | Вы следователь? … Я люблю, когда люди работают по бумагам. | You are an investigator? … I like when people work on papers. | You're the investigator? … I like it when people work by the book. |

## 3. Реалии и сленг

- Стратегию берём из `glossary.md`, не изобретаем: **эквивалент** (опер → *detective*, крыша → *protection*), **транслитерация + пояснение** (*strelka, a gangland sit-down*), **описательный** (ИВС → *temporary detention cell*), **сохранение + архив** (*voucher*), **нейтральная замена** (кидалово → *scam*).
- Институты США не подставлять: следователь прокуратуры — *prosecutor's investigator*, не *district attorney*; милиция — *police* (в США *militia* — вооружённые ополченцы), *militsiya* только в архивной справке. **Ловушки:** «ордер» (жилищный) → *housing warrant*, не *search warrant*; «эпизод» обвинения → *count*; «показания» → *testimony*.
- **Первое появление.** У рассказчика — короткая приложка (*a strelka, a gangland sit-down between two crews*), дальше просто *strelka*. В реплике персонажа не пояснять: эквивалент либо термин без пояснения + карточка архива. Аббревиатуры (*BTI, MUR*) — с расшифровкой; в титре (≤ 56) допустимо описание: *Bureau of Technical Inventory*.
- **Не локализовать:** имена и отчества; улицы, районы, газеты (*Molodogvardeyskaya Street, Presnya, Vechernyaya Moskva*) — переводим только родовое слово; марки (*Volga, Lada*); рубли — *rubles* (не ₽ и не пересчёт в доллары; масштаб денег объясняет архив).

## 4. Имена и транслитерация

- **Основа — упрощённая BGN/PCGN** без диакритики и апострофов (ё → yo, ъ/ь опускаем, ц → ts, х → kh, ч → ch, ш → sh, щ → shch, ю → yu, я → ya); это исходная форма и для es/pt. Ударения в en не ставим.
- **Личные имена** — как в ep01: *Andrei Gromov, Viktor Saiko, Sergei Murashov*; топонимы и улицы — строго по таблице: *Molodogvardeyskaya, Presnya*. Классы расходятся (по BGN/PCGN было бы *Andrey, Sergey, Sayko*): пока писать как в ep01, новые имена согласовывать с редактором.
- **Отчества и женские формы** сохраняем: *Zoya Pavlovna, Sergei Viktorovich, Levina, Gromova*. В документах порядок «имя отчество фамилия»: «С. Зоя Павловна» → *Zoya Pavlovna S.*; инициалы — через неразрывный пробел: *A. N. Kovrigin*.
- **Прозвища** переводим по смыслу и заносим в глоссарий («Удав» → *The Boa*); звания и должности — только по глоссарию. es/pt вправе адаптировать написание под чтение (`glossary.md`, «Правила имён»); английская форма для них — опора.

## 5. Типографика

| Что | Правило | Пример |
|---|---|---|
| Кавычки | “ ” основные, ‘ ’ вложенные; точка и запятая внутри; апостроф ’ (не ') | `Gromov wrote: “no signs of a struggle found.”` |
| Тире, запятая | em dash без пробелов, en dash в диапазонах; … — один символ; ru-тире механически не переносить; серийная запятая | `1991–1996`; `keys, papers, and a housing warrant` |
| Даты | Month D, YYYY; цифровые даты ru раскрывать словами (dd.mm не спутать с mm.dd); в титрах *Oct.* | `July 4, 1991`; `28.06.1993` → `June 28, 1993` |
| Числа, деньги | 1,500; 2.5; у рассказчика числа словами (до ста), цифрами — даты, возраст (*32-year-old*), деньги | `twelve years`; `12,000 rubles` |
| Единицы | метрические оставляем, без пересчёта в мили и футы | `60 meters`, `−20 °C` |
| Время | 12-часовое, строчные с точками | `7:40 p.m.` |
| Регистр | Title Case — названия эпизода, частей, мини-игр, концовок и карточек архива; sentence case — всё остальное (кнопки, выборы, подписи UI, подсказки) | `Part One. The City` / `Text speed` |
| Nbsp | U+00A0 (в примерах — настоящий) между инициалами и фамилией, числом и единицей, перед *p.m.* | `A. N. Kovrigin` |

## 6. Лимиты длины и UI

- Лимиты в символах Unicode (пробелы и `{плейсхолдеры}` считаются): **кнопка выбора ≤ 60 · `date_stamp` ≤ 32 · `location` ≤ 56 · `lower_third` ≤ 48 · заголовки ≤ 40 · подписи UI ≤ 24 · `fact` ≤ 120 · `say` ≤ 220 · `narrate` ≤ 240.**
- Линтер даёт WARN по `option, date_stamp, location, lower_third, chapter, fact, say, narrate`; прочие заголовки и подписи UI проверяем вручную. На пределе в ep01: `s15.cap` *Presnya. October 1993. 7:40 p.m.* ровно 32 — ничего не добавлять; `s13.cap` (`lower_third`) 45 из 48.
- **en — база вёрстки:** UI проектируется на *en + 35 %*, поэтому подписи UI в en держим ≤ 18 (24 / 1,35), иначе es/pt не уложатся: *Watch an ad for a hint* (22) → *Hint: watch an ad* (17). Остальной текст en не раздуваем: запас нужен es/pt. Кнопка выбора в en — одна строка (`03-visual-language.md` §8).
- **Плейсхолдеры** `{n}` не переводить, не менять написание, не вплетать в грамматику: `{n} min`; вместо *{n} days* — *Days: {n}*.
- **Сокращаем без потери смысла:** убираем повтор промпта выбора и вводные; глагол вместо существительного; стандартные сокращения (*min, Oct.*). Длинную должность в `lower_third` — до ядра, полное название в архив: *Andrei Gromov, senior investigator* вместо *…senior investigator for major cases* (50 > 48). Варианты выбора остаются различимыми.

## 7. Контент и право

- **Грубая лексика** — тот же уровень, что в ru, без усиления: мягкое («блин», «чёрт») → *damn, hell, crap*. **Насилие** — как в источнике: деталь или последствие, не действие (*the bullet grazed Saiko's shoulder*); натурализм и интенсификаторы не добавлять.
- **Процессуальный статус не повышать и не смещать:** подозреваемый → *suspect*, обвиняемый и подсудимый → *defendant*, осуждённый → *convicted*; «дело доведено до суда» ≠ «осуждён» (`s23.fact`: *The case was brought to trial in 1994…*); *killer / murderer* — только о приговорённых.
- **Дисклеймер** (`ui.disclaimer.body`) — утверждённая формула; формулы вида «true story» запрещены. Последнего предложения нет в нынешнем `ui.json` (en), хотя оно есть в ru, — добавить после юридической проверки:
  > “Based on a real criminal case. Dialogue, certain characters and events have been dramatized or invented; some names have been changed. Any resemblance of fictional characters to real persons is coincidental. This game is not an official document and does not claim to reproduce events exactly.”
- **Предупреждение и «18+»** (`ui.warning.body_generic`): “This episode contains scenes of violence and descriptions of real crimes. 18+” — «18+» остаётся меткой; в сборке 16+: “…Scenes of violence are shown schematically, without graphic detail. 16+”.

## 8. Чеклист перед сдачей

1. Заполнены все ключи, пустых строк нет; ключи и порядок не менялись; плейсхолдеры `{...}` совпадают с ru символ в символ (иначе ERROR).
2. Лимиты длины (§6): без WARN; подписи UI проверены вручную (en ≤ 18).
3. Имена, отчества, прозвища, должности — по §4 и глоссарию.
4. Реалии: стратегия по глоссарию, пояснение при первом появлении, в репликах персонажей без пояснений; *militia* нет.
5. Нет британизмов (поиск: `neighbour`, `centre`, `-ise`, `flat`, `lift`, даты вида `4 July`).
6. Рассказчик — без сокращений и оценок, времена как в ru; персонажи — сокращения, один регистр на героя.
7. Кавычки (точка внутри), апострофы ’, тире, даты, время, регистр — по §5.
8. Грубая лексика и насилие не сильнее источника; статусы лиц не повышены; дисклеймер и «18+» — только утверждённый текст.
9. Реплики прочитаны в контексте (колонка `context` экспорта): кто говорит, кому, в какой ситуации.
10. К сдаче — список спорных ключей «ключ — вопрос»; сомнения по ru уходят сценаристу, а не решаются догадкой.

```bash
# пример пути: episodes/examples/ep01_murylev.json
python3 tools/validate_episode.py episodes/<путь>.json   # ожидаем: ошибок 0, предупреждений 0
python3 tools/loc_sync.py stats episodes/<путь>.json     # ожидаем: 100 % по вашему языку (только полнота, не качество)
```
