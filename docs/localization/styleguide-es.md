# Стайлгайд перевода: испанский (латиноамериканский нейтральный, es-419)

Для переводчиков и редакторов `es`; входит в системный промпт машинного черновика (`../architecture/05-localization.md` §3) и служит чеклистом редактора-носителя.
Читать вместе с `05-localization.md` §4–6, `../architecture/07-narrator-styleguide.md` и `glossary.md` (приоритет у глоссария). Примеры — из `locales/es/ep01_murylev.json`. Статус: черновик без проверки носителями.

## 1. Вариант языка и аудитория

- **Нейтральный латиноамериканский испанский (ориентир es-419).** Крупнейшая аудитория порталов — Мексика и Латинская Америка; текст не должен «звучать» как одна страна. Переводим с `ru`, `en` — опора; расхождение смысла выносим вопросом сценаристу, не угадываем.
- **Tuteo; voseo не использовать** (*vos tenés, vos sos*); множественное — только *ustedes* (никаких *vosotros*, *-áis/-éis*). Прошедшее рассказчика — *pretérito indefinido* (*no notaron, fue aprobada*), без «испанского» *perfecto compuesto* для законченных фактов.
- **Испанские регионализмы исключить:** *vale, tío, coche, piso, ordenador, móvil, gafas, zapatillas, joder, gilipollas* и особенно *coger* (в Мексике и Аргентине вульгарно; → *agarrar, atrapar, detener*). Нейтрально: *de acuerdo, auto, apartamento, computadora, celular, lentes, pantuflas*.
- **Маркеры других стран** тоже не использовать: *che, boludo* (Ла-Плата), *güey, órale, chido, chamba, ahorita* (Мексика), *parce, chévere* (Колумбия/Карибы). Квартира — *apartamento* (по умолчанию, `glossary.md`; *departamento* — вариант Мексики и юга региона), внутри эпизода не смешивать.

## 2. Два голоса

- **Рассказчик** — сухо, документально, 3-е лицо; точность вместо транскреации; без шуток и обращения к игроку. Факты — *pretérito indefinido*, настоящее — только где оно в ru. Без оценок, кроме *brutal / audaz / increíble* (жестокий / дерзкий / невероятный).
- Канцелярит протоколов — формулами: *fue detenido, declaró, quedó en libertad bajo compromiso de no salir de la ciudad, quedó fuera de la acusación*; в повествовании *detuvieron*, не *agarraron*. **Документ**: формулы делового испанского (*PODER. Yo, …, autorizo a …*, *Certificado por el notario …*), заголовки капсом и поля бланка как в оригинале.
- **Персонажи** — транскреация, живая речь 90-х, без современного сленга и англицизмов (*cringe, ghostear*): опер — рубленые фразы, *apretar, agarrar*; бандит — холодная вежливость; пенсионерка и соседка — «Zoya Pávlovna» без *doña*; свидетель — испуганная, обрывистая речь. Внутренний голос (`narrate`, `style: inner`) — короткие фрагменты.
- **Обращение зеркалим по ru:** «вы» → *usted*, «ты» → *tú*; смену внутри сцены (опер переходит на «ты», когда давит) переносим.

| Ситуация (ep01) | ru | es |
|---|---|---|
| следователь → подозреваемый, свидетель; опер → свидетель, пока не давит; сосед → пенсионерка; бандит → следователь (холодно); эксперт → следователь (`s06.l001`) | вы | *usted*; гражданин X → *señor X* |
| опер → задержанный или тот, на кого давит (`s09.l002`); близкие, друзья | ты | *tú* (не *usted*, не *vos*) |
| игрок: инструкции / кнопки выбора и подписи UI | вы / — | *usted* (*Elija…*) / инфинитив и существительные (*Inspeccionar…*, *Ajustes*) |

| Ключ, голос | ru | Плохо | Хорошо |
|---|---|---|---|
| `s09.l002` опер → Лапин | Ты живёшь в квартире женщины, которую никто не видел два месяца. | Vos vivís en el piso de una mujer a la que nadie ha visto en dos meses. | Vives en el apartamento de una mujer a la que nadie ha visto en dos meses. |
| `s01.l002` соседка → пенсионерка | Зоя Павловна, вы дома? Я вам молоко принесла. | Zoya Pávlovna, ¿estás en casa? Te traje leche. | Zoya Pávlovna, ¿está en casa? Le traje leche. |
| `s20.l004` рассказчик | …не дал показаний в суде. Эпизод с его квартирой выпал из обвинения. | Lapin no dio testimonios en la corte. El episodio de su apartamento cayó de la acusación. | Lapin nunca declaró en el juicio. El cargo relativo a su apartamento quedó fuera de la acusación. |
| `s15.l001` опер | Берём обоих сейчас или ждём, пока разойдутся? | ¿Los cogemos a los dos ahora o esperamos a que se separen? | ¿Los agarramos a los dos ahora o esperamos a que se separen? |

