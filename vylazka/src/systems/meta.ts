/**
 * Метаслой (партнёр 21.11, 19:09: «какие-то вещи должны открывать метаслой игры: записки на экран, фотографии, кусочки видео по
 * несколько секунд, обрывки чатов»; квиз — «Одна находка за сон»; реестр — Z-20, связки куратора «Обрывок — на экспонате» и
 * «Видео — с камеры героя»).
 *
 * Раз за сон — не в первом — в лимбо экспонат, на который посмотрели, «вспоминает» обрывок: пропущенный вызов, строки переписки,
 * записку, снимок или несколько секунд записи с нагрудной камеры самого игрока. Колода одна, в порядке истории больного сна
 * (design.md, §34): у него был жар; её положили в больницу; ночью звонили — он не взял трубку. Словами историю игрок до сих пор
 * не получал — только снимки на стенах; обрывки дают ей голос, но не объясняют её. Без счёта, полки и пустых ячеек: игрок не
 * знает, сколько их и какой по счёту (противоречие 375). Имени у неё нет — как лица на старых карточках, имя не сохранилось.
 *
 * Тексты — ключи локали `meta.*` (английский — первоисточник); картинки снимков — из колоды больного сна (world/papers.ts);
 * запись — кадры, снятые игрой в этом сне (app.ts, reel).
 */

export type FragmentKind = 'call' | 'chat' | 'note' | 'photo' | 'video';

/** Строка переписки: кто пишет (она или он сам), ключ текста, время; failed — его сообщение не ушло. */
export interface ChatLine {
  who: 'her' | 'me';
  key: string;
  at: string;
  failed?: boolean;
}

export interface Fragment {
  id: string;
  kind: FragmentKind;
  /** Сколько секунд держится на экране. */
  hold: number;
  /** chat: строки по порядку. */
  lines?: readonly ChatLine[];
  /** call: когда звонили (последний — последним). */
  calls?: readonly string[];
  /** note: ключ строки записки. */
  note?: string;
  /** photo: снимок колоды больного сна (world/papers.ts, DREAM_PRINTS) и какой его кусок — доли кадра x, y, w, h. */
  print?: string;
  crop?: readonly [number, number, number, number];
  /** video: какой миг этого сна — когда вспомнил или когда она показалась (нет кадров этого мига — берутся другого). */
  moment?: 'recall' | 'apparition';
}

/** Колода: 14 обрывков в порядке истории. Один за сон, начиная со второго. */
export const DECK: readonly Fragment[] = [
  { id: 'm01', kind: 'call', hold: 5, calls: ['02:14'] },
  {
    id: 'm02',
    kind: 'chat',
    hold: 7,
    lines: [
      { who: 'her', key: 'meta.m02.0', at: '21:40' },
      { who: 'her', key: 'meta.m02.1', at: '21:41' },
    ],
  },
  { id: 'm03', kind: 'photo', hold: 5, print: 'dream_phone', crop: [0, 0.18, 0.75, 0.8] },
  { id: 'm04', kind: 'note', hold: 6, note: 'meta.m04' },
  {
    id: 'm05',
    kind: 'chat',
    hold: 7,
    lines: [
      { who: 'me', key: 'meta.m05.0', at: '23:58' },
      { who: 'her', key: 'meta.m05.1', at: '00:03' },
    ],
  },
  { id: 'm06', kind: 'video', hold: 4, moment: 'recall' },
  { id: 'm07', kind: 'call', hold: 5, calls: ['02:14', '02:31', '03:05'] },
  { id: 'm08', kind: 'photo', hold: 5, print: 'dream_window', crop: [0.3, 0.12, 0.6, 0.6] },
  { id: 'm09', kind: 'chat', hold: 7, lines: [{ who: 'me', key: 'meta.m09.0', at: '06:51', failed: true }] },
  { id: 'm10', kind: 'note', hold: 5, note: 'meta.m10' },
  { id: 'm11', kind: 'photo', hold: 5, print: 'dream_clock', crop: [0.1, 0.22, 0.7, 0.7] },
  { id: 'm12', kind: 'video', hold: 4, moment: 'apparition' },
  { id: 'm13', kind: 'photo', hold: 5, print: 'dream_bed', crop: [0.08, 0.06, 0.84, 0.6] },
  { id: 'm14', kind: 'chat', hold: 7, lines: [{ who: 'her', key: 'meta.m14.0', at: 'now' }] },
];

/** Какие кадры записи есть в этом сне. */
export interface Reels {
  recall: boolean;
  apparition: boolean;
}

/**
 * Следующий обрывок: первый в колоде, которого игрок ещё не видел. Запись без кадров пропускается (не сгорает — придёт, когда
 * кадры будут): кадры снимает игра в этом сне, и в первые секунды после перезагрузки их может не быть. null — колода пройдена.
 */
export function nextFragment(seen: readonly string[], reels: Reels): Fragment | null {
  for (const f of DECK) {
    if (seen.includes(f.id)) continue;
    if (f.kind === 'video' && !reels.recall && !reels.apparition) continue;
    return f;
  }
  return null;
}

/** Обрывок позволен: не в первом сне (после первого сна successes = 1) и не на пробных уровнях. */
export function metaAllowed(successes: number, test: boolean): boolean {
  return !test && successes >= 2;
}

/** Все ключи локали, которые нужны колоде (для проверок). */
export function deckKeys(): string[] {
  const keys = new Set<string>(['meta.missed', 'meta.missed.n', 'meta.ward', 'meta.failed', 'meta.now', 'meta.rec']);
  for (const f of DECK) {
    for (const l of f.lines ?? []) keys.add(l.key);
    if (f.note) keys.add(f.note);
  }
  return [...keys];
}
