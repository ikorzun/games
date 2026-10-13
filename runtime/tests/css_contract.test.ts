/**
 * Договорённости по внешнему виду, записанные в CSS (решения владельца 2026-10-10): сдержанная
 * цветокоррекция (десатурация ≤ 35 %), картинки без размытия в цветокоррекции, HUD камкордера мигает 1 Гц,
 * текстовое окно ≈ rgba(0,0,0,.72) без рамки, имя без обводки, кнопки меню на 8 % белого без контура,
 * кнопки выбора ≥ 48 px, таймкод в правом верхнем углу.
 * Тест читает стили как текст и считает матрицы CSS-фильтров по спецификации Filter Effects.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const stageCss = readFileSync(join(HERE, '..', 'src', 'stage', 'stage.css'), 'utf8');
const uiCss = readFileSync(join(HERE, '..', 'src', 'ui', 'styles.css'), 'utf8');

type Rgb = [number, number, number];

/** Фильтр цветокоррекции каждого stage.filter: `.vn-stage.filter-<имя> .vn-stage__grade { filter: … }`. */
function gradeFilters(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of stageCss.matchAll(/\.vn-stage\.filter-([a-z_]+)\s+\.vn-stage__grade\s*\{\s*filter:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const mul = (m: number[], [r, g, b]: Rgb): Rgb => [clamp(m[0]! * r + m[1]! * g + m[2]! * b), clamp(m[3]! * r + m[4]! * g + m[5]! * b), clamp(m[6]! * r + m[7]! * g + m[8]! * b)];

function applyFn(name: string, arg: number, c: Rgb): Rgb {
  switch (name) {
    case 'saturate': {
      const s = arg;
      return mul([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s], c);
    }
    case 'sepia': {
      const k = 1 - arg;
      return mul([0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k], c);
    }
    case 'grayscale': {
      const k = 1 - arg;
      return mul([0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k], c);
    }
    case 'contrast':
      return [clamp(arg * (c[0] - 0.5) + 0.5), clamp(arg * (c[1] - 0.5) + 0.5), clamp(arg * (c[2] - 0.5) + 0.5)];
    case 'brightness':
      return [clamp(c[0] * arg), clamp(c[1] * arg), clamp(c[2] * arg)];
    default:
      throw new Error(`цветокоррекция использует неучтённую функцию ${name}()`);
  }
}

function runFilter(filter: string, c: Rgb): Rgb {
  let out = c;
  for (const m of filter.matchAll(/([a-z-]+)\(([^)]*)\)/g)) out = applyFn(m[1]!, Number(m[2]), out);
  return out;
}

/** Насыщенность HSV: (max − min) / max. */
const sat = ([r, g, b]: Rgb): number => {
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
};

/** Типичные «живые» цвета кадра: кожа, зелень, небо, кирпич, охра, серо-бежевый. */
const PROBE: Rgb[] = [
  [0.8, 0.55, 0.45],
  [0.35, 0.55, 0.3],
  [0.3, 0.45, 0.7],
  [0.65, 0.3, 0.25],
  [0.75, 0.65, 0.4],
  [0.45, 0.4, 0.35],
];

/** Средняя потеря насыщенности фильтром на палитре: 0 — без потери, 1 — чёрно-белое. */
function desaturation(filter: string): number {
  const ratios = PROBE.map((c) => sat(runFilter(filter, c)) / sat(c));
  return 1 - ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

describe('цветокоррекция stage.filter: сдержанная', () => {
  const filters = gradeFilters();

  it('описаны все фильтры сцены', () => {
    expect(Object.keys(filters).sort()).toEqual(['archive_photo', 'desaturated', 'night', 'noir', 'sepia', 'vhs', 'vhs_heavy']);
  });

  it('archive_photo, sepia, desaturated, noir, night — только цветокоррекция: десатурация ≤ 35 %', () => {
    for (const name of ['archive_photo', 'sepia', 'desaturated', 'noir', 'night'] as const) {
      const d = desaturation(filters[name]!);
      expect(d, `${name}: ${filters[name]} → потеря насыщенности ${(d * 100).toFixed(0)} %`).toBeLessThanOrEqual(0.35);
    }
  });

  it('и по отдельным функциям: saturate ≥ 0,65, sepia ≤ 0,35, grayscale ≤ 0,35 (никаких «ч/б» и коричневых заливок)', () => {
    for (const [name, f] of Object.entries(filters)) {
      for (const m of f.matchAll(/saturate\(([\d.]+)\)/g)) expect(Number(m[1]), `${name} saturate`).toBeGreaterThanOrEqual(0.65);
      for (const m of f.matchAll(/sepia\(([\d.]+)\)/g)) expect(Number(m[1]), `${name} sepia`).toBeLessThanOrEqual(0.35);
      for (const m of f.matchAll(/grayscale\(([\d.]+)\)/g)) expect(Number(m[1]), `${name} grayscale`).toBeLessThanOrEqual(0.35);
    }
  });

  it('vhs и vhs_heavy почти не трогают цвет (картинка чистая, «камкордер» делает рантайм поверх)', () => {
    expect(desaturation(filters.vhs!)).toBeLessThanOrEqual(0.12);
    expect(desaturation(filters.vhs_heavy!)).toBeLessThanOrEqual(0.2);
  });

  it('в цветокоррекции нет размытия: мягкость и помехи — отдельный слой камкордера, а не фильтр картинки', () => {
    for (const [name, f] of Object.entries(filters)) expect(f, name).not.toMatch(/blur\(/);
  });

  it('метрика считает правильно: saturate(0.5) убирает около половины насыщенности, grayscale(1) — всю, contrast(1) — ничего', () => {
    expect(desaturation('saturate(0.5)')).toBeGreaterThan(0.35);
    expect(desaturation('saturate(0.5)')).toBeLessThan(0.55);
    expect(desaturation('saturate(0.65)')).toBeLessThan(desaturation('saturate(0.5)'));
    expect(desaturation('grayscale(1)')).toBeCloseTo(1, 1);
    expect(desaturation('contrast(1)')).toBeCloseTo(0, 5);
    expect(desaturation('saturate(1)')).toBeCloseTo(0, 5);
  });
});

describe('слои камкордера в CSS', () => {
  it('прежнее SVG-зерно с mix-blend-mode убрано: зерно — один canvas низкого разрешения; интерлейс только у vhs_heavy и только при включённых эффектах', () => {
    expect(stageCss).not.toMatch(/vn-stage__grain/);
    expect(stageCss).not.toMatch(/mix-blend-mode:\s*overlay/);
    expect(stageCss).toMatch(/\.vn-stage__camfx\s*\{[^}]*display:\s*none/);
    expect(stageCss).toMatch(/\.vn-stage\.cam-on\s+\.vn-stage__camfx\s*\{\s*display:\s*block/);
    expect(stageCss).toMatch(/\.vn-stage\.cam-on\.filter-vhs_heavy\s+\.vn-stage__scan\s*\{\s*--scan:\s*var\(--cam-interlace\)/);
    expect(stageCss).toMatch(/--scan:\s*0;/); // по умолчанию строк нет
  });

  it('фильтр на неподвижном слое grade, а дрожащая обёртка hand — только трансформация (will-change), без фильтров', () => {
    const hand = /\.vn-stage__hand\s*\{([^}]*)\}/.exec(stageCss)![1]!;
    expect(hand).toMatch(/will-change:\s*transform/);
    expect(hand).not.toMatch(/filter/);
    expect(gradeFilters().vhs).toBeDefined();
    expect(stageCss).not.toMatch(/\.vn-stage\.filter-[a-z_]+\s+\.vn-stage__scene\s*\{\s*filter/);
  });

  it('HUD записи: точка мигает с периодом 1 с (1 Гц), скрыт по умолчанию, виден только при cam-rec; «Скрыть интерфейс» прячет REC и таймкод', () => {
    expect(stageCss).toMatch(/\.vn-rec__dot\s*\{[^}]*animation:\s*rec-blink\s+1s\s+steps\(1,\s*end\)\s+infinite/);
    expect(stageCss).toMatch(/@keyframes rec-blink\s*\{\s*0%,\s*49\.99%\s*\{\s*opacity:\s*1;\s*\}\s*50%,\s*100%\s*\{\s*opacity:\s*0;/);
    expect(stageCss).toMatch(/\.vn-stage__hud\s*\{[^}]*display:\s*none/);
    expect(stageCss).toMatch(/\.vn-stage\.cam-rec\s+\.vn-stage__hud\s*\{\s*display:\s*block/);
    expect(uiCss).toMatch(/\.vn-root\.ui-hidden\s+\.vn-cap--date_stamp,\s*\.vn-root\.ui-hidden\s+\.vn-stage__hud\s*\{\s*visibility:\s*hidden/);
  });

  it('vignette: два независимых затемнения (фильтр и камкордер) без max()', () => {
    expect(stageCss).toMatch(/opacity:\s*calc\(var\(--vig\)\s*\+\s*var\(--cam-vignette\)\s*\*\s*\(1\s*-\s*var\(--vig\)\)\)/);
  });
});

describe('интерфейс: документальная эстетика, mobile-first', () => {
  it('окно реплики по макету в Figma (узел 1232:3796, 2026-10-13): полоса 40 % чёрного под каждой строкой без тени, над текстом портрет 48 px, имя и подпись; шрифт Tinos', () => {
    const box = /\n\.vn-textbox\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(box).not.toMatch(/background/);
    expect(box).not.toMatch(/text-shadow/);
    expect(box).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(box).toMatch(/width:\s*min\(100%,\s*calc\(585em \/ 15\)\)/);
    const plate = /\n\.vn-textbox__box\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(plate).not.toMatch(/background/); // сплошной подложки больше нет — полосы по строкам
    const text = /\n\.vn-textbox__text\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(text).toMatch(/line-height:\s*calc\(20em \/ 15\)/); // шаг строк = высота полосы
    expect(text).toMatch(/padding:\s*0 calc\(24em \/ 15\) 0 calc\(5em \/ 15\)/);
    const bars = /\n\.vn-textbox__bars\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(bars).toMatch(/opacity:\s*0\.4;/);
    expect(bars).toMatch(/color:\s*transparent/);
    const bar = /\n\.vn-textbox__bar\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(bar).toMatch(/background:\s*#000/);
    expect(bar).toMatch(/-webkit-box-decoration-break:\s*clone;[\s\S]*\bbox-decoration-break:\s*clone/);
    expect(bar).toMatch(/box-shadow:\s*calc\(-5em \/ 15\) 0 #000, calc\(5em \/ 15\) 0 #000/);
    const avatar = /\n\.vn-textbox__avatar\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(avatar).toMatch(/width:\s*48px;[\s\S]*height:\s*48px;/);
    expect(avatar).toMatch(/border-radius:\s*50%/);
    expect(uiCss).toMatch(/\.vn-textbox__name\s*\{\s*font-size:\s*calc\(14em \/ 15\);\s*\}/);
    expect(uiCss).toMatch(/\.vn-textbox__title\s*\{\s*font-size:\s*calc\(10em \/ 15\);\s*opacity:\s*0\.7;\s*\}/);
    expect(uiCss).toMatch(/--font-body:\s*'Tinos'/);
    expect(uiCss).toMatch(/--panel-line:\s*rgb\(255 255 255 \/ 0\.28\)/);
    expect((uiCss.match(/@font-face \{ font-family: 'Tinos'/g) ?? []).length).toBe(3); // свои woff2, без Google Fonts в рантайме; курсива нет
    // Размытие — только у оверлеев выбора и документа по макетам 2026-10-13 и только при мыши: на телефоне дорого.
    const blur = /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.vn-document,\s*\.vn-choices\s*\{([^}]*)\}\s*\}/.exec(uiCss);
    expect(blur?.[1]).toMatch(/background:\s*rgb\(0 0 0 \/ 0\.6\);[\s\S]*backdrop-filter:\s*blur\(5px\)/);
    expect(uiCss.replace(blur![0], '')).not.toMatch(/backdrop-filter/);
  });

  it('шрифт только 400 или тоньше (решение владельца 2026-10-12): знак «дальше» — рисунок из макета реплик, не жирная буква', () => {
    const cssOf = (dir: string): string[] => {
      const d = join(HERE, '..', 'src', dir);
      return readdirSync(d).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(d, f), 'utf8'));
    };
    // Мини-игры и режим дела (папка, итог поиска, осмотр фото).
    expect(uiCss.match(/font-weight:\s*700/g)).toHaveLength(1); // только @font-face жирной латиницы Tinos
    const rest = uiCss.replace(/@font-face[^\n]*font-weight: 700[^\n]*/, '');
    for (const css of [rest, ...cssOf('minigames'), ...cssOf('case')]) {
      expect(css).not.toMatch(/font-weight:\s*(?:[5-9]00|bold)/);
      expect(css).not.toMatch(/font:\s*(?:[5-9]00|bold)\s/);
    }
  });

  it('курсива нет нигде (решение владельца 2026-10-13): мысли и закадровый голос — своим цветом, у мыслей нет черты слева', () => {
    const cssOf = (dir: string): string[] => {
      const d = join(HERE, '..', 'src', dir);
      return readdirSync(d).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(d, f), 'utf8'));
    };
    for (const css of [uiCss, stageCss, ...cssOf('minigames'), ...cssOf('case')]) expect(css).not.toMatch(/italic|oblique/);
    expect(uiCss).toMatch(/\.vn-textbox\[data-style='inner'\] \.vn-textbox__text \{ color: #cfd2d8; \}/);
    expect(uiCss).toMatch(/\.vn-textbox\[data-style='voiceover'\] \.vn-textbox__text \{ color: #e4dfd1; \}/);
  });

  it('без скруглений (решение владельца 2026-10-13): круглые только портрет у имени, экран-кинескоп меню, лампа REC, номер варианта, крестик документа, номера и попытки осмотра (макеты 2026-10-13)', () => {
    const cssOf = (dir: string): string[] => {
      const d = join(HERE, '..', 'src', dir);
      return readdirSync(d).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(d, f), 'utf8'));
    };
    const owners: string[] = [];
    for (const css of [uiCss, stageCss, ...cssOf('minigames'), ...cssOf('case')]) {
      for (const m of css.matchAll(/([^{}]+)\{[^}]*border-radius:(?!\s*0;)[^}]*\}/g)) owners.push(m[1]!.trim().split('\n').pop()!.trim());
    }
    expect(owners.sort()).toEqual([
      '.mg-scene__num',
      '.mg-scene__pin',
      '.mg-stage .mg-shell__pip',
      '.vn-choice__n',
      '.vn-crt__in',
      '.vn-crt__screen',
      '.vn-crt__screen::after',
      '.vn-document__close',
      '.vn-rec__dot',
      '.vn-textbox__avatar',
    ]);
    expect(uiCss).not.toMatch(/--radius/);
  });

  it('каретка — плашка 19 × 20 (40 % #ac0000) сразу за полосой, ширины не занимает; белый «>» виден, когда реплика допечатана', () => {
    expect(uiCss).toMatch(/\n\.vn-textbox__more\s*\{\s*position:\s*relative;\s*\}/);
    const plate = /\n\.vn-textbox__more::before\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(plate).toMatch(/position:\s*absolute/);
    expect(plate).toMatch(/width:\s*calc\(19em \/ 15\)/);
    expect(plate).toMatch(/height:\s*calc\(20em \/ 15\)/);
    expect(plate).toMatch(/background:\s*rgb\(172 0 0 \/ 0\.4\)/);
    const glyph = /\n\.vn-textbox__more svg\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(glyph).toMatch(/position:\s*absolute/);
    expect(glyph).toMatch(/fill:\s*#fff/);
    expect(glyph).toMatch(/opacity:\s*0;/);
    expect(uiCss).toMatch(/\.vn-textbox\.is-complete\s+\.vn-textbox__more svg\s*\{\s*opacity:\s*1;/);
  });

  it('кнопки быстрого меню — полупрозрачная подложка 8 % белого без контура, фокус с клавиатуры виден', () => {
    const q = /\n\.vn-qbtn\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(q).toMatch(/background:\s*rgb\(255 255 255 \/ 0\.08\)/);
    expect(q).toMatch(/border:\s*0;/);
    expect(uiCss).toMatch(/\.vn-qbtn:focus-visible\s*\{[^}]*outline:/);
  });

  it('кнопки выбора — крупные: не ниже 48 px (у нас 52); кнопки быстрого меню — иконки не меньше 40 px', () => {
    const choice = /\n\.vn-choice\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(Number(/min-height:\s*max\((\d+)px/.exec(choice)![1])).toBeGreaterThanOrEqual(48); // и растёт с кеглем
    const q = /\n\.vn-qbtn\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(Number(/width:\s*(\d+)px/.exec(q)![1])).toBeGreaterThanOrEqual(40);
    expect(Number(/height:\s*(\d+)px/.exec(q)![1])).toBeGreaterThanOrEqual(40);
  });

  it('таймкод date_stamp — мелкий моноширинный в правом верхнем углу картинки; REC — слева, ниже выреза', () => {
    const stamp = /\.vn-cap--date_stamp\s*\{([^}]*)\}/.exec(uiCss)![1]!;
    expect(stamp).toMatch(/right:/);
    expect(stamp).not.toMatch(/\bleft:/);
    expect(stamp).toMatch(/var\(--font-osd\)/); // индикация камеры осталась моноширинной
    expect(uiCss).toMatch(/--font-osd:\s*var\(--font-latin\)/);
    expect(uiCss).toMatch(/--font-latin:\s*'DM Mono'/);
    expect(uiCss).toMatch(/--font-cyr:\s*'JetBrains Mono'/);
    expect(uiCss).toMatch(/html\[lang='ru'\]\s*\{\s*--font-osd:\s*var\(--font-cyr\)/);
    expect(stageCss).toMatch(/var\(--font-osd, monospace\)/);
    expect(Number(/font:\s*400\s+clamp\((\d+)px/.exec(stamp)![1])).toBeLessThanOrEqual(12); // мелкий
    expect(stamp).toMatch(/env\(safe-area-inset-top\)/);
    expect(stageCss).toMatch(/--hud-top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/);
    expect(stageCss).toMatch(/\.vn-stage__hud\s*\{[^}]*left:\s*var\(--hud-left\)/);
  });

  it('safe-area: слой интерфейса, панель портрета, выборы и быстрое меню учитывают вырезы экрана', () => {
    expect(uiCss).toMatch(/padding:\s*0 max\(5%, env\(safe-area-inset-right\)\) max\(2\.2%, env\(safe-area-inset-bottom\)\) max\(5%, env\(safe-area-inset-left\)\)/);
    expect(uiCss).toMatch(/env\(safe-area-inset-top\)/);
    expect(uiCss).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(uiCss).toMatch(/env\(safe-area-inset-left\)/);
    expect(uiCss).toMatch(/env\(safe-area-inset-right\)/);
  });

  it('портрет: картинка сверху целиком (16:9 по ширине), текст под ней; HUD внутри сцены (а не в панели текста)', () => {
    expect(uiCss).toMatch(/@media \(orientation: portrait\)/);
    expect(uiCss).toMatch(/grid-template-rows:\s*minmax\(0,\s*min\(56%,\s*56\.25vw\)\)\s*minmax\(0,\s*1fr\)/);
    expect(uiCss).toMatch(/\.vn-main > \.vn-ui\s*\{\s*grid-area:\s*2 \/ 1/);
    expect(stageCss).toMatch(/\.vn-stage__hud/);
  });
});