## 3. Реалии и сленг

- Стратегию берём из `glossary.md`, не изобретаем: **эквивалент** (крыша → *protección*, кидалово → *estafa*), **транслитерация + пояснение** (*strelka, una “reunión” entre bandas*), **описательный** (СИЗО → *centro de detención preventiva*), **сохранение + архив** (*voucher*).
- Опер → *agente de investigación*, следователь прокуратуры → *investigador de la fiscalía*; институты Мексики и Испании не подставлять (*Ministerio Público, juez de instrucción*).
- **Ловушки:** милиция → *policía*, не *milicia* (в Латинской Америке — вооружённые группы); «ордер» (жилищный) → *orden oficial*, не *orden de registro*; «эпизод» обвинения → *cargo*; «показания» → *declaración*, не *testimonio*; «жилищный фонд» → *parque de viviendas*.
- **Первое появление.** У рассказчика — короткая приложка (*una strelka, una “reunión” entre bandas*), дальше просто *strelka*. В реплике персонажа не пояснять: эквивалент либо термин без пояснения + карточка архива. Аббревиатуры (*BTI, MUR*) — с расшифровкой; в титре (≤ 56) допустимо описание: *Oficina de Inventario Técnico*.
- **Не локализовать:** имена и отчества; улицы, районы, газеты (*calle Molodogvardéiskaya, Presnia*) — переводим только родовое слово; марки (*Volga, Lada*); рубли — *rublos* (не пересчёт в песо и доллары: масштаб денег объясняет архив).

## 4. Имена и транслитерация

- **Основа — латинская форма из таблицы en** (*Andrei, Sergei, Kovrigin, Presnya*). Под чтение носителя глоссарий разрешает адаптацию (`glossary.md`, «Правила имён»): знак ударения (*Andréi, Grómov, Víktor, Pávlovna, Kúntsevo*), *g* перед *e/i* → *gu* (*Serguéi, Kovriguin*), *Presnia*. Остальные буквы — как в en (*Murashov, Saiko*).
- **Ударение** ставим там, где русское ударение расходится с испанским правилом и имя частотное; точный список — в таблице имён эпизода. Новую адаптацию переводчик сам не вводит: пишет базовую форму и просит редактора вопросом.
- **Отчества и женские формы** сохраняем: *Zoya Pávlovna, Serguéi Víktorovich, Levina, Gromova*. В документах порядок «имя отчество фамилия» (*Zoya Pávlovna S.*); инициалы — через неразрывный пробел: *A. N. Kovriguin*.
- **Прозвища** переводим по смыслу и заносим в глоссарий («Удав» → *La Boa*); звания и должности — только по глоссарию (*investigador de la fiscalía*).

## 5. Типографика

| Что | Правило | Пример |
|---|---|---|
| Кавычки | “ ” → ‘ ’ (практика Латинской Америки, CLDR es-419; « » не используем); точка и запятая — вне кавычек | `Grómov anotó: “no se hallaron señales de lucha”.` |
| ¿ ¡ | парные; открывающий знак там, где вопрос начинается, а не в начале фразы | `Zoya Pávlovna, ¿está en casa?` |
| Тире, многоточие | raya (—) без пробела после открывающей, для реплик внутри текста и вставных фраз; … — один символ; ru-тире механически не переносить | `—Demuéstrelo.`; `El notario —Kovriguin— firmó` |
| Даты | 12 de octubre de 1994; месяцы и дни строчными; в документах 28/06/1993; в титрах *oct.* | `Presnia. Octubre de 1993. 19:40` |
| Числа, деньги | 1500; от 5 знаков — неразрывный пробел; дробные через запятую: 2,5 | `12 000 rublos` |
| Время | 24-часовое, как в ru | `19:40` |
| Регистр | sentence case везде, и в заголовках; должности и месяцы строчными | `Primera parte. La ciudad`; `el notario Kovriguin` |
| Nbsp | U+00A0 (в примерах — настоящий) между инициалами и фамилией, числом и единицей, перед %, после *n.º* | `A. N. Kovriguin`; `50 %` |

## 6. Лимиты длины и UI

