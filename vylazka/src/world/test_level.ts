/**
 * Тестовый уровень технического среза, собранный руками: коридор с поворотом, спальный отсек
 * за гермодверью, лестница вниз в тупик. Нужен, чтобы проверить вид, частоту кадров и управление
 * на реальных устройствах до генератора. Собирается теми же деталями, что и будущие уровни.
 */
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import type { BuiltLevel } from './level';
import { MAT } from './materials';
import { barrel, bunk, cables, cageLamp, crate, hermoDoor, locker, pipeRun, rubble, signPlate, stairsDown, stool, table, valve, ventGrille, Xf } from './props';
import { buildShell, Shell, STYLE_CORRIDOR, STYLE_ROOM, WALL_T } from './shell';

const CEIL = 2.7;
const LOW = -1.44;

export function buildTestLevel(): BuiltLevel {
  const shell = new Shell();
  // Коридор A: вдоль z от +4,5 до −16,5.
  for (let cz = 1; cz >= -5; cz--) shell.add({ cx: 0, cz, floorY: 0, ceilY: CEIL, room: 1, style: STYLE_CORRIDOR });
  // Спальный отсек B за дверью.
  for (const cx of [1, 2]) for (const cz of [-3, -2]) shell.add({ cx, cz, floorY: 0, ceilY: CEIL, room: 2, style: STYLE_ROOM });
  shell.setDoor(0, -2, 0);
  // Коридор C: поворот налево, лестница вниз и нижний тупик.
  for (const cx of [-1, -2]) shell.add({ cx, cz: -5, floorY: 0, ceilY: CEIL, room: 1, style: STYLE_CORRIDOR });
  shell.add({ cx: -3, cz: -5, floorY: LOW, ceilY: CEIL, room: 1, style: STYLE_CORRIDOR });
  for (const cx of [-4, -5]) shell.add({ cx, cz: -5, floorY: LOW, ceilY: 1.3, room: 1, style: { ...STYLE_CORRIDOR, floor: MAT.wetConcrete, floorTint: [0.9, 0.9, 0.9] } });

  const mb = new MeshBuilder();
  const col = new ColliderSet();
  buildShell(shell, mb, col);

  const T = WALL_T / 2;
  const at = (x: number, y: number, z: number, rot: 0 | 1 | 2 | 3 = 0): Xf => new Xf(mb, col, x, y, z, rot);

  // ── Коридор A ──
  // Трубы по западной стене (лицом к +x): от южного торца до поворота.
  pipeRun(at(-1.5 + T, 0, 4.3, 1), 17.7, 2.28, 0.06, MAT.rust);
  pipeRun(at(-1.5 + T, 0, 4.3, 1), 17.7, 2.08, 0.035, MAT.paintBlue, [0.8, 0.8, 0.8]);
  valve(at(-1.5 + T + 0.12, 2.28, -3.2, 1));
  valve(at(-1.5 + T + 0.12, 2.28, -11.0, 1), 0.1);
  // Кабели под потолком по восточной стене (лицом к −x).
  cables(at(1.5 - T, 2.56, -16.3, 3), 20.5);
  for (const z of [3, -3, -9, -15]) cageLamp(at(0, CEIL, z));
  signPlate(at(1.5 - T, 2.33, -6, 3), 0.6, 0.16);
  ventGrille(at(1.5 - T, 2.2, 0.5, 3));
  crate(at(1.0, 0, 3.6), 0.6, 0.45, 0.45);
  crate(at(1.02, 0.45, 3.62, 1), 0.42, 0.3, 0.4, [0.85, 0.85, 0.85]);
  barrel(at(-0.95, 0, -9.6), MAT.metalGreen);
  rubble(at(0.7, 0, -12.2), 11);

  // ── Гермодверь в отсек B: стена идёт вдоль z, створка распахнута внутрь отсека ──
  hermoDoor(at(1.5, 0, -6, 1));

  // ── Отсек B ──
  bunk(at(7.5 - T, 0, -4.85, 2));
  bunk(at(7.5 - T, 0, -7.35, 2));
  locker(at(2.25, 0, -10.5 + T));
  locker(at(2.72, 0, -10.5 + T), true, [0.92, 0.95, 0.9]);
  locker(at(3.19, 0, -10.5 + T), false, [0.85, 0.9, 0.85]);
  table(at(4.4, 0, -7.4));
  stool(at(4.3, 0, -6.75));
  stool(at(5.3, 0, -7.9, 1));
  barrel(at(2.15, 0, -5.15));
  crate(at(3.05, 0, -5.05), 0.7, 0.5, 0.5);
  ventGrille(at(5.2, 2.15, -4.5 - T, 2));
  cageLamp(at(4.5, CEIL, -7.5));
  pipeRun(at(1.7, 0, -10.5 + T), 5.6, 2.35, 0.045, MAT.rust, [0.9, 0.9, 0.9]);

  // ── Коридор C и лестница ──
  pipeRun(at(-7.4, 0, -16.5 + T), 8.7, 2.28, 0.06, MAT.rust);
  valve(at(-4.2, 2.28, -16.5 + T + 0.12));
  cageLamp(at(-4.5, CEIL, -15));
  rubble(at(-6.3, 0, -14.3), 5);
  stairsDown(at(-7.5, 0, 0), 8, 0.18, 0.3, -16.5 + T, -13.5 - T);

  // ── Нижний тупик ──
  barrel(at(-15.85, LOW, -15.95));
  barrel(at(-15.2, LOW, -16.0), MAT.metalGreen, [0.9, 0.9, 0.9]);
  barrel(at(-15.75, LOW, -15.3), MAT.rust, [0.8, 0.75, 0.7]);
  crate(at(-13.2, LOW, -14.1, 1), 0.7, 0.5, 0.5, [0.8, 0.8, 0.8]);
  ventGrille(at(-16.5 + T, LOW + 1.75, -15, 1), 0.6, 0.4);
  rubble(at(-12.0, LOW, -15.9), 23);
  signPlate(at(-12, LOW + 2.3, -16.5 + T), 0.5, 0.16);

  return { chunks: [{ mesh: mb.build(), tierMin: 0, tierMax: 1 }], stairs: [], colliders: col, spawn: { pos: [0, 0, 3], yaw: 0 }, exit: [0, 0, 4], spots: [], landmarks: [], zones: [], collapses: [], variants: [], nav: [], sheets: mb.sheets, layout: null };
}
