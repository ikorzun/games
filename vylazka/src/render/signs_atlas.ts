/**
 * Атлас надписей: трафареты, таблички, плакаты ГО, шкалы приборов. Рисуется на canvas при запуске
 * по раскладке из world/signs.ts — ни одной готовой картинки в игре нет.
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

// ── Рисунки плакатов: простые фигуры одним цветом ──

function person(g: G, x: number, y: number, k: number, run = false): void {
  g.beginPath();
  g.arc(x, y - 16 * k, 4 * k, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * k;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y - 12 * k);
  g.lineTo(x + (run ? 2 * k : 0), y);
  g.moveTo(x, y - 9 * k);
  g.lineTo(x - 6 * k, y - (run ? 12 : 3) * k);
  g.moveTo(x, y - 9 * k);
  g.lineTo(x + 6 * k, y - (run ? 4 : 3) * k);
  g.moveTo(x + (run ? 2 * k : 0), y);
  g.lineTo(x - (run ? 7 : 3) * k, y + 11 * k);
  g.moveTo(x + (run ? 2 * k : 0), y);
  g.lineTo(x + (run ? 9 : 3) * k, y + (run ? 8 : 11) * k);
  g.stroke();
}

function gasMask(g: G, x: number, y: number, k: number): void {
  g.beginPath();
  g.ellipse(x, y, 15 * k, 19 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PAPER;
  for (const dx of [-6, 6]) {
    g.beginPath();
    g.arc(x + dx * k, y - 4 * k, 4.5 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = INK;
  g.fillRect(x - 6 * k, y + 10 * k, 12 * k, 8 * k);
  g.beginPath();
  g.ellipse(x, y + 24 * k, 9 * k, 6 * k, 0, 0, Math.PI * 2);
  g.fill();
}

function picture(g: G, style: number, row: number, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  const key = style * 3 + row;
  if (key === 0) {
    // Сирена и волны звука.
    g.beginPath();
    g.moveTo(cx - 18, cy - 6);
    g.lineTo(cx - 4, cy - 14);
    g.lineTo(cx - 4, cy + 14);
    g.lineTo(cx - 18, cy + 6);
    g.closePath();
    g.fill();
    for (let i = 1; i <= 3; i++) {
      g.beginPath();
      g.arc(cx - 4, cy, 7 + i * 7, -0.7, 0.7);
      g.stroke();
    }
  } else if (key === 1) {
    // Люди бегут к входу.
    person(g, cx - 18, cy + 2, 0.9, true);
    person(g, cx - 2, cy + 2, 0.9, true);
    g.fillRect(cx + 16, cy - 20, 12, 36);
    g.fillStyle = PAPER;
    g.fillRect(cx + 19, cy - 16, 6, 30);
  } else if (key === 2 || key === 6) {
    // Разрез: земля, дом, под ним убежище с людьми.
    g.fillRect(x + 4, cy - 2, w - 8, 3);
    g.fillRect(cx - 22, cy - 24, 20, 22);
    g.strokeRect(cx - 26, cy + 4, 52, 20);
    for (const dx of [-16, -4, 8]) person(g, cx + dx, cy + 14, 0.45);
  } else if (key === 3) {
    gasMask(g, cx, cy - 6, 0.95);
  } else if (key === 4) {
    // Сумка с противогазом через плечо.
    g.fillRect(cx - 14, cy - 6, 28, 24);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 14, cy - 6);
    g.quadraticCurveTo(cx, cy - 34, cx + 14, cy - 6);
    g.stroke();
    g.fillStyle = PAPER;
    g.fillRect(cx - 9, cy + 2, 18, 3);
  } else if (key === 5) {
    // Человек в противогазе.
    person(g, cx, cy + 6, 1.1);
    g.beginPath();
    g.ellipse(cx, cy - 12, 6, 7.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(cx - 2, cy - 6, 4, 8);
  } else if (key === 7) {
    // Не курить: перечёркнутая папироса.
    g.fillRect(cx - 18, cy - 3, 30, 6);
    g.strokeStyle = '#a1241b';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, 22, 0, Math.PI * 2);
    g.moveTo(cx - 15, cy + 15);
    g.lineTo(cx + 15, cy - 15);
    g.stroke();
  } else if (key === 8) {
    // Нары в два яруса.
    for (const dy of [-14, 6]) g.fillRect(cx - 24, cy + dy, 48, 4);
    for (const dx of [-24, 21]) g.fillRect(cx + dx, cy - 22, 3, 44);
    person(g, cx - 6, cy - 2, 0.5);
  } else if (key === 9) {
    g.fillStyle = '#a1241b';
    g.fillRect(cx - 6, cy - 20, 12, 40);
    g.fillRect(cx - 20, cy - 6, 40, 12);
  } else if (key === 10) {
    // Перевязка руки.
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 22, cy + 10);
    g.lineTo(cx + 20, cy - 10);
    g.stroke();
    g.strokeStyle = PAPER;
    g.lineWidth = 2;
    for (let i = -1; i <= 2; i++) {
      g.beginPath();
      g.moveTo(cx - 6 + i * 6, cy - 4);
      g.lineTo(cx - 2 + i * 6, cy + 8);
      g.stroke();
    }
  } else {
    // Носилки.
    g.fillRect(cx - 26, cy - 2, 52, 4);
    g.fillRect(cx - 18, cy - 8, 36, 6);
    person(g, cx - 28, cy + 4, 0.55);
    person(g, cx + 28, cy + 4, 0.55);
  }
}

function poster(g: G, s: SignRect): void {
  const rnd = lcg(seedOf(s.id));
  const style = s.style ?? 0;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = ['#a1281e', '#274f70', '#2f5a3a', '#8f2a22'][style % 4]!;
  g.fillRect(6, 6, s.pw - 12, 46);
  g.fillStyle = '#efe9d2';
  s.lines.forEach((line, i) => {
    const h = Math.min(16, (s.pw - 22) / (line.length * ADV));
    mono(g, line, (s.pw - line.length * ADV * h) / 2, 20 + i * 19, h);
  });
  const rowH = (s.ph - 64) / 3;
  for (let row = 0; row < 3; row++) {
    const y = 58 + row * rowH;
    g.strokeStyle = '#6c6654';
    g.lineWidth = 1;
    g.strokeRect(8, y + 2, 72, rowH - 8);
    picture(g, style, row, 8, y + 2, 72, rowH - 8);
    // Мелкий текст: строчки, которые с двух шагов не прочесть.
    g.fillStyle = '#4b473d';
    for (let l = 0; l < 6; l++) g.fillRect(88, y + 8 + l * 9, (s.pw - 100) * (0.55 + rnd() * 0.45), 2.5);
  }
  // Сгибы и пожелтевшие края.
  g.fillStyle = 'rgba(60, 45, 20, 0.12)';
  g.fillRect(0, s.ph / 2 - 1, s.pw, 2);
  g.fillRect(s.pw / 2 - 1, 0, 2, s.ph);
  age(g, s, rnd, false);
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

function scheme(g: G, s: SignRect): void {
  const rnd = lcg(seedOf(s.id));
  g.fillStyle = PAPER;
  g.fillRect(0, 0, s.pw, s.ph);
  g.fillStyle = INK;
  mono(g, s.lines[0]!, 10, 14, 13);
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  // Коридор и помещения по обе стороны.
  g.strokeRect(14, 66, s.pw - 28, 14);
  for (let i = 0; i < 6; i++) {
    const x = 16 + i * ((s.pw - 32) / 6);
    const w = (s.pw - 32) / 6 - 4;
    g.strokeRect(x, 30 + rnd() * 6, w, 36 - rnd() * 6);
    if (i % 2 === 0 || rnd() < 0.6) g.strokeRect(x, 80, w, 26 + rnd() * 14);
  }
  // Путь к выходу.
  g.strokeStyle = '#a1281e';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(s.pw - 22, 73);
  g.lineTo(24, 73);
  g.lineTo(30, 68);
  g.moveTo(24, 73);
  g.lineTo(30, 78);
  g.stroke();
  g.fillStyle = '#4b473d';
  for (let l = 0; l < 3; l++) g.fillRect(14, s.ph - 22 + l * 6, 60 + rnd() * 70, 2);
  age(g, s, rnd, false);
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

const DRAW: Record<SignRect['kind'], (g: G, s: SignRect) => void> = { stencil, brush, plate, poster, dial, clock, calendar, hazard, arc, scheme, tally, symbol };

/** Нарисовать атлас. Только в браузере. */
export function drawSigns(): HTMLCanvasElement {
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
    DRAW[s.kind](g, s);
    g.restore();
  }
  return canvas;
}
