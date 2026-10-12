/**
 * Мини-грамматика условий сценария (поле `when`): порт tools/vnexpr.py 1:1, без eval().
 *
 *   expr   := or
 *   or     := and ( '||' and )*
 *   and    := not ( '&&' not )*
 *   not    := '!' not | cmp
 *   cmp    := atom ( ('=='|'!='|'<='|'>='|'<'|'>') atom )?
 *   atom   := IDENT | INT | STRING | 'true' | 'false' | '(' expr ')'
 *
 * IDENT = [a-z_][a-z0-9_]*   INT = -?[0-9]+   STRING = '...'
 *
 * Отличия от Python-оригинала (намеренные, поведение на корректных входах идентично):
 *  - сравнение строки с числом через == / != просто даёт false/true; Python в этом случае
 *    падал бы с TypeError, потому что вычисляет все шесть сравнений словарём заранее;
 *  - порядковое сравнение (<, <=, >, >=) строки с числом — ExprError, а не TypeError;
 *  - как и в Python, True == 1 и False == 0 (bool сравнивается с числом численно).
 */
import type { Value } from './types';

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

export interface Tok {
  readonly kind: 'op' | 'int' | 'str' | 'ident';
  readonly text: string;
}

// Группы: 1 — оператор, 2 — целое, 3 — строка в одинарных кавычках, 4 — идентификатор.
const TOKEN_RE = /\s*(?:(==|!=|<=|>=|&&|\|\||[!<>()])|(-?\d+)|('[^']*')|([a-z_][a-z0-9_]*))/y;

export function tokenize(src: string): Tok[] {
  const s = src.trim();
  const out: Tok[] = [];
  let pos = 0;
  while (pos < s.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(s);
    if (!m || TOKEN_RE.lastIndex === pos) {
      throw new ExprError(`неожиданный символ в позиции ${pos}: ${JSON.stringify(s.slice(pos, pos + 10))}`);
    }
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ kind: 'op', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'int', text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'str', text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: 'ident', text: m[4] });
  }
  return out;
}

export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Node =
  | { t: 'var'; name: string }
  | { t: 'int'; value: number }
  | { t: 'str'; value: string }
  | { t: 'bool'; value: boolean }
  | { t: 'not'; arg: Node }
  | { t: 'and'; left: Node; right: Node }
  | { t: 'or'; left: Node; right: Node }
  | { t: 'cmp'; op: CmpOp; left: Node; right: Node };

const CMP_OPS: ReadonlySet<string> = new Set(['==', '!=', '<=', '>=', '<', '>']);

class Parser {
  private i = 0;

