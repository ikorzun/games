/**
 * Псевдолокализация (docs/architecture/05-localization.md §3, 06 §8): строка становится длиннее
 * на ~35 % и получает диакритику, чтобы увидеть обрезания и переполнения до прихода реальных
 * переводов. Плейсхолдеры {name} сохраняются. Включается ?pseudo=1 (и в dev-сборке — i18n.setPseudo).
 */

const LATIN: Readonly<Record<string, string>> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ó', p: 'þ', q: 'ƣ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
};

function mapChar(ch: string): string {
  const lower = ch.toLowerCase();
  const m = LATIN[lower];
  if (m === undefined) return ch;
  return ch === lower ? m : m.toUpperCase();
}

export function pseudoloc(text: string): string {
  const mapped = text
    .split(/(\{[a-z_][a-z0-9_]*\})/gi)
    .map((part) => (/^\{.*\}$/.test(part) ? part : Array.from(part, mapChar).join('')))
    .join('');
  // Добавка — «слова» через пробел, чтобы строка переносилась как настоящий текст (без неразрывного хвоста).
  const extra = Math.ceil(Array.from(mapped).length * 0.35);
  const pad = Array.from({ length: Math.ceil(extra / 4) }, () => '~~~').join(' ');
  return `[!!! ${mapped} ${pad} !!!]`;
}
