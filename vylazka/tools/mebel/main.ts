/**
 * Каталог мебели Untitled Session — страница для партнёра (слова партнёра: «Вообще нужно вернуться к
 * мебели, как лучше это контролировать и менять? Может дашь мне простой инструмент?»).
 *
 * Каждая вещь собирается тем же кодом, что в игре (ALL_PROPS), и показывается объёмно: покрутить,
 * приблизить, сравнить с ростом человека. Рядом — где она стоит (посчитано по уровням при сборке
 * страницы), из чего сделана и отметка партнёра. Отметки лежат в общей базе страницы (`db`,
 * коллекция `verdicts`, документ = имя вещи): основная модель их читает и переделывает вещи.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBuilder } from '../../src/world/kit';
import { MAT_DEFS, hexToLinear } from '../../src/world/materials';
import { Xf } from '../../src/world/props';
import { ALL_PROPS } from '../../src/world/props_all';

type Usage = Record<string, { worlds: Record<string, number>; rooms: Record<string, number> }>;
declare const __USAGE__: Usage;
declare const __GAME_URL__: string;
const USAGE: Usage = __USAGE__;

const WORLD_RU: Record<string, string> = { shelter: 'убежище', office: 'офис', yellow: 'жёлтые комнаты', station: 'зал ожидания' };
const ROOM_RU: Record<string, string> = {
  entrance: 'вход', airlock: 'шлюз', corridor: 'коридор', stairwell: 'лестница', dorm: 'спальный отсек', living: 'гостиная', command: 'пункт управления',
  kitchen: 'кухня', medical: 'медпункт', hallway: 'прихожая', washroom: 'санузел', storage: 'кладовая', fvu: 'ФВУ', diesel: 'дизельная', bedroom: 'спальня',
  tanks: 'баки', bathroom: 'ванная', switchboard: 'щитовая', archive: 'архив', nursery: 'детская', collapsed: 'завал', reception: 'приёмная', breakroom: 'кухня офиса',
  manager: 'кабинет', files: 'картотека', meeting: 'переговорная', cubicles: 'опенспейс', department: 'отдел', hall: 'зал', vestibule: 'вход', concourse: 'зал',
  tickets: 'касса', lockers: 'камеры хранения', buffet: 'буфет', platform: 'перрон', lift: 'лифт', track: 'пути',
};

type Verdict = 'keep' | 'real' | 'replace' | 'remove';
const VERDICTS: { id: Verdict; label: string; hint: string }[] = [
  { id: 'keep', label: 'Оставить', hint: 'вещь хорошая' },
  { id: 'real', label: 'Сделать реальнее', hint: 'та же вещь, но как в жизни' },
  { id: 'replace', label: 'Заменить другой', hint: 'напишите, чем' },
  { id: 'remove', label: 'Убрать из игры', hint: 'не нужна' },
];
interface Mark {
  verdict?: Verdict;
  note?: string;
  at?: string;
}

/** Мебель — то, на чём сидят, лежат, за чем работают и куда кладут. Остальное — в «всё». */
const FURNITURE = /стул|кресл|табурет|скамь|сиден|диван|кушет|стол|парт|конторк|кроват|нар[ыа]|койк|шкаф|полк|стеллаж|тумб|комод|сундук|вешалк|трюмо|буфет|витрин|прилавок|стойк|сервант|этажерк|кабинк/;

interface Item {
  name: string;
  ru: string;
  mount: string;
  w: number;
  d: number;
  h: number;
  y: number;
  furniture: boolean;
  toy: boolean;
  source: string;
  worlds: Record<string, number>;
  rooms: [string, number][];
}

const ITEMS: Item[] = Object.keys(ALL_PROPS)
  .map((name) => {
    const p = ALL_PROPS[name]!;
    const u = USAGE[name];
    const toy = name.startsWith('kk_');
    return {
      name,
      ru: p.ru,
      mount: p.mount,
      w: p.w,
      d: p.d,
      h: p.h,
      y: p.mount === 'wall' ? (p.y ?? 1.2) : 0,
      furniture: FURNITURE.test(p.ru),
      toy,
      source: toy ? 'готовая модель из набора KayKit (нарочно игрушечный стиль)' : 'собрана кодом в игре',
      worlds: u?.worlds ?? {},
      rooms: Object.entries(u?.rooms ?? {}).sort((a, b) => b[1] - a[1]),
    };
  })
  .sort((a, b) => Number(b.toy) - Number(a.toy) || a.ru.localeCompare(b.ru, 'ru'));