  constructor(private readonly toks: readonly Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private take(text?: string): Tok {
    const t = this.peek();
    if (t === undefined) throw new ExprError('неожиданный конец выражения');
    if (text !== undefined && t.text !== text) {
      throw new ExprError(`ожидалось ${JSON.stringify(text)}, получено ${JSON.stringify(t.text)}`);
    }
    this.i += 1;
    return t;
  }

  parse(): Node {
    const node = this.pOr();
    const rest = this.peek();
    if (rest !== undefined) throw new ExprError(`лишние токены после выражения: ${JSON.stringify(rest.text)}`);
    return node;
  }

  private pOr(): Node {
    let node = this.pAnd();
    while (this.peek()?.text === '||') {
      this.take();
      node = { t: 'or', left: node, right: this.pAnd() };
    }
    return node;
  }

  private pAnd(): Node {
    let node = this.pNot();
    while (this.peek()?.text === '&&') {
      this.take();
      node = { t: 'and', left: node, right: this.pNot() };
    }
    return node;
  }

  private pNot(): Node {
    const t = this.peek();
    if (t !== undefined && t.kind === 'op' && t.text === '!') {
      this.take();
      return { t: 'not', arg: this.pNot() };
    }
    return this.pCmp();
  }

  private pCmp(): Node {
    const left = this.pAtom();
    const t = this.peek();
    if (t !== undefined && t.kind === 'op' && CMP_OPS.has(t.text)) {
      this.take();
      const right = this.pAtom();
      return { t: 'cmp', op: t.text as CmpOp, left, right };
    }
    return left;
  }

  private pAtom(): Node {
    const t = this.take();
    if (t.kind === 'int') return { t: 'int', value: Number.parseInt(t.text, 10) };
    if (t.kind === 'str') return { t: 'str', value: t.text.slice(1, -1) };
    if (t.kind === 'ident') {
      if (t.text === 'true') return { t: 'bool', value: true };
      if (t.text === 'false') return { t: 'bool', value: false };
      return { t: 'var', name: t.text };
    }
    if (t.kind === 'op' && t.text === '(') {
      const node = this.pOr();
      this.take(')');
      return node;
    }
    throw new ExprError(`неожиданный токен ${JSON.stringify(t.text)}`);
  }
}

export function parse(src: string): Node {
  return new Parser(tokenize(src)).parse();
}

/** Имена переменных в порядке появления (с повторами, как в оригинале). */
export function* variables(node: Node): Generator<string> {
  switch (node.t) {
    case 'var':
      yield node.name;
      break;
    case 'not':
      yield* variables(node.arg);
      break;
    case 'and':
    case 'or':
      yield* variables(node.left);
      yield* variables(node.right);
      break;
    case 'cmp':
      yield* variables(node.left);
      yield* variables(node.right);
      break;
    default:
      break;
  }
}

/** Питоновская «истинность» для bool | int | str. */
export function truthy(v: Value): boolean {
  return typeof v === 'string' ? v.length > 0 : Boolean(v);
}

function compare(op: CmpOp, a: Value, b: Value): boolean {
  const numeric = (typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean');
  const bothStr = typeof a === 'string' && typeof b === 'string';
  if (op === '==' || op === '!=') {
    const eq = numeric ? Number(a) === Number(b) : a === b;
    return op === '==' ? eq : !eq;
  }
  if (!numeric && !bothStr) {
    throw new ExprError(`нельзя сравнивать ${typeof a} и ${typeof b} оператором ${op}`);
  }
  const x = numeric ? Number(a) : (a as string);
  const y = numeric ? Number(b) : (b as string);
  switch (op) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    default:
      return x >= y;
  }
}

export type Env = Readonly<Record<string, Value>>;

export function evaluate(node: Node, env: Env): Value {
  switch (node.t) {
    case 'int':
    case 'str':
    case 'bool':
      return node.value;
    case 'var': {
      if (!Object.prototype.hasOwnProperty.call(env, node.name)) {
        throw new ExprError(`переменная не определена: ${node.name}`);
      }
      return env[node.name] as Value;
    }
    case 'not':
      return !truthy(evaluate(node.arg, env));
    case 'and':
      return truthy(evaluate(node.left, env)) && truthy(evaluate(node.right, env));
    case 'or':
      return truthy(evaluate(node.left, env)) || truthy(evaluate(node.right, env));
    case 'cmp':
      return compare(node.op, evaluate(node.left, env), evaluate(node.right, env));
  }
}

/** Ошибки выражения для линтера/редактора: синтаксис + необъявленные переменные. */
export function check(src: string, declared: ReadonlySet<string> | Iterable<string>): string[] {
  const known = declared instanceof Set ? declared : new Set(declared);
  let node: Node;
  try {
    node = parse(src);
  } catch (e) {
    if (e instanceof ExprError) return [`синтаксис: ${e.message}`];
    throw e;
  }
  const missing = [...new Set(variables(node))].filter((v) => !known.has(v)).sort();
  return missing.map((v) => `необъявленная переменная: ${v}`);
}

// ───────────────────────────── удобные обёртки для интерпретатора ─────────────────────────────

const cache = new Map<string, Node>();

/** Разбор с кэшем: условия вычисляются на каждом шаге, парсить их каждый раз незачем. */
export function parseCached(src: string): Node {
  let node = cache.get(src);
  if (node === undefined) {
    node = parse(src);
    cache.set(src, node);
  }
  return node;
}

/** Вычислить условие `when` в булев результат. */
export function evalCondition(src: string, env: Env): boolean {
  return truthy(evaluate(parseCached(src), env));
}
