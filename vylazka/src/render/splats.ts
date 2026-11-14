/**
 * Облака точек мира: у каждой сетки (помещение убежища, карманное пространство, вещь) — свои
 * точки-сплаты. Здесь решается, сколько точек у кого посеяно и сколько из них рисуется.
 *
 * Сетка помещения режется на клетки в несколько метров, у каждой клетки своё облако. Точки сеются
 * слоями (world/points.ts): далёкой клетке хватает первого слоя, чем ближе игрок — тем больше слоёв.
 * Клетка дальше предела видимости точек и клетка за кадром не рисуются вовсе.
 *
 * Досев идёт понемногу — около заданного числа точек за кадр: сначала первый слой каждой клетке
 * рядом, потом слой за слоем ближним, — поэтому вход в новое помещение не даёт рывка. Сеется и то,
 * что за спиной: при повороте стена не должна оказаться пустой.
 *
 * Память возвращается: клетка, которой давно не нужна полная плотность, ужимается до двух слоёв;
 * сетка, которая давно не видна или далеко, отдаёт свои клетки целиком (понадобятся — посеются
 * заново, теми же точками).
 *
 * Сами точки на процессоре не двигаются: сборку, разлёт и цвет считает вершинный шейдер (SPLAT_VERT).
 */
import * as THREE from 'three';
import type { MeshData } from '../world/kit';
import { MAT } from '../world/materials';
import { fillStratum, pointBuffers, pointSource, splitCells, STRATA, stratumCount, stratumRoom } from '../world/points';
import type { PointBuffers, PointSource } from '../world/points';

/** Облако одной клетки сетки. */
interface Cell {
  points: THREE.Points;
  src: PointSource;
  seed: number;
  /** Сколько места отведено под один слой (точек; с запасом). */
  per: number;
  /** Сколько слоёв помещается в буферах. */
  capacity: number;
  buf: PointBuffers;
  /** Где кончается каждый посеянный слой (номер точки). */
  ends: number[];
  /** Сколько кадров клетке не нужно больше двух слоёв. */
  idle: number;
  /** Габариты клетки в координатах сетки. */
  box: THREE.Box3;
  /** Шар клетки с запасом на разлёт точек — для отсечения по кадру. */
  sphere: THREE.Sphere;
}

/** Облака одной сетки. */
interface Group {
  owner: THREE.Object3D;
  data: MeshData;
  /** Вещь: точки ходят за её сеткой (у помещений сетка стоит на месте). */
  follow: boolean;
  /** Во сколько раз облако реже обычного. */
  thin: number;
  seed: number;
  /** Шар всей сетки в её координатах, с запасом на разлёт точек. */
  sphere: THREE.Sphere;
  /** Клетки; пока сетка не понадобилась — их нет. */
  cells: Cell[] | null;
  /** Сколько кадров сетка не видна или далеко. */
  idle: number;
  /** Расстояние от камеры до шара сетки в этом кадре. */
  dist: number;
  /**
   * На какой масштаб вещи рассчитан посев. Вещь под взглядом вырастает в несколько раз; точки сеются
   * в её собственных координатах, и без поправки на выросшей вещи они стояли бы во столько раз реже,
   * во сколько выросла её площадь.
   */
  scale: number;
}

export interface CloudOptions {
  /** Во сколько раз реже обычного (карманные пространства: там поверхность и так видна вблизи). */
  thin?: number;
  /** Точки ходят за сеткой (вещи). */
  follow?: boolean;
}

/** Сколько кадров облако ждёт, прежде чем отдать память. */
const IDLE_FRAMES = 600;
/** На столько точка может отлететь от своей поверхности, м (с запасом): на это шире шары облаков. */
const SCATTER = 0.7;

