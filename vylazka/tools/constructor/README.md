# Конструктор на своём компьютере

Квиз 18.11: «Программа на MacBook» и «Ищу везде, беру по заявке». Конструктор открывается отдельным окном браузера и
работает с файлами игры напрямую:

- всё, что ставишь, двигаешь, крутишь и убираешь, **сохраняется само** — в файлы `src/world/partner/*.json`
  (их и берёт игра); кнопки «Сохранить» нет;
- вкладка **«Каталог»** — поиск по всему каталогу Sand3D (около 106 тыс. вещей), с картинками, по смыслу; можно по-русски
  (частые слова переводятся сами — «старый чемодан» уходит в каталог как «old suitcase»);
- понравилась вещь — **«В заявку»**. Заявки — вкладка «Заявки». Основная модель доводит их до игры: проверяет лицензию,
  что нет марок, надписей и персонажей, подбирает масштаб и материалы. После этого вещь появляется на полке, и её можно
  ставить. В игру попадает только поставленное;
- **«залить»** — одной командой: правки проверяются теми же правилами, что в игре, и уходят на GitHub.

## Один раз: поставить

1. **Node.js** (версия 22 или новее): скачать с nodejs.org (кнопка LTS) и установить. Или, если стоит Homebrew,
   `brew install node`.
2. **Git**: в Терминале `git --version`; если его нет, macOS сама предложит поставить инструменты разработчика.
3. В Терминале — положить проект в рабочую папку `~/Desktop/Claude/Usession` (слова партнёра 18.11: «теперь это рабочая
   папка проекта»). Репозиторий ложится прямо в неё, игра — в `Usession/vylazka`. Строки можно вставить разом; запустить
   их ещё раз не страшно (git ответит «already exists» — так и должно быть):

   ```bash
   mkdir -p ~/Desktop/Claude/Usession && cd ~/Desktop/Claude/Usession
   git init
   git remote add origin https://github.com/ikorzun/games.git
   git fetch origin claude/cool-clarke-gdi2gp
   git checkout -b claude/cool-clarke-gdi2gp --track origin/claude/cool-clarke-gdi2gp
   cd vylazka
   npm install
   ```

   Почему не `git clone`: он не кладёт проект в папку, где уже что-то есть, хотя бы невидимый `.DS_Store` от Finder. Если
   раньше склонировал по старой инструкции и в папке лежит `games` — её можно удалить.

4. Чтобы «залить» могло отправлять на GitHub, нужен вход: при первой отправке git спросит логин и токен (GitHub →
   Settings → Developer settings → Personal access tokens), либо один раз `gh auth login`, если стоит GitHub CLI.

Что-то не пошло — пришли основной модели текст из Терминала.

## Каждый раз

```bash
cd ~/Desktop/Claude/Usession/vylazka
git pull
npm run constructor
```

Откроется окно. Закрыть программу — `Ctrl+C` в Терминале (правки уже в файлах). Если после `git pull` окно пишет, что не
находит пакет, — `npm install` и снова `npm run constructor`.

## Залить в игру

```bash
npm run constructor:push
```

Если что-то не годится (вещь врастает в стену, перекрывает проход, нет имени), команда ничего не отправит и скажет, что
поправить. Если всё годно — отправит и попросит написать в чат «залил». Тогда основная модель соберёт игру по ссылке и
доведёт заявки до полки.

Только проверить, ничего не отправляя: `npm run constructor:push -- --check`.

## Для основной модели

- Рабочая папка партнёра — `~/Desktop/Claude/Usession` на MacBook, клон всего репозитория (ветка `claude/cool-clarke-gdi2gp`).
  Облачная сессия её не видит: свежее туда приходит через `git pull`, правки партнёра — через «залить». Работать прямо в
  папке может сессия на его компьютере или облачная — если партнёр откроет папку в приложении Claude (Remote Control).
- `serve.mjs` — сервер окна: страница (`page.mjs`, `local: true`), записи (`GET /api/work`, `PUT`/`DELETE
  /api/work/<коллекция>/<ключ>`), каталог через спейс Sandflow (`/api/catalog/search|facets|object|render`; картинки — в
  `work/.cache`, в репозиторий не идут). В контейнере сеть к спейсу — через прокси:
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt npm run constructor -- --no-open`.
- Коллекции: `things`, `figures`, `removed` → `src/world/partner/*.json` (игра: `placed_data.ts`, `figures_data.ts`);
  `verdicts`, `requests` → `tools/constructor/work/*.json`. Записи — по времени сохранения, одна строка на запись.
- `push.mjs` — проверка (`check.ts`: `placedProblems`, `removedProblems`, `figureProblems`, ключи), коммит этих файлов,
  `git pull --rebase`, `git push`.
- Страница в Claude (`build.mjs`) — та же, но пишет в свою базу; перенос оттуда — руками, в те же файлы.
- Заявки доводятся `scripts/import_sand3d.py` (строка в `SHELF`), как полка 18.11 (`docs/vylazka/assets.md`, «Sand3D»).
