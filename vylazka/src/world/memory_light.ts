/**
 * Свет памяти. Вещь памяти приносит с собой свет, в котором её запомнили: чайник — синее пламя
 * конфорки, которую забыли выключить; кресло — окно, к которому оно до сих пор повёрнуто; билет — круг
 * лампы; пальто — зимний свет с улицы, откуда его принесли. Это и есть та «одна главная деталь, видная
 * издалека» (слова партнёра в опроснике, docs/vylazka/ideas.md, V-33): свет ложится на пол и стены
 * вокруг вещи, и это пятно собирается в точки даже там, куда фонарь не достаёт.
 *
 * Свет один на всё место — у искомой вещи: в сессии ищут по одной. Рисует его шейдер мира (memLight в
 * render/shaders.ts), здесь — только что за свет у какой вещи. Чистые данные, без three.js.
 */
import type { Vec3 } from '../core/types';

/** Род света: точка у пола (пламя), окно перед вещью, лампа сверху, зимний свет сверху, ровная точка (циферблат). */
export type MemLightKind = 'flame' | 'window' | 'lamp' | 'winter' | 'dial';

/**
 * Как свет живёт во времени (необязательно): 'tv' — неровное мерцание экрана, которого нет; 'blink' — лампочка
 * «на удержании», мигает раз в 1,2 с; 'pass' — свет проходящего поезда: раз в девять секунд нарастает и уходит.
 */
export type MemLightMod = 'tv' | 'blink' | 'pass';

export interface MemLightDef {
  kind: MemLightKind;
  /** Цвет света (линейный, единица — белый в полную силу луча). */
  color: Vec3;
  /** Сила: множитель цвета на освещённой поверхности. */
  strength: number;
  /** Дальше этого расстояния от вещи свет не светит, м. */
  radius: number;
  /**
   * Высота точки света над началом вещи, м: у пламени — чуть выше чайника (свет у самого пола ложился бы
   * на пол вскользь и пятна не давал), у лампы — потолок над вещью.
   */
  height: number;
  /** Как свет меняется во времени; нет — ровный (у пламени дрожь своя, в шейдере). */
  mod?: MemLightMod;
}

/** Номер рода света в шейдере (uRecallColor.w). */
export const MEM_LIGHT_KIND: Readonly<Record<MemLightKind, number>> = { flame: 0, window: 1, lamp: 2, winter: 3, dial: 4 };

/**
 * Свет у вещей памяти — по роду вещи (thing в цепочках systems/session.ts). Первыми — вещи, что стоят
 * в двух местах (plan.md, шаг 6а): по ним игрок узнаёт, что места связаны. Красного нет: красный в игре —
 * знак системы (сетка, давление, выход).
 */