// ───────────────────────────── геометрия ─────────────────────────────

const BASE = MAT_DEFS.map((m) => hexToLinear(m.color));
const geoCache = new Map<string, THREE.BufferGeometry>();

function geometryOf(name: string): THREE.BufferGeometry {
  const hit = geoCache.get(name);
  if (hit) return hit;
  const p = ALL_PROPS[name]!;
  const mb = new MeshBuilder();
  const sl = new MeshBuilder();
  const y = p.mount === 'wall' ? (p.y ?? 1.2) : p.mount === 'ceiling' ? 0 : 0;
  try {
    p.build(new Xf(mb, null, 0, y, 0, 0, sl), 7);
  } catch {
    /* вещь, которой нужен уровень вокруг, показывается тем, что успела собрать */
  }
  const data = mb.build();
  const n = data.position.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const base = BASE[Math.round(data.mat[i]!)] ?? [0.5, 0.5, 0.5];
    const ao = 0.35 + 0.65 * data.color[i * 4 + 3]!;
    for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.min(1, base[k]! * data.color[i * 4 + k]! * ao);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(data.index, 1));
  g.computeBoundingBox();
  geoCache.set(name, g);
  return g;
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide });

function stage(): { scene: THREE.Scene; holder: THREE.Group } {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x2a2622, 1.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4d0, 0.8);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const holder = new THREE.Group();
  scene.add(holder);
  return { scene, holder };
}

/** Рост человека рядом с вещью: тонкий силуэт 1,75 м. */
function person(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x55606c, roughness: 0.9, transparent: true, opacity: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.15, 6, 16), m);
  body.position.y = 0.17 + 0.575 + 0.04;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), m);
  head.position.y = 1.64;
  g.add(body, head);
  return g;
}

function place(holder: THREE.Group, name: string, withPerson: boolean): THREE.Box3 {
  holder.clear();
  const g = geometryOf(name);
  const mesh = new THREE.Mesh(g, material);
  const box = g.boundingBox!.clone();
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  mesh.position.set(-cx, 0, -cz);
  holder.add(mesh);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.8, (box.max.x - box.min.x) * 0.9), 48), new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  holder.add(floor);
  if (withPerson) {
    const p = person();
    p.position.set(-(box.max.x - box.min.x) / 2 - 0.45, 0, 0);
    holder.add(p);
  }
  box.translate(new THREE.Vector3(-cx, 0, -cz));
  return box;
}

// ───────────────────────────── миниатюры ─────────────────────────────

const thumbR = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
thumbR.setSize(220, 220, false);
thumbR.setClearColor(0x16191d);
const thumb = stage();
const thumbCam = new THREE.PerspectiveCamera(32, 1, 0.01, 50);

function renderThumb(name: string): string {
  const box = place(thumb.holder, name, false);
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5 + 0.05;
  const c = box.getCenter(new THREE.Vector3());
  const dist = r / Math.sin((thumbCam.fov * Math.PI) / 360) * 1.05;
  thumbCam.position.set(c.x + dist * 0.62, c.y + dist * 0.42, c.z + dist * 0.66);
  thumbCam.lookAt(c);
  thumbR.render(thumb.scene, thumbCam);
  return thumbR.domElement.toDataURL('image/jpeg', 0.82);
}

// ───────────────────────────── просмотр ─────────────────────────────

const viewEl = document.getElementById('view')!;
const viewR = new THREE.WebGLRenderer({ antialias: true });
viewR.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
viewR.setClearColor(0x121417);
viewEl.appendChild(viewR.domElement);
const view = stage();
const cam = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
const controls = new OrbitControls(cam, viewR.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;

function resize(): void {
  const w = viewEl.clientWidth;
  const h = viewEl.clientHeight;
  viewR.setSize(w, h, false);
  cam.aspect = w / Math.max(1, h);
  cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);

function show(name: string): void {
  const box = place(view.holder, name, true);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 1.2) * 0.6;
  const dist = r / Math.sin((cam.fov * Math.PI) / 360);
  cam.position.set(c.x + dist * 0.55, Math.max(1.0, c.y + dist * 0.35), c.z + dist * 0.8);
  controls.target.copy(c);
  controls.update();
}
(function loop(): void {
  requestAnimationFrame(loop);
  controls.update();
  viewR.render(view.scene, cam);
})();

