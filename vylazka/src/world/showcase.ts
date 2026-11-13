/**
 * Витрина реквизита (?level=show): длинный зал, вдоль стены в ряд стоят предметы из реестров PROPS и HOME_PROPS (ALL_PROPS).
 * Нужна, чтобы посмотреть каждый предмет под фонарём, не разыскивая его по сгенерированному убежищу.
 *   ?level=show                 — весь реестр
 *   ?level=show&props=a,b,c     — только названные
 * Предмет № i стоит у северной стены в точке x = i · SHOW_STEP; смотреть на него — с юга.
 */
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import type { BuiltLevel } from './level';
import { Xf } from './props';
import { ALL_PROPS } from './props_all';
import { buildShell, Shell, STYLE_ROOM, WALL_T } from './shell';

export const SHOW_STEP = 2.4;
/** Внутренняя грань северной стены зала. */
export const SHOW_WALL_Z = -1.5 + WALL_T / 2;
const CEIL = 2.7;

/** Имена предметов витрины по порядку (все или только существующие из запрошенных). */
export function showcaseNames(only: readonly string[] | null): string[] {
  const all = Object.keys(ALL_PROPS);
  return only ? only.filter((n) => n in ALL_PROPS) : all;
}

/** Что стоит на витрине и как закреплено: по этому съёмка решает, куда смотреть. */
export function showcaseItems(only: readonly string[] | null): { name: string; mount: string; h: number; y: number }[] {
  return showcaseNames(only).map((name) => {
    const p = ALL_PROPS[name]!;
    return { name, mount: p.mount, h: p.h, y: p.y ?? 0 };
  });
}

export function buildShowcase(only: readonly string[] | null): BuiltLevel {
  const names = showcaseNames(only);
  const cells = Math.max(2, Math.ceil(((names.length - 1) * SHOW_STEP + 3) / 3));
  const shell = new Shell();
  for (let cx = 0; cx < cells; cx++) for (const cz of [0, 1]) shell.add({ cx, cz, floorY: 0, ceilY: CEIL, room: 1, style: STYLE_ROOM });
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  buildShell(shell, mb, col);
  names.forEach((name, i) => {
    const p = ALL_PROPS[name]!;
    const x = i * SHOW_STEP;
    const y = p.mount === 'wall' ? (p.y ?? 1.2) : p.mount === 'ceiling' ? CEIL : 0;
    // Отдельно стоящие предметы отодвинуты от стены, чтобы их можно было обойти.
    const z = p.mount === 'free' ? SHOW_WALL_Z + 1.2 : SHOW_WALL_Z;
    p.build(new Xf(mb, col, x, y, z, 0), 1000 + i * 7);
  });
  return { chunks: [{ mesh: mb.build(), tierMin: 0, tierMax: 0 }], stairs: [], colliders: col, spawn: { pos: [0, 0, 3], yaw: 0 }, exit: [0, 0, 4], spots: [], landmarks: [], zones: [], collapses: [], variants: [], nav: [], layout: null };
}
