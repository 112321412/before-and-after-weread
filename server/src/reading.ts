export interface ReadingProgressLike {
  progress: number;
  readingTime?: number;
  recordReadingTime?: number;
  finishTime?: number;
}

export function isFinishedReading(book: Pick<ReadingProgressLike, "progress" | "finishTime">): boolean {
  return Boolean(book.finishTime) || book.progress === 100;
}

export function readingSeconds(book: Pick<ReadingProgressLike, "readingTime" | "recordReadingTime">): number {
  return book.readingTime ?? book.recordReadingTime ?? 0;
}

export function resolveWordCount(infoWordCount: number | undefined, chapterWordCounts: (number | undefined)[]): number {
  if (infoWordCount !== undefined && infoWordCount > 0) return infoWordCount;
  return chapterWordCounts.reduce((sum: number, wordCount) => sum + (wordCount ?? 0), 0);
}
