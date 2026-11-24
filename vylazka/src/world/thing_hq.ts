/**
 * Подробные вещи памяти (партнёр 24.11: «полигонов должно быть больше, материал лучше»; docs/vylazka/things_hq.md).
 * У вещи из описи THING_HQ есть подробная сетка с развёрткой и две карты: цвет + затенение щелей и нормали + шероховатость +
 * металл (scripts/import_thing_hq.py). Файлы лежат в assets/things сборки и качаются по нужде — когда вещь в первый раз
 * появляется; пока их нет (и если сеть их не отдала), стоит прежняя болванка из блоков: игра от подробной вещи не зависит.
 * Здесь — разбор файла сетки и очередь загрузок; карты грузит рендер (render/renderer.ts, addThing).
 */
import type { MeshData } from './kit';
import { MAT } from './materials';
import { THING_HQ } from './thing_hq_meta';

export interface ThingHq {
  mesh: MeshData;
  /** Адреса карт: цвет + AO и нормали + шероховатость + металл. */
  maps: { color: string; normal: string };
  tris: number;
}

/** Где лежат файлы вещей в сборке (относительно страницы игры). */
export const THING_HQ_DIR = 'assets/things/';

let enabled = true;
const ready = new Map<string, ThingHq | null>();
const pending = new Map<string, Promise<ThingHq | null>>();

/** Выключить подробные вещи (?hq=0 — для кадров «до» и замеров): стоят прежние болванки. */
export function setThingHq(on: boolean): void {
  enabled = on;
}

/** Есть ли у вещи подробная модель (и включены ли они). */
export function hasThingHq(kind: string): boolean {
  return enabled && kind in THING_HQ;
}

/** Уже загруженная подробная вещь; нет — null (ещё не пришла, не пришла вовсе или её нет в описи). */
export function thingHqReady(kind: string): ThingHq | null {
  return enabled ? (ready.get(kind) ?? null) : null;
}

/**
 * Разобрать файл сетки (формат — в шапке scripts/import_thing_hq.py). Материал вершин — эмаль: это только основа для
 * правил мира (запустение, скан); цвет, блеск и металл подробной вещи берутся из её карт (render/shaders.ts, THING_TEX).
 */
export function decodeThingHq(buf: ArrayBuffer): MeshData {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x31545a56) throw new Error('не файл вещи (нет метки VZT1)');
  const nv = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const f = (k: number): number => dv.getFloat32(12 + k * 4, true);
  const lo = [f(0), f(1), f(2)];
  const hi = [f(3), f(4), f(5)];
  const ulo = [f(6), f(7)];
  const uhi = [f(8), f(9)];
  let off = 12 + 40;
  const wide = nv > 65535;
  const need = off + nv * 6 + nv * 4 + nv * 4;
  if (buf.byteLength < need + ni * (wide ? 4 : 2)) throw new Error('файл вещи обрезан');
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const color = new Float32Array(nv * 4).fill(1);
  const mat = new Float32Array(nv).fill(MAT.enamel);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) position[i * 3 + k] = lo[k]! + (dv.getUint16(off + i * 6 + k * 2, true) / 65535) * (hi[k]! - lo[k]!);
  off += nv * 6;
  for (let i = 0; i < nv; i++) for (let k = 0; k < 2; k++) uv[i * 2 + k] = ulo[k]! + (dv.getUint16(off + i * 4 + k * 2, true) / 65535) * (uhi[k]! - ulo[k]!);
  off += nv * 4;
  for (let i = 0; i < nv; i++) {
    const x = dv.getInt8(off + i * 4);
    const y = dv.getInt8(off + i * 4 + 1);
    const z = dv.getInt8(off + i * 4 + 2);
    const l = Math.hypot(x, y, z) || 1;
    normal[i * 3] = x / l;
    normal[i * 3 + 1] = y / l;
    normal[i * 3 + 2] = z / l;
  }
  off += nv * 4;
  off += (4 - (off % 4)) % 4;
  const index = new Uint32Array(ni);
  for (let i = 0; i < ni; i++) {
    const v = wide ? dv.getUint32(off + i * 4, true) : dv.getUint16(off + i * 2, true);
    if (v >= nv) throw new Error('индекс вершины за пределами сетки');
    index[i] = v;
  }
  return { position, normal, color, mat, uv, index };
}

/**
 * Подгрузить подробную вещь (один раз на вид; повторный вызов отдаёт тот же ответ). null — её нет в описи, подробные вещи
 * выключены или файл не пришёл: вещь остаётся болванкой.
 */
export function loadThingHq(kind: string, base = ''): Promise<ThingHq | null> {
  const meta = THING_HQ[kind];
  if (!enabled || !meta) return Promise.resolve(null);
  let p = pending.get(kind);
  if (!p) {
    const url = base + THING_HQ_DIR + meta.file;
    p = fetch(`${url}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf): ThingHq => {
        const mesh = decodeThingHq(buf);
        return { mesh, maps: { color: `${url}_c.webp`, normal: `${url}_n.webp` }, tris: mesh.index.length / 3 };
      })
      .catch((e: unknown) => {
        console.warn(`[things] подробная вещь ${kind} не загрузилась:`, e);
        return null;
      })
      .then((hq) => {
        ready.set(kind, hq);
        return hq;
      });
    pending.set(kind, p);
  }
  return p;
}
