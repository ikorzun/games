import type { Plugin } from 'vite';

export const ASSET_EXTENSIONS: string[];
export const MIME: Record<string, string>;
export interface AssetFile {
  rel: string;
  abs: string;
  size: number;
}
export function collectAssets(dir: string): AssetFile[];
export function resolveAsset(dir: string, relUrl: string): string | null;
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable';
export function copyAssets(dir: string, outDir: string): { files: number; bytes: number };
export function assetsPlugin(options: { dir: string }): Plugin;

/** Имя файла индекса клипов озвучки в корне сборки. */
export const VOICE_INDEX_FILE: string;
export interface VoiceIndexJson {
  version: 1;
  /** Папка эпизода → язык → имена файлов клипов. */
  episodes: Record<string, Record<string, string[]>>;
}
/** Индекс клипов озвучки по <dir>/<папка>/voice/<язык>/*; skipped — аудио с именем не по соглашению. */
export function collectVoiceIndex(dir: string): { index: VoiceIndexJson; skipped: string[]; count: number };