- Лимиты в символах Unicode (пробелы и `{плейсхолдеры}` считаются): **кнопка выбора ≤ 60 · `date_stamp` ≤ 32 · `location` ≤ 56 · `lower_third` ≤ 48 · заголовки ≤ 40 · подписи UI ≤ 24 · `fact` ≤ 120 · `say` ≤ 220 · `narrate` ≤ 240.**
- Линтер даёт WARN по `option, date_stamp, location, lower_third, chapter, fact, say, narrate`; прочие заголовки и подписи UI проверяем вручную. На пределе в ep01: `s15.cap` *Presnia. Octubre de 1993. 19:40* (31 из 32), `s13.cap` (46 из 48), `s03.fact` (116 из 120).
- Короткие строки в es растут сильнее длинных: в ep01 текст в целом ≈ en + 4 %, но отдельные титры, заголовки и промпты выбора на 45–100 % длиннее en (`s19.cap` 17 → 30, `mg_docs.title` 14 → 22); UI проектируется на *en + 35 %*.
- **Плейсхолдеры** `{n}` не переводить, не менять написание, не вплетать в грамматику: `{n} min`; вместо *{n} días* — *Días: {n}*.
- **Сокращаем без потери смысла:** кнопка — инфинитив без артикля и местоимения; убрать повтор промпта выбора; стандартные сокращения (*min, oct., n.º*); существительное вместо глагольной фразы. Кнопка может занимать две строки (`03-visual-language.md` §8), но лимит 60 остаётся; на таймерных выборах короче — длинные читаются дольше (проверяет LQA). Варианты выбора остаются различимыми.
- Примеры: должность в `lower_third` — до ядра, полное название в архив: *Andrei Gromov, investigador* вместо *…investigador de casos de especial importancia* (60 > 48); UI: *Подсказка за рекламу* → *Pista (ver anuncio)* (19), не *Ver un anuncio para una pista* (29).

## 7. Контент и право

- **Грубая лексика** — тот же уровень, что в ru, без усиления: мягкое («блин», «чёрт») → *caray, demonios*; региональные ругательства (*joder, coño, pendejo, boludo, chingar*) не использовать — они «приклеивают» реплику к стране. **Насилие** — как в источнике: деталь или последствие, не действие (*la bala rozó el hombro*); натурализм и интенсификаторы не добавлять.
- **Процессуальный статус не повышать и не смещать:** подозреваемый → *sospechoso*, обвиняемый и подсудимый → *acusado*, осуждённый → *condenado*; «дело доведено до суда» ≠ «осуждён» (`s23.fact`: *Otro equipo de investigación llevó el caso a juicio en 1994*); *asesino* — только о приговорённых.
- **Дисклеймер** (`ui.disclaimer.body`) переводим юридически, не дословно: сохраняем объём («вымышлены *персонажи*», не «всё»), «имена изменены», «не официальный документ»; формул «правдивая история» нет (*Esta es una historia real*, *basado en hechos reales* — только через юриста):
  > «Basado en un caso criminal real. Los diálogos, algunos personajes y ciertas circunstancias han sido reconstruidos o inventados con fines dramáticos, y se han cambiado los nombres de algunas personas. Cualquier parecido entre los personajes ficticios y personas reales es pura coincidencia. Este juego no es un documento oficial ni pretende reproducir los hechos con exactitud.»
- **Предупреждение и «18+»** (`ui.warning.body_generic`): «Este episodio contiene escenas de violencia y descripciones de delitos reales. Solo para mayores de 18 años.» В сборке 16+: «…Las escenas de violencia se muestran de forma esquemática, sin detalles gráficos. Recomendado para mayores de 16 años.»

## 8. Чеклист перед сдачей

1. Заполнены все ключи, пустых строк нет; ключи и порядок не менялись; плейсхолдеры `{...}` совпадают с ru символ в символ (иначе ERROR).
2. Лимиты длины (§6): без WARN; подписи UI ≤ 24 проверены вручную.
3. Имена — по §4: адаптации только из таблицы имён, ударения «от себя» не добавлены, отчества сохранены.
4. Реалии (§3): стратегия по глоссарию, пояснение при первом появлении, в репликах персонажей без пояснений; *milicia* нет.
5. Нет регионализмов и voseo (поиск: `vos`, `vosotros`, `vale`, `coche`, `piso`, `coger`, `ordenador`, `móvil`).
6. Обращение выдержано по таблице §2 (*tú / usted*) в каждой сцене; рассказчик — *indefinido*, без оценок.
7. ¿ ¡ парные; кавычки “ ” → ‘ ’; даты, числа, время, регистр — по §5.
8. Грубая лексика и насилие не сильнее источника; статусы лиц не повышены; дисклеймер и «18+» — только утверждённый текст.
9. Реплики прочитаны в контексте (колонка `context` экспорта): кто говорит, кому, в какой ситуации.
10. К сдаче — список спорных ключей «ключ — вопрос»; сомнения по ru уходят сценаристу, а не решаются догадкой.

```bash
# пример пути: episodes/s1/ep01_murylev.json
python3 tools/validate_episode.py episodes/<путь>.json   # ожидаем: ошибок 0, предупреждений 0
python3 tools/loc_sync.py stats episodes/<путь>.json     # ожидаем: 100 % по вашему языку (только полнота, не качество)
```