// ───────────────────────────── отметки ─────────────────────────────

const marks = new Map<string, Mark>();
type DbNs = { collection(p: string): { doc(id: string): { set(d: Record<string, unknown>): Promise<void> }; onSnapshot(n: (s: { docs: { id: string; data(): Record<string, unknown> | undefined }[]; metadata: { fromCache: boolean } }) => void, e?: (err: { code: string }) => void): () => void } };
let db: DbNs | null = null;
let canWrite = true;
const statusEl = document.getElementById('status')!;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) {
    setStatus('Отметки не сохраняются: страница открыта не в Claude.');
    return;
  }
  db = (await claude.use('db')) as DbNs | null;
  const user = (await claude.use('user')) as { can?(n: string): Promise<boolean | null> } | null;
  if (!db) {
    setStatus('Отметки сейчас недоступны: войдите в Claude, чтобы их сохранять.');
    return;
  }
  const can = user?.can ? await user.can('data.write') : null;
  canWrite = can !== false;
  if (!canWrite) setStatus('Можно смотреть; отмечать может только тот, у кого есть право правки.');
  const timer = window.setTimeout(() => setStatus('Отметки пока не загрузились — проверьте связь.'), 10000);
  db.collection('verdicts').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) {
        window.clearTimeout(timer);
        if (canWrite) setStatus('');
      }
      marks.clear();
      for (const d of snap.docs) marks.set(d.id, (d.data() ?? {}) as Mark);
      render();
      renderPanel();
    },
    () => {
      window.clearTimeout(timer);
      setStatus('Отметки не загрузились. Обновите страницу позже.');
    },
  );
}

async function save(name: string, patch: Mark): Promise<void> {
  if (!db || !canWrite) return;
  const next: Mark = { ...(marks.get(name) ?? {}), ...patch, at: new Date().toISOString() };
  marks.set(name, next);
  render();
  renderPanel();
  setStatus('Сохраняю…');
  try {
    await db.collection('verdicts').doc(name).set(next as Record<string, unknown>);
    setStatus('Сохранено.');
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'invalid_argument') {
      canWrite = false;
      setStatus('Сохранять отметки может только тот, у кого есть право правки.');
    } else setStatus('Не сохранилось. Попробуйте ещё раз через минуту.');
  }
}

// ───────────────────────────── список и панель ─────────────────────────────

const filter = { what: 'furniture', world: 'all', mark: 'all', q: '' };
let current = ITEMS.find((i) => i.name === 'chair_bent')?.name ?? ITEMS[0]!.name;
const listEl = document.getElementById('list')!;
const thumbs = new Map<string, string>();

function visible(): Item[] {
  const q = filter.q.trim().toLowerCase();
  return ITEMS.filter((i) => {
    if (filter.what === 'furniture' && !i.furniture) return false;
    if (filter.what === 'used' && Object.keys(i.worlds).length === 0) return false;
    if (filter.world !== 'all' && !(filter.world in i.worlds)) return false;
    const m = marks.get(i.name)?.verdict;
    if (filter.mark === 'none' && m) return false;
    if (filter.mark === 'marked' && !m) return false;
    if (q && !i.ru.toLowerCase().includes(q) && !i.name.includes(q)) return false;
    return true;
  });
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target as HTMLImageElement;
      const name = img.dataset.name!;
      if (!thumbs.has(name)) thumbs.set(name, renderThumb(name));
      img.src = thumbs.get(name)!;
      io.unobserve(img);
    }
  },
  { rootMargin: '200px' },
);

function where(i: Item): string {
  const w = Object.entries(i.worlds);
  if (w.length === 0) return 'на уровнях не стоит';
  return w.map(([k, v]) => `${WORLD_RU[k] ?? k}: ${v}`).join(' · ');
}

