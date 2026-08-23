import * as THREE from "three";
import type { ShelfBook } from "../types";

export const COVER_TEXTURE_WIDTH = 768;
export const COVER_TEXTURE_HEIGHT = 1152;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`封面加载失败：${url}`));
    image.src = url;
  });
}

// 封面图 → 768×1152 画布，叠左右边缘明暗渐变（对齐参考实现 makeCoverTexture 的 edgeShade），
// 让平面贴图产生书页装帧的立体暗示
export function drawCoverCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_TEXTURE_WIDTH;
  canvas.height = COVER_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D 画布");
  ctx.drawImage(image, 0, 0, COVER_TEXTURE_WIDTH, COVER_TEXTURE_HEIGHT);
  const edgeShade = ctx.createLinearGradient(0, 0, COVER_TEXTURE_WIDTH, 0);
  edgeShade.addColorStop(0, "rgba(0,0,0,0.16)");
  edgeShade.addColorStop(0.055, "rgba(255,255,255,0.015)");
  edgeShade.addColorStop(0.93, "rgba(255,255,255,0)");
  edgeShade.addColorStop(1, "rgba(0,0,0,0.1)");
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, COVER_TEXTURE_WIDTH, COVER_TEXTURE_HEIGHT);
  return canvas;
}

// 书脊 = 该书主色纯色 + 竖排书名（贴图窄长，独立画布）
export function drawSpineCanvas(book: ShelfBook): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = COVER_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D 画布");
  ctx.fillStyle = book.dominant;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(canvas.width * 0.3, 0, 2, canvas.height);

  const fontSize = Math.max(34, Math.min(64, Math.floor((canvas.height * 0.42) / book.title.length)));
  ctx.font = `600 ${fontSize}px "Noto Serif SC", "Songti SC", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = book.palette.paperPale;
  const startX = canvas.width / 2;
  let y = canvas.height * 0.30;
  for (const ch of book.title) {
    ctx.fillText(ch, startX, y);
    y += fontSize * 1.12;
  }

  ctx.fillStyle = book.palette.accent;
  ctx.fillRect(canvas.width * 0.28, canvas.height * 0.16, canvas.width * 0.44, 3);
  ctx.fillRect(canvas.width * 0.28, y + 10, canvas.width * 0.44, 3);
  return canvas;
}

// 程序化木纹：中性灰底 + 明暗年轮线（无外部图片）。
// 底色刻意中性——木质色调完全由材质 color（即焦点书 palette.shelf/shelfDark）驱动
export function makeWoodCanvas(): HTMLCanvasElement {
  const width = 512;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D 画布");
  ctx.fillStyle = "#8f8f8f";
  ctx.fillRect(0, 0, width, height);
  let seed = 20260823;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let line = 0; line < 160; line += 1) {
    const y = random() * height;
    const light = random() > 0.5;
    ctx.strokeStyle = light ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.18)";
    ctx.lineWidth = 0.6 + random() * 1.6;
    ctx.beginPath();
    const amplitude = 1.5 + random() * 4;
    const wavelength = 40 + random() * 90;
    for (let x = 0; x <= width; x += 8) {
      const waveY = y + Math.sin((x / wavelength) * Math.PI * 2 + line) * amplitude;
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();
  }
  for (let knot = 0; knot < 3; knot += 1) {
    const cx = random() * width;
    const cy = random() * height;
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    for (let ring = 1; ring <= 4; ring += 1) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ring * 5, ring * 2.4, random() * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return canvas;
}

// 搁板接触阴影条带的 alpha 贴图（上浓下淡的横向软影）
export function makeContactShadowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2D 画布");
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 64);
  const fade = ctx.createLinearGradient(0, 0, 256, 0);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.12, "rgba(0,0,0,0)");
  fade.addColorStop(0.88, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 256, 64);
  return canvas;
}

export function configureCanvasTexture(texture: THREE.CanvasTexture, anisotropy: number): THREE.CanvasTexture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
