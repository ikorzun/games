/* Тексты конструктора задержанных (русский — первоисточник). Ключи dz.cg.*:
   dz.cg.species.<вид>, dz.cg.kind.<род>, dz.cg.part.<деталь> — название группы, dz.cg.<деталь>.<вариант> — вариант. */
(function (root) {
  const DZ = (root.DZ = root.DZ || {});
  DZ.strings = DZ.strings || {};
  const ru = (DZ.strings.ru = DZ.strings.ru || {});
  const add = (prefix, map) => { for (const k in map) ru[prefix + k] = map[k]; };

  add('dz.cg.', { title: 'Межгалактическая дежурная часть', sub: 'Конструктор задержанных',
    lead: 'В отделение ведут всех: людей, пришельцев и нечисть. Соберите задержанного из деталей или возьмите случайного из очереди.',
    random: 'Случайный', same: 'Ещё такой же', bars: 'Решётка', lobby: 'Вестибюль', seed: 'Зерно',
    queue: 'Очередь в вестибюле', 'queue.new': 'Новая очередь', 'queue.note': 'Нажмите на любого, чтобы взять его в окно.',
    take: 'Забрать персонажа', 'tab.data': 'Данные', 'tab.prompt': 'Промпт', 'tab.svg': 'SVG', copy: 'Скопировать', copied: 'Скопировано',
    'take.data': 'Описание из деталей: вставляется в дело как внешность задержанного.',
    'take.prompt': 'Английское описание того же персонажа для генеративной модели; к нему прикладывается лист стиля.',
    'take.svg': 'Готовая картинка в векторе.',
    'sec.who': 'Кто', 'sec.face': 'Лицо', 'sec.head': 'Голова', 'sec.body': 'Тело, одежда, приметы', 'sec.state': 'Состояние' });

  add('dz.cg.kind.', { all: 'Все', human: 'Люди', alien: 'Пришельцы', myth: 'Нечисть' });
  add('dz.cg.species.', { human: 'Человек', grey: 'Серый', squid: 'Головоног', insect: 'Жукоглаз', blob: 'Слизень', reptile: 'Ящер', robot: 'Робот', stalker: 'Стебельчатый',
    leshy: 'Леший', vodyanoy: 'Водяной', domovoy: 'Домовой', chert: 'Чёрт', gorynych: 'Змей Горыныч', koschei: 'Кощей', vampire: 'Упырь', volkolak: 'Волколак',
    likho: 'Лихо одноглазое', kikimora: 'Кикимора', minotaur: 'Минотавр', gorgon: 'Горгона' });
  add('dz.cg.part.', { species: 'Вид', head: 'Форма головы', skin: 'Кожа', eyes: 'Глаза', eyen: 'Сколько глаз', nose: 'Нос', mouthx: 'У рта', ears: 'Уши', top: 'На голове',
    hair: 'Цвет волос', face: 'Усы и борода', tex: 'Фактура', clothes: 'Одежда', build: 'Сложение', glasses: 'Очки', mark: 'Приметы', mood: 'Состояние' });

  add('dz.cg.head.', { potato: 'Картошка', egg: 'Яйцо', pear: 'Груша', brick: 'Кирпич', bean: 'Боб', bulb: 'Луковица', dome: 'Купол', skull: 'Череп', box: 'Коробка', drop: 'Капля' });
  add('dz.cg.skin.', { peach: 'Светлая', tan: 'Смуглая', ruddy: 'Румяная', pale: 'Бледная', grey: 'Серая', olive: 'Болотная', teal: 'Сизая', lilac: 'Сиреневая', ochre: 'Охристая',
    moss: 'Мшистая', bone: 'Костяная', brick: 'Кирпичная', steel: 'Железо', jelly: 'Студень', fur: 'Шерсть' });
  add('dz.cg.eyes.', { dot: 'Обычные', almond: 'Миндалины', compound: 'Фасеточные', slit: 'Змеиные', lamp: 'Лампы', stalk: 'На стебельках' });
  add('dz.cg.eyen.', { 1: 'Один', 2: 'Два', 3: 'Три', 4: 'Четыре' });
  add('dz.cg.nose.', { none: 'Нет', bump: 'Маленький', potato: 'Картошкой', hook: 'Крючком', snout: 'Пятачок', slits: 'Щёлки' });
  add('dz.cg.mouthx.', { none: 'Ничего', fangs: 'Клыки', tusks: 'Бивни', mandibles: 'Жвалы', tentacles: 'Щупальца', grille: 'Решётка динамика' });
  add('dz.cg.ears.', { none: 'Нет', round: 'Обычные', pointed: 'Острые', fin: 'Плавники', animal: 'Звериные' });
  add('dz.cg.top.', { bald: 'Лысина', buzz: 'Ёжик', short: 'Короткие волосы', curly: 'Кудри', sidehair: 'Лысина с боками', long: 'Длинные волосы', bun: 'Пучок', widow: 'Зализанные',
    flatcap: 'Кепка', ushanka: 'Ушанка', hat: 'Шляпа', scarf: 'Платок', peaked: 'Фуражка', crown: 'Корона', horns: 'Рожки', bullhorns: 'Бычьи рога', moss: 'Мох и гриб',
    antennae: 'Усики', antenna: 'Антенна', snakes: 'Змеи', crest: 'Гребень', helmet: 'Шлем' });
  add('dz.cg.hair.', { dark: 'Тёмные', brown: 'Каштановые', ginger: 'Рыжие', grey: 'Седые', white: 'Белые', black: 'Чёрные', moss: 'Зелёные' });
  add('dz.cg.face.', { none: 'Нет', stubble: 'Щетина', moustache: 'Усы', longmoustache: 'Висячие усы', beard: 'Борода', hugebeard: 'Борода до пояса', mossbeard: 'Борода из мха' });
  add('dz.cg.tex.', { none: 'Гладкая', wrinkles: 'Морщины', scales: 'Чешуя', spots: 'Пятна', cracks: 'Трещины', rivets: 'Заклёпки', fur: 'Шерсть' });
  add('dz.cg.clothes.', { denim: 'Джинсовка', vatnik: 'Ватник', coat: 'Старое пальто', overcoat: 'Пальто и галстук', leather: 'Кожанка', blazer: 'Малиновый пиджак', chef: 'Китель повара',
    uniform: 'Форма', tracksuit: 'Спортивный костюм', telnyashka: 'Тельняшка', rubakha: 'Рубаха', trench: 'Плащ', suit: 'Костюм с планками', sweater: 'Свитер', cape: 'Плащ с воротником',
    spacesuit: 'Скафандр', none: 'Без одежды' });
  add('dz.cg.build.', { tiny: 'Крошечный', narrow: 'Худой', medium: 'Средний', wide: 'Плотный', huge: 'Громадный' });
  add('dz.cg.glasses.', { none: 'Нет', round: 'Круглые', rect: 'Прямоугольные' });
  add('dz.cg.mark.', { none: 'Нет', scar: 'Шрам', tattoo: 'Якорь на шее', both: 'Шрам и якорь' });
  add('dz.cg.mood.', { calm: 'Спокойствие', irritated: 'Раздражение', caught: 'Врасплох', smug: 'Самодовольство', scared: 'Испуг', sullen: 'Угрюмость' });   // существительные: вид бывает любого рода
})(typeof window !== 'undefined' ? window : globalThis);
