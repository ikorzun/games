/**
 * Атлас надписей: трафареты, таблички, шкалы приборов рисуются на canvas при запуске по раскладке
 * из world/signs.ts. Плакаты гражданской обороны и план убежища — настоящие листы: готовые картинки
 * (assets/posters), которые сюда только вклеиваются и старятся.
 *
 * Буквы ставятся по одной, каждая в свою клетку: раскладка не зависит от того, успел ли загрузиться
 * шрифт. У трафарета в буквах прорезаны перемычки, как у настоящего листа с вырезанными буквами.
 */
import { PL_H, SIGN_LIST, SIGNS_SIZE } from '../world/signs';
import type { SignRect } from '../world/signs';

type G = CanvasRenderingContext2D;

const FONT = '"JetBrains Mono", "DejaVu Sans Mono", monospace';
const ADV = 0.6;
const PAPER = '#d6cdaa';
const INK = '#1d1b18';

/** Свой счётчик вместо Math.random: атлас одинаков от запуска к запуску. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Строка по одной букве в клетку шириной ADV·h. */
function mono(g: G, text: string, x: number, y: number, h: number, weight = 'bold'): void {
  g.font = `${weight} ${h}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) g.fillText(text[i]!, x + (i + 0.5) * ADV * h, y);
}

function stencil(g: G, s: SignRect): void {
  const h = s.ph / 1.3;
  const text = s.lines[0]!;
  g.fillStyle = '#fff';
  mono(g, text, 5, s.ph / 2 + 1, h);
  // Перемычки трафарета: две тонкие прорези в каждой букве.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '—' || ch === '-' || ch === '!' || ch === '.') continue;
    const x0 = 5 + i * ADV * h;
    g.fillRect(x0 + ADV * h * 0.33, 0, 1.6, s.ph);
    g.fillRect(x0 + ADV * h * 0.66, 0, 1.6, s.ph);
  }
  g.globalCompositeOperation = 'source-over';
}

function brush(g: G, s: SignRect): void {
  const rnd = lcg(seedOf(s.id));
  const h = s.ph / 1.3;
  const text = s.lines[0]!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.font = `bold ${h * 0.92}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === ' ') continue;
    g.save();
    g.translate(5 + (i + 0.5) * ADV * h + (rnd() - 0.5) * 3, s.ph / 2 + (rnd() - 0.5) * 5);
    g.rotate((rnd() - 0.5) * 0.22);
    g.lineWidth = 1.5 + rnd() * 2;
    g.strokeText(ch, 0, 0);
    g.fillText(ch, 0, 0);
    g.restore();
    // Потёк краски под буквой.
    if (rnd() < 0.3) g.fillRect(5 + (i + 0.3 + rnd() * 0.4) * ADV * h, s.ph / 2 + h * 0.3, 1.5, 3 + rnd() * 6);
  }
}

function tally(g: G, s: SignRect): void {
  const rnd = lcg(seedOf(s.id));
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  let x = 8;
  for (let group = 0; group < 6 && x < s.pw - 34; group++) {
    const n = group < 5 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      g.lineWidth = 2 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(x + i * 6 + (rnd() - 0.5) * 2, 10 + rnd() * 4);
      g.lineTo(x + i * 6 + (rnd() - 0.5) * 3, s.ph - 10 - rnd() * 4);
      g.stroke();
    }
    if (group < 5) {
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x - 4, s.ph - 16 - rnd() * 6);
      g.lineTo(x + 24, 14 + rnd() * 6);
      g.stroke();
    }
    x += 36;
  }
}

