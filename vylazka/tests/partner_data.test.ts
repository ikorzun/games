/**
 * Записи партнёра в игре (world/partner/*.json): их пишет конструктор — на странице в Claude (переносит основная модель) и
 * на компьютере партнёра (квиз 18.11: «Программа на MacBook», tools/constructor/serve.mjs, push.mjs). Каждая запись проходит
 * те же проверки, что и в конструкторе, ключи уникальны, файлы — по времени сохранения.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURES } from '../src/world/figures_data';
import { figureProblems } from '../src/world/figures';
import { PLACED, REMOVED } from '../src/world/placed_data';
import { placedProblems, removedProblems } from '../src/world/placed';
import { ALL_PROPS, FIXED } from '../src/world/props_all';

/** Порядок записей, как у конструктора: по времени сохранения, при равенстве — по ключу. */
const order = (r: { id: string; at?: string }): string => `${r.at ?? ''}|${r.id}`;
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
/** Файл в том виде, в каком его пишет конструктор (tools/constructor/serve.mjs, writeRows): одна запись — одна строка, ключи по алфавиту. */
const canon = (rows: { id: string; at?: string }[]): string => {
  const s = [...rows].sort((a, b) => order(a).localeCompare(order(b)));
  return `[\n${s.map((r) => `  ${JSON.stringify(sortKeys(r))}`).join(',\n')}${s.length ? '\n' : ''}]\n`;
};
/** Все файлы, которые конструктор отправляет «Залить в игру» (кроме вещей Sand3D). */
const FILES = ['src/world/partner/things.json', 'src/world/partner/removed.json', 'src/world/partner/figures.json', 'tools/constructor/work/verdicts.json', 'tools/constructor/work/requests.json'];

const sorted = (rows: readonly { id: string; at?: string }[]): boolean => rows.every((r, i) => i === 0 || `${rows[i - 1]!.at ?? ''}|${rows[i - 1]!.id}` <= `${r.at ?? ''}|${r.id}`);

describe('записи партнёра в игре', () => {
  it('каждая годна: вещи, убранные, фигуры', () => {
    for (const s of PLACED) expect(placedProblems(s, ALL_PROPS, FIXED), s.id).toEqual([]);
    for (const r of REMOVED) expect(removedProblems(r, ALL_PROPS, FIXED), r.id).toEqual([]);
    for (const f of FIGURES) expect(figureProblems(f), f.id).toEqual([]);
  });

  it('ключи уникальны и из [a-z0-9_]; записи — по времени сохранения', () => {
    const ids = [...PLACED, ...REMOVED, ...FIGURES].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
    expect(sorted(PLACED)).toBe(true);
    expect(sorted(REMOVED)).toBe(true);
    expect(sorted(FIGURES)).toBe(true);
  });

  // 20.11: правки партнёра дважды ушли отдельной веткой — файлы в репозитории были записаны с пробелами (json.dumps), а
  // конструктор пишет без них. Каждая строка отличалась, и любая правка с двух сторон давала конфликт. В одном виде git
  // сводит построчно: новая запись партнёра и наша правка другой записи не мешают друг другу.
  it('файлы — в том виде, в каком их пишет конструктор (иначе git не сводит правки построчно)', () => {
    for (const f of FILES) {
      const raw = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(raw, f).toBe(canon(JSON.parse(raw) as { id: string; at?: string }[]));
    }
  });
});
