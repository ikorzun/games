/**
 * Состояние партии и операции над ним (эффекты, начальные значения, нормализация при загрузке).
 * Состояние — чистый JSON без ссылок на объекты движка, поэтому сериализуется как есть.
 */
import type { Effect, Episode, GameState, Value, VariableDef } from './types';

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

export function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function cloneState(s: GameState): GameState {
  return cloneJson(s);
}

/** Область видимости переменной: по умолчанию эпизодная. */
export function isGlobalVar(def: VariableDef): boolean {
  return def.scope === 'global';
}

/**
 * Начальное состояние. `carriedGlobals` — значения глобальных переменных, перенесённые из
 * предыдущих эпизодов сезона; применяются только к переменным, которые объявлены global.
 */
export function createInitialState(
  episode: Episode,
  sceneId: string,
  carriedGlobals: Readonly<Record<string, Value>> = {},
): GameState {
  const vars: Record<string, Value> = {};
  const globals: Record<string, Value> = {};
  for (const [name, def] of Object.entries(episode.variables)) {
    if (isGlobalVar(def)) globals[name] = coerce(def, carriedGlobals[name], def.default);
    else vars[name] = def.default;
  }
  return {
    episode_id: episode.id,
    scene_id: sceneId,
    step_index: 0,
    vars,
    globals,
    archive: [],
    journal: [],
  };
}

/** Переменные для вычисления условий: глобальные + эпизодные. */
export function envOf(s: Pick<GameState, 'vars' | 'globals'>): Record<string, Value> {
  return { ...s.globals, ...s.vars };
}

function typeOk(def: VariableDef, v: unknown): v is Value {
  switch (def.type) {
    case 'bool':
      return typeof v === 'boolean';
    case 'int':
      return typeof v === 'number' && Number.isInteger(v);
    case 'string':
      return typeof v === 'string';
  }
}

function clamp(def: VariableDef, v: Value): Value {
  if (def.type !== 'int' || typeof v !== 'number') return v;
  let out = v;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}

/** Значение, приведённое к типу переменной; при несоответствии — запасное. */
function coerce(def: VariableDef, v: unknown, fallback: Value): Value {
  return typeOk(def, v) ? clamp(def, v) : fallback;
}

function storeOf(state: GameState, def: VariableDef): Record<string, Value> {
  return isGlobalVar(def) ? state.globals : state.vars;
}

/** Присвоить значение переменной с проверкой типа и зажатием в [min, max]. */
export function setVariable(state: GameState, episode: Episode, name: string, value: Value): void {
  const def = episode.variables[name];
  if (!def) throw new StateError(`переменная не объявлена: ${name}`);
  if (!typeOk(def, value)) {
    throw new StateError(`значение ${JSON.stringify(value)} не подходит типу ${def.type} переменной ${name}`);
  }
  storeOf(state, def)[name] = clamp(def, value);
}

export function getVariable(state: GameState, name: string): Value | undefined {
  return name in state.vars ? state.vars[name] : state.globals[name];
}

export function applyEffect(state: GameState, episode: Episode, eff: Effect): void {
  const def = episode.variables[eff.var];
  if (!def) throw new StateError(`effect на необъявленную переменную: ${eff.var}`);
  const store = storeOf(state, def);
  const cur = store[eff.var];
  switch (eff.op) {
    case 'set':
      if (eff.value === undefined) throw new StateError(`set без value (${eff.var})`);
      setVariable(state, episode, eff.var, eff.value);
      return;
    case 'add':
    case 'sub': {
      if (def.type !== 'int' || typeof cur !== 'number') {
        throw new StateError(`${eff.op} применим только к int (${eff.var}: ${def.type})`);
      }
      if (typeof eff.value !== 'number') throw new StateError(`${eff.op} без числового value (${eff.var})`);
      const next = eff.op === 'add' ? cur + eff.value : cur - eff.value;
      store[eff.var] = clamp(def, next);
      return;
    }
    case 'toggle':
      if (def.type !== 'bool' || typeof cur !== 'boolean') {
        throw new StateError(`toggle применим только к bool (${eff.var}: ${def.type})`);
      }
      store[eff.var] = !cur;
      return;
  }
}

export function applyEffects(state: GameState, episode: Episode, effects: readonly Effect[] | undefined): void {
  if (!effects) return;
  for (const eff of effects) applyEffect(state, episode, eff);
}

/**
 * Привести состояние из сейва к текущему описанию эпизода (контент мог поменяться между
 * версиями): добавить новые переменные со значениями по умолчанию, выбросить удалённые,
 * исправить значения неверного типа. Возвращает список замечаний для лога.
 */
export function reconcileState(episode: Episode, saved: GameState): { state: GameState; notes: string[] } {
  const notes: string[] = [];
  const state = cloneState(saved);
  const vars: Record<string, Value> = {};
  const globals: Record<string, Value> = {};
  for (const [name, def] of Object.entries(episode.variables)) {
    const source = isGlobalVar(def) ? saved.globals : saved.vars;
    const dest = isGlobalVar(def) ? globals : vars;
    if (!(name in source)) {
      dest[name] = def.default;
      notes.push(`новая переменная ${name} = ${JSON.stringify(def.default)}`);
    } else {
      const ok = typeOk(def, source[name]);
      dest[name] = ok ? clamp(def, source[name] as Value) : def.default;
      if (!ok) notes.push(`переменная ${name}: неверный тип в сейве, сброшена`);
    }
  }
  for (const name of [...Object.keys(saved.vars), ...Object.keys(saved.globals)]) {
    if (!(name in episode.variables)) notes.push(`переменная ${name} удалена из эпизода`);
  }
  state.vars = vars;
  state.globals = globals;
  state.archive = Array.isArray(saved.archive) ? saved.archive.filter((x) => typeof x === 'string') : [];
  state.journal = Array.isArray(saved.journal) ? saved.journal : [];
  return { state, notes };
}
