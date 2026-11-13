/** Текстовая карта плана: для отладки, документов и чтения глазами. */
import { GRID } from './layout';
import type { GenLayout, RoomType } from './layout';

const GLYPH: Record<RoomType, string> = {
  corridor: '·',
  entrance: 'E',
  airlock: 'A',
  stairwell: '≡',
  dorm: 'D',
  command: 'C',
  medical: 'M',
  storage: 'S',
  washroom: 'W',
  fvu: 'F',
  diesel: 'G',
  tanks: 'T',
  switchboard: 'B',
  archive: 'R',
  collapsed: 'X',
  kitchen: 'K',
  living: 'L',
  bedroom: 'O',
  bathroom: 'V',
  nursery: 'N',
  hallway: 'H',
};

/** Ярусы плана строками; двери отмечены «+» между клетками. */
export function layoutToAscii(l: GenLayout): string {
  const out: string[] = [];
  for (let t = 0; t < l.tierCount; t++) {
    // Холст с удвоенным шагом: клетки на нечётных позициях, рёбра — между ними.
    const w = GRID * 2 + 1;
    const rows: string[][] = Array.from({ length: w }, () => Array.from({ length: w }, () => ' '));
    for (const r of l.rooms) {
      if (r.tier !== t) continue;
      for (const [x, z] of r.cells) rows[z * 2 + 1]![x * 2 + 1] = GLYPH[r.type];
    }
    for (const e of l.edges) {
      if (e.tier !== t) continue;
      rows[e.cz * 2 + 1 + (e.dir === 1 ? 1 : 0)]![e.cx * 2 + 1 + (e.dir === 0 ? 1 : 0)] = e.kind === 'open' ? '=' : '+';
    }
    out.push(`ярус ${t + 1}`, ...rows.map((r) => r.join('').replace(/\s+$/, '')).filter((r, i, a) => r !== '' || (i > 0 && a[i - 1] !== '')));
  }
  return out.join('\n');
}
