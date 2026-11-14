import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SplatClouds } from '../src/render/splats';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';

/** Комната w × 3 × d м с углом в (x, 0, z). */
function roomData(x: number, z: number, w = 4, d = 4): MeshData {
  const mb = new MeshBuilder();
  mb.box([x, 0, z], [x + w, 3, z + d], MAT.concrete);
  return mb.build();
}

/** Сетка three.js из данных уровня — как её заводит рендер. */
function meshOf(data: MeshData, scene: THREE.Scene): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  g.setIndex(new THREE.BufferAttribute(data.index, 1));
  const mesh = new THREE.Mesh(g);
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function setup(density = 400) {
  const clouds = new SplatClouds(new THREE.ShaderMaterial());
  clouds.density = density;
  // Размер клетки в тестах задан явно: подбор рабочего значения не должен менять ожидания.
  clouds.cell = 4.5;
  // С запасом: тесты, которым важен сам досев, задают бюджет сами.
  clouds.budget = 1e9;
  const scene = new THREE.Scene();
  return { clouds, scene };
}

/** Камера в точке, смотрит под углом yaw (0 — вдоль −z, как игрок на старте). */
function camAt(x: number, y: number, z: number, yaw = 0): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  cam.position.set(x, y, z);
  cam.rotation.set(0, yaw, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/** Все облака клеток, какие есть в сцене менеджера. */
const cellsOf = (clouds: SplatClouds) => clouds.scene.children as THREE.Points[];
/** Сколько точек клетка готова рисовать (у только что заведённой — ноль). */
const ready = (p: THREE.Points) => (Number.isFinite(p.geometry.drawRange.count) ? p.geometry.drawRange.count : 0);
/** Сколько точек лежит в памяти клетки. */
const stored = (p: THREE.Points) => p.geometry.getAttribute('position')?.count ?? 0;
const sum = (list: number[]) => list.reduce((s, v) => s + v, 0);
const readyAll = (clouds: SplatClouds) => sum(cellsOf(clouds).map(ready));

describe('облака точек: кому сколько слоёв', () => {
  it('ближнему помещению — все слои, дальнему — один, а тому, что за пределом видимости точек, — ничего', () => {
    const { clouds, scene } = setup();
    const near = roomData(-2, -2);
    const far = roomData(-2, -26);
    const beyond = roomData(-2, -60);
    for (const r of [near, far, beyond]) clouds.add(meshOf(r, scene), r);
    expect(clouds.count).toBe(3);
    // Пока никто не смотрел, клеток нет вовсе.
    expect(clouds.cells).toBe(0);
    clouds.update(camAt(0, 1.5, 0));
    // Комната 4 × 3 × 4 — одна клетка; у третьей комнаты (58 м) клетки так и не появились.
    expect(clouds.cells).toBe(2);
    const [a, b] = cellsOf(clouds);
    // 80 м², 400 точек на м² — 32 тысячи точек; одна восьмая — 4 тысячи.
    expect(Math.abs(ready(a!) - 32000)).toBeLessThan(700);
    expect(Math.abs(ready(b!) - 4000)).toBeLessThan(200);
    // Обе комнаты в кадре: отдано видеокарте всё, что готово.
    expect(clouds.drawn).toBe(ready(a!) + ready(b!));
    // Дальней и памяти отведено меньше: два слоя, а не восемь.
    expect(stored(b!)).toBeLessThan(stored(a!) / 3);
  });

  it('чем дальше клетка, тем меньше слоёв: их число падает как квадрат расстояния до её края', () => {
    const { clouds, scene } = setup();
    const data = roomData(-2, -2);
    clouds.add(meshOf(data, scene), data);
    const layers: number[] = [];
    // Камера отходит от стены комнаты (z = 2) и смотрит на неё.
    for (const d of [0, 3, 4.5, 6, 9, 20]) {
      clouds.update(camAt(0, 1.5, 2 + d));
      layers.push(Math.round(ready(cellsOf(clouds)[0]!) / 4000));
    }
    // Ближе 3,5 м — все восемь; дальше: 8·(3,5/d)² с округлением вверх.
    expect(layers).toEqual([8, 8, 5, 3, 2, 1]);
    // Дальше 28 м точек нет: клетка не рисуется.
    clouds.update(camAt(0, 1.5, 2 + 30));
    expect(cellsOf(clouds)[0]!.visible).toBe(false);
    expect(clouds.drawn).toBe(0);
  });

  it('большое помещение режется на клетки: дальний угол получает меньше слоёв, чем ближний', () => {
    const { clouds, scene } = setup();
    const data = roomData(0, 0, 18, 18);
    clouds.add(meshOf(data, scene), data);
    const cam = camAt(1, 1.5, 1, Math.PI);
    clouds.update(cam);
    // 18 м — четыре клетки по 4,5 м по каждой оси.
    expect(clouds.cells).toBe(16);
    const counts = cellsOf(clouds).map(ready);
    // Клетка, где стоит камера, — в полную плотность (пол, потолок и две стены: 2·20,25 + 2·13,5 м²).
    expect(Math.abs(Math.max(...counts) - 67.5 * 400)).toBeLessThan(1200);
    // Дальним клеткам хватает одного слоя. Меньше всего точек у дальней клетки посреди комнаты: там
    // только пол и потолок (2·20,25 м²), одна восьмая плотности.
    expect(Math.abs(Math.min(...counts) - (40.5 * 400) / 8)).toBeLessThan(200);
    // У дальнего угла (пол, потолок и две стены; до него 12,5 м по каждой оси) — тоже один слой.
    const corner = cellsOf(clouds).find((p) => p.geometry.boundingSphere!.center.x > 15 && p.geometry.boundingSphere!.center.z > 15)!;
    expect(Math.abs(ready(corner) - (67.5 * 400) / 8)).toBeLessThan(300);
    // Без клеток вся комната шла бы в полную плотность: 972 м² — 389 тысяч точек. С клетками — втрое меньше.
    expect(sum(counts)).toBeLessThan(389000 / 2.5);
    // И почти всё отданное видно: отбор по расстоянию прячет меньше половины.
    const use = clouds.usage();
    expect(use.drawn).toBe(clouds.drawn);
    expect(use.shown / use.drawn).toBeGreaterThan(0.5);
  });

  it('что за кадром — посеяно, но не рисуется; повернулся — рисуется сразу', () => {
    const { clouds, scene } = setup();
    const front = roomData(-2, -12);
    const back = roomData(-2, 8);
    clouds.add(meshOf(front, scene), front);
    clouds.add(meshOf(back, scene), back);
    clouds.update(camAt(0, 1.5, 0));
    const [f, b] = cellsOf(clouds);
    expect(f!.visible).toBe(true);
    expect(b!.visible).toBe(false);
    // За спиной точки готовы — столько же слоёв, сколько впереди (расстояние то же).
    expect(Math.abs(ready(b!) - ready(f!))).toBeLessThan(300);
    expect(clouds.drawn).toBe(ready(f!));
    clouds.update(camAt(0, 1.5, 0, Math.PI));
    expect(f!.visible).toBe(false);
    expect(b!.visible).toBe(true);
    expect(clouds.drawn).toBe(ready(b!));
  });

  it('досев идёт понемногу: первый кадр — сразу первый слой везде, дальше не больше бюджета за кадр', () => {
    const { clouds, scene } = setup();
    const data = roomData(-2, -2, 12, 12);
    clouds.add(meshOf(data, scene), data);
    clouds.budget = 5000;
    const cam = camAt(4, 1.5, 4);
    clouds.update(cam);
    // Комната 12 × 3 × 12: девять клеток, 432 м², слой — 21,6 тысячи точек на всех.
    expect(clouds.cells).toBe(9);
    const first = readyAll(clouds);
    // Пусто было — первый кадр сеет вшестеро больше обычного: всем по первому слою и ближним по второму.
    expect(first).toBeGreaterThan(21000);
    expect(first).toBeLessThan(21600 + 30000);
    for (const p of cellsOf(clouds)) expect(ready(p)).toBeGreaterThan(1000);
    // Дальше — понемногу: за кадр не больше бюджета плюс один слой одной клетки (слой не дробится).
    let prev = first;
    let frames = 0;
    while (frames < 60) {
      clouds.update(cam);
      frames += 1;
      const now = readyAll(clouds);
      expect(now - prev).toBeLessThan(5000 + 3600);
      if (now === prev) break;
      prev = now;
    }
    // Камера посередине: до каждой клетки меньше 3,5 м, все идут в полную плотность.
    expect(Math.abs(prev - 172800)).toBeLessThan(3000);
    expect(frames).toBeGreaterThan(15);
    expect(frames).toBeLessThan(40);
  });

  it('невидимая сетка: облака не сеются и не рисуются; показали — досеялись', () => {
    const { clouds, scene } = setup();
    const data = roomData(-2, -2);
    const mesh = meshOf(data, scene);
    clouds.add(mesh, data);
    mesh.visible = false;
    const cam = camAt(0, 1.5, 0);
    for (let i = 0; i < 5; i++) clouds.update(cam);
    expect(clouds.cells).toBe(0);
    expect(clouds.drawn).toBe(0);
    mesh.visible = true;
    clouds.update(cam);
    const p = cellsOf(clouds)[0]!;
    expect(p.visible).toBe(true);
    expect(Math.abs(ready(p) - 32000)).toBeLessThan(700);
    // Сетку сняли со сцены (помещение рассыпалось): облако гаснет вместе с ней.
    scene.remove(mesh);
    clouds.update(cam);
    expect(p.visible).toBe(false);
    expect(clouds.drawn).toBe(0);
  });

  it('память возвращается: клетка, от которой отошли, ужимается до двух слоёв, а далёкая сетка отдаёт клетки совсем', () => {
    const { clouds, scene } = setup();
    const data = roomData(-2, -2);
    clouds.add(meshOf(data, scene), data);
    const here = camAt(0, 1.5, 0);
    const away = camAt(0, 1.5, 22);
    const gone = camAt(0, 1.5, 90);
    clouds.update(here);
    const p = cellsOf(clouds)[0]!;
    const full = stored(p);
    const before = Array.from(p.geometry.getAttribute('position').array.subarray(0, 300));
    expect(full).toBeGreaterThan(32000);
    for (let i = 0; i < 590; i++) clouds.update(away);
    // Пока не вышел срок, память держится: вдруг игрок вернётся.
    expect(stored(p)).toBe(full);
    for (let i = 0; i < 20; i++) clouds.update(away);
    expect(stored(p)).toBeLessThan(full / 3);
    expect(Math.abs(ready(p) - 4000)).toBeLessThan(200);
    // Первый слой при этом не пересеивался.
    expect(Array.from(p.geometry.getAttribute('position').array.subarray(0, 300))).toEqual(before);
    clouds.update(here);
    expect(stored(p)).toBe(full);
    expect(Math.abs(ready(p) - 32000)).toBeLessThan(700);
    // Ушли далеко и надолго: клеток у сетки больше нет.
    for (let i = 0; i < 590; i++) clouds.update(gone);
    expect(clouds.cells).toBe(1);
    for (let i = 0; i < 20; i++) clouds.update(gone);
    expect(clouds.cells).toBe(0);
    expect(clouds.count).toBe(1);
    // Вернулись — те же точки на тех же местах.
    clouds.update(here);
    expect(clouds.cells).toBe(1);
    expect(Array.from(cellsOf(clouds)[0]!.geometry.getAttribute('position').array.subarray(0, 300))).toEqual(before);
  });

  it('облако вещи ходит за её сеткой; облако помещения стоит на месте', () => {
    const { clouds, scene } = setup();
    const data = roomData(-0.5, -0.5, 1, 1);
    const thing = meshOf(data, scene);
    const fixed = meshOf(data, scene);
    clouds.add(thing, data, { follow: true });
    clouds.add(fixed, data);
    thing.position.set(5, 0, 7);
    thing.updateMatrixWorld(true);
    clouds.update(camAt(5, 1.5, 7.2, Math.PI * 0.2));
    const [moved, still] = cellsOf(clouds);
    expect(moved!.matrixWorld.elements[12]).toBe(5);
    expect(moved!.matrixWorld.elements[14]).toBe(7);
    expect(still!.matrixWorld.elements[12]).toBe(0);
    // Вещь рядом с камерой: ей нужны все восемь слоёв, хотя в своих координатах она стоит в начале.
    // Столбик 1 × 3 × 1 м — 14 м², 5600 точек. Такой же на месте, в восьми метрах от камеры, — два слоя.
    expect(Math.abs(ready(moved!) - 5600)).toBeLessThan(200);
    expect(Math.abs(ready(still!) - 1400)).toBeLessThan(120);
    // Вещь уехала на 20 м — слоёв стало меньше, хотя сами точки не трогались.
    thing.position.set(5, 0, 27.7);
    thing.updateMatrixWorld(true);
    clouds.update(camAt(5, 1.5, 7.2, Math.PI));
    expect(Math.abs(ready(moved!) - 700)).toBeLessThan(80);
    expect(moved!.visible).toBe(true);
  });

  it('вещь выросла — точек на ней в мире столько же: посев уплотняется, но редко', () => {
    const { clouds, scene } = setup();
    const data = roomData(-0.25, -0.25, 0.5, 0.5);
    const thing = meshOf(data, scene);
    clouds.add(thing, data, { follow: true });
    const cam = camAt(0, 1.5, 2);
    clouds.update(cam);
    // Столбик 0,5 × 3 × 0,5 м: 6,5 м², 2600 точек.
    const p0 = cellsOf(clouds)[0]!;
    expect(Math.abs(ready(p0) - 2600)).toBeLessThan(150);
    // Вырос на четверть — посев тот же: пересев меняет рисунок точек, по мелочи его не трогают.
    thing.scale.setScalar(1.25);
    thing.updateMatrixWorld(true);
    clouds.update(cam);
    expect(cellsOf(clouds)[0]).toBe(p0);
    // Вырос вдвое: площадь в мире вчетверо больше — и точек нужно вчетверо больше.
    thing.scale.setScalar(2);
    thing.updateMatrixWorld(true);
    clouds.update(cam);
    const p1 = cellsOf(clouds)[0]!;
    expect(p1).not.toBe(p0);
    expect(clouds.cells).toBe(1);
    // Посеяно с запасом на дальнейший рост, а рисуется доля слоёв под нынешний размер: от 4 до 5,5 раза.
    expect(ready(p1)).toBeGreaterThan(2600 * 3.6);
    expect(ready(p1)).toBeLessThan(2600 * 5.6);
    // Растёт дальше, до трёх с половиной: посев тот же (запаса хватает), слоёв рисуется больше.
    thing.scale.setScalar(3.5);
    thing.updateMatrixWorld(true);
    clouds.update(cam);
    expect(cellsOf(clouds)[0]).toBe(p1);
    expect(ready(p1)).toBeGreaterThan(2600 * 3.5 * 3.5 * 0.85);
    expect(ready(p1)).toBeLessThan(2600 * 3.5 * 3.5 * 1.25);
    // Уменьшилась обратно — пересева нет, просто рисуется меньше слоёв.
    thing.scale.setScalar(1);
    thing.updateMatrixWorld(true);
    clouds.update(cam);
    expect(cellsOf(clouds)[0]).toBe(p1);
    expect(ready(p1)).toBeLessThan(2600 * 2.2);
  });

  it('редкое облако карманного пространства: огромный пол сеется только вокруг игрока, клетками покрупнее', () => {
    const { clouds, scene } = setup(600);
    // Пол белого нигде: 88 × 88 м одним прямоугольником.
    const mb = new MeshBuilder();
    mb.quadFacing([-44, 0, -44], [44, 0, -44], [44, 0, 44], [-44, 0, 44], [0, 1, 0], MAT.concrete);
    const data = mb.build();
    clouds.add(meshOf(data, scene), data, { thin: 6 });
    clouds.update(camAt(0, 1.5, 0));
    // Клетки вшестеро более редкого облака — в √6 раз крупнее: 88 м делятся на восемь по 11 м.
    expect(clouds.cells).toBe(64);
    const counts = cellsOf(clouds).map(ready);
    // Камера на стыке четырёх клеток: у них полная плотность — 121 м² по 100 точек.
    expect(counts.filter((n) => Math.abs(n - 12100) < 300).length).toBe(4);
    // Клетки дальше 28 м пусты; всего посеяно в разы меньше, чем весь пол (774 тысячи точек).
    expect(counts.filter((n) => n === 0).length).toBeGreaterThan(20);
    expect(sum(counts)).toBeLessThan(140000);
    // Игрок ушёл на 40 м — точки появились и там.
    const before = sum(counts);
    clouds.update(camAt(38, 1.5, 38));
    expect(readyAll(clouds)).toBeGreaterThan(before * 0.4);
    const corner = cellsOf(clouds).filter((p) => ready(p) > 12000);
    expect(corner.length).toBeGreaterThanOrEqual(1);
  });

  it('смена плотности пересевает всё заново; сетка без поверхности облака не получает', () => {
    const { clouds, scene } = setup(300);
    const data = roomData(-2, -2);
    clouds.add(meshOf(data, scene), data);
    const cam = camAt(0, 1.5, 0);
    clouds.update(cam);
    expect(Math.abs(clouds.drawn - 24000)).toBeLessThan(600);
    clouds.setDensity(1100);
    expect(clouds.count).toBe(1);
    expect(clouds.cells).toBe(0);
    clouds.update(cam);
    expect(Math.abs(clouds.drawn - 88000)).toBeLessThan(1500);
    // Только светящееся (абажур, небо): сеять не на что.
    const mb = new MeshBuilder();
    mb.box([0, 0, 0], [1, 1, 1], MAT.glow);
    const glow = mb.build();
    clouds.add(meshOf(glow, scene), glow);
    expect(clouds.count).toBe(1);
  });

  it('убранное облако освобождает сцену; повторное добавление той же сетки заменяет прежнее', () => {
    const { clouds, scene } = setup();
    const data = roomData(-2, -2);
    const mesh = meshOf(data, scene);
    const cam = camAt(0, 1.5, 0);
    clouds.add(mesh, data);
    clouds.update(cam);
    clouds.add(mesh, data);
    expect(clouds.count).toBe(1);
    expect(clouds.scene.children.length).toBe(0);
    clouds.update(cam);
    expect(clouds.scene.children.length).toBe(1);
    clouds.remove(mesh);
    expect(clouds.count).toBe(0);
    expect(clouds.scene.children.length).toBe(0);
    const other = roomData(10, 0);
    clouds.add(mesh, data);
    clouds.add(meshOf(other, scene), other);
    clouds.update(cam);
    expect(clouds.scene.children.length).toBe(2);
    clouds.clear();
    expect(clouds.count).toBe(0);
    expect(clouds.scene.children.length).toBe(0);
    clouds.update(cam);
    expect(clouds.drawn).toBe(0);
  });
});
