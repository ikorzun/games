/**
 * Строки вещей с каждым кругом короче (docs/vylazka/plan.md, §4, шаг 6; предложение из station.md:
 * «it says: locker.», потом «it says.»). Каждый круг места рассказывает одно и то же, а стёртость
 * оставляет от рассказа всё меньше (story.md, §7а). Укорачивается то, что вещь говорит (вспышка и
 * строка «вспомнил»), — а с ней и подсказка, где следующая вещь: на поздних кругах её ведёт память
 * о прошлых. Строка в списке заданий не укорачивается: по ней игра остаётся проходимой.
 *
 * Режется с конца: сначала целыми фразами, и только когда остаётся одна — по словам. Чистый TS.
 */

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Какая доля слов остаётся при стёртости wear: первые два круга — целиком, к последнему — четверть. */
export function wornShare(wear: number): number {
  return 1 - 0.75 * smooth(0.1, 0.85, wear);
}

const words = (s: string): string[] => s.trim().split(/\s+/).filter((w) => w.length > 0);

/** Знак паузы внутри фразы: на нём фразу можно оборвать, и она останется фразой. */
const PAUSE = /[,:;]$/;
const DASH = /^[—–-]$/;

/**
 * Строка, какой её помнят при стёртости wear. Слова уходят с конца; оборванная фраза обрывается на
 * последней паузе (запятая, двоеточие, тире), а если паузы в ней нет — уходит целиком. Так «in the
 * kitchen» держится дольше хвоста фразы, а строка не кончается на «the.».
 */
export function wornLine(text: string, wear: number): string {
  const all = words(text);
  const keep = Math.max(2, Math.ceil(all.length * wornShare(wear) - 1e-9));
  if (keep >= all.length) return text;
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).map(words);
  const out: string[] = [];
  let left = keep;
  for (const sw of sentences) {
    if (sw.length <= left) {
      out.push(sw.join(' '));
      left -= sw.length;
      continue;
    }
    // Оборванная фраза: ищем паузу среди оставшихся слов (или тире сразу за ними).
    let cut = -1;
    for (let i = Math.min(left, sw.length) - 1; i >= 0; i--) {
      if (PAUSE.test(sw[i]!) || (i + 1 < sw.length && DASH.test(sw[i + 1]!) && i + 1 >= left)) {
        cut = i + 1;
        break;
      }
      if (DASH.test(sw[i]!)) {
        cut = i;
        break;
      }
    }
    // Первая фраза без паузы режется просто по словам: от строки должно что-то остаться.
    if (cut <= 0 && out.length === 0) cut = left;
    if (cut > 0) out.push(`${sw.slice(0, cut).join(' ').replace(/[\s,:;—–-]+$/u, '')}.`);
    break;
  }
  return out.join(' ');
}
