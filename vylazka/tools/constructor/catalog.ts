/**
 * Опись вещей для карточки конструктора: то, что раньше было отдельной страницей «Опросник мебели» (tools/mebel; партнёр
 * выбрал в квизе «Опросник внутрь»: каждая вещь объёмно рядом с ростом человека, отметки «оставить / реальнее / заменить /
 * убрать» — теперь в конструкторе, одна страница). Здесь — что это за вещь (вид, размеры, откуда, где стоит, совет основной
 * модели) и какие отметки к ней можно поставить. Где стоит — посчитано при сборке страницы (usage.ts, __USAGE__).
 */
import { ALL_PROPS } from '../../src/world/props_all';
import { ALL_MEMORIES } from '../../src/systems/session';
import { KAYKIT_SWAPS } from '../../src/world/props_real';
import { swapFits } from '../../src/world/placed';
import { SAND3D_CREDITS } from '../../src/world/sand3d_data';
import { FURNITURE_FROM } from '../../src/world/furniture';
import RU from '../../locales/ru/ui.json';

type Usage = Record<string, { worlds: Record<string, number>; rooms: Record<string, number> }>;
declare const __USAGE__: Usage;
declare const __GAME_URL__: string;
const USAGE: Usage = __USAGE__;
/** Адрес игры: «посмотреть в игре» открывает вещь в витрине по #show-<имя-через-дефисы>. */
export const GAME_URL: string = __GAME_URL__;

export const WORLD_RU: Record<string, string> = { shelter: 'убежище', office: 'офис', yellow: 'жёлтые комнаты', station: 'зал ожидания' };
export const ROOM_RU: Record<string, string> = {
  entrance: 'вход', airlock: 'шлюз', corridor: 'коридор', stairwell: 'лестница', dorm: 'спальный отсек', living: 'гостиная', command: 'пункт управления',
  kitchen: 'кухня', medical: 'медпункт', hallway: 'прихожая', washroom: 'санузел', storage: 'кладовая', fvu: 'ФВУ', diesel: 'дизельная', bedroom: 'спальня',
  tanks: 'баки', bathroom: 'ванная', switchboard: 'щитовая', archive: 'архив', nursery: 'детская', collapsed: 'завал', reception: 'приёмная', breakroom: 'кухня офиса',
  manager: 'кабинет', files: 'картотека', meeting: 'переговорная', cubicles: 'опенспейс', department: 'отдел', hall: 'зал', vestibule: 'вход', concourse: 'зал',
  tickets: 'касса', lockers: 'камеры хранения', buffet: 'буфет', platform: 'перрон', lift: 'лифт', track: 'пути', copyroom: 'копировальная', server: 'серверная',
};