/** Старение печатного: бурые пятна, сколы эмали по краям. */
function age(g: G, s: SignRect, rnd: () => number, chips: boolean): void {
  for (let i = 0; i < 7; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 40}, ${60 + rnd() * 30}, ${30 + rnd() * 20}, ${0.05 + rnd() * 0.1})`;
    g.beginPath();
    g.ellipse(rnd() * s.pw, rnd() * s.ph, 6 + rnd() * s.pw * 0.2, 4 + rnd() * s.ph * 0.15, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (!chips) return;
  for (let i = 0; i < 9; i++) {
    const edge = Math.floor(rnd() * 4);
    const t = rnd();
    const x = edge === 0 ? 0 : edge === 1 ? s.pw : t * s.pw;
    const y = edge === 2 ? 0 : edge === 3 ? s.ph : t * s.ph;
    g.fillStyle = rnd() < 0.5 ? '#4a2c1c' : '#2b2420';
    g.beginPath();
    g.ellipse(x, y, 2 + rnd() * 7, 2 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

function plate(g: G, s: SignRect): void {
  const rnd = lcg(seedOf(s.id));
  const style = s.style ?? 0;
  g.fillStyle = style === 2 ? '#1f6238' : style === 1 ? '#e2d48a' : '#e6e2d3';
  g.fillRect(0, 0, s.pw, s.ph);
  g.strokeStyle = style === 1 ? '#a1241b' : style === 2 ? '#e6e2d3' : '#26231f';
  g.lineWidth = 2.5;
  g.strokeRect(4, 4, s.pw - 8, s.ph - 8);
  const h = PL_H;
  const top = (s.ph - s.lines.length * h * 1.35) / 2 + h * 0.72;
  s.lines.forEach((line, i) => {
    g.fillStyle = style === 2 ? '#f0ede2' : style === 1 && i === 0 ? '#a1241b' : INK;
    const hh = line.length * ADV * h > s.pw - 20 ? ((s.pw - 20) / (line.length * ADV)) : h;
    mono(g, line, (s.pw - line.length * ADV * hh) / 2, top + i * h * 1.35, hh);
  });
  // Заклёпки по углам.
  g.fillStyle = '#5b5850';
  for (const [x, y] of [[9, 9], [s.pw - 9, 9], [9, s.ph - 9], [s.pw - 9, s.ph - 9]] as const) {
    g.beginPath();
    g.arc(x, y, 2, 0, Math.PI * 2);
    g.fill();
  }
  age(g, s, rnd, true);
}

/** Листы-картинки по id (плакаты ГО, план убежища): их грузит render/poster_images.ts. */
export type Sheets = Readonly<Record<string, CanvasImageSource>>;

/**
 * Лист-картинка: настоящий плакат, провисевший на стене тридцать лет. Сам рисунок — из файла; здесь
 * только следы времени: сгибы (лист везли сложенным вчетверо), пожелтевшие края, бурые пятна, ржавчина
 * от кнопок по углам. Пока файл не пришёл, на стене пустой лист — без рисунка, но и без подделки под него.
 */
function sheet(g: G, s: SignRect, img: CanvasImageSource | undefined): void {
  const rnd = lcg(seedOf(s.id));
  g.fillStyle = PAPER;
  g.fillRect(0, 0, s.pw, s.ph);
  if (img) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s.pw, s.ph);
  }
  // Сгибы: тёмная нитка и светлая рядом — бумага на сгибе вытерлась.
  const fx = Math.round(s.pw / 2 + (rnd() - 0.5) * 8);
  const fy = Math.round(s.ph / 2 + (rnd() - 0.5) * 8);
  g.fillStyle = 'rgba(52, 38, 18, 0.22)';
  g.fillRect(0, fy - 1, s.pw, 1.5);
  g.fillRect(fx - 1, 0, 1.5, s.ph);
  g.fillStyle = 'rgba(255, 250, 235, 0.16)';
  g.fillRect(0, fy + 0.5, s.pw, 1.5);
  g.fillRect(fx + 0.5, 0, 1.5, s.ph);
  // Края пожелтели и потемнели сильнее середины; пятна ложатся на печать, а не поверх неё.
  g.globalCompositeOperation = 'multiply';
  const e = Math.min(s.pw, s.ph) * 0.1;
  const edge = (x0: number, y0: number, x1: number, y1: number, x: number, y: number, w: number, h: number): void => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(146, 112, 64, 0.6)');
    gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  };
  edge(0, 0, e, 0, 0, 0, e, s.ph);
  edge(s.pw, 0, s.pw - e, 0, s.pw - e, 0, e, s.ph);
  edge(0, 0, 0, e, 0, 0, s.pw, e);
  edge(0, s.ph, 0, s.ph - e, 0, s.ph - e, s.pw, e);
  age(g, s, rnd, false);
  // Ржавчина от кнопок по углам.
  for (const [cx, cy] of [[9, 9], [s.pw - 9, 9], [9, s.ph - 9], [s.pw - 9, s.ph - 9]] as const) {
    const gr = g.createRadialGradient(cx, cy, 0.5, cx, cy, 7 + rnd() * 5);
    gr.addColorStop(0, 'rgba(96, 52, 24, 0.9)');
    gr.addColorStop(0.35, 'rgba(140, 86, 40, 0.45)');
    gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gr;
    g.fillRect(cx - 14, cy - 14, 28, 28);
  }
  g.globalCompositeOperation = 'source-over';
}

function dial(g: G, s: SignRect): void {
  const r = s.pw / 2;
  const style = s.style ?? 0;
  g.fillStyle = '#17150f';
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = '#ddd6bd';
  g.beginPath();
  g.arc(r, r, r - 5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = INK;
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  for (let i = 0; i <= 20; i++) {
    const a = a0 + ((a1 - a0) * i) / 20;
    g.lineWidth = i % 5 === 0 ? 2.5 : 1;
    g.beginPath();
    g.moveTo(r + Math.cos(a) * (r - 9), r + Math.sin(a) * (r - 9));
    g.lineTo(r + Math.cos(a) * (r - (i % 5 === 0 ? 20 : 15)), r + Math.sin(a) * (r - (i % 5 === 0 ? 20 : 15)));
    g.stroke();
  }
  g.strokeStyle = '#a1281e';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(r, r, r - 11, a0 + (a1 - a0) * 0.8, a1);
  g.stroke();
  // Стрелка застыла там, где её застала тишина.
  const an = a0 + (a1 - a0) * [0.04, 0.37, 0.92][style % 3]!;
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(r - Math.cos(an) * 8, r - Math.sin(an) * 8);
  g.lineTo(r + Math.cos(an) * (r - 18), r + Math.sin(an) * (r - 18));
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(r, r, 4, 0, Math.PI * 2);
  g.fill();
  mono(g, ['КГС/СМ2', 'ММ ВОД.СТ', 'А'][style % 3]!, r - [7, 9, 1][style % 3]! * ADV * 4, r + r * 0.48, 8);
}

function clock(g: G, s: SignRect): void {
  const r = s.pw / 2;
  g.fillStyle = '#2a2622';
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = '#d9d2ba';
  g.beginPath();
  g.arc(r, r, r - 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.strokeStyle = INK;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = i % 3 === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(r + Math.cos(a) * (r - 12), r + Math.sin(a) * (r - 12));
    g.lineTo(r + Math.cos(a) * (r - 22), r + Math.sin(a) * (r - 22));
    g.stroke();
  }
  // Часы встали в 3:17.
  const hand = (turn: number, len: number, w: number): void => {
    const a = turn * Math.PI * 2 - Math.PI / 2;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(r, r);
    g.lineTo(r + Math.cos(a) * len, r + Math.sin(a) * len);
    g.stroke();
  };
  hand((3 + 17 / 60) / 12, r * 0.42, 5);
  hand(17 / 60, r * 0.66, 3);
  g.beginPath();
  g.arc(r, r, 4, 0, Math.PI * 2);
  g.fill();
}

function calendar(g: G, s: SignRect): void {
  g.fillStyle = '#e0d9c0';
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = '#a1281e';
  g.fillRect(0, 0, s.pw, 30);
  g.fillStyle = '#efe9d2';
  mono(g, s.lines[0]!, (s.pw - 4 * ADV * 18) / 2, 15, 18);
  g.fillStyle = INK;
  mono(g, s.lines[2]!, (s.pw - 2 * ADV * 58) / 2, 72, 58);
  mono(g, s.lines[1]!, (s.pw - 6 * ADV * 15) / 2, 116, 15);
  age(g, s, lcg(seedOf(s.id)), false);
}

function hazard(g: G, s: SignRect): void {
  g.fillStyle = '#c9a422';
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = '#15130f';
  for (let x = -s.ph; x < s.pw; x += 32) {
    g.beginPath();
    g.moveTo(x, s.ph);
    g.lineTo(x + s.ph, 0);
    g.lineTo(x + s.ph + 16, 0);
    g.lineTo(x + 16, s.ph);
    g.closePath();
    g.fill();
  }
}

/** Сектор распаха двери: четверть кольца от петли. */
function arc(g: G, s: SignRect): void {
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(4, s.ph - 4, s.pw - 14, -Math.PI / 2, 0);
  g.stroke();
}

function symbol(g: G, s: SignRect): void {
  const style = s.style ?? 0;
  const c = s.pw / 2;
  if (style === 2) {
    g.fillStyle = '#e6e2d3';
    g.fillRect(0, 0, s.pw, s.ph);
    g.fillStyle = '#a1241b';
    g.fillRect(c - 9, 12, 18, s.ph - 24);
    g.fillRect(12, c - 9, s.pw - 24, 18);
    return;
  }
  g.fillStyle = '#c9a422';
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = '#15130f';
  if (style === 0) {
    // Молния в треугольнике.
    g.lineWidth = 5;
    g.strokeStyle = '#15130f';
    g.beginPath();
    g.moveTo(c, 8);
    g.lineTo(s.pw - 8, s.ph - 10);
    g.lineTo(8, s.ph - 10);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(c + 4, 24);
    g.lineTo(c - 8, 46);
    g.lineTo(c + 1, 46);
    g.lineTo(c - 5, 64);
    g.lineTo(c + 10, 40);
    g.lineTo(c + 1, 40);
    g.closePath();
    g.fill();
  } else {
    // Трилистник радиации.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, c - 10, a - 0.5, a + 0.5);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#c9a422';
    g.beginPath();
    g.arc(c, c, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#15130f';
    g.beginPath();
    g.arc(c, c, 5, 0, Math.PI * 2);
    g.fill();
  }
}

const DRAW: Record<Exclude<SignRect['kind'], 'poster' | 'scheme'>, (g: G, s: SignRect) => void> = { stencil, brush, plate, dial, clock, calendar, hazard, arc, tally, symbol };

/**
 * Нарисовать атлас. Только в браузере. sheets — листы-картинки, которые уже загрузились: без них
 * на месте плакатов пустые листы, и атлас перерисовывают, когда картинки приходят.
 */
export function drawSigns(sheets: Sheets = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIGNS_SIZE;
  canvas.height = SIGNS_SIZE;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, SIGNS_SIZE, SIGNS_SIZE);
  for (const s of SIGN_LIST) {
    g.save();
    g.beginPath();
    g.rect(s.x, s.y, s.pw, s.ph);
    g.clip();
    g.translate(s.x, s.y);
    if (s.kind === 'poster' || s.kind === 'scheme') sheet(g, s, sheets[s.id]);
    else DRAW[s.kind](g, s);
    g.restore();
  }
  return canvas;
}
