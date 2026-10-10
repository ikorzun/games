export const CORE_BUDGET_BYTES: number;
export const ARCHIVE_BUDGET_BYTES: number;
export const ASSETS_WARN_BYTES: number;
export interface DistStats {
  files: number;
  totalBytes: number;
  coreBytes: number;
  contentBytes: number;
  /** Игровые ассеты (assets/<папка>/…): графика и звук. */
  assetBytes: number;
  assetFiles: number;
}
export function checkDist(
  dir: string,
  opts?: { coreBudget?: number; archiveBudget?: number; assetsWarn?: number },
): { problems: string[]; warnings: string[]; stats: DistStats };