/** Вид вещи в описи: пара KayKit → замена, мебель, вещь памяти, люди (манекены), полка Sand3D, прочее. */
export type Kind = 'pair' | 'furniture' | 'memory' | 'people' | 's3' | 'other';
export type Verdict = 'redo1' | 'redo2' | 'keep' | 'remove' | 'detail1' | 'detail2' | 'swap' | 'swapfix' | 'good' | 'fix' | 'drop';
export interface Choice {
  id: Verdict;
  label: string;
  hint: string;
}
/** Отметки по виду вещи — те же, что были в опроснике. */
export const CHOICES: Record<Kind, Choice[]> = {
  pair: [
    { id: 'swap', label: 'Менять на новую', hint: 'новая встаёт везде вместо старой' },
    { id: 'swapfix', label: 'Менять, но доработать', hint: 'напиши, что поправить' },
    { id: 'keep', label: 'Оставить как есть', hint: 'старая лучше' },
  ],
  furniture: [
    { id: 'redo1', label: 'Переделать, как стул — первым', hint: 'настоящие пропорции и материалы' },
    { id: 'redo2', label: 'Переделать — потом', hint: 'когда дойдут руки' },
    { id: 'keep', label: 'Оставить как есть', hint: 'вещь годится' },
    { id: 'remove', label: 'Убрать из игры', hint: 'не нужна' },
  ],
  memory: [
    { id: 'detail1', label: 'Детальнее — в первую очередь', hint: 'это вещь, которую ищут' },
    { id: 'detail2', label: 'Детальнее — потом', hint: 'после других' },
    { id: 'keep', label: 'Уже хороша', hint: 'не трогать' },
  ],
  s3: [
    { id: 'good', label: 'Годится', hint: 'ставлю её и меняю ею вещи игры' },
    { id: 'fix', label: 'Годится, но поправить', hint: 'напиши в заметке: размер, цвет, материал, какой стороной стоит' },
    { id: 'drop', label: 'Убрать с полки', hint: 'игре не подходит' },
  ],
  people: [
    { id: 'keep', label: 'Поза годится', hint: 'так и ставить' },
    { id: 'swapfix', label: 'Поза — но поправить', hint: 'напиши в заметке: что не так, как должно быть' },
    { id: 'remove', label: 'Такую позу не ставить', hint: 'убрать из игры' },
  ],
  other: [
    { id: 'redo1', label: 'Переделать, как стул — первым', hint: 'настоящие пропорции и материалы' },
    { id: 'redo2', label: 'Переделать — потом', hint: 'когда дойдут руки' },
    { id: 'keep', label: 'Оставить как есть', hint: 'вещь годится' },
    { id: 'remove', label: 'Убрать из игры', hint: 'не нужна' },
  ],
};
/** Подпись отметки (у одинаковых в разных видах — первая). */
export const LABEL: Record<string, string> = Object.fromEntries(Object.values(CHOICES).flat().map((c) => [c.id, c.label]));
/** Коротко — для метки на полке. */
export const SHORT: Record<Verdict, string> = { redo1: 'переделать первым', redo2: 'переделать потом', keep: 'оставить', remove: 'убрать', detail1: 'детальнее первой', detail2: 'детальнее потом', swap: 'менять', swapfix: 'менять, доработать', good: 'годится', fix: 'поправить', drop: 'убрать с полки' };
/** Отметка партнёра: коллекция verdicts, документ = имя вещи (как в опроснике). */
export interface Mark {
  verdict?: Verdict;
  note?: string;
  at?: string;
}

/** Мебель — то, на чём сидят, лежат, за чем работают и куда кладут. Остальное — «прочее». */
const FURNITURE = /стул|кресл|табурет|скамь|сиден|диван|кушет|стол|парт|конторк|кроват|нар[ыа]|койк|шкаф|полк|стеллаж|тумб|комод|сундук|вешалк|трюмо|буфет|витрин|прилавок|стойк|сервант|этажерк|кабинк/;

/** Вещи памяти: какая вещь в каком месте и с какой строкой (тексты — русский перевод игры). */
const MEM_WORLD: Record<string, string> = { sh: 'shelter', of: 'office', ye: 'yellow', st: 'station' };
export const MEMORY = new Map<string, { world: string; line: string }[]>();
for (const m of ALL_MEMORIES) {
  const list = MEMORY.get(m.thing) ?? [];
  list.push({ world: MEM_WORLD[m.id.slice(0, 2)] ?? '', line: (RU as Record<string, string>)[`mem.${m.id}.task`] ?? '' });
  MEMORY.set(m.thing, list);
}

const SWAP = new Map(KAYKIT_SWAPS.map((x) => [x.from, x.to]));
const ALT = new Set(KAYKIT_SWAPS.map((x) => x.to));

/** Полка Sand3D: авторство каждой вещи (строка каталога, без изменений). */
const S3 = new Map(SAND3D_CREDITS.map((c) => [c.name, c]));

/** Подпись вещи коротко: до первой запятой или двоеточия. */
const head = (ru: string): string => ru.split(/[,:]/)[0]!.trim();
/** Вещь полки → вещи игры, которые с 18.11 ею и выглядят (world/furniture.ts, FURNITURE_FROM). */
const IN_GAME = new Map<string, string[]>();
for (const [game, models] of Object.entries(FURNITURE_FROM)) for (const m of models) IN_GAME.set(m, [...(IN_GAME.get(m) ?? []), game]);

/**
 * Род мебели — по главному слову подписи: первые три слова до запятой или двоеточия («кабинка с тканевой перегородкой,
 * столом…» — кабинка, не стол; «островок отдела: четыре стола» — не стол). Слово ищется с начала слова: «двухтумбовый
 * стол» — стол, «тумба под стол» — тумба, «мойка-тумба» — не тумба. Кровать меняют на кровать, стол на стол.
 */
