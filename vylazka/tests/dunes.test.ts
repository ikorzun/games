import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { createBody, stepPlayer } from '../src/player/controller';
import { ColliderSet } from '../src/world/colliders';
import { SILL, tongueHeight } from '../src/world/furnish_dunes';
import { buildLevel, dunesRolled } from '../src/world/level_build';
import { DUNES, duneHeight, SPINE, spineLift } from '../src/world/pocket_dunes';
import type { DunesSpace } from '../src/world/pocket_dunes';
import { buildPocket } from '../src/world/pockets';
import { DOOR_W } from '../src/world/shell';

/**
 * Песчаный зал (партнёр 21.11, 19:13: «В другой комнате, песок на полу, комната огромная и песок словно барханами, из песка торчат
 * кости скелет огромного странного зверя»; design.md, §38; world/pocket_dunes.ts, furnish_dunes.ts).
 */
const ORIGIN: Vec3 = [400, 0, 0];
const hall = buildPocket('dunes', 7, ORIGIN) as DunesSpace;
const ground = (x: number, z: number): number => ORIGIN[1] + duneHeight(x - ORIGIN[0], ORIGIN[2] - z, 7);

describe('барханы: рельеф песка', () => {
  it('у проёма — ровная площадка вровень с порогом; дальше — гряды до полутора-трёх метров', () => {
    for (let u = -1.5; u <= 1.5; u += 0.5) for (let v = 0; v <= 1.5; v += 0.5) expect(duneHeight(u, v, 7)).toBeCloseTo(SILL, 6);
    let hi = 0;
    for (let u = -18; u <= 18; u += 0.5) for (let v = 12; v <= 50; v += 0.5) hi = Math.max(hi, duneHeight(u, v, 7));
    expect(hi).toBeGreaterThan(1.5);
    expect(hi).toBeLessThan(4);
  });

  it('песок непрерывен (без ступенек) и не круче 55°; у стен — наметено выше, чем посреди', () => {
    let worst = 0;
    for (let u = -DUNES.w / 2 + 0.2; u <= DUNES.w / 2 - 0.2; u += 0.31) {
      for (let v = 0.2; v <= DUNES.l - 0.2; v += 0.29) {
        const h = duneHeight(u, v, 7);
        const g = Math.hypot(duneHeight(u + 0.02, v, 7) - h, duneHeight(u, v + 0.02, 7) - h) / 0.02;
        worst = Math.max(worst, g);
      }
    }
    expect(worst).toBeLessThan(Math.tan((55 * Math.PI) / 180));
    const wall = duneHeight(DUNES.w / 2 - 0.5, 33, 7);
    const middle = duneHeight(0, 33, 7);
    expect(wall).toBeGreaterThan(middle - 0.5);
    expect(wall).toBeGreaterThan(2);
  });

  it('по барханам ходят: контроллер идёт поверх песка, не проваливаясь и не застревая', () => {
    const col = new ColliderSet();
    for (const b of hall.colliders) col.add(b);
    for (const f of hall.fields) col.addField(f);
    // Поперёк гряд, от проёма вглубь и влево (в стороне от костей) — 20 м пути.
    const b = createBody(ORIGIN[0], hall.spawn.pos[1], ORIGIN[2] - 1);
    let travelled = 0;
    let lastX = b.x;
    let lastZ = b.z;
    const dir = [-0.55, -0.83];
    for (let i = 0; i < 60 * 10; i++) {
      stepPlayer(b, dir[0]!, dir[1]!, 2.2, 1 / 60, col);
      travelled += Math.hypot(b.x - lastX, b.z - lastZ);
      lastX = b.x;
      lastZ = b.z;
      expect(Math.abs(b.y - ground(b.x, b.z))).toBeLessThan(0.08);
    }
    expect(travelled).toBeGreaterThan(18);
  });

  it('лучи останавливаются на песке: взгляд вниз упирается в бархан', () => {
    const col = new ColliderSet();
    for (const f of hall.fields) col.addField(f);
    const x = ORIGIN[0] + 3;
    const z = ORIGIN[2] - 20;
    const eye = ground(x, z) + 1.6;
    const d = col.raycast(x, eye, z, 0, -1, 0, 10);
    expect(d).toBeCloseTo(1.6, 1);
  });
});

