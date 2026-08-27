import type { MockBook } from "./data.js";

// 演示模式的 SVG 封面：768×1152（与前端封面画布同比例），底色 + 边缘渐变 + 竖排元素。
// 字体只用系统栈——SVG 作为 <img> 加载时不允许外部资源，系统字体仍然可用。
export function svgCover(book: MockBook): string {
  const width = 768;
  const height = 1152;
  const titleLines = wrapTitle(book.title);
  const titleSize = titleLines.length > 1 ? 104 : 128;
  const foil = "#d9a441";
  const authorBlockTop = height * 0.42 + titleLines.length * titleSize * 1.14;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.24"/>
      <stop offset="0.075" stop-color="#fff" stop-opacity="0.035"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.01"/>
      <stop offset="0.94" stop-color="#000" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.19"/>
    </linearGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.12"/>
      <stop offset="0.35" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.16"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${book.color}"/>
  <rect width="${width}" height="${height}" fill="url(#veil)"/>
  <circle cx="${width / 2}" cy="${height * 0.24}" r="118" fill="none" stroke="${foil}" stroke-opacity="0.5" stroke-width="3"/>
  <circle cx="${width / 2}" cy="${height * 0.24}" r="96" fill="${foil}" fill-opacity="0.08"/>
  <rect x="64" y="64" width="${width - 128}" height="${height - 128}" fill="none" stroke="${foil}" stroke-opacity="0.55" stroke-width="2.5"/>
  <rect x="80" y="80" width="${width - 160}" height="${height - 160}" fill="none" stroke="${foil}" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="${width / 2}" y="96" text-anchor="middle" fill="${foil}" fill-opacity="0.9"
    font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="26" letter-spacing="14">阅 读 副 驾</text>
  ${titleLines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${height * 0.46 + i * titleSize * 1.12}" text-anchor="middle" fill="#f3ece0"
    font-family="Noto Serif SC, Songti SC, SimSun, serif" font-weight="600" font-size="${titleSize}">${escapeXml(line)}</text>`
    )
    .join("\n  ")}
  <line x1="${width / 2 - 90}" y1="${authorBlockTop + 8}" x2="${width / 2 + 90}" y2="${authorBlockTop + 8}" stroke="${foil}" stroke-opacity="0.7" stroke-width="2"/>
  <text x="${width / 2}" y="${authorBlockTop + 76}" text-anchor="middle" fill="#e9e0d2" fill-opacity="0.92"
    font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="34">${escapeXml(book.author)}</text>
  <text x="${width / 2}" y="${height - 132}" text-anchor="middle" fill="#e9e0d2" fill-opacity="0.55"
    font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="24" letter-spacing="8">${escapeXml(book.category)} · 演示书目</text>
  <rect width="${width}" height="${height}" fill="url(#edge)"/>
</svg>`;
}

// 长书名按 6 字折行，避免标题超出封面宽度
function wrapTitle(title: string): string[] {
  if (title.length <= 6) return [title];
  const lines: string[] = [];
  for (let i = 0; i < title.length; i += 6) lines.push(title.slice(i, i + 6));
  return lines;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch
  );
}
