# Стайлгайд перевода: португальский (бразильский, pt-BR)

Для переводчиков и редакторов `pt`; входит в системный промпт машинного черновика (`../architecture/05-localization.md` §3) и служит чеклистом редактора-носителя.
Читать вместе с `05-localization.md` §4–6, `../architecture/07-narrator-styleguide.md` и `glossary.md` (приоритет у глоссария). Примеры — из `locales/pt/ep01_murylev.json`. Статус: черновик без проверки носителями.

## 1. Вариант языка и аудитория

- **Бразильский португальский (pt-BR).** Аудитория Бразилии на порядок больше португальской, европейская норма бразильцам понятна хуже, чем наоборот (`05-localization.md` §1). Переводим с `ru`, `en` — опора; расхождение смысла выносим вопросом сценаристу, не угадываем.
- **Орфография** — Acordo Ortográfico 1990 в бразильском варианте: *ideia, heroico, frequência* (без тремы), *ex-jornalista*.
- **Обращение: базовая форма — *você*** (*você mora*); формально — *o senhor / a senhora*. **Не использовать** *tu* с европейским спряжением (*tu vives, tens, estás*), энклизу (*trouxe-te, disse-me* → *te trouxe, me disse*), *estar a + инфинитив* (→ герундий: *está falando*), *vós*.
- **Европеизмы заменять:** *esquadra* → *delegacia*, *telemóvel* → *celular*, *autocarro* → *ônibus*, *comboio* → *trem*, *casa de banho* → *banheiro*, *reformado* → *aposentado*, *piso* → *apartamento*, *miúdo* → *garoto*; *rapariga* (в ряде регионов Бразилии оскорбительно), *fixe, bué, pá, tás* не использовать.
- **Бразильские ловушки:** *apanhar* в разговорной речи чаще значит «получать побои» (взять, задержать — *pegar, prender*); *seu / sua* двусмысленно при *você* — для 3-го лица *dele / dela* (*o apartamento dele*).

## 2. Два голоса

- **Рассказчик** — сухо, документально, 3-е лицо; точность вместо транскреации; без шуток и обращения к игроку. Факты — *pretérito perfeito*, настоящее — только где оно в ru. Без оценок, кроме *brutal / ousado / incrível* (жестокий / дерзкий / невероятный).
- Канцелярит протоколов — формулами: *foi preso, depôs, foi liberado mediante compromisso de não deixar a cidade, foi retirada da denúncia*; бразильские процедуры не подставлять (*inquérito policial, flagrante, B.O.*). **Документ**: формулы делового португальского (*PROCURAÇÃO. Eu, …, autorizo …*, *Reconhecida pelo tabelião …*), заголовки капсом и поля бланка как в оригинале.
- **Персонажи** — транскреация, живая речь 90-х, без современного сленга (*lacrar, mitar, cringe*): в репликах опера, бандита, пенсионерки допустимы *a gente, pra, tá, né* (в рассказчике — нет), но без фонетических написаний (*cê, tô*) и региональных маркеров (*mano, bah, uai, oxente*).
- Бандит — холодная вежливость на *o senhor*; свидетель — испуганная, обрывистая речь. Внутренний голос (`narrate`, `style: inner`) — короткие фрагменты, без канцелярита.

| Ситуация (ep01) | ru | pt |
|---|---|---|
| следователь → подозреваемый, свидетель; сосед → пенсионерка; бандит → следователь (холодно) | вы (почтительно) | *o senhor / a senhora*; гражданин X → *senhor X* |
| опер → задержанный или тот, на кого давит (`s09.l002`); эксперт → следователь (`s06.l001`); близкие, друзья | ты / вы по работе | *você* (давление — лексикой и краткостью; не *tu*) |
| игрок: инструкции / кнопки выбора и подписи UI | вы / — | императив с *você* (*Escolha…*) / инфинитив и существительные (*Vistoriar…*, *Ajustes*) |

| Ключ, голос | ru | Плохо | Хорошо |
|---|---|---|---|
| `s09.l002` опер → Лапин | Ты живёшь в квартире женщины, которую никто не видел два месяца. | Tu vives no apartamento de uma mulher que ninguém vê há dois meses. | Você mora no apartamento de uma mulher que ninguém vê há dois meses. |
| `s01.l002` соседка → пенсионерка | Зоя Павловна, вы дома? Я вам молоко принесла. | Zoia Pavlovna, estás em casa? Trouxe-te leite. | Zoia Pavlovna, a senhora está em casa? Trouxe leite para a senhora. |
| `s20.l004` рассказчик | …не дал показаний в суде. Эпизод с его квартирой выпал из обвинения. | Lapin nunca deu declarações em tribunal. O episódio do seu apartamento caiu da acusação. | Lapin nunca depôs no julgamento. A acusação referente ao apartamento dele foi retirada da denúncia. |
| `s15.c_take.now` опер, кнопка | Брать сейчас, обоих | Apanhar agora, os dois | Pegar agora, os dois |

