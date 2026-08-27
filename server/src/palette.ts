import sharp from "sharp";

// 10 键调色板，键名与语义对齐 complete-shelf-v2.html 中 BOOKS[].palette。
// 输入永远是“封面主色”（hex），输出与内容无关的纯函数——mock 的 SVG 底色与真实封面提取色走同一条路。
export interface Palette {
  paper: string; // 页面底色
  paperDeep: string; // 底色深一档（渐变、深部面板）
  paperPale: string; // 纸面浅色（高亮底、引文块）
  ink: string; // 主文字
  inkSoft: string; // 次级文字
  shelf: string; // 木质搁板主色
  shelfDark: string; // 搁板暗部
  light: string; // 主光源色
  fill: string; // 补光色
  accent: string; // 强调色（对齐产品琥珀 #D9A441 的暖金属调）
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const convert = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [convert(hue + 1 / 3), convert(hue), convert(hue - 1 / 3)];
}

export function hsl(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

// 色相按最短弧插值；直接线性插值会在 0°/360° 交界处绕远路
function mixHue(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function paletteFromDominant(hex: string): Palette {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  // 底色压到能承载文字的饱和度/亮度区间，过艳或过暗的封面都能得到可读背景
  const paperS = clamp(s, 0.16, 0.46);
  const paperL = clamp(l, 0.14, 0.68);
  const dark = paperL <= 0.52; // 底偏深 → 浅文字；底偏浅 → 深文字
  // 胡桃木、主光、琥珀强调都属于暖色锚点：只有书本身是暖色时才向其偏色，
  // 冷色书穿过色轮去混色会得到洋红木纹/黄绿金箔这类失真结果
  const warmFamily = h >= 330 || h <= 90;
  const shelfHue = warmFamily ? mixHue(24, h, 0.4) : 27;
  const lightHue = warmFamily ? mixHue(38, h, 0.25) : 38;
  const accentHue = warmFamily ? mixHue(39, h, 0.3) : 39;
  return {
    paper: hsl(h, paperS, paperL),
    paperDeep: hsl(h, paperS * 0.9, paperL - 0.055),
    paperPale: hsl(h, Math.min(s, 0.32), 0.9),
    ink: dark ? hsl(h, 0.14, 0.93) : hsl(h, 0.3, 0.13),
    inkSoft: dark ? hsl(h, 0.12, 0.68) : hsl(h, 0.22, 0.36),
    shelf: hsl(shelfHue, 0.45, 0.21),
    shelfDark: hsl(shelfHue, 0.48, 0.11),
    light: hsl(lightHue, 0.5, 0.84),
    fill: hsl(h, clamp(s, 0.22, 0.5), 0.68),
    accent: hsl(accentHue, 0.6, 0.56)
  };
}

// 无封面可用时的稳定回退色：按书名哈希落入预设的编辑部色环
const FALLBACK_COLORS = [16, 32, 96, 160, 208, 244, 276, 336].map((hue) => hsl(hue, 0.4, 0.3));

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function paletteFromTitle(title: string): Palette {
  return paletteFromDominant(FALLBACK_COLORS[hashSeed(title) % FALLBACK_COLORS.length]);
}

// 封面 buffer → 主色。sharp 解码（jpg/png/webp 通吃）并缩到 32×48，
// 然后做 4bit/通道直方图量化；权重向画面中心倾斜——封面边缘常有白边、腰封和深色框，
// 朴素取色会被它们带偏。
export async function dominantFromImage(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .resize(32, 48, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 3;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const nx = (x / info.width) * 2 - 1;
      const ny = (y / info.height) * 2 - 1;
      const weight = 1 - Math.min(1, Math.hypot(nx, ny)) * 0.6;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      bin.weight += weight;
      bin.r += r * weight;
      bin.g += g * weight;
      bin.b += b * weight;
      bins.set(key, bin);
    }
  }
  let best = { weight: 0, r: 0, g: 0, b: 0 };
  for (const bin of bins.values()) {
    if (bin.weight > best.weight) best = bin;
  }
  return rgbToHex(best.r / best.weight / 255, best.g / best.weight / 255, best.b / best.weight / 255);
}