describe('песчаный зал: что в нём', () => {
  it('огромный: 48 × 66 м, стены выше 15 м; точка появления — в проёме, взгляд в зал', () => {
    const xs = hall.colliders.map((b) => [b.minX, b.maxX]).flat();
    const zs = hall.colliders.map((b) => [b.minZ, b.maxZ]).flat();
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(DUNES.w);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThanOrEqual(DUNES.l);
    expect(Math.max(...hall.colliders.map((b) => b.maxY)) - ORIGIN[1]).toBeGreaterThan(15);
    expect(hall.spawn.yaw).toBe(0);
    expect(hall.spawn.pos[1]).toBeCloseTo(ORIGIN[1] + SILL, 6);
    expect(hall.exit).toEqual(ORIGIN);
    expect(hall.env.light).toBe(1);
  });

  it('хребет ныряет в песок у хвоста и стоит сводом над грудью: под рёбрами можно пройти', () => {
    const v = hall.dunes.vertebrae;
    expect(v.length).toBeGreaterThan(30);
    const lift = v.map((q) => q.at[1] - ground(q.at[0], q.at[2]));
    // У хвоста часть позвонков почти целиком в песке.
    expect(lift.slice(0, 10).some((h, i) => h < v[i]!.r * 0.3)).toBe(true);
    // Над грудью хребет выше человеческого роста с запасом.
    expect(Math.max(...lift)).toBeGreaterThan(4);
    expect(spineLift(0.5)).toBeGreaterThan(4.5);
    expect(SPINE.length).toBeGreaterThan(5);
  });

  it('рёбра — дугой из хребта в песок; концы целых рёбер уходят под песок', () => {
    expect(hall.dunes.ribs.length).toBeGreaterThan(16);
    let buried = 0;
    for (const r of hall.dunes.ribs) {
      const tip = r[r.length - 1]!;
      if (tip[1] < ground(tip[0], tip[2])) buried++;
      // Ребро поднимается над песком.
      expect(Math.max(...r.map((p) => p[1] - ground(p[0], p[2])))).toBeGreaterThan(1.5);
    }
    expect(buried).toBeGreaterThan(hall.dunes.ribs.length * 0.6);
  });

  it('череп лежит на песке и повёрнут к проёму в три четверти: от двери видны морда в профиль и ряд глазниц', () => {
    const s = hall.dunes.skull;
    const toDoor = [ORIGIN[0] - s.at[0], ORIGIN[2] - s.at[2]];
    const l = Math.hypot(toDoor[0]!, toDoor[1]!);
    const cos = (s.face[0] * toDoor[0]! + s.face[1] * toDoor[1]!) / l;
    expect(cos).toBeGreaterThan(0.5);
    expect(cos).toBeLessThan(0.8);
    expect(s.at[1] - ground(s.at[0], s.at[2])).toBeLessThan(1.2);
    expect(l).toBeGreaterThan(25);
  });

  it('от проёма вглубь на 6 м путь свободен: ни кость, ни стена не стоят на пороге', () => {
    for (let k = 0.5; k <= 6; k += 0.25) {
      const p: Vec3 = [ORIGIN[0], ORIGIN[1] + 1, ORIGIN[2] - k];
      const hit = hall.colliders.some((b) => p[0] > b.minX - 0.3 && p[0] < b.maxX + 0.3 && p[2] > b.minZ - 0.3 && p[2] < b.maxZ + 0.3 && p[1] > b.minY && p[1] < b.maxY);
      expect(hit, `${k} м от проёма`).toBe(false);
    }
  });

  it('за чёрным проёмом зала — преграда: в толщу стены не уйти', () => {
    const p: Vec3 = [ORIGIN[0], ORIGIN[1] + 1, ORIGIN[2] + 0.45];
    expect(hall.colliders.some((b) => p[0] > b.minX && p[0] < b.maxX && p[2] > b.minZ && p[2] < b.maxZ && p[1] > b.minY && p[1] < b.maxY)).toBe(true);
  });
});

