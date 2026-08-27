import type { Palette } from "./types";

// 焦点书切换只写入书架 hero 自己的背景容器；应用外壳与其他页面保持中性令牌。
export function applyPalette(palette: Palette, target: HTMLElement | null): void {
  if (!target) return;
  target.style.setProperty("--shelf-paper", palette.paper);
  target.style.setProperty("--shelf-paper-deep", palette.paperDeep);
  target.style.setProperty("--shelf-paper-pale", palette.paperPale);
}
