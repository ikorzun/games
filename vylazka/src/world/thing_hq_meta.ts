/**
 * Вещи памяти в «новом качестве» (партнёр 24.11: «полигонов должно быть больше, материал лучше… максимально реалистичное
 * качество, которое не сломает производительность»). Здесь — только опись: какие 16 моделей считаются вещами памяти и у
 * каких из них есть подробная модель с картами (цвет, нормали, шероховатость и металл). Сами модели и карты лежат в
 * public/assets/things и качаются по нужде, когда вещь появляется (world/thing_hq.ts); в ядро сборки входит только эта опись.
 * Файл пишет scripts/import_thing_hq.py — блок THING_HQ руками не править.
 */

/** Модели вещей памяти (thing в цепочках systems/session.ts), по порядку мест. */
export const MEMORY_KINDS = ['alarm_clock', 'kettle', 'remote', 'st_coat', 'photo_frame', 'office_terminal', 'office_chair', 'st_ticket', 'water_cooler', 'desk_phone', 'wet_floor_sign', 'slippers', 'office_clock', 'st_note', 'st_key', 'st_cup'] as const;

export interface ThingHqMeta {
  /** Имя файлов в public/assets/things: <file>.bin, <file>_c.webp, <file>_n.webp. */
  file: string;
  tris: number;
  verts: number;
  /** Сторона карт, пикселей. */
  tex: number;
  /** Габарит модели, м (начало координат — как у вещи игры: середина основания). */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** Откуда модель и на каких условиях (строка для описи и титров). */
  credit: string;
}

// <generated>
export const THING_HQ: Readonly<Record<string, ThingHqMeta>> = {
  alarm_clock: { file: 'alarm_clock', tris: 8265, verts: 6818, tex: 512, min: [-0.0756, 0.0000, -0.0357], max: [0.0756, 0.2000, 0.0357], credit: "Alarm Clock 01 by James Ray Cock and Yann Kervran, Poly Haven (polyhaven.com), CC0" },
  wet_floor_sign: { file: 'wet_floor_sign', tris: 228, verts: 254, tex: 512, min: [-0.1500, 0.0000, -0.1793], max: [0.1500, 0.6295, 0.1793], credit: "Wet Floor Sign 01 by Fran Calvente, Poly Haven (polyhaven.com), CC0" },
  office_clock: { file: 'office_clock', tris: 3130, verts: 3139, tex: 512, min: [-0.1700, 0.0000, -0.0188], max: [0.1700, 0.3400, 0.0188], credit: "Wall Clock by PierreB3D, Poly Haven (polyhaven.com), CC0" },
  photo_frame: { file: 'photo_frame', tris: 1632, verts: 1422, tex: 1024, min: [-0.1206, 0.0000, -0.0602], max: [0.1206, 0.3000, 0.0602], credit: "Standing Picture Frame 01 by James Ray Cock, Poly Haven (polyhaven.com), CC0" },
};
// </generated>