const GENUS: readonly [RegExp, string][] = [
  [/(?:^|\s)(?:кроват|нар[ыа]|койк|кушетк)/, 'bed'],
  [/(?:^|\s)(?:кресл|стул|табурет)/, 'seat'],
  [/(?:^|\s)(?:диван|скамь|банкетк|ряд)/, 'bench'],
  [/(?:^|\s)(?:стол|парт|конторк)/, 'table'],
  [/(?:^|\s)(?:шкаф|комод|тумб|стеллаж|этажерк|картотек|сервант|стенк)/, 'store'],
  [/(?:^|\s)вешалк/, 'hanger'],
];
function genus(ru: string): string | null {
  const head = ru.split(/[,:]/)[0]!.trim().split(/\s+/).slice(0, 3).join(' ');
  let best: [number, string] | null = null;
  for (const [re, g] of GENUS) {
    const m = re.exec(head);
    if (m && (best === null || m.index < best[0])) best = [m.index, g];
  }
  return best?.[1] ?? null;
}

/**
 * Вместо каких вещей игры встаёт вещь полки: того же рода, стоит на уровнях и по размеру влезает на её место
 * (swapFits — та же проверка, что у замены в игре). Сначала те, что чаще на глазах.
 */
export function s3Fits(name: string): { name: string; ru: string; most: number }[] {
  const me = ALL_PROPS[name];
  const g = me ? genus(me.ru) : null;
  if (!me || !g) return [];
  return Object.keys(ALL_PROPS)
    .filter((n) => !S3.has(n) && !SWAP.has(n) && genus(ALL_PROPS[n]!.ru) === g && Object.keys(USAGE[n]?.worlds ?? {}).length > 0 && swapFits(ALL_PROPS[n]!, me))
    .map((n) => ({ name: n, ru: ALL_PROPS[n]!.ru, most: Math.max(0, ...Object.values(USAGE[n]!.worlds)) }))
    .sort((a, b) => b.most - a.most || a.name.localeCompare(b.name));
}

export interface Item {
  kind: Kind;
  /** У пары: имя замены. */
  alt?: string;
  /** Совет основной модели — чтобы было с чем спорить; решает партнёр. */
  advice: string;
  name: string;
  ru: string;
  mount: string;
  w: number;
  d: number;
  h: number;
  /** Высота настенной вещи над полом, м. */
  y: number;
  toy: boolean;
  source: string;
  worlds: Record<string, number>;
  rooms: [string, number][];
}

/** Вся опись: каждая вещь реестра (ALL_PROPS), с видом и советом — как в опроснике. */
export const ITEMS: Item[] = Object.keys(ALL_PROPS).map((name) => {
  const p = ALL_PROPS[name]!;
  const u = USAGE[name];
  const toy = name.startsWith('kk_');
  const used = Object.keys(u?.worlds ?? {}).length > 0;
  const alt = SWAP.get(name);
  const kind: Kind = name.startsWith('mq_') ? 'people' : S3.has(name) ? 's3' : alt ? 'pair' : MEMORY.has(name) ? 'memory' : ALT.has(name) && name !== 'chair_bent' ? 'other' : FURNITURE.test(p.ru) && used ? 'furniture' : 'other';
  // Чаще на глазах — раньше переделывать: сколько штук в среднем на уровень в том месте, где их больше.
  const most = Math.max(0, ...Object.values(u?.worlds ?? {}));
  const fits = kind === 's3' ? s3Fits(name) : [];
  const usedBy = IN_GAME.get(name);
  const madeOf = FURNITURE_FROM[name];
  // Совет основной модели — чтобы было с чем спорить; решает партнёр.
  const advice = ((): string => {
    if (kind === 's3') {
      if (usedBy) return `уже в игре (с 18.11): так выглядят ${[...new Set(usedBy.map((g) => `«${head(ALL_PROPS[g]!.ru)}»`))].join(', ')}`;
      if (used) return 'уже в игре (с 18.11): стоит в комнатах сама — где, видно ниже';
      return fits.length > 0
        ? `первой — вместо «${fits[0]!.ru.split(',')[0]}»: по размеру встаёт на её место, а она чаще на глазах`
        : 'ставить рядом с вещами игры: вместо вещи того же рода не влезает по размеру';
    }
    if (madeOf) return `с 18.11 — модели полки: ${madeOf.map((m) => `«${head(ALL_PROPS[m]?.ru ?? m)}»`).join(', ')}`;
    if (name === 'kk_chair_a') return 'уже заменён по твоему слову';
    if (kind === 'pair') return 'заменена 16.11 по твоему слову';
    if (kind === 'memory') return 'детальнее — первой: её ищут';
    if (kind === 'people') return 'поза-заготовка; свою позу можно описать словами в заметке';
    if (toy) return 'переделать первым: игрушечный набор';
    if (kind !== 'furniture') return '';
    return most >= 2 ? `переделать первым: на глазах чаще всего (${String(most).replace('.', ',')} на уровень)` : 'переделать потом: встречается реже';
  })();
  return {
    kind,
    ...(alt ? { alt } : {}),
    advice,
    name,
    ru: p.ru,
    mount: p.mount,
    w: p.w,
    d: p.d,
    h: p.h,
    y: p.mount === 'wall' ? (p.y ?? 1.2) : 0,
    toy,
    source: kind === 's3' ? `каталог Sand3D (вещь, записанная программой), упрощена для игры; авторство: ${S3.get(name)!.attribution}` : toy ? 'готовая модель из набора KayKit (нарочно игрушечный стиль)' : 'собрана кодом в игре',
    worlds: u?.worlds ?? {},
    rooms: Object.entries(u?.rooms ?? {}).sort((a, b) => b[1] - a[1]),
  };
});
export const ITEM = new Map(ITEMS.map((i) => [i.name, i]));

