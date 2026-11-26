#!/usr/bin/env node
/**
 * Упрощение сетки вещи до бюджета треугольников (scripts/import_thing_hq.py зовёт его сам).
 * Вход (stdin): u32 вершин, u32 индексов, u32 цель (треугольников), затем по 8 f32 на вершину (позиция, нормаль, развёртка)
 * и индексы u32. Выход (stdout): u32 вершин, u32 индексов, вершины в том же виде, индексы u32.
 * meshoptimizer (MIT) — из three.js в node_modules; нормали и развёртка идут в упрощение признаками, чтобы швы и грани держались.
 */
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const buf = Buffer.concat(chunks);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const head = new Uint32Array(ab, 0, 3);
const [nv, ni, target] = head;
const verts = new Float32Array(ab, 12, nv * 8);
const idx = new Uint32Array(ab, 12 + nv * 32, ni);
await MeshoptSimplifier.ready;
const pos = new Float32Array(nv * 3);
const attr = new Float32Array(nv * 5);
for (let i = 0; i < nv; i++) {
  pos.set(verts.subarray(i * 8, i * 8 + 3), i * 3);
  attr.set(verts.subarray(i * 8 + 3, i * 8 + 8), i * 5);
}
// Веса признаков: нормаль важнее развёртки; ошибка — до 2 % размера вещи (дальше упрощать не даём, пусть будет больше треугольников).
const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attr, 5, [0.5, 0.5, 0.5, 0.25, 0.25], null, target * 3, 0.02, ['LockBorder']);
// Выбросить вершины, на которые больше никто не ссылается.
const remap = new Int32Array(nv).fill(-1);
const keep = [];
const outIdx = new Uint32Array(out.length);
for (let i = 0; i < out.length; i++) {
  const v = out[i];
  if (remap[v] < 0) {
    remap[v] = keep.length;
    keep.push(v);
  }
  outIdx[i] = remap[v];
}
const res = Buffer.alloc(8 + keep.length * 32 + outIdx.length * 4);
res.writeUInt32LE(keep.length, 0);
res.writeUInt32LE(outIdx.length, 4);
const fv = new Float32Array(keep.length * 8);
keep.forEach((v, k) => fv.set(verts.subarray(v * 8, v * 8 + 8), k * 8));
Buffer.from(fv.buffer).copy(res, 8);
Buffer.from(outIdx.buffer).copy(res, 8 + keep.length * 32);
process.stdout.write(res);
