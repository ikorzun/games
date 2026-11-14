/**
 * Надписи, таблички и плакаты убежища: что именно написано и где это лежит в общем атласе.
 * Здесь только данные и раскладка — чистый TS, без canvas: уровень собирается и в тестах, и в Worker.
 * Рисует атлас render/signs_atlas.ts (в браузере), по этой же раскладке.
 *
 * Плакаты гражданской обороны и план убежища — не рисунки кодом, а настоящие листы: картинки из
 * assets/posters/<id>.webp (их грузит render/poster_images.ts и кладёт в свои клетки атласа).
 *
 * Надписи остаются русскими на любом языке интерфейса: это часть места действия.
 */

export const SIGNS_SIZE = 2048;

export type SignKind =
  /** Трафарет по стене: буквы с перемычками, вне букв прозрачно. Цвет даёт вершина. */
  | 'stencil'
  /** Надпись от руки кистью — следы тех, кто был здесь после. */
  | 'brush'
  /** Эмалированная табличка: светлое поле, рамка, текст. */
  | 'plate'
  /** Плакат гражданской обороны: лист-картинка из assets/posters. */
  | 'poster'
  /** Шкала прибора. */
  | 'dial'
  | 'clock'
  | 'calendar'
  /** Жёлто-чёрная полоса. */
  | 'hazard'
  /** Сектор распаха гермодвери на полу. */
  | 'arc'
  /** План убежища: тоже лист-картинка. */
  | 'scheme'
  /** Зарубки-счёт на стене. */
  | 'tally'
  /** Знак: молния, трилистник, крест. */
  | 'symbol';

export interface SignDef {
  id: string;
  kind: SignKind;
  /** Строки текста (у трафарета — одна). */
  lines: readonly string[];
  /** Размер в атласе, px. */
  pw: number;
  ph: number;
  /** Ширина на стене по умолчанию, м (высота — по пропорции). */
  w: number;
  /** Вариант оформления: цвет таблички, вид шкалы или знака. */
  style?: number;
}

