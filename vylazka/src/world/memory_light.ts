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
}

/** Номер рода света в шейдере (uMemColor.w). */
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
};

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