export class SplatClouds {
  readonly scene = new THREE.Scene();
  private readonly groups = new Map<THREE.Object3D, Group>();
  private nextSeed = 1;
  /** Точек на квадратный метр в полную плотность. */
  density = 800;
  /** До этого расстояния нужны все слои, дальше — меньше (как в шейдере: квадрат отношения расстояний). */
  lodDist = 3.5;
  /** Дальше этого точек не видно (шейдер гасит их к этому расстоянию): клетки не рисуются и не сеются. */
  far = 28;
  /**
   * Наибольший размер клетки, м. У редких облаков клетки крупнее. Мельче клетка — точнее отбор по
   * расстоянию, но больше вызовов отрисовки: при 6 м в убежище выходит 20–60 облаков в кадре, а лишних
   * точек (тех, что шейдер всё равно спрячет) — около половины; без клеток их было две трети.
   */
  cell = 6;
  /** Сколько точек можно досеять за кадр. */
  budget = 36000;
  /** Сколько точек отдано видеокарте в прошлом кадре (для отладки и проверок). */
  drawn = 0;

  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly ball = new THREE.Sphere();

  constructor(private readonly material: THREE.ShaderMaterial) {}

  /** Сколько сеток с облаками. */
  get count(): number {
    return this.groups.size;
  }

  /** Сколько клеток сейчас живо (у сеток рядом с игроком). */
  get cells(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.cells?.length ?? 0;
    return n;
  }

  /** Завести облака для сетки. Клетки и точки появятся сами, когда сетка окажется рядом и на виду. */
  add(owner: THREE.Object3D, data: MeshData, opts: CloudOptions = {}): void {
    this.remove(owner);
    // Сетка, где сеять не на что (вся светится или пуста), облаков не получает.
    const { index, mat, position: p } = data;
    let surface = false;
    for (let t = 0; t < index.length && !surface; t += 3) surface = Math.round(mat[index[t]!]!) !== MAT.glow;
    if (!surface) return;
    const box = new THREE.Box3();
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(this.tmp.set(p[i]!, p[i + 1]!, p[i + 2]!));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius += SCATTER;
    this.groups.set(owner, { owner, data, follow: opts.follow === true, thin: opts.thin ?? 1, seed: this.nextSeed++, sphere, cells: null, idle: 0, dist: 0, scale: 1 });
  }

  remove(owner: THREE.Object3D): void {
    const g = this.groups.get(owner);
    if (!g) return;
    this.release(g);
    this.groups.delete(owner);
  }

  clear(): void {
    for (const owner of [...this.groups.keys()]) this.remove(owner);
  }

  /** Плотность сменилась (другое качество картинки): всё пересевается заново. */
  setDensity(density: number): void {
    if (density === this.density) return;
    this.density = density;
    for (const g of this.groups.values()) this.release(g);
  }

  /** Плотность посева сетки: у выросшей вещи — больше, чтобы на её поверхности в мире точек было столько же. */
  private densityOf(g: Group): number {
    return (this.density / g.thin) * g.scale * g.scale;
  }

