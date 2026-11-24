#!/usr/bin/env node
/**
 * Развернуть сжатый GLB (EXT_meshopt_compression — так каталог Sand3D отдаёт тяжёлые вещи) в обычный .gltf + .bin, который
 * читает scripts/import_thing_hq.py:  node tools/things_hq/unpack_glb.mjs <in.glb> <out.gltf>
 * Декодер meshoptimizer (MIT) — из three.js в node_modules.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [src, out] = process.argv.slice(2);
const raw = readFileSync(src);
const jsonLen = raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = raw.subarray(20 + jsonLen + 8);
await MeshoptDecoder.ready;
const parts = [];
let size = 0;
for (const v of doc.bufferViews) {
  const ext = v.extensions?.EXT_meshopt_compression;
  let data;
  if (ext) {
    data = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(data, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
    v.byteStride = v.byteStride ?? (ext.mode === 'ATTRIBUTES' ? ext.byteStride : undefined);
    delete v.extensions;
  } else data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  if (v.byteStride === undefined) delete v.byteStride;
  v.buffer = 0;
  v.byteOffset = size;
  v.byteLength = data.length;
  parts.push(data);
  size += data.length;
  const pad = (4 - (size % 4)) % 4;
  if (pad) {
    parts.push(new Uint8Array(pad));
    size += pad;
  }
}
const binName = basename(out).replace(/\.gltf$/, '.bin');
doc.buffers = [{ byteLength: size, uri: binName }];
doc.extensionsUsed = (doc.extensionsUsed ?? []).filter((e) => e !== 'EXT_meshopt_compression');
doc.extensionsRequired = (doc.extensionsRequired ?? []).filter((e) => e !== 'EXT_meshopt_compression');
writeFileSync(out, JSON.stringify(doc));
writeFileSync(out.replace(/\.gltf$/, '.bin'), Buffer.concat(parts));