export const MEMORY_LIGHT: Readonly<Record<string, MemLightDef>> = {
  // «the kettle. you left it on.» Синий венец газа; в жёлтых комнатах строка скажет «it was cold» — пламя врёт.
  kettle: { kind: 'flame', color: [0.2, 0.4, 1.0], strength: 1.6, radius: 2.6, height: 0.45 },
  // «it still turns to the window.» Окна нет, а свет из него есть: низкое тёплое солнце, рама крестом.
  office_chair: { kind: 'window', color: [1.0, 0.78, 0.5], strength: 1.6, radius: 3.4, height: 1.0 },
  // «one way.» Билет лежит в круге лампы, которой нет.
  st_ticket: { kind: 'lamp', color: [1.0, 0.78, 0.48], strength: 3.2, radius: 2.0, height: 2.3 },
  // «it smells of a station.» Пальто принесли с зимней улицы: холодный свет сверху, снег на плечах.
  st_coat: { kind: 'winter', color: [0.62, 0.75, 1.0], strength: 1.8, radius: 2.2, height: 2.8 },
  // Первая вещь убежища (её ищут в первой сессии): будильник светится зелёным фосфором циферблата, как
  // таблички ГО, — «it rang. nobody got up.» Свет ровный, без дрожи.
  alarm_clock: { kind: 'dial', color: [0.45, 1.0, 0.55], strength: 1.4, radius: 2.2, height: 0.3 },
  // Остальные вещи цепочек (17.11). Убежище: «where is the remote? the channel will not change.» Телевизора
  // нет — есть его мерцание: холодный голубой свет, неровный, как от экрана в тёмной комнате.
  remote: { kind: 'dial', color: [0.55, 0.72, 1.0], strength: 1.6, radius: 2.6, height: 0.7, mod: 'tv' },
  // «a photo of everyone. the faces did not save.» Перед фотографией горит свеча: тёплый дрожащий круг.
  photo_frame: { kind: 'flame', color: [1.0, 0.74, 0.42], strength: 1.4, radius: 2.0, height: 0.3 },
  // Офис: «the terminal. you never logged out.» — экран так и горит: зелёный свет строк на стол и стену.
  office_terminal: { kind: 'dial', color: [0.35, 0.95, 0.6], strength: 1.5, radius: 2.4, height: 0.45 },
  // «the water cooler. where everything was really decided.» Голубая бутыль светится изнутри.
  water_cooler: { kind: 'dial', color: [0.45, 0.78, 1.0], strength: 1.5, radius: 2.4, height: 1.1 },
  // «the desk phone. line two was for you.» Мигает янтарная лампочка второй линии — звонок, который не взяли.
  desk_phone: { kind: 'dial', color: [1.0, 0.74, 0.25], strength: 1.6, radius: 2.0, height: 0.25, mod: 'blink' },
  // Жёлтые комнаты: «the yellow sign. the floor was never wet.» Знак стоит в круге лампы: плитка блестит, будто
  // мокрая, — а пол сухой (обман ожиданий, как синий газ под холодным чайником).
  wet_floor_sign: { kind: 'lamp', color: [1.0, 0.93, 0.78], strength: 2.6, radius: 1.8, height: 2.4 },
  // «your slippers. you came to work in them.» Детский ночник у самого пола — дом посреди офиса.
  slippers: { kind: 'dial', color: [1.0, 0.76, 0.62], strength: 1.3, radius: 1.9, height: 0.15 },
  // «the clock. ten to six. the same ten to six.» Подсвеченный циферблат.
  office_clock: { kind: 'dial', color: [1.0, 0.9, 0.72], strength: 1.4, radius: 2.2, height: 0.15 },
  // Зал ожидания: записка, ключ, стакан — свет проходящего поезда, рама окна вагона скользит мимо и уходит.
  st_note: { kind: 'window', color: [1.0, 0.86, 0.62], strength: 2.0, radius: 3.0, height: 1.2, mod: 'pass' },
  st_key: { kind: 'window', color: [1.0, 0.86, 0.62], strength: 2.0, radius: 3.0, height: 1.2, mod: 'pass' },
  st_cup: { kind: 'window', color: [1.0, 0.86, 0.62], strength: 2.0, radius: 3.0, height: 1.2, mod: 'pass' },
};

/**
 * Множитель силы света во времени t (с, время игры) — его «жизнь» (MemLightMod); без mod — 1. Чистая функция
 * времени игры: один и тот же миг выглядит одинаково, проверки повторимы.
 */
export function memLightMod(mod: MemLightMod | undefined, t: number): number {
  if (!mod) return 1;
  if (mod === 'blink') return t % 1.2 < 0.55 ? 1 : 0.08;
  if (mod === 'pass') {
    // Раз в девять секунд — волна около двух секунд; в остальное время от поезда остаётся слабый отсвет.
    const x = ((t % 9) / 9 - 0.5) / 0.11;
    return 0.12 + 0.88 * Math.exp(-x * x);
  }
  // Экран: смена «кадров» двенадцать раз в секунду, яркость каждого — сумма несоизмеримых синусов.
  const q = Math.floor(t * 12) / 12;
  const n = 0.5 + 0.25 * Math.sin(q * 7.3) + 0.15 * Math.sin(q * 23.1 + 1.7) + 0.1 * Math.sin(q * 51.7 + 0.4);
  return 0.35 + 0.65 * Math.min(1, Math.max(0, n));
}

/** Свет вещи памяти этого рода (нет — undefined: вещь без своего света). */
export function memoryLightOf(thing: string): MemLightDef | undefined {
  return MEMORY_LIGHT[thing];
}

/** Как свет загорается и гаснет: за сколько секунд от нуля до полной силы и обратно. */
export const MEM_LIGHT_FADE = { in: 1.6, out: 0.9 } as const;

/** Шаг силы света к цели за dt: загорается медленнее, чем гаснет (вещь вспомнили — свет уходит с ней). */
export function memLightStep(k: number, target: number, dt: number): number {
  const rate = target > k ? 1 / MEM_LIGHT_FADE.in : 1 / MEM_LIGHT_FADE.out;
  return target > k ? Math.min(target, k + rate * dt) : Math.max(target, k - rate * dt);
}