## 3. Реалии и сленг

- Стратегию берём из `glossary.md`, не изобретаем: **эквивалент** (крыша → *proteção*, кидалово → *golpe*), **транслитерация + пояснение** (*strelka, um “acerto” entre gangues*), **описательный** (СИЗО → *centro de detenção provisória*), **сохранение + архив** (*voucher*).
- Опер → *investigador*, следователь прокуратуры → *investigador da promotoria*; нотариус → *tabelião*, заверить подпись → *reconhecer firma*.
- **Ловушки:** милиция → *polícia*, не *milícia* (в Бразилии — вооружённые банды); «ордер» (жилищный) → *ordem oficial*, не *ordem de registro*; доверенное лицо → *representante*, не *procurador* (так называют и прокурора); «эпизод» обвинения → *acusação*; «показания» → *depoimento*; «жилищный фонд» → *parque habitacional*.
- **Первое появление.** У рассказчика — короткая приложка (*uma strelka, um “acerto” entre gangues*), дальше просто *strelka*. В реплике персонажа не пояснять: эквивалент либо термин без пояснения + карточка архива. Аббревиатуры (*BTI, MUR*) — с расшифровкой; в титре (≤ 56) допустимо описание: *Departamento de Inventário Técnico*.
- **Не локализовать:** имена и отчества; улицы, районы, газеты (*rua Molodogvardeiskaia, Presnia*) — переводим только родовое слово; марки (*Volga, Lada*); рубли — *rublos* (не *R$*, без пересчёта: масштаб денег объясняет архив).

## 4. Имена и транслитерация

- **Основа — латинская форма из таблицы en** (*Andrei, Sergei, Kovrigin, Presnya*). Под чтение носителя глоссарий разрешает адаптацию (`glossary.md`, «Правила имён»): *g* перед *e/i* → *gu* (*Serguei, Kovriguin*), *y* → *i* (*Zoia, Presnia, Molodogvardeiskaia*); в черновике так же *Viktorovitch, Vetcherniaia* (ч → tch) — к подтверждению.
- Остальные буквы — как в en (*Andrei Gromov, Murashov, Saiko, Kuntsevo*); знаков ударения в именах не добавляем. Новую адаптацию переводчик сам не вводит: пишет базовую форму и просит редактора вопросом; утверждённые формы заносятся в таблицу имён эпизода.
- **Отчества и женские формы** сохраняем: *Zoia Pavlovna, Serguei Viktorovitch, Levina, Gromova*. В обращении — имя и отчество без *dona*; в документах порядок «имя отчество фамилия» (*Zoia Pavlovna S.*); инициалы — через неразрывный пробел: *A. N. Kovriguin*.
- **Прозвища** переводим по смыслу и заносим в глоссарий («Удав» → *A Jiboia*); звания и должности — только по глоссарию (*investigador da promotoria*).

## 5. Типографика

| Что | Правило | Пример |
|---|---|---|
| Кавычки | “ ” → ‘ ’; « » не используем (европейская норма); знаки препинания вне кавычек, если цитата вставлена в предложение | `Gromov anotou: “não foram encontrados sinais de luta”.` |
| ? ! | без ¿ ¡ и без пробела перед знаком | `A senhora está em casa?` |
| Тире, многоточие | travessão (—) с пробелом после, для реплик внутри текста и вставных фраз; … — один символ; ru-тире механически не переносить | `— Prove.`; `— Eu sei — disse ele.` |
| Даты | 12 de outubro de 1994; месяцы и дни строчными; в документах 28/06/1993; в титрах *out.* | `Presnia. Outubro de 1993. 19h40` |
| Числа, деньги | 1.500; 2,5; рубли словом, не *R$* | `12.000 rublos` |
| Время | 24-часовое с *h* вместо двоеточия | `19h40` |
| Регистр | sentence case везде, и в заголовках; должности и месяцы строчными | `Primeira parte. A cidade`; `o tabelião Kovriguin` |
| Nbsp | U+00A0 (в примерах — настоящий) между инициалами и фамилией, числом и единицей, после *nº* | `A. N. Kovriguin`; `nº 5` |

## 6. Лимиты длины и UI

