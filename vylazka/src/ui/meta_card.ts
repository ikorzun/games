/**
 * Карточка обрывка метаслоя (systems/meta.ts): что показать на экране в лимбо. Пропущенный вызов и переписка — экран телефона;
 * записка — полоска бумаги от руки; снимок — отпечаток из колоды больного сна; запись — несколько секунд с нагрудной камеры
 * самого игрока, кадр за кадром, с REC и временем записи. Имя в переписке не сохранилось — на его месте размытое пятно.
 */
import { t } from '../core/i18n';
import { PAPER_URLS } from '../render/paper_images';
import type { Fragment } from '../systems/meta';
import { DREAM_PRINTS } from '../world/papers';

/**
 * Размер слоя бумаги и снимка в нём, px (world/papers.ts: снимки 240 × 320 сеткой 3 × 4 в слое 720 × 1280) и поле отпечатка
 * (scripts/papers_dream.py, DREAM_EDGE): кусок снимка считается от картинки внутри поля — иначе в кадр карточки попадает полоска
 * фотобумаги.
 */
const LAYER_W = 720;
const LAYER_H = 1280;
const PRINT_W = 240;
const PRINT_H = 320;
const PRINT_EDGE = 8;
const IMG_W = PRINT_W - 2 * PRINT_EDGE;
const IMG_H = PRINT_H - 2 * PRINT_EDGE;
/** Запись: кадров в секунду при показе. */
export const REEL_FPS = 6;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Время записи для подписи кадра: часы камеры, как в углу кадра игры. */
export type ClockText = () => string;

/**
 * Собрать карточку. frames — кадры записи этого сна (для video); clock — время на камере. Возвращает элемент и функцию,
 * которая останавливает показ кадров (вызвать, когда карточка ушла).
 */
export function buildMetaCard(f: Fragment, frames: readonly HTMLCanvasElement[], clock: ClockText): { card: HTMLElement; stop: () => void } {
  const card = el('div', `vz-meta vz-meta--${f.kind}`);
  let stop = (): void => {};
  if (f.kind === 'call') {
    const phone = el('div', 'vz-meta__phone');
    phone.append(el('div', 'vz-meta__missed', f.calls!.length > 1 ? t('meta.missed.n', { n: f.calls!.length }) : t('meta.missed')));
    phone.append(el('div', 'vz-meta__who', t('meta.ward')));
    phone.append(el('div', 'vz-meta__times', f.calls!.join(' · ')));
    card.append(phone);
  } else if (f.kind === 'chat') {
    const phone = el('div', 'vz-meta__phone');
    // Имя не сохранилось — как лица на старых карточках.
    const head = el('div', 'vz-meta__head');
    head.append(el('span', 'vz-meta__name', '— — —'));
    phone.append(head);
    for (const l of f.lines ?? []) {
      const row = el('div', `vz-meta__msg vz-meta__msg--${l.who}`);
      row.append(el('div', 'vz-meta__bubble', t(l.key)));
      const at = l.at === 'now' ? t('meta.now') : l.at;
      row.append(el('div', 'vz-meta__at', l.failed ? `${at} · ${t('meta.failed')}` : at));
      phone.append(row);
    }
    card.append(phone);
  } else if (f.kind === 'note') {
    card.append(el('div', 'vz-meta__note', t(f.note!)));
  } else if (f.kind === 'photo') {
    const p = DREAM_PRINTS.find((d) => d[0] === f.print);
    const print = el('div', 'vz-meta__print');
    const img = el('div', 'vz-meta__img');
    const url = p ? PAPER_URLS[p[1]] : undefined;
    if (p && url) {
      const [, , x0, y0] = p;
      const [cx, cy, cw, ch] = f.crop ?? [0, 0, 1, 1];
      // Кусок снимка во весь кадр карточки: слой масштабируется так, чтобы ширина куска стала шириной кадра; положение — доля
      // свободного хода фона (так считает background-position в процентах).
      const w = cw * IMG_W;
      const h = ch * IMG_H;
      const sx = LAYER_W / w;
      const sy = LAYER_H / h;
      const px = (x0 + PRINT_EDGE + cx * IMG_W) / (LAYER_W - w);
      const py = (y0 + PRINT_EDGE + cy * IMG_H) / (LAYER_H - h);
      img.style.backgroundImage = `url("${url}")`;
      img.style.backgroundSize = `${(sx * 100).toFixed(2)}% ${(sy * 100).toFixed(2)}%`;
      img.style.backgroundPosition = `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`;
      img.style.aspectRatio = `${w.toFixed(1)} / ${h.toFixed(1)}`;
    }
    print.append(img);
    card.append(print);
  } else {
    const screen = el('div', 'vz-meta__reel');
    const canvas = el('canvas', 'vz-meta__frame');
    const first = frames[0];
    canvas.width = first?.width ?? 192;
    canvas.height = first?.height ?? 108;
    const ctx = canvas.getContext('2d');
    screen.append(canvas);
    const rec = el('div', 'vz-meta__rec');
    rec.append(el('span', 'vz-meta__dot'));
    rec.append(document.createTextNode(t('meta.rec')));
    screen.append(rec);
    const tc = el('div', 'vz-meta__tc', clock());
    screen.append(tc);
    card.append(screen);
    let i = 0;
    const draw = (): void => {
      const fr = frames[i % Math.max(1, frames.length)];
      if (ctx && fr) ctx.drawImage(fr, 0, 0, canvas.width, canvas.height);
      tc.textContent = clock();
      i += 1;
    };
    draw();
    const id = setInterval(draw, 1000 / REEL_FPS);
    stop = () => clearInterval(id);
  }
  return { card, stop };
}
