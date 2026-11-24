/**
 * Статуя красной комнаты забвения — скан (квиз партнёра 24.11, ночь: «Готовая модель»): гипсовый слепок архаической коры в
 * хитоне и накидке, SMK — Statens Museum for Kunst, инв. KAS1800, Public Domain Mark 1.0. Сетку готовит
 * tools/lethe/make_statue.py (40 тыс. треугольников, высота 2,05 м, лицом к −z, низ подножия — y = 0); файл лежит в
 * assets/pockets сборки и качается один раз, при первом сне. Пока его нет (и если сеть его не отдала), в комнате стоит прежняя
 * фигура, собранная программой (world/pocket_lethe.ts): карман от файла не зависит.
 */
import type { MeshData } from './kit';
import { MAT } from './materials';
import { decodeThingHq } from './thing_hq';

export const LETHE_STATUE_FILE = 'assets/pockets/lethe_statue.bin';

/** Строка авторства для титров (ui/overlay.ts, creditParts). */
export const LETHE_STATUE_CREDIT =
  '"Kore dressed in chiton and cape (epiblema)", plaster cast KAS1800 by SMK – Statens Museum for Kunst, https://open.smk.dk/artwork/image/KAS1800, Public Domain Mark 1.0; modified: decimated to 40k triangles';

let statue: MeshData | null = null;
let pending: Promise<MeshData | null> | null = null;

/** Загруженная статуя (сетка в своих осях: середина подножия — начало координат); нет — null. */
export function letheStatue(): MeshData | null {
  return statue;
}

/** Подставить статую (тесты) или убрать её (null). */
export function setLetheStatue(m: MeshData | null): void {
  statue = m;
}

/** Подгрузить статую один раз; повторный вызов отдаёт тот же ответ. Материал — мрамор, оттенок — как у прежней фигуры. */
export function loadLetheStatue(base = ''): Promise<MeshData | null> {
  pending ??= fetch(base + LETHE_STATUE_FILE)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const m = decodeThingHq(buf);
      m.mat.fill(MAT.marble);
      for (let i = 0; i < m.color.length; i += 4) {
        m.color[i] = 1.14;
        m.color[i + 1] = 1.13;
        m.color[i + 2] = 1.1;
        m.color[i + 3] = 1;
      }
      statue = m;
      return m;
    })
    .catch((e: unknown) => {
      console.warn('[lethe] статуя не загрузилась, стоит фигура из программы:', e);
      return null;
    });
  return pending;
}