export interface SignRect extends SignDef {
  x: number;
  y: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Высота строки трафарета в атласе и ширина знака моноширинного шрифта (доля высоты). */
const ST_H = 26;
const ADV = 0.6;
/** Высота строки таблички в атласе. */
export const PL_H = 17;

function stencil(id: string, text: string, w: number, kind: 'stencil' | 'brush' = 'stencil'): SignDef {
  return { id, kind, lines: [text], pw: Math.ceil(text.length * ADV * ST_H + 10), ph: Math.ceil(ST_H * 1.3), w };
}

/**
 * Лист-картинка в атласе: 400×600 (плакат 2:3; план убежища — тот же лист на боку). На стене плакат
 * шириной 62 см — как настоящий лист 60×90: с двух шагов читаются и заголовок, и подписи.
 */
const SHEET_PW = 400;
const SHEET_PH = 600;

function sheet(id: string, lines: readonly string[]): SignDef {
  return { id, kind: 'poster', lines, pw: SHEET_PW, ph: SHEET_PH, w: 0.62 };
}

function plate(id: string, lines: readonly string[], w: number, style = 0): SignDef {
  const longest = Math.max(...lines.map((l) => l.length));
  const h = PL_H;
  return { id, kind: 'plate', lines, pw: Math.max(96, Math.ceil(longest * ADV * h + 28)), ph: Math.ceil(lines.length * h * 1.35 + 22), w, style };
}

/** Трафаретные названия помещений: ключ — тип помещения генератора. */
export const ROOM_LABEL: Readonly<Record<string, string>> = {
  dorm: 'room_dorm',
  command: 'room_command',
  medical: 'room_medical',
  storage: 'room_storage',
  washroom: 'room_washroom',
  fvu: 'room_fvu',
  diesel: 'room_diesel',
  tanks: 'room_tanks',
  switchboard: 'room_switchboard',
  archive: 'room_archive',
  airlock: 'room_airlock',
};

const DEFS: readonly SignDef[] = [
  // ── Трафареты ──
  stencil('room_dorm', 'ОТСЕК', 0.5),
  stencil('room_command', 'ПУНКТ УПРАВЛЕНИЯ', 1.0),
  stencil('room_medical', 'МЕДПУНКТ', 0.6),
  stencil('room_storage', 'СКЛАД', 0.45),
  stencil('room_washroom', 'САНУЗЕЛ', 0.55),
  stencil('room_fvu', 'ФВУ', 0.34),
  stencil('room_diesel', 'ДЭС', 0.34),
  stencil('room_tanks', 'БАКИ ВОДЫ', 0.62),
  stencil('room_switchboard', 'ЩИТОВАЯ', 0.56),
  stencil('room_archive', 'АРХИВ', 0.45),
  stencil('room_airlock', 'ТАМБУР-ШЛЮЗ', 0.75),
  stencil('germo', 'ГЕРМОДВЕРЬ', 0.62),
  stencil('dzg', 'ДЗГ-1', 0.36),
  stencil('attention', 'ВНИМАНИЕ!', 0.5),
  stencil('door_sector', 'НЕ СТОЙ В СЕКТОРЕ ДВЕРИ', 1.1),
  stencil('exit', 'ВЫХОД', 0.42),
  stencil('exit_spare', 'ЗАПАСНЫЙ ВЫХОД', 0.85),
  stencil('no_smoking', 'НЕ КУРИТЬ', 0.55),
  stencil('quiet', 'СОБЛЮДАЙ ТИШИНУ', 0.9),
  stencil('save_water', 'БЕРЕГИ ВОДУ', 0.6),
  stencil('water', 'ВОДА', 0.3),
  stencil('air', 'ВОЗДУХ', 0.38),
  stencil('fuel', 'ТОПЛИВО', 0.42),
  stencil('post1', 'ПОСТ № 1', 0.5),
  stencil('open', 'ОТКР', 0.2),
  stencil('closed', 'ЗАКР', 0.2),
  stencil('arrow_r', '——>', 0.3),
  stencil('arrow_l', '<——', 0.3),
  stencil('tier1', 'ЯРУС I', 0.42),
  stencil('tier2', 'ЯРУС II', 0.46),
  stencil('tier3', 'ЯРУС III', 0.5),
  stencil('digits', '0123456789', 0.9),
  // ── От руки: кто-то был здесь после ──
  stencil('br_noopen', 'НЕ ОТКРЫВАТЬ', 1.2, 'brush'),
  stencil('br_below', 'ОНИ ВНИЗУ', 1.0, 'brush'),
  stencil('br_nolight', 'НЕ СВЕТИ', 0.9, 'brush'),
  stencil('br_quiet', 'ТИШЕ', 0.6, 'brush'),
  stencil('br_back', 'НАЗАД', 0.7, 'brush'),
  stencil('br_count', 'НАС БЫЛО 9', 1.0, 'brush'),
  { id: 'tally', kind: 'tally', lines: [], pw: 224, ph: 56, w: 0.7 },
  // ── Таблички ──
  plate('pl_shelter', ['УБЕЖИЩЕ', 'ВМЕСТИМОСТЬ 150 ЧЕЛ.'], 0.5),
  plate('pl_fire', ['ОТВЕТСТВЕННЫЙ', 'ЗА ПОЖАРНУЮ БЕЗОПАСНОСТЬ', 'КОМЕНДАНТ УБЕЖИЩА'], 0.5),
  plate('pl_voltage', ['ОПАСНО!', 'ВЫСОКОЕ НАПРЯЖЕНИЕ'], 0.4, 1),
  plate('pl_nopower', ['НЕ ВКЛЮЧАТЬ!', 'РАБОТАЮТ ЛЮДИ'], 0.34, 1),
  plate('pl_gas', ['ОСТОРОЖНО, ГАЗ!'], 0.4, 1),
  plate('pl_drink', ['ПИТЬЕВАЯ ВОДА'], 0.36),
  plate('pl_exit', ['ВЫХОД'], 0.3, 2),
  plate('pl_modes', ['РЕЖИМЫ ВЕНТИЛЯЦИИ', 'I   ЧИСТАЯ ВЕНТИЛЯЦИЯ', 'II  ФИЛЬТРОВЕНТИЛЯЦИЯ', 'III ПОЛНАЯ ИЗОЛЯЦИЯ'], 0.55),
  plate('pl_rules', ['ПРАВИЛА ПОВЕДЕНИЯ', 'В УБЕЖИЩЕ', '1. НЕ ШУМЕТЬ', '2. НЕ КУРИТЬ', '3. СЛУШАТЬ КОМЕНДАНТА'], 0.5),
  plate('pl_fireext', ['ОГНЕТУШИТЕЛЬ'], 0.3, 1),
  // ── Плакаты ГО и план убежища: листы-картинки (строки — заголовок листа, для справки и тестов) ──
  sheet('poster_alarm', ['ПО СИГНАЛУ', '«ВОЗДУШНАЯ ТРЕВОГА»']),
  sheet('poster_mask', ['УМЕЙ ПОЛЬЗОВАТЬСЯ', 'ПРОТИВОГАЗОМ']),
  sheet('poster_shelter', ['ПРАВИЛА ПОВЕДЕНИЯ', 'В УБЕЖИЩЕ']),
  sheet('poster_aid', ['ПЕРВАЯ МЕДИЦИНСКАЯ', 'ПОМОЩЬ']),
  sheet('poster_signals', ['СИГНАЛЫ', 'ГРАЖДАНСКОЙ ОБОРОНЫ']),
  sheet('poster_protect', ['СРЕДСТВА', 'ИНДИВИДУАЛЬНОЙ ЗАЩИТЫ']),
  sheet('poster_nuclear', ['ЯДЕРНЫЙ ВЗРЫВ', 'ПОРАЖАЮЩИЕ ФАКТОРЫ']),
  sheet('poster_refuge', ['УБЕЖИЩЕ', 'НАДЕЖНАЯ ЗАЩИТА']),
  sheet('poster_dose', ['ДОЗИМЕТРИЧЕСКИЙ', 'КОНТРОЛЬ']),
  { id: 'scheme', kind: 'scheme', lines: ['ПЛАН УБЕЖИЩА'], pw: SHEET_PH, ph: SHEET_PW, w: 0.8 },
  // ── Приборы и прочее ──
  { id: 'dial_a', kind: 'dial', lines: [], pw: 96, ph: 96, w: 0.12, style: 0 },
  { id: 'dial_b', kind: 'dial', lines: [], pw: 96, ph: 96, w: 0.12, style: 1 },
  { id: 'dial_c', kind: 'dial', lines: [], pw: 96, ph: 96, w: 0.12, style: 2 },
  { id: 'clock', kind: 'clock', lines: [], pw: 128, ph: 128, w: 0.3 },
  { id: 'calendar', kind: 'calendar', lines: ['1991', 'НОЯБРЬ', '13'], pw: 96, ph: 136, w: 0.24 },
  { id: 'hazard', kind: 'hazard', lines: [], pw: 160, ph: 24, w: 1.0 },
  { id: 'arc', kind: 'arc', lines: [], pw: 144, ph: 144, w: 1.0 },
  { id: 'sym_bolt', kind: 'symbol', lines: [], pw: 80, ph: 80, w: 0.2, style: 0 },
  { id: 'sym_rad', kind: 'symbol', lines: [], pw: 80, ph: 80, w: 0.22, style: 1 },
  { id: 'sym_cross', kind: 'symbol', lines: [], pw: 80, ph: 80, w: 0.2, style: 2 },
];

/** Разложить знаки по атласу полками: высокие — первыми. Чистая функция, проверяется тестом. */
export function packSigns(defs: readonly SignDef[], size = SIGNS_SIZE, pad = 3): SignRect[] {
  const order = [...defs].sort((a, b) => b.ph - a.ph || b.pw - a.pw || (a.id < b.id ? -1 : 1));
  const out: SignRect[] = [];
  let x = pad;
  let y = pad;
  let row = 0;
  for (const d of order) {
    if (x + d.pw + pad > size) {
      x = pad;
      y += row + pad;
      row = 0;
    }
    if (y + d.ph + pad > size) throw new Error(`атлас надписей переполнен на знаке ${d.id}: занято ${y} из ${size} строк`);
    // v растёт вверх: строка 0 атласа — нижняя.
    out.push({ ...d, x, y, u0: x / size, u1: (x + d.pw) / size, v0: 1 - (y + d.ph) / size, v1: 1 - y / size });
    x += d.pw + pad;
    row = Math.max(row, d.ph);
  }
  return out;
}

export const SIGN_LIST: readonly SignRect[] = packSigns(DEFS);
export const SIGN: Readonly<Record<string, SignRect>> = Object.fromEntries(SIGN_LIST.map((s) => [s.id, s]));

/** Прямоугольник цифры в полосе «0123456789» (для номеров на дверях и баках). */
export function digitRect(d: number): { u0: number; v0: number; u1: number; v1: number; aspect: number } {
  const s = SIGN.digits!;
  const cell = (ADV * ST_H) / SIGNS_SIZE;
  const u0 = s.u0 + 5 / SIGNS_SIZE + cell * d;
  return { u0, u1: u0 + cell, v0: s.v0, v1: s.v1, aspect: (ADV * ST_H) / s.ph };
}

/** Плакаты, которые вешают в коридорах и отсеках. */
export const POSTERS: readonly string[] = ['poster_alarm', 'poster_mask', 'poster_shelter', 'poster_aid', 'poster_signals', 'poster_protect', 'poster_nuclear', 'poster_refuge', 'poster_dose'];
/** Листы, которые берутся из файлов-картинок assets/posters/<id>.webp: все плакаты и план убежища. */
export const SHEETS: readonly string[] = [...POSTERS, 'scheme'];
/** Надписи от руки — только там, где уже неладно. */
export const BRUSH: readonly string[] = ['br_noopen', 'br_below', 'br_nolight', 'br_quiet', 'br_back', 'br_count'];