/** О каких вещах опросник спрашивал (у «прочего» и у полки Sand3D отметку можно поставить, но её не ждут). */
export const asked = (i: Item): boolean => i.kind !== 'other' && i.kind !== 's3';

/** Где стоит вещь: по местам — сколько в среднем на уровень; у вещи памяти — в каких местах её ищут; у пары — где замена. */
export function whereText(i: Item): string {
  if (i.kind === 's3') return 'полка Sand3D: сама на уровнях не стоит — встанет там, куда её поставишь';
  if (i.kind === 'memory') return 'вещь памяти: ' + MEMORY.get(i.name)!.map((m) => WORLD_RU[m.world] ?? m.world).join(', ');
  if (i.kind === 'pair') {
    const w = Object.entries(USAGE[i.alt!]?.worlds ?? {});
    return 'заменена: ' + (w.length ? w.map(([k, v]) => `${WORLD_RU[k] ?? k}: ${String(v).replace('.', ',')}`).join(' · ') : 'на уровнях');
  }
  const w = Object.entries(i.worlds);
  if (w.length === 0) return 'на уровнях не стоит';
  return w.map(([k, v]) => `${WORLD_RU[k] ?? k}: ${String(v).replace('.', ',')}`).join(' · ') + ' на уровень';
}

/** Где чаще (до четырёх помещений) или, у вещи памяти, её задание. */
export function roomsText(i: Item): { label: string; text: string } {
  if (i.kind === 's3') {
    const fits = s3Fits(i.name).slice(0, 5);
    return { label: 'Можно вместо', text: fits.length ? fits.map((f) => `${f.ru.split(',')[0]} (${String(f.most).replace('.', ',')} на уровень)`).join('; ') : '—' };
  }
  if (i.kind === 'memory') return { label: 'Задание', text: MEMORY.get(i.name)!.map((m) => `«${m.line}» (${WORLD_RU[m.world] ?? m.world})`).join('; ') };
  const rooms = i.rooms.slice(0, 4).map(([k]) => {
    const [w, r] = k.split(':');
    return `${ROOM_RU[r!] ?? r} (${WORLD_RU[w!] ?? w})`;
  });
  return { label: 'Где чаще', text: rooms.length ? rooms.join(', ') : '—' };
}

/** Размер: ш × г × в, м (у настенной — на какой высоте висит). */
export function sizeText(i: Pick<Item, 'w' | 'd' | 'h' | 'mount' | 'y'>): string {
  const m = (v: number): string => v.toFixed(2).replace('.', ',');
  return `${m(i.w)} × ${m(i.d)} × ${m(i.h)} м${i.mount === 'wall' ? `, висит на ${m(i.y)} м` : ''}`;
}

/** Ссылка «посмотреть в игре»: витрина игры, вещь по имени через дефисы. */
export const gameLink = (name: string): string => `${GAME_URL}#show-${name.replace(/_/g, '-')}`;
