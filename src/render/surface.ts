/**
 * Canvas の実ピクセル解像度を CSS 上の表示サイズと devicePixelRatio に合わせて維持する層。
 *
 * 描画レイヤ（Phase 2 以降）はここが返す論理サイズ（CSS ピクセル）だけを見ればよく、
 * 高 DPI 端末の差異を意識しなくて済む。
 */

/** 論理サイズ（CSS ピクセル）。 */
export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

export interface SurfaceOptions {
  /** 端末の DPR。省略時は `globalThis.devicePixelRatio`。 */
  readonly devicePixelRatio?: number;
  /** バックバッファの上限倍率。高 DPI 端末での過大なバッファを防ぐ。 */
  readonly maxPixelRatio?: number;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;

/** DPR を 1〜maxPixelRatio に丸める。異常値（0・NaN・Infinity）は 1 として扱う。 */
export function clampPixelRatio(raw: number, max: number = DEFAULT_MAX_PIXEL_RATIO): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(Math.max(raw, 1), max);
}

/** 論理サイズと DPR からバックバッファのピクセル数を求める。 */
export function backingStoreSize(size: SurfaceSize, pixelRatio: number): SurfaceSize {
  return {
    width: Math.max(1, Math.round(size.width * pixelRatio)),
    height: Math.max(1, Math.round(size.height * pixelRatio)),
  };
}

export class CanvasSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly maxPixelRatio: number;
  private readonly explicitPixelRatio: number | undefined;
  private size: SurfaceSize = { width: 0, height: 0 };
  private pixelRatio = 1;

  constructor(canvas: HTMLCanvasElement, options: SurfaceOptions = {}) {
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('2D コンテキストを取得できませんでした。');
    }
    this.canvas = canvas;
    this.context = context;
    this.maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
    this.explicitPixelRatio = options.devicePixelRatio;
  }

  get ctx(): CanvasRenderingContext2D {
    return this.context;
  }

  /** 現在の論理サイズ（CSS ピクセル）。 */
  get logicalSize(): SurfaceSize {
    return this.size;
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /**
   * 論理サイズを指定してバックバッファを合わせる。
   * サイズにも DPR にも変化がなければ何もせず false を返す。
   */
  resize(size: SurfaceSize): boolean {
    const ratio = clampPixelRatio(
      this.explicitPixelRatio ?? globalThis.devicePixelRatio,
      this.maxPixelRatio,
    );
    const unchanged =
      this.size.width === size.width &&
      this.size.height === size.height &&
      this.pixelRatio === ratio;
    if (unchanged) return false;

    const backing = backingStoreSize(size, ratio);
    this.canvas.width = backing.width;
    this.canvas.height = backing.height;
    this.size = { width: size.width, height: size.height };
    this.pixelRatio = ratio;
    // 以降の描画は CSS ピクセル座標で書ける
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return true;
  }

  /** 論理サイズ全域を指定色で塗り潰す。 */
  clear(color: string): void {
    this.context.save();
    this.context.fillStyle = color;
    this.context.fillRect(0, 0, this.size.width, this.size.height);
    this.context.restore();
  }
}
