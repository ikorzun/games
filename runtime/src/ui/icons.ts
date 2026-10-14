/**
 * Иконки интерфейса: встроенный SVG (монолиния, currentColor), никаких внешних файлов и шрифтов.
 * Быстрое меню; карточки-улики дедуктивной развилки — по виду материала (archive_items[].kind);
 * значки «уже пробовали» (✕) и «подсказка» у вариантов выбора.
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
  notebook: [
    ['path', { d: 'M6.5 3.5h12v17h-12z' }],
    ['path', { d: 'M4.5 7h4M4.5 12h4M4.5 17h4M10.5 8h5M10.5 11.5h5M10.5 15h3' }],
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
  // ── главное меню: язык и закрытый эпизод ──
  globe: [
    ['circle', { cx: '12', cy: '12', r: '8.5' }],
    ['path', { d: 'M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5s1.2-6.1 3.8-8.5z' }],
  ],
  lock: [
    ['rect', { x: '5.5', y: '10.5', width: '13', height: '9.5', rx: '1' }],
    ['path', { d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5' }],
  ],
  // ── виды материалов архива (карточка «предъявить» в дедуктивной развилке) ──
  document: [
    ['path', { d: 'M6.5 3.5h7.5l4 4v13h-11.5z' }],
    ['path', { d: 'M14 3.5v4h4M9 12h6M9 15.5h6' }],
  ],
  photo: [
    ['path', { d: 'M3.5 5.5h17v13h-17z' }],
    ['circle', { cx: '9', cy: '10', r: '1.7' }],
    ['path', { d: 'M3.5 16l5-4.5 3.5 3 3-2.5 5.5 4.5' }],
  ],
  newspaper: [
    ['path', { d: 'M4.5 5.5h12v13H6a1.5 1.5 0 0 1-1.5-1.5z' }],
    ['path', { d: 'M16.5 9h3v8a1.5 1.5 0 0 1-3 0' }],
    ['path', { d: 'M7.5 8.5h6v3h-6zM7.5 14.5h6' }],
  ],
  object: [
    ['path', { d: 'M4 13l8.5-8.5H20v7.5l-8.5 8.5z' }],
    ['circle', { cx: '16', cy: '8.5', r: '1.4' }],
  ],
  map: [
    ['path', { d: 'M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z' }],
    ['path', { d: 'M9 4.5v13M15 6.5v13' }],
  ],
  audio: [
    ['rect', { x: '3.5', y: '6', width: '17', height: '12', rx: '1.5' }],
    ['circle', { cx: '8.5', cy: '11', r: '1.7' }],
    ['circle', { cx: '15.5', cy: '11', r: '1.7' }],
    ['path', { d: 'M10.2 11h3.6M7 18l1.2-2.5h7.6L17 18' }],
  ],
  fact: [
    ['circle', { cx: '12', cy: '12', r: '8.5' }],
    ['path', { d: 'M12 11v5.5M12 7.8v.01' }],
  ],
  // ── состояния вариантов выбора ──
  cross: [['path', { d: 'M7 7l10 10M17 7L7 17' }]],
  /** Закрыть (крестик на всю клетку): окно документа по макету. */
  close: [['path', { d: 'M.5.5l23 23M23.5.5l-23 23' }]],
  /** Переместить (стрелки на четыре стороны): ручка блока мини-игры по макету. */
  move: [
    ['path', { d: 'M12 5v14M5 12h14' }],
    ['path', { d: 'M12 1.5l3.4 3.8H8.6zM12 22.5l3.4-3.8H8.6zM1.5 12l3.8-3.4v6.8zM22.5 12l-3.8-3.4v6.8z', fill: 'currentColor', stroke: 'none' }],
  ],
  hint: [
    ['path', { d: 'M8.6 14.2a5.5 5.5 0 1 1 6.8 0c-.6.5-.9 1.2-.9 2v1.3h-5v-1.3c0-.8-.3-1.5-.9-2z' }],
    ['path', { d: 'M10 20.5h4' }],
  ],
  /** Канцелярская скрепка (стоя): бумаги в блокноте приколоты ею к странице. */
  clip: [['path', { d: 'M10.5 8v9.5a1.75 1.75 0 0 0 3.5 0V4.5a2.75 2.75 0 0 0-5.5 0V19a3.5 3.5 0 0 0 7 0V7.5' }]],
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