function render(): void {
  const items = visible();
  const total = ITEMS.filter((i) => (filter.what === 'furniture' ? i.furniture : true)).length;
  document.getElementById('count')!.textContent = `${items.length} из ${total}`;
  const marked = [...marks.values()].filter((m) => m.verdict).length;
  document.getElementById('marked')!.textContent = String(marked);
  listEl.textContent = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Под эти условия ничего не подходит. Снимите какой-нибудь фильтр.';
    listEl.appendChild(p);
    return;
  }
  for (const i of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (i.name === current ? ' is-current' : '');
    b.setAttribute('aria-pressed', String(i.name === current));
    const img = document.createElement('img');
    img.alt = '';
    img.dataset.name = i.name;
    img.width = 110;
    img.height = 110;
    if (thumbs.has(i.name)) img.src = thumbs.get(i.name)!;
    else io.observe(img);
    const t = document.createElement('div');
    t.className = 'card__text';
    const ru = document.createElement('span');
    ru.className = 'card__ru';
    ru.textContent = i.ru;
    const meta = document.createElement('span');
    meta.className = 'card__meta';
    meta.textContent = where(i);
    t.append(ru, meta);
    const tags = document.createElement('span');
    tags.className = 'card__tags';
    if (i.toy) tags.appendChild(tag('игрушечный набор', 'toy'));
    if (i.name === 'chair_bent') tags.appendChild(tag('новый, 16.11', 'new'));
    const v = marks.get(i.name)?.verdict;
    if (v) tags.appendChild(tag(VERDICTS.find((x) => x.id === v)!.label, `v-${v}`));
    t.appendChild(tags);
    b.append(img, t);
    b.addEventListener('click', () => {
      current = i.name;
      render();
      renderPanel();
      show(i.name);
      if (window.matchMedia('(max-width: 860px)').matches) document.getElementById('panel')!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    listEl.appendChild(b);
  }
}

function tag(text: string, kind: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `tag tag--${kind}`;
  s.textContent = text;
  return s;
}

const noteEl = document.getElementById('note') as HTMLTextAreaElement;

function renderPanel(): void {
  const i = ITEMS.find((x) => x.name === current)!;
  document.getElementById('p-ru')!.textContent = i.ru;
  document.getElementById('p-name')!.textContent = i.name;
  document.getElementById('p-size')!.textContent = `${Math.round(i.w * 100)} × ${Math.round(i.d * 100)} × ${Math.round(i.h * 100)} см${i.mount === 'wall' ? `, висит на высоте ${Math.round(i.y * 100)} см` : ''}`;
  document.getElementById('p-source')!.textContent = i.source;
  document.getElementById('p-where')!.textContent = where(i);
  const rooms = i.rooms.slice(0, 4).map(([k]) => {
    const [w, r] = k.split(':');
    return `${ROOM_RU[r!] ?? r} (${WORLD_RU[w!] ?? w})`;
  });
  document.getElementById('p-rooms')!.textContent = rooms.length ? rooms.join(', ') : '—';
  const game = document.getElementById('p-game') as HTMLAnchorElement;
  game.href = `${__GAME_URL__}#show-${i.name.replace(/_/g, '-')}`;
  const m = marks.get(i.name) ?? {};
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.verdict')) {
    const on = btn.dataset.v === m.verdict;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = !db || !canWrite;
  }
  if (document.activeElement !== noteEl) noteEl.value = m.note ?? '';
  noteEl.disabled = !db || !canWrite;
  (document.getElementById('save-note') as HTMLButtonElement).disabled = !db || !canWrite;
}

for (const v of VERDICTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `verdict verdict--${v.id}`;
  b.dataset.v = v.id;
  b.innerHTML = '';
  const l = document.createElement('span');
  l.textContent = v.label;
  const h = document.createElement('small');
  h.textContent = v.hint;
  b.append(l, h);
  b.addEventListener('click', () => {
    const cur = marks.get(current)?.verdict;
    void save(current, { verdict: cur === v.id ? undefined : v.id, note: noteEl.value });
  });
  document.getElementById('verdicts')!.appendChild(b);
}
document.getElementById('save-note')!.addEventListener('click', () => void save(current, { note: noteEl.value }));

function bindSeg(id: string, key: keyof typeof filter): void {
  const root = document.getElementById(id)!;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    filter[key] = b.dataset.val!;
    for (const x of root.querySelectorAll('button')) {
      x.classList.toggle('is-on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
    render();
  });
}
bindSeg('f-what', 'what');
bindSeg('f-world', 'world');
bindSeg('f-mark', 'mark');
document.getElementById('q')!.addEventListener('input', (e) => {
  filter.q = (e.target as HTMLInputElement).value;
  render();
});

render();
renderPanel();
resize();
show(current);
void connect();
