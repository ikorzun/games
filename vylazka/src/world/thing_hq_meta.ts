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
  remote: { file: 'remote', tris: 12000, verts: 7099, tex: 256, min: [-0.0250, 0.0000, -0.1100], max: [0.0250, 0.0251, 0.1100], credit: "\"Remote Control\" by budakbina, https://sketchfab.com/3d-models/c7ec86e7feb746489b30b4a01c2510af, CC-BY-4.0; modified: rewritten as a sand3d program" },
  office_terminal: { file: 'office_terminal', tris: 4256, verts: 4406, tex: 256, min: [-0.2600, 0.0000, -0.2549], max: [0.2600, 0.3325, 0.2549], credit: "\"Vic-30\" by fisherw, https://sketchfab.com/3d-models/98869ceaacdc4b1ebfca60caad424c09, CC-BY-4.0; modified: rewritten as a sand3d program" },
  office_chair: { file: 'office_chair', tris: 40000, verts: 21940, tex: 256, min: [-0.2813, 0.0000, -0.3117], max: [0.2813, 1.0200, 0.3117], credit: "\"Silla DISGRAF 8 B\" by jacavision, https://sketchfab.com/3d-models/2ef40e2a05f74110bb90c3072fa3c2cd, CC-BY-4.0; modified: rewritten as a sand3d program" },
  water_cooler: { file: 'water_cooler', tris: 11380, verts: 9580, tex: 256, min: [-0.1948, 0.0000, -0.1628], max: [0.1948, 1.3500, 0.1628], credit: "NVIDIA SimReady assets: \"water_cooler_a01\" by NVIDIA, https://huggingface.co/datasets/nvidia/simready-assets/tree/653d91e182011f357cf1644013cc94ddf194d349/water_cooler_a01, CC BY 4.0; modified: rewritten as a sand3d program" },
  desk_phone: { file: 'desk_phone', tris: 12000, verts: 8766, tex: 256, min: [-0.0942, 0.0000, -0.1200], max: [0.0942, 0.0999, 0.1200], credit: "\"Office Phone\" by maxdragon, https://sketchfab.com/3d-models/4176a01b6d0b4d13ad165c0df278a6b5, CC-BY-4.0; modified: rewritten as a sand3d program" },
  st_cup: { file: 'st_cup', tris: 7721, verts: 4577, tex: 256, min: [-0.0519, 0.0000, -0.0519], max: [0.0519, 0.1400, 0.0519], credit: "\"Coffee Paper-cup\" by DenPennicus, https://sketchfab.com/3d-models/70d51490fb8e4de0a132d9f543859a35, CC-BY-4.0; modified: rewritten as a sand3d program" },
  kettle: { file: 'kettle', tris: 5192, verts: 3032, tex: 1024, min: [-0.1415, 0.0000, -0.1120], max: [0.1415, 0.3335, 0.1120], credit: "Kettle: made for Untitled Session (tools/things_hq/make_kettle.py)" },
  st_ticket: { file: 'st_ticket', tris: 1344, verts: 850, tex: 512, min: [-0.0600, 0.0000, -0.0300], max: [0.0600, 0.0082, 0.0300], credit: "Ticket: made for Untitled Session (tools/things_hq/make_small.py)" },
  st_note: { file: 'st_note', tris: 1024, verts: 748, tex: 512, min: [-0.0800, 0.0000, -0.0275], max: [0.0800, 0.0188, 0.0275], credit: "Note: made for Untitled Session (tools/things_hq/make_small.py)" },
  st_key: { file: 'st_key', tris: 2000, verts: 1320, tex: 512, min: [-0.0678, 0.0000, -0.0200], max: [0.0678, 0.0080, 0.0200], credit: "Key with a tag: made for Untitled Session (tools/things_hq/make_small.py)" },
  slippers: { file: 'slippers', tris: 2976, verts: 1808, tex: 512, min: [-0.1206, 0.0000, -0.1398], max: [0.1206, 0.0576, 0.1398], credit: "Slippers: made for Untitled Session (tools/things_hq/make_small.py)" },
  st_coat: { file: 'st_coat', tris: 8460, verts: 4509, tex: 512, min: [-0.1700, 0.0000, -0.1450], max: [0.1700, 0.1395, 0.1450], credit: "Hat: made for Untitled Session (tools/things_hq/make_small.py)" },
  photo_frame: { file: 'photo_frame', tris: 1632, verts: 1422, tex: 1024, min: [-0.1206, 0.0000, -0.0602], max: [0.1206, 0.3000, 0.0602], credit: "Standing Picture Frame 01 by James Ray Cock, Poly Haven (polyhaven.com), CC0" },
};
// </generated>
