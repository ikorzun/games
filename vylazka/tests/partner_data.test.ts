/**
 * Записи партнёра в игре (world/partner/*.json): их пишет конструктор — на странице в Claude (переносит основная модель) и
 * на компьютере партнёра (квиз 18.11: «Программа на MacBook», tools/constructor/serve.mjs, push.mjs). Каждая запись проходит
 * те же проверки, что и в конструкторе, ключи уникальны, файлы — по времени сохранения.
 */
import { describe, expect, it } from 'vitest';
import { FIGURES } from '../src/world/figures_data';
import { figureProblems } from '../src/world/figures';
import { PLACED, REMOVED } from '../src/world/placed_data';
import { placedProblems, removedProblems } from '../src/world/placed';
import { ALL_PROPS, FIXED } from '../src/world/props_all';

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
});
