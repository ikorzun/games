/**
 * Гнуть манекен руками (слова партнёра: «я сам хочу руками трогать»). Тянешь кисть — рука сгибается так,
 * чтобы кисть пришла туда, куда тянешь; тянешь щиколотку — нога; макушку — голова поворачивается;
 * основание шеи — корпус наклоняется и поворачивается.
 *
 * Поза манекена — углы суставов (world/props_people.ts, Pose), а не точки. Поэтому обратная кинематика
 * здесь численная: несколько углов той части тела, за которую тянут, подбираются демпфированными
 * наименьшими квадратами (Левенберг — Марквардт) по прямой кинематике skeleton(). Углы всё время держатся
 * в пределах суставов (world/figures.ts, LIMITS): рука не вывернется, колено не согнётся назад.
 *
 * Чистый TS: конструктор (tools/constructor) и тесты.
 */
import type { Vec3 } from '../core/types';
import { clampTo, LIMITS } from './figures';
import { skeleton } from './props_people';
import type { Limb, Pose, Skeleton } from './props_people';

export type Handle = 'wristL' | 'wristR' | 'ankleL' | 'ankleR' | 'head' | 'chest';
export const HANDLES: readonly Handle[] = ['wristL', 'wristR', 'ankleL', 'ankleR', 'head', 'chest'];

/** Точка, за которую тянут: кисть, щиколотка, макушка, основание шеи (координаты фигуры). */
export function handlePoint(s: Skeleton, h: Handle): Vec3 {
  switch (h) {
    case 'wristL':
      return s.wrL;
    case 'wristR':
      return s.wrR;
    case 'ankleL':
      return s.anL;
    case 'ankleR':
      return s.anR;
    case 'head': {
      const f = s.frames.head;
      return [s.head[0] + f[1] * 0.12, s.head[1] + f[4] * 0.12, s.head[2] + f[7] * 0.12];
    }
    case 'chest':
      return s.neckBase;
  }
}

interface Param {
  get(p: Pose): number;
  set(p: Pose, v: number): void;
  lim: readonly [number, number];
}

type LimbKey = 'armL' | 'armR' | 'legL' | 'legR';

const field = (key: LimbKey, name: keyof Limb, lim: readonly [number, number]): Param => ({
  get: (p) => (p[key][name] as number | undefined) ?? 0,
  set: (p, v) => {
    (p[key] as Limb)[name] = v as never;
  },
  lim,
});

/** У руки и ноги численно подбирается только направление (вперёд и вбок); сгиб считается сразу. */
const limbParams = (key: LimbKey): Param[] => (key.startsWith('arm') ? [field(key, 'fwd', LIMITS.armFwd), field(key, 'out', LIMITS.armOut)] : [field(key, 'fwd', LIMITS.legFwd), field(key, 'out', LIMITS.legOut)]);

/** Конечность ручки: ключ в позе, шарнир у корня, сустав посередине и конец (точки скелета). */
const LIMB: Partial<Record<Handle, { key: LimbKey; root: (s: Skeleton) => Vec3; mid: (s: Skeleton) => Vec3; end: (s: Skeleton) => Vec3; bend: readonly [number, number] }>> = {
  wristL: { key: 'armL', root: (s) => s.shL, mid: (s) => s.elL, end: (s) => s.wrL, bend: LIMITS.armBend },
  wristR: { key: 'armR', root: (s) => s.shR, mid: (s) => s.elR, end: (s) => s.wrR, bend: LIMITS.armBend },
  ankleL: { key: 'legL', root: (s) => s.hipL, mid: (s) => s.knL, end: (s) => s.anL, bend: LIMITS.legBend },
  ankleR: { key: 'legR', root: (s) => s.hipR, mid: (s) => s.knR, end: (s) => s.anR, bend: LIMITS.legBend },
};

