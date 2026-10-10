export const CORE_BUDGET_BYTES: number;
export const ARCHIVE_BUDGET_BYTES: number;
export interface DistStats {
  files: number;
  totalBytes: number;
  coreBytes: number;
  contentBytes: number;
}
export function checkDist(
  dir: string,
  opts?: { coreBudget?: number; archiveBudget?: number },
): { problems: string[]; stats: DistStats };