describe('язык песка у чёрного проёма на уровне', () => {
  it('у проёма — вровень с порогом зала, к краям сходит на нет, за пределами — пусто', () => {
    expect(tongueHeight(0, 0)).toBeCloseTo(SILL, 2);
    expect(tongueHeight(-0.2, 0)).toBe(SILL);
    expect(tongueHeight(-0.2, DOOR_W)).toBe(0);
    expect(tongueHeight(1.95, 0)).toBeLessThan(0.02);
    expect(tongueHeight(0.3, 1.5)).toBeLessThan(0.02);
    expect(tongueHeight(0.8, 0)).toBeGreaterThan(0.05);
  });
});

const SEEDS = Array.from({ length: 40 }, (_, i) => 2000 + i * 41);

describe('чёрный проём на уровне', () => {
  it('жребий выпадает примерно в четырёх уровнях из десяти', () => {
    const n = SEEDS.filter((s) => dunesRolled(s)).length;
    expect(n).toBeGreaterThan(SEEDS.length * 0.22);
    expect(n).toBeLessThan(SEEDS.length * 0.6);
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: выпал — проём есть почти всегда; помещение тупиковое, с одной дверью, пустое', (world: WorldKind) => {
    let want = 0;
    let have = 0;
    for (const s of SEEDS.slice(0, 14)) {
      const layout = generateLayout(s, 2, world);
      const l = buildLevel(layout);
      if (!dunesRolled(s)) {
        expect(l.duneDoor, `сид ${s}`).toBeUndefined();
        continue;
      }
      want++;
      const d = l.duneDoor;
      if (!d) continue;
      have++;
      const room = layout.rooms[d.room]!;
      expect(room.id).not.toBe(layout.entranceRoom);
      expect(l.whiteRoom?.room).not.toBe(d.room);
      expect([l.greenRoom, l.skyRoom, l.grassRoom]).not.toContain(d.room);
      // Одна дверь: одна связь навигации наружу.
      const own = l.nav.filter((n) => n.room === d.room);
      const out = own.flatMap((n) => n.links.map((i) => l.nav[i]!)).filter((n) => n.room !== d.room);
      expect(out.length, `сид ${s}`).toBe(1);
      // Проём — между помещением и этим соседом; нормаль смотрит внутрь помещения.
      const o = out[0]!;
      expect(Math.hypot(d.at[0] - o.x, d.at[1] - o.z)).toBeCloseTo(1.5, 1);
      expect((own[0]!.x - d.at[0]) * d.n[0] + (own[0]!.z - d.at[1]) * d.n[1]).toBeGreaterThan(0);
      // Пусто: ни мест для вещей, ни вещей.
      expect(l.spots.filter((sp) => sp.room === d.room)).toEqual([]);
      // Снаружи у проёма лежит песок: рельеф выше пола.
      expect(l.colliders.fieldAt(d.at[0] - d.n[0] * 0.4, d.at[1] - d.n[1] * 0.4)).toBeGreaterThan(d.y + 0.1);
    }
    expect(have).toBeGreaterThanOrEqual(Math.ceil(want * 0.6));
  });

  it('в зале ожидания чёрного проёма нет', () => {
    for (const s of SEEDS.filter((q) => dunesRolled(q)).slice(0, 3)) expect(buildLevel(generateLayout(s, 2, 'station')).duneDoor).toBeUndefined();
  });
});