const len = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const PARAMS: Record<Handle, Param[]> = {
  wristL: limbParams('armL'),
  wristR: limbParams('armR'),
  ankleL: limbParams('legL'),
  ankleR: limbParams('legR'),
  head: [
    { get: (p) => p.head.pitch, set: (p, v) => (p.head.pitch = v), lim: LIMITS.headPitch },
    { get: (p) => p.head.yaw, set: (p, v) => (p.head.yaw = v), lim: LIMITS.headYaw },
  ],
  chest: [
    { get: (p) => p.spine, set: (p, v) => (p.spine = v), lim: LIMITS.spine },
    { get: (p) => p.twist ?? 0, set: (p, v) => (p.twist = v), lim: LIMITS.twist },
  ],
};

/** Глубокая копия позы: заготовки (POSES) неизменяемы, а решатель меняет углы на месте. */
export const clonePose = (p: Pose): Pose => JSON.parse(JSON.stringify(p)) as Pose;

/**
 * Подобрать углы части тела h так, чтобы её точка пришла в target (координаты фигуры). Недостижимая цель —
 * часть тела тянется к ней, сколько позволяют длины костей и пределы суставов. Исходную позу не меняет.
 */
export function solve(pose: Pose, h: Handle, target: Vec3, iters = 40): Pose {
  const p = clonePose(pose);
  const params = PARAMS[h];
  // Две кости: сгиб локтя (колена) задаёт расстояние от плеча (бедра) до конца — по теореме косинусов.
  // Дальше остаётся повернуть конечность так, чтобы конец смотрел на цель.
  const limb = LIMB[h];
  if (limb) {
    const s = skeleton(p);
    const r = limb.root(s);
    const a = len(r, limb.mid(s));
    const b = len(limb.mid(s), limb.end(s));
    const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-4, len(r, target)));
    const inner = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
    field(limb.key, 'bend', limb.bend).set(p, clampTo(180 - (inner * 180) / Math.PI, limb.bend));
  }
  const n = params.length;
  const D = 0.5;
  let lambda = 0.05;
  const err = (q: Pose): Vec3 => {
    const pt = handlePoint(skeleton(q), h);
    return [target[0] - pt[0], target[1] - pt[1], target[2] - pt[2]];
  };
  let e = err(p);
  let e2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  for (let it = 0; it < iters && e2 > 1e-7; it++) {
    // Якобиан численно: на сколько сдвигается точка при повороте каждого угла на полградуса.
    const J: Vec3[] = [];
    for (const pr of params) {
      const q = clonePose(p);
      const v = pr.get(q);
      const up = v + D <= pr.lim[1];
      pr.set(q, up ? v + D : v - D);
      const eq = err(q);
      const s = up ? 1 : -1;
      J.push([((e[0] - eq[0]) / D) * s, ((e[1] - eq[1]) / D) * s, ((e[2] - eq[2]) / D) * s]);
    }
    // (JᵀJ + λ²·I) Δ = Jᵀ e — для двух-трёх углов решается напрямую.
    const A: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      A.push([]);
      for (let j = 0; j < n; j++) A[i]!.push(J[i]![0] * J[j]![0] + J[i]![1] * J[j]![1] + J[i]![2] * J[j]![2] + (i === j ? lambda * lambda : 0));
      b.push(J[i]![0] * e[0] + J[i]![1] * e[1] + J[i]![2] * e[2]);
    }
    const step = gauss(A, b);
    if (!step) break;
    // Не больше 20° за шаг: иначе рука перескакивает через цель.
    const big = Math.max(...step.map((x) => Math.abs(x)));
    const k = big > 20 ? 20 / big : 1;
    const q = clonePose(p);
    params.forEach((pr, i) => pr.set(q, clampTo(pr.get(q) + step[i]! * k, pr.lim)));
    const eq = err(q);
    const eq2 = eq[0] * eq[0] + eq[1] * eq[1] + eq[2] * eq[2];
    if (eq2 < e2) {
      params.forEach((pr) => pr.set(p, pr.get(q)));
      e = eq;
      e2 = eq2;
      lambda = Math.max(0.01, lambda * 0.6);
    } else lambda *= 3;
  }
  return p;
}

/** Решить A·x = b (малая система) методом Гаусса с выбором главного элемента; null — вырождена. */
function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}
