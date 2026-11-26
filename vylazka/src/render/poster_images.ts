/**
 * Листы-картинки: плакаты гражданской обороны и план убежища (assets/posters/<id>.webp). Сборка кладёт
 * их отдельными файлами рядом с кодом; игра стартует, не дожидаясь их, и перерисовывает атлас
 * надписей, когда листы пришли. Какие листы нужны — world/signs.ts (SHEETS); откуда они взялись и как
 * их пересоздать — assets/posters/README.md.
 */
const FILES = import.meta.glob<string>('../../assets/posters/*.webp', { eager: true, query: '?url', import: 'default' });

/** Адрес файла по id листа. */
export const SHEET_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]),
);

/** Загрузить все листы. Лист, который не загрузился, просто останется пустым: игра от него не зависит. */
export async function loadSheets(): Promise<Record<string, HTMLImageElement>> {
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(
    Object.entries(SHEET_URLS).map(async ([id, url]) => {
      const img = new Image();
      img.decoding = 'async';
      // В песочнице iframe (так игру встраивают порталы) у страницы нет своего адреса, и картинка
      // с того же сервера считается чужой: нарисуешь её на canvas — он «испачкается», и видеокарта
      // откажется брать с него текстуру. Поэтому картинку просим так же, как браузер просит сам код
      // игры и шрифты, — с разрешением сервера (CORS); где запускается код, там оно уже есть.
      img.crossOrigin = 'anonymous';
      img.src = url;
      try {
        await img.decode();
        out[id] = img;
      } catch {
        console.warn(`[vylazka] лист «${id}» не загрузился`);
      }
    }),
  );
  return out;
}
