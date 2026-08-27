import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Palette, ShelfBook } from "../types";
import {
  configureCanvasTexture,
  drawCoverCanvas,
  drawSpineCanvas,
  loadImage,
  makeContactShadowCanvas,
  makeWoodCanvas
} from "./textures";

const SPACING = 1.5; // 书与书的横向间距（世界单位）
const VISIBLE_WINDOW = 8; // 只实例化焦点 ±8 本，滑出窗口即回收（大书架虚拟化）
const TEXTURE_CACHE_LIMIT = 40; // 封面纹理 LRU 上限
const WHEEL_IDLE_SECONDS = 0.14; // 滚轮停止 0.14s 后吸附到整数位（对齐参考实现）
const SHELF_TOP = 0.47; // 搁板顶面高度

const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const mod = (value: number, length: number) => ((value % length) + length) % length;

/** 书架背景取封面主色，但压低饱和度并混入中性底色，避免主题色接管应用外壳。 */
export function restrainedHeroColor(value: string): THREE.Color {
  const color = new THREE.Color(value);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, Math.min(hsl.s, 0.48), clamp(hsl.l, 0.26, 0.68));
  return color.lerp(new THREE.Color("#1f2430"), 0.55);
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface BookTextures {
  cover: THREE.CanvasTexture;
  spine: THREE.CanvasTexture;
}

interface Rig {
  root: THREE.Group;
  mesh: THREE.Mesh<RoundedBoxGeometry, THREE.Material[]>;
  spineMaterial: THREE.MeshPhysicalMaterial;
  coverMaterial: THREE.MeshBasicMaterial;
  backMaterial: THREE.MeshPhysicalMaterial;
  bookIndex: number;
  height: number;
  opacity: number;
}

export interface ShelfSceneOptions {
  books: ShelfBook[];
  onFocus: (index: number) => void;
  onActivate: (index: number) => void;
}

export class ShelfScene {
  private container: HTMLElement;
  private books: ShelfBook[];
  private onFocus: (index: number) => void;
  private onActivate: (index: number) => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private rafId = 0;
  private disposed = false;
  private inViewport = true;

  private rigs = new Map<number, Rig>();
  private rigPool: Rig[] = [];
  private geometry: RoundedBoxGeometry;
  private pageMaterial: THREE.MeshPhysicalMaterial;
  private shelfMaterial: THREE.MeshStandardMaterial;
  private shelfDarkMaterial: THREE.MeshStandardMaterial;
  private anisotropy: number;

  private textureCache = new Map<string, BookTextures>(); // 插入序即 LRU 序
  private pendingTextures = new Set<string>();

  private position = 0;
  private targetPosition = 0;
  private selectedIndex = 0;
  private wheelIdle = 0;

  private dragging = false;
  private dragMoved = false;
  private dragLastX = 0;
  private dragVelocity = 0;
  private pointerNdc = new THREE.Vector2(0, 0);
  private raycaster = new THREE.Raycaster();

  private theme = {
    background: new THREE.Color()
  };
  private themeMoving = false;

  private sceneBackground: THREE.Color;
  private contactShadowMaterial!: THREE.MeshBasicMaterial;
  private shelfMeshes: THREE.Mesh[] = [];
  private lights: {
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  };
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;