  /** Разрезать сетку на клетки и завести каждой пустое облако. */
  private build(g: Group): void {
    const density = this.densityOf(g);
    const sources = g.follow ? [pointSource(g.data)] : splitCells(g.data, this.cell * Math.sqrt(g.thin));
    g.cells = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]!;
      // Обрезок, на который не приходится и одной точки, облака не получает.
      if (stratumCount(src, density) * STRATA < 1) continue;
      const box = new THREE.Box3(new THREE.Vector3(src.min[0], src.min[1], src.min[2]), new THREE.Vector3(src.max[0], src.max[1], src.max[2]));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      sphere.radius += SCATTER;
      const geometry = new THREE.BufferGeometry();
      geometry.boundingSphere = sphere;
      const points = new THREE.Points(geometry, this.material);
      points.matrixAutoUpdate = false;
      // Что в кадре, а что нет, решается здесь же (update): тогда известно, сколько точек отдано на самом деле.
      points.frustumCulled = false;
      points.visible = false;
      g.cells.push({ points, src, seed: g.seed * 4099 + i, per: stratumRoom(src, density), capacity: 0, buf: pointBuffers(0), ends: [], idle: 0, box, sphere });
      this.scene.add(points);
    }
  }

  /** Отдать клетки сетки: память видеокарты и разрезанную геометрию. */
  private release(g: Group): void {
    if (!g.cells) return;
    for (const c of g.cells) {
      this.scene.remove(c.points);
      c.points.geometry.dispose();
    }
    g.cells = null;
  }

  /** Перенести буферы клетки в новые, на столько слоёв; посеянное сохраняется. */
  private resize(c: Cell, capacity: number): void {
    const keep = Math.min(c.ends.length, capacity);
    const kept = keep > 0 ? c.ends[keep - 1]! : 0;
    const buf = pointBuffers(capacity * c.per);
    buf.position.set(c.buf.position.subarray(0, kept * 3));
    buf.nrm.set(c.buf.nrm.subarray(0, kept * 4));
    buf.seed.set(c.buf.seed.subarray(0, kept * 4));
    c.buf = buf;
    c.capacity = capacity;
    c.ends.length = keep;
    // Новая геометрия вместо старой: так видеокарта отдаёт память прежних буферов.
    const old = c.points.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buf.position, 3));
    g.setAttribute('aNrm', new THREE.BufferAttribute(buf.nrm, 4, true));
    g.setAttribute('aSeed', new THREE.BufferAttribute(buf.seed, 4, true));
    g.boundingSphere = c.sphere;
    g.setDrawRange(0, kept);
    c.points.geometry = g;
    old.dispose();
  }

  /** Досеять клетке ещё один слой. Возвращает, сколько точек добавлено. */
  private grow(c: Cell, density: number): number {
    const k = c.ends.length;
    const from = k > 0 ? c.ends[k - 1]! : 0;
    const written = fillStratum(c.src, k, density, c.seed, c.buf, from);
    c.ends.push(from + written);
    const g = c.points.geometry;
    for (const [name, size] of [['position', 3], ['aNrm', 4], ['aSeed', 4]] as const) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      attr.addUpdateRange(from * size, written * size);
      attr.needsUpdate = true;
    }
    return written;
  }

  /**
   * Раз в кадр: кому сколько слоёв нужно, досев (ближним — первым), что рисовать и сколько.
   * Облака невидимой сетки не рисуются и не сеются. Матрицы камеры должны быть уже посчитаны.
   */
  update(camera: THREE.Camera): void {
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const list: { c: Cell; d: number; need: number; density: number }[] = [];
    for (const g of this.groups.values()) {
      let near = false;
      // Во сколько раз вещь сейчас больше своей сетки (у помещений — 1).
      let scale = 1;
      if (g.owner.visible && g.owner.parent !== null) {
        if (g.follow) {
          const e = g.owner.matrixWorld.elements;
          scale = Math.hypot(e[0]!, e[1]!, e[2]!) || 1;
        }
        const center = g.follow ? this.tmp.copy(g.sphere.center).applyMatrix4(g.owner.matrixWorld) : g.sphere.center;
        g.dist = Math.max(0, this.camPos.distanceTo(center) - g.sphere.radius * scale);
        near = g.dist < this.far;
      }
      if (!near) {
        if (g.cells) {
          for (const c of g.cells) c.points.visible = false;
          g.idle += 1;
          if (g.idle > IDLE_FRAMES) this.release(g);
        }
        continue;
      }
      g.idle = 0;
      // Вещь выросла заметно больше, чем рассчитан её посев, — пересеять плотнее, с запасом на рост
      // (пересев меняет рисунок точек, поэтому он редок: за рост в семь раз — два раза).
      if (g.cells && scale > g.scale * 1.3) {
        this.release(g);
        g.scale = scale * 1.8;
      }
      if (!g.cells) this.build(g);
      const density = this.densityOf(g);
      // Посев с запасом на рост плотнее нужного: рисуется только нужная доля слоёв.
      const share = Math.min(1, (scale * scale) / (g.scale * g.scale));
      // Камера в координатах сетки: у помещений они совпадают с мировыми, у вещей — нет.
      const eye = g.follow ? this.local.copy(this.camPos).applyMatrix4(this.inverse.copy(g.owner.matrixWorld).invert()) : this.camPos;
      for (const c of g.cells!) {
        if (g.follow) {
          c.points.matrix.copy(g.owner.matrixWorld);
          c.points.matrixWorld.copy(g.owner.matrixWorld);
        }
        const d = c.box.distanceToPoint(eye) * scale;
        if (d >= this.far) {
          c.points.visible = false;
          c.idle += 1;
          if (c.capacity > 2 && c.idle > IDLE_FRAMES) this.resize(c, 2);
          continue;
        }
        const k = this.lodDist / Math.max(d, this.lodDist);
        const need = Math.min(STRATA, Math.max(1, Math.ceil(STRATA * k * k * share)));
        c.idle = need > 2 ? 0 : c.idle + 1;
        if (need > c.capacity) this.resize(c, need <= 2 ? 2 : STRATA);
        else if (c.capacity > 2 && c.idle > IDLE_FRAMES) this.resize(c, 2);
        const ball = g.follow ? this.ball.copy(c.sphere).applyMatrix4(g.owner.matrixWorld) : c.sphere;
        c.points.visible = this.frustum.intersectsSphere(ball);
        list.push({ c, d, need, density });
      }
    }
    list.sort((a, b) => a.d - b.d);
    // Досев. Сначала каждой клетке рядом — первый, редкий слой: тогда точки есть везде сразу.
    // Потом слой за слоем ближним. Если у самой близкой почти ничего нет (первый кадр, скачок в
    // другое место), сеется сразу много: рывок в этот момент не виден, а пустой кадр — виден.
    const first = list[0];
    let left = first && first.c.ends.length < Math.min(2, first.need) ? this.budget * 6 : this.budget;
    for (const { c, density } of list) {
      if (left <= 0) break;
      if (c.ends.length === 0) left -= Math.max(1, this.grow(c, density));
    }
    for (let k = 1; k < STRATA && left > 0; k++) {
      for (const { c, need, density } of list) {
        if (left <= 0) break;
        if (c.ends.length === k && need > k) left -= Math.max(1, this.grow(c, density));
      }
    }
    let drawn = 0;
    for (const { c, need } of list) {
      const have = Math.min(need, c.ends.length);
      const n = have > 0 ? c.ends[have - 1]! : 0;
      c.points.geometry.setDrawRange(0, n);
      if (c.points.visible) drawn += n;
    }
    this.drawn = drawn;
  }

  /**
   * Сколько из отданных видеокарте точек проходит отбор по расстоянию (шейдер прячет точку, если её
   * очередь больше доли плотности на её расстоянии). Остальные — лишняя работа вершинного шейдера.
   * Считается перебором всех точек: только для отладки и тестов.
   */
  usage(): { drawn: number; shown: number; cells: number } {
    let drawn = 0;
    let shown = 0;
    let cells = 0;
    const p = new THREE.Vector3();
    for (const g of this.groups.values()) {
      for (const c of g.cells ?? []) {
        if (!c.points.visible) continue;
        const n = c.points.geometry.drawRange.count;
        if (!Number.isFinite(n) || n <= 0) continue;
        cells += 1;
        drawn += n;
        for (let i = 0; i < n; i++) {
          p.set(c.buf.position[i * 3]!, c.buf.position[i * 3 + 1]!, c.buf.position[i * 3 + 2]!);
          if (g.follow) p.applyMatrix4(g.owner.matrixWorld);
          const d = p.distanceTo(this.camPos);
          const lod = Math.min(1, Math.max(0.015, (this.lodDist * this.lodDist) / (d * d)));
          if (d < this.far && c.buf.seed[i * 4]! / 255 <= lod) shown += 1;
        }
      }
    }
    return { drawn, shown, cells };
  }
}