- Лимиты в символах Unicode (пробелы и `{плейсхолдеры}` считаются): **кнопка выбора ≤ 60 · `date_stamp` ≤ 32 · `location` ≤ 56 · `lower_third` ≤ 48 · заголовки ≤ 40 · подписи UI ≤ 24 · `fact` ≤ 120 · `say` ≤ 220 · `narrate` ≤ 240.**
- Линтер даёт WARN по `option, date_stamp, location, lower_third, chapter, fact, say, narrate`; прочие заголовки и подписи UI проверяем вручную. На пределе в ep01: `s09.c_buyer.release` (59 из 60), `s11.cap` (52 из 56), `s15.cap` *Presnia. Outubro de 1993. 19h40* (31 из 32).
- Короткие строки в pt растут сильнее длинных: в ep01 текст в целом ≈ en + 3 %, но отдельные титры, заголовки и промпты выбора на 45–80 % длиннее en (`s19.cap` 17 → 28, `mg_docs.title` 14 → 25); UI проектируется на *en + 35 %*.
- **Плейсхолдеры** `{n}` не переводить, не менять написание, не вплетать в грамматику: `{n} min`; вместо *{n} dias* — *Dias: {n}*.
- **Сокращаем без потери смысла:** кнопка — инфинитив без артикля и местоимения; убрать повтор промпта выбора; стандартные сокращения (*min, out., nº*); существительное вместо глагольной фразы. Кнопка может занимать две строки (`03-visual-language.md` §8), но лимит 60 остаётся; на таймерных выборах короче — длинные читаются дольше (проверяет LQA). Варианты выбора остаются различимыми.
- Примеры: должность в `lower_third` — до ядра, полное название в архив: *Andrei Gromov, investigador* вместо *…investigador de casos de especial relevância* (59 > 48); UI: *Подсказка за рекламу* → *Dica (ver anúncio)* (18), не *Assistir a um anúncio para ganhar uma dica* (42).

## 7. Контент и право

- **Грубая лексика** — тот же уровень, что в ru, без усиления: мягкое («блин», «чёрт») → *droga, caramba*; европейские ругательства (*caralho, pá*) не использовать. **Насилие** — как в источнике: деталь или последствие, не действие (*a bala pegou de raspão no ombro*); натурализм и интенсификаторы не добавлять.
- **Процессуальный статус не повышать и не смещать:** подозреваемый → *suspeito*, обвиняемый → *acusado*, подсудимый → *réu*, осуждённый → *condenado*; «дело доведено до суда» ≠ «осуждён» (`s23.fact`: *Outra equipe de investigação levou o caso a julgamento em 1994*); *assassino* — только о приговорённых.
- **Дисклеймер** (`ui.disclaimer.body`) переводим юридически, не дословно: сохраняем объём («вымышлены *персонажи*», не «всё»), «имена изменены», «не официальный документ»; формул «правдивая история» нет (*Esta é uma história verídica*, *baseado em fatos reais* — только через юриста; в Бразилии суд защищает честь и образ даже в документальной реконструкции, дело Aida Curi):
  > “Baseado em um caso criminal real. Os diálogos, alguns personagens e certas circunstâncias foram reconstruídos ou inventados para fins dramáticos, e os nomes de algumas pessoas foram alterados. Qualquer semelhança entre personagens fictícios e pessoas reais é mera coincidência. Este jogo não é um documento oficial e não pretende reproduzir os fatos com exatidão.”
- **Предупреждение и «18+»** (`ui.warning.body_generic`): “Este episódio contém cenas de violência e descrições de crimes reais. Não recomendado para menores de 18 anos.” (формула Classificação Indicativa). В сборке 16+: “…As cenas de violência são mostradas de forma esquemática, sem detalhes gráficos. Não recomendado para menores de 16 anos.”

## 8. Чеклист перед сдачей

1. Заполнены все ключи, пустых строк нет; ключи и порядок не менялись; плейсхолдеры `{...}` совпадают с ru символ в символ (иначе ERROR).
2. Лимиты длины (§6): без WARN; подписи UI ≤ 24 проверены вручную.
3. Имена — по §4: адаптации только из таблицы имён, отчества сохранены.
4. Реалии (§3): стратегия по глоссарию, пояснение при первом появлении, в репликах персонажей без пояснений; *milícia* и *procurador* (в значении доверенного лица) нет.
5. Нет европеизмов (поиск: `tu `, `-te `, `estás`, `esquadra`, `telemóvel`, `apanhar`, `a + инфинитив`); орфография AO 1990.
6. Обращение выдержано по таблице §2 (*você / o senhor*) в каждой сцене; *seu/sua* не двусмысленны; рассказчик — *perfeito*, без оценок.
7. Без ¿ ¡; кавычки “ ” → ‘ ’; даты, числа, время (*19h40*), регистр — по §5.
8. Грубая лексика и насилие не сильнее источника; статусы лиц не повышены; дисклеймер и «18+» — только утверждённый текст.
9. Реплики прочитаны в контексте (колонка `context` экспорта): кто говорит, кому, в какой ситуации.
10. К сдаче — список спорных ключей «ключ — вопрос»; сомнения по ru уходят сценаристу, а не решаются догадкой.

```bash
# пример пути: episodes/s1/ep01_murylev.json
python3 tools/validate_episode.py episodes/<путь>.json   # ожидаем: ошибок 0, предупреждений 0
python3 tools/loc_sync.py stats episodes/<путь>.json     # ожидаем: 100 % по вашему языку (только полнота, не качество)
```