  constructor(container: HTMLElement, options: ShelfSceneOptions) {
    this.container = container;
    this.books = options.books;
    this.onFocus = options.onFocus;
    this.onActivate = options.onActivate;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "shelf-canvas";
    container.appendChild(this.renderer.domElement);

    this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    this.camera.position.set(0, 2.05, 8.4);
    this.camera.lookAt(0, 1.55, 0);

    this.sceneBackground = restrainedHeroColor(this.books[0].palette.paper);
    this.scene.background = this.sceneBackground;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.lights = this.addLights();
    this.geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.045);
    this.pageMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe7dfcf,
      roughness: 0.95,
      metalness: 0,
      sheen: 0.025,
      sheenRoughness: 1
    });
    const { shelfMaterial, shelfDarkMaterial } = this.addShelf();
    this.shelfMaterial = shelfMaterial;
    this.shelfDarkMaterial = shelfDarkMaterial;

    this.applyTheme(this.books[0].palette, true);
    this.ensureTextures(0);
    this.prefetchNeighbors(0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inViewport = entries[0]?.isIntersecting ?? true;
    });
    this.intersectionObserver.observe(container);
    this.resize();
    this.bindEvents();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private lastTime = 0;

  // ---- 场景搭建 ----

  private addLights() {
    const hemi = new THREE.HemisphereLight(0xfff8e8, 0x5b4030, 0.55);
    const key = new THREE.DirectionalLight(0xffe8c2, 1.5);
    key.position.set(-4.6, 7.4, 5.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -1.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 24;
    key.shadow.bias = -0.0006;
    const fill = new THREE.DirectionalLight(0xd8e3e7, 0.45);
    fill.position.set(5.2, 3.4, 4.2);
    const rim = new THREE.DirectionalLight(0xd5a45e, 0.7);
    rim.position.set(0, 5, -6);
    this.scene.add(hemi, key, fill, rim);
    return { hemi, key, fill, rim };
  }

  private addShelf() {
    const woodTexture = new THREE.CanvasTexture(makeWoodCanvas());
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    woodTexture.wrapS = THREE.RepeatWrapping;
    woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(7, 1.65);
    woodTexture.center.set(0.5, 0.5);
    woodTexture.rotation = Math.PI * 0.5;
    woodTexture.anisotropy = this.anisotropy;

    const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2b1d, map: woodTexture, roughness: 0.58 });
    const shelfDarkMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a170f,
      map: woodTexture.clone(),
      roughness: 0.72
    });

    const boardGeometry = new THREE.BoxGeometry(1, 1, 1);
    const addBoard = (
      material: THREE.Material,
      size: [number, number, number],
      position: [number, number, number]
    ) => {
      const mesh = new THREE.Mesh(boardGeometry, material);
      mesh.scale.set(...size);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.shelfMeshes.push(mesh);
      return mesh;
    };

    addBoard(shelfMaterial, [19, 0.28, 1.08], [0, 0.33, -0.03]);
    addBoard(shelfDarkMaterial, [19.05, 0.075, 1.14], [0, 0.205, 0.02]);
    addBoard(shelfMaterial, [19, 0.17, 0.2], [0, 0.68, -0.52]);
    addBoard(shelfDarkMaterial, [0.2, 3.8, 0.72], [-8.8, 2.05, -0.28]);
    addBoard(shelfDarkMaterial, [0.2, 3.8, 0.72], [8.8, 2.05, -0.28]);

    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 0.85),
      new THREE.MeshBasicMaterial({
        color: 0x2f1d13,
        alphaMap: new THREE.CanvasTexture(makeContactShadowCanvas()),
        transparent: true,
        opacity: 0.24,
        depthWrite: false
      })
    );
    contactShadow.rotation.x = -Math.PI * 0.5;
    contactShadow.position.set(0, SHELF_TOP + 0.002, 0.06);
    this.scene.add(contactShadow);
    this.contactShadowMaterial = contactShadow.material as THREE.MeshBasicMaterial;

    return { shelfMaterial, shelfDarkMaterial };
  }

  private buildRig(): Rig {
    const root = new THREE.Group();
    const spineMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x888888,
      roughness: 0.62,
      metalness: 0.02,
      transparent: true
    });
    // 封面纹理使用原图颜色，不受场景灯光或主题色染色；保留深度测试避免书体穿透。
    const coverMaterial = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      depthTest: true,
      depthWrite: true
    });
    const backMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x666666,
      roughness: 0.95,
      metalness: 0.02,
      transparent: true
    });
    // RoundedBoxGeometry 材质组顺序：+x 前口（书页）、-x 书脊、+y/-y 书顶书底、+z 封面、-z 封底
    const mesh = new THREE.Mesh(this.geometry, [
      this.pageMaterial,
      spineMaterial,
      this.pageMaterial,
      this.pageMaterial,
      coverMaterial,
      backMaterial
    ]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    this.scene.add(root);
    return { root, mesh, spineMaterial, coverMaterial, backMaterial, bookIndex: -1, height: 1.5, opacity: 0 };
  }

  // ---- 书目虚拟化 ----

  private wrappedOffset(index: number): number {
    const count = this.books.length;
    let offset = index - this.position;
    offset -= Math.round(offset / count) * count;
    return offset;
  }

  // 书体物理尺寸的宽窄高矮差异由服务端下发的 sizeSeed 决定，3D 层零内容硬编码
  private bookDimensions(book: ShelfBook): { width: number; height: number; depth: number } {
    const seed = book.sizeSeed;
    return {
      width: 0.94 + ((seed >>> 4) % 100) / 100 * 0.2,
      height: 1.4 + ((seed >>> 12) % 100) / 100 * 0.22,
      depth: 0.23 + ((seed >>> 20) % 100) / 100 * 0.07
    };
  }

  private syncRigs(): void {
    const count = this.books.length;
    for (let index = 0; index < count; index += 1) {
      const offset = this.wrappedOffset(index);
      const has = this.rigs.has(index);
      if (!has && Math.abs(offset) <= VISIBLE_WINDOW) {
        const rig = this.rigPool.pop() ?? this.buildRig();
        this.attachBook(rig, index);
        this.rigs.set(index, rig);
        this.ensureTextures(index);
      } else if (has && Math.abs(offset) > VISIBLE_WINDOW + 1) {
        const rig = this.rigs.get(index)!;
        this.rigs.delete(index);
        rig.root.visible = false;
        this.rigPool.push(rig);
      }
    }
  }

  private attachBook(rig: Rig, index: number): void {
    const book = this.books[index];
    const { width, height, depth } = this.bookDimensions(book);
    rig.bookIndex = index;
    rig.height = height;
    rig.root.visible = true;
    rig.mesh.scale.set(width, height, depth);
    const dominant = new THREE.Color(book.dominant);
    rig.spineMaterial.color.copy(dominant).multiplyScalar(0.9);
    rig.backMaterial.color.copy(dominant).multiplyScalar(0.55);
    rig.opacity = 0;
    const textures = this.textureCache.get(book.bookId);
    rig.coverMaterial.color.set(textures ? 0xffffff : dominant);
    if (textures) {
      this.textureCache.delete(book.bookId);
      this.textureCache.set(book.bookId, textures); // 刷新 LRU 序
      rig.coverMaterial.map = textures.cover;
      rig.spineMaterial.map = textures.spine;
    } else {
      rig.coverMaterial.map = null;
      rig.spineMaterial.map = null;
    }
    rig.coverMaterial.needsUpdate = true;
    rig.spineMaterial.needsUpdate = true;
  }

  // ---- 封面纹理 LRU + 预取 ----

  private ensureTextures(index: number): void {
    const book = this.books[index];
    if (this.textureCache.has(book.bookId)) {
      const textures = this.textureCache.get(book.bookId)!;
      this.textureCache.delete(book.bookId);
      this.textureCache.set(book.bookId, textures);
      return;
    }
    if (this.pendingTextures.has(book.bookId)) return;
    this.pendingTextures.add(book.bookId);
    loadImage(book.cover)
      .then((image) => {
        if (this.disposed) return;
        const textures: BookTextures = {
          cover: configureCanvasTexture(new THREE.CanvasTexture(drawCoverCanvas(image)), this.anisotropy),
          spine: configureCanvasTexture(new THREE.CanvasTexture(drawSpineCanvas(book)), this.anisotropy)
        };
        this.pendingTextures.delete(book.bookId);
        this.textureCache.set(book.bookId, textures);
        this.evictTextures();
        const rig = this.rigs.get(index);
        if (rig && rig.bookIndex === index) {
          rig.coverMaterial.map = textures.cover;
          rig.coverMaterial.color.set(0xffffff);
          rig.spineMaterial.map = textures.spine;
          rig.coverMaterial.needsUpdate = true;
          rig.spineMaterial.needsUpdate = true;
        }
      })
      .catch(() => {
        this.pendingTextures.delete(book.bookId); // 加载失败保持主色占位，不影响书架可用
      });
  }

  private evictTextures(): void {
    while (this.textureCache.size > TEXTURE_CACHE_LIMIT) {
      let evicted = false;
      for (const bookId of this.textureCache.keys()) {
        const inUse = [...this.rigs.values()].some((rig) => this.books[rig.bookIndex]?.bookId === bookId);
        if (inUse) continue;
        const textures = this.textureCache.get(bookId)!;
        textures.cover.dispose();
        textures.spine.dispose();
        this.textureCache.delete(bookId);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  // 滚轮顺序移动的命中率最高：焦点相邻 2 本提前把封面纹理备好
  private prefetchNeighbors(index: number): void {
    const count = this.books.length;
    for (const delta of [-2, -1, 1, 2]) {
      this.ensureTextures(mod(index + delta, count));
    }
  }

  // ---- 主题（三维侧）：调色板 → 场景颜色目标，渲染循环内指数趋近 ----

  private applyTheme(palette: Palette, immediate = false): void {
    this.theme.background.copy(restrainedHeroColor(palette.paper));
    if (immediate) {
      this.sceneBackground.copy(this.theme.background);
      this.themeMoving = false;
    } else {
      this.themeMoving = true;
    }
  }

  private updateTheme(delta: number): void {
    if (!this.themeMoving) return;
    const amount = 1 - Math.exp(-delta * 5.5); // 与页面 720ms CSS 过渡同步的趋近速率
    this.sceneBackground.lerp(this.theme.background, amount);
    if (this.converged()) this.themeMoving = false;
  }

  private converged(): boolean {
    const gap = (a: THREE.Color, b: THREE.Color) =>
      (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
    const largest = gap(this.sceneBackground, this.theme.background);
    return largest < 0.0000025;
  }

  // ---- 姿态更新（对齐参考实现的位移/抬起/衰减公式）----

  private updateRigs(delta: number, elapsed: number): void {
    for (const [index, rig] of this.rigs) {
      const offset = this.wrappedOffset(index);
      const distance = Math.abs(offset);
      const focus = 1 - clamp(distance, 0, 1);
      const idle = Math.sin(elapsed * 0.72 + index * 0.8) * 0.012 * focus; // 居中书微幅呼吸
      const targetX = offset * SPACING;
      const targetY = SHELF_TOP + rig.height * 0.5 + focus * 0.15 + idle; // 焦点书抬起 0.15
      const targetZ = 0.13 + focus * 0.24 - Math.min(distance, 2.8) * 0.07;
      rig.root.position.x = damp(rig.root.position.x, targetX, 12, delta);
      rig.root.position.y = damp(rig.root.position.y, targetY, 12, delta);
      rig.root.position.z = damp(rig.root.position.z, targetZ, 12, delta);
      rig.root.rotation.y = damp(rig.root.rotation.y, -offset * 0.105, 12, delta);
      rig.root.rotation.z = damp(rig.root.rotation.z, -offset * 0.018, 12, delta);
      const scale = damp(rig.root.scale.x, 1 + focus * 0.09, 12, delta);
      rig.root.scale.setScalar(scale);

      const fadeProgress = clamp((distance - 2.55) / 0.7, 0, 1);
      const targetOpacity = 1 - smoothstep(fadeProgress);
      rig.opacity = damp(rig.opacity, targetOpacity, 18, delta);
      rig.spineMaterial.opacity = rig.opacity;
      rig.coverMaterial.opacity = rig.opacity;
      rig.backMaterial.opacity = rig.opacity;
      rig.root.visible = rig.opacity > 0.02;
    }
  }

  // ---- 交互 ----

  private bindEvents(): void {
    const element = this.renderer.domElement;
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("click", this.onClick);
    element.addEventListener("keydown", this.onKeyDown);
    element.tabIndex = 0;
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this.targetPosition += clamp(delta * 0.0022, -0.72, 0.72);
    this.wheelIdle = WHEEL_IDLE_SECONDS;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragging = true;
    this.dragMoved = false;
    this.dragLastX = event.clientX;
    this.dragVelocity = 0;
  };

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    if (!this.dragging) return;
    const dx = event.clientX - this.dragLastX;
    this.dragLastX = event.clientX;
    if (Math.abs(dx) > 0.5) this.dragVelocity = dx;
    if (Math.abs(dx) > 2) this.dragMoved = true;
    this.targetPosition -= dx * 0.006;
    this.wheelIdle = 0;
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    // 惯性甩动：按最后位移速度补一段距离，然后吸附
    this.targetPosition -= this.dragVelocity * 0.12;
    this.targetPosition = Math.round(this.targetPosition);
  };

  private onClick = (event: MouseEvent): void => {
    if (this.dragMoved) return; // 拖拽结束不触发点击
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.rigs.values()].filter((rig) => rig.root.visible).map((rig) => rig.mesh);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;
    const hitRig = [...this.rigs.entries()].find(([, rig]) => rig.mesh === hits[0].object);
    if (!hitRig) return;
    const index = hitRig[0];
    if (index === this.selectedIndex) {
      this.onActivate(index);
      return;
    }
    const count = this.books.length;
    let delta = mod(index, count) - mod(Math.round(this.targetPosition), count);
    if (delta > count / 2) delta -= count;
    if (delta < -count / 2) delta += count;
    this.targetPosition = Math.round(this.targetPosition) + delta;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowLeft") this.nudge(-1);
    if (event.key === "ArrowRight") this.nudge(1);
  };

  nudge(direction: number): void {
    this.targetPosition = Math.round(this.targetPosition) + direction;
  }

  // ---- 帧循环 ----

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.inViewport || delta <= 0) return;

    this.position = damp(this.position, this.targetPosition, 9.5, delta);
    if (Math.abs(this.position - this.targetPosition) < 0.0005) this.position = this.targetPosition;
    if (this.wheelIdle > 0) {
      this.wheelIdle -= delta;
      if (this.wheelIdle <= 0) this.targetPosition = Math.round(this.targetPosition);
    }

    const nearest = mod(Math.round(this.position), this.books.length);
    if (nearest !== this.selectedIndex) {
      this.selectedIndex = nearest;
      this.applyTheme(this.books[nearest].palette);
      this.prefetchNeighbors(nearest);
      this.onFocus(nearest);
    }

    this.syncRigs();
    this.updateRigs(delta, this.clock.getElapsedTime());
    this.updateTheme(delta);
    this.camera.position.x = damp(this.camera.position.x, this.pointerNdc.x * 0.42, 4, delta);
    this.camera.position.y = damp(this.camera.position.y, 2.05 + this.pointerNdc.y * 0.16, 4, delta);
    this.camera.lookAt(0, 1.55, 0);
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    const element = this.renderer.domElement;
    element.removeEventListener("wheel", this.onWheel);
    element.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    element.removeEventListener("click", this.onClick);
    element.removeEventListener("keydown", this.onKeyDown);
    for (const textures of this.textureCache.values()) {
      textures.cover.dispose();
      textures.spine.dispose();
    }
    this.textureCache.clear();
    for (const rig of [...this.rigs.values(), ...this.rigPool]) {
      rig.spineMaterial.dispose();
      rig.coverMaterial.dispose();
      rig.backMaterial.dispose();
    }
    this.geometry.dispose();
    this.pageMaterial.dispose();
    (this.scene.environment as THREE.Texture | null)?.dispose();
    this.shelfMeshes.forEach((mesh) => mesh.geometry.dispose());
    this.shelfMaterial.map?.dispose();
    this.shelfDarkMaterial.map?.dispose();
    this.shelfMaterial.dispose();
    this.shelfDarkMaterial.dispose();
    this.renderer.dispose();
    element.remove();
  }
}
