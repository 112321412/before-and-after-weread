import type { ShelfResponse, SyncPhase, SyncProgress } from "./types";

export const SYNC_STAGE_LABELS: Record<SyncPhase, string> = {
  notebooks: "整理书架目录",
  shelf: "同步书架快照",
  notes: "收集划线与想法",
  covers: "处理封面",
  readdata: "汇总阅读数据",
  baseline: "校准阅读速度",
  done: "同步完成",
  error: "同步失败"
};

const MOCK_SYNC_DONE: SyncProgress = { phase: "done", current: 1, total: 1, percent: 1 };

export function resolveShelfSync(shelf: Pick<ShelfResponse, "mode" | "sync">): SyncProgress | null {
  if (shelf.sync) {
    return { ...shelf.sync, percent: Math.min(1, Math.max(0, shelf.sync.percent)) };
  }
  return shelf.mode === "mock" ? MOCK_SYNC_DONE : null;
}

export function syncPercent(sync: SyncProgress | null): number {
  return Math.round(Math.min(1, Math.max(0, sync?.percent ?? 0)) * 100);
}

export function syncStageLabel(sync: SyncProgress | null): string {
  return sync ? SYNC_STAGE_LABELS[sync.phase] : "等待真实同步状态";
}

export function canBrowseShelf(sync: SyncProgress | null, booksLoaded: boolean, bookCount: number): boolean {
  return sync?.phase === "done" && booksLoaded && bookCount > 0;
}

export function canShowReadingData(
  sync: SyncProgress | null,
  booksLoaded: boolean,
  bookCount: number,
  statsLoaded: boolean
): boolean {
  return canBrowseShelf(sync, booksLoaded, bookCount) && statsLoaded;
}
