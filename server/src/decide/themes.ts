import type { Quote, ThemeBlock } from "./types.js";

// P1 证据规范的主题归纳：候选主题（LLM 归纳或 fixture 标注）按
// max(2, ⌈15% × 抽样数⌉) 的支持数门槛验收，不足的降级为“个别提及”。
export interface RawReview {
  reviewId: string;
  content: string;
  star: number;
  isFinish: boolean;
  createTime: number;
}

export interface ThemeCandidate {
  theme: string;
  reviewIds: string[];
}

export function themeThreshold(sampleSize: number): number {
  return Math.max(2, Math.ceil(sampleSize * 0.15));
}

export function consolidateThemes(
  candidates: ThemeCandidate[],
  reviews: RawReview[],
  bandLabel: string
): { themes: ThemeBlock[]; singles: Quote[] } {
  const byId = new Map(reviews.map((review) => [review.reviewId, review]));
  const used = new Set<string>();
  const themes: ThemeBlock[] = [];
  const threshold = themeThreshold(reviews.length);

  for (const candidate of candidates) {
    const uniqueIds = [...new Set(candidate.reviewIds)].filter((id) => byId.has(id));
    if (uniqueIds.length < threshold) continue;
    const quotes: Quote[] = [];
    for (const id of uniqueIds) {
      const review = byId.get(id)!;
      used.add(id);
      quotes.push({
        text: review.content,
        star: review.star,
        isFinish: review.isFinish,
        // 差评档里“读完仍给差评”是最硬的信号
        highWeight: bandLabel === "差评" && review.isFinish && review.star <= 40
      });
    }
    themes.push({
      theme: candidate.theme,
      count: uniqueIds.length,
      total: reviews.length,
      display: `${reviews.length} 条抽样${bandLabel}中 ${uniqueIds.length} 条提及`,
      quotes: quotes.slice(0, 3)
    });
  }

  themes.sort((a, b) => b.count - a.count);
  const singles = reviews
    .filter((review) => !used.has(review.reviewId))
    .map((review) => ({
      text: review.content,
      star: review.star,
      isFinish: review.isFinish,
      highWeight: bandLabel === "差评" && review.isFinish && review.star <= 40
    }));
  return { themes, singles };
}

// 争议焦点：好评主题与差评主题谈论同一件事但结论相反（主题字符串有 ≥2 字公共子串）
export function findControversy(positive: ThemeBlock[], negative: ThemeBlock[]): string | null {
  for (const pos of positive) {
    for (const neg of negative) {
      const shared = longestCommonSubstring(pos.theme, neg.theme);
      if (shared.length >= 2) {
        return `好评与差评都在谈「${shared}」，但结论相反`;
      }
    }
  }
  return null;
}

function longestCommonSubstring(a: string, b: string): string {
  let best = "";
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 2; j <= a.length; j += 1) {
      const piece = a.slice(i, j);
      if (b.includes(piece) && piece.length > best.length) best = piece;
    }
  }
  return best;
}
