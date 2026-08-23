import type { Palette } from "./types";

// 焦点书切换 → 10 键调色板批量写入 :root CSS 变量。
// 页面背景等使用这些变量的元素靠 CSS transition（720ms）完成渐变，这里不做 JS 补间。
export function applyPalette(palette: Palette): void {
  const root = document.documentElement.style;
  root.setProperty("--paper", palette.paper);
  root.setProperty("--paper-deep", palette.paperDeep);
  root.setProperty("--paper-pale", palette.paperPale);
  root.setProperty("--ink", palette.ink);
  root.setProperty("--ink-soft", palette.inkSoft);
  root.setProperty("--shelf", palette.shelf);
  root.setProperty("--shelf-dark", palette.shelfDark);
  root.setProperty("--light", palette.light);
  root.setProperty("--fill", palette.fill);
  root.setProperty("--accent", palette.accent);
  root.setProperty("--rule", `color-mix(in srgb, ${palette.ink} 24%, transparent)`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.paper);
}
