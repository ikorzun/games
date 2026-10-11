/**
 * Иконки быстрого меню: встроенный SVG (монолиния, currentColor), никаких внешних файлов и шрифтов.
 * Подписи кнопок остаются в разметке (скрытый текст + title) — иконка без подписи недоступна скринридеру.
 */

type Node2 = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>, group?: 'on' | 'off'];

const ICONS = {
  auto: [
    ['circle', { cx: '12', cy: '12', r: '8.5' }],
    ['path', { d: 'M10.2 8.6l5.2 3.4-5.2 3.4z', fill: 'currentColor' }],
  ],
  skip: [
    ['path', { d: 'M5 6.5l7 5.5-7 5.5z', fill: 'currentColor' }],
    ['path', { d: 'M12.5 6.5l7 5.5-7 5.5z', fill: 'currentColor' }],
  ],
  log: [
    ['path', { d: 'M3.5 7.5h6l2 2h9v9.5h-17z' }],
  ],
  save: [
    ['path', { d: 'M5 4.5h11l3.5 3.5V19.5H5z' }],
    ['path', { d: 'M8 4.5v4.5h7V4.5M8 19.5v-6h8v6' }],
  ],
  load: [
    ['path', { d: 'M3.5 7.5h6l2 2h9v9.5h-17z' }],
    ['path', { d: 'M12 11v6M9.5 14.5l2.5 2.5 2.5-2.5' }],
  ],
  mute: [
    ['path', { d: 'M4.5 9.5v5h3.8l5 3.7V5.8l-5 3.7z', fill: 'currentColor' }],
    ['path', { d: 'M16.4 9.4c1.4 1.4 1.4 4.2 0 5.6M18.9 6.9c2.9 2.9 2.9 7.3 0 10.2' }, 'on'],
    ['path', { d: 'M16.5 9.5l5 5M21.5 9.5l-5 5' }, 'off'],
  ],
  settings: [
    ['path', { d: 'M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9' }],
    ['circle', { cx: '15.2', cy: '7.5', r: '2.2' }],
    ['circle', { cx: '8.8', cy: '16.5', r: '2.2' }],
  ],
  hide: [
    ['path', { d: 'M2.8 12S6.2 6.2 12 6.2 21.2 12 21.2 12 17.8 17.8 12 17.8 2.8 12 2.8 12z' }],
    ['circle', { cx: '12', cy: '12', r: '2.4' }],
    ['path', { d: 'M4.5 4.5l15 15' }],
  ],
} as const satisfies Record<string, readonly Node2[]>;

export type IconName = keyof typeof ICONS;

const NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `vn-ico vn-ico--${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs, group] of ICONS[name] as readonly Node2[]) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (group) el.setAttribute('class', `vn-ico__${group}`);
    svg.appendChild(el);
  }
  return svg;
}
