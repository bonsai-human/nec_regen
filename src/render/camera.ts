/**
 * カメラ（実装計画書 第7.3章・第7.4章）。
 *
 * - ワールド座標（ヘクス外接円 = 1）と画面座標（CSS ピクセル）を相互変換する
 * - パン・ズームを扱い、盤面の外へ行き過ぎないように制限する
 * - **可視範囲のヘクスだけ**を返す。マップが大きくてもモバイルで描画量が増えない
 *
 * 画面の回転やリサイズでは**注視点を維持する**（第7.3章）ため、
 * 状態として持つのは「注視しているワールド座標」と「倍率」の2つだけにしてある。
 */

import { toAxial, type Hex, type Offset } from '@/core/hex';
import {
  boundsSize,
  COLUMN_SPACING,
  HEX_HEIGHT,
  hexToWorld,
  type Point,
  type WorldBounds,
} from './hex-layout';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * タップ対象を 44 CSS px 以上確保できる最小倍率（第7.3章）。
 * ヘクスの幅は倍率の2倍なので、22 で幅 44px になる。
 */
export const MIN_TAP_SCALE = 22;

/** 拡大の上限。これ以上寄っても情報が増えない。 */
export const MAX_SCALE = 72;

export interface CameraOptions {
  readonly bounds: WorldBounds;
  readonly viewport: Viewport;
}

export class Camera {
  private bounds: WorldBounds;
  private viewport: Viewport;
  private centerWorld: Point;
  private scaleValue: number;

  constructor(options: CameraOptions) {
    this.bounds = options.bounds;
    this.viewport = options.viewport;
    this.centerWorld = boundsCenter(options.bounds);
    this.scaleValue = this.initialScale();
    this.clamp();
  }

  /** 1 ワールド単位あたりの CSS ピクセル数。ヘクスの外接円半径そのもの。 */
  get scale(): number {
    return this.scaleValue;
  }

  get center(): Point {
    return this.centerWorld;
  }

  /** 盤面全体が収まる倍率。ズームの下限にもなる。 */
  get fitScale(): number {
    const size = boundsSize(this.bounds);
    if (size.width <= 0 || size.height <= 0) return MIN_TAP_SCALE;
    return Math.min(this.viewport.width / size.width, this.viewport.height / size.height);
  }

  get minScale(): number {
    return Math.min(this.fitScale, MIN_TAP_SCALE);
  }

  /**
   * 初期倍率は「マップ全体が入る」か「タップできる最小サイズ」の**大きい方**（第7.3章）。
   * 狭い画面では全体が入らなくなるが、押せない盤面よりは動かせる盤面を選ぶ。
   */
  initialScale(): number {
    return clamp(Math.max(this.fitScale, MIN_TAP_SCALE), this.minScale, MAX_SCALE);
  }

  /** 画面サイズが変わっても注視点は維持する。 */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.scaleValue = clamp(this.scaleValue, this.minScale, MAX_SCALE);
    this.clamp();
  }

  /** 盤面全体が見える位置と倍率へ戻す。 */
  fit(): void {
    this.scaleValue = clamp(this.fitScale, this.minScale, MAX_SCALE);
    this.centerWorld = boundsCenter(this.bounds);
    this.clamp();
  }

  worldToScreen(point: Point): Point {
    return {
      x: (point.x - this.centerWorld.x) * this.scaleValue + this.viewport.width / 2,
      y: (point.y - this.centerWorld.y) * this.scaleValue + this.viewport.height / 2,
    };
  }

  screenToWorld(point: Point): Point {
    return {
      x: (point.x - this.viewport.width / 2) / this.scaleValue + this.centerWorld.x,
      y: (point.y - this.viewport.height / 2) / this.scaleValue + this.centerWorld.y,
    };
  }

  hexToScreen(h: Hex): Point {
    return this.worldToScreen(hexToWorld(h));
  }

  /** 画面上の移動量ぶんだけ盤面を掴んで動かす（指の下の点がついてくる向き）。 */
  panByScreen(dx: number, dy: number): void {
    this.centerWorld = {
      x: this.centerWorld.x - dx / this.scaleValue,
      y: this.centerWorld.y - dy / this.scaleValue,
    };
    this.clamp();
  }

  /**
   * 倍率を factor 倍する。`anchor`（画面座標）を渡すと、
   * **その点の下にあるヘクスが動かない**ように中心を補正する。
   * ピンチとホイールで自然な感覚を出すために必要。
   */
  zoomBy(factor: number, anchor?: Point): void {
    this.applyScale(this.scaleValue * factor, anchor);
  }

  setScale(scale: number, anchor?: Point): void {
    this.applyScale(scale, anchor);
  }

  private applyScale(scale: number, anchor?: Point): void {
    const next = clamp(scale, this.minScale, MAX_SCALE);
    if (next === this.scaleValue) return;

    if (anchor === undefined) {
      this.scaleValue = next;
      this.clamp();
      return;
    }

    const before = this.screenToWorld(anchor);
    this.scaleValue = next;
    const after = this.screenToWorld(anchor);
    this.centerWorld = {
      x: this.centerWorld.x + (before.x - after.x),
      y: this.centerWorld.y + (before.y - after.y),
    };
    this.clamp();
  }

  /**
   * 盤面が画面より大きければ端が内側へ入り込まないように、
   * 小さければ中央に置くように、注視点を制限する。
   */
  private clamp(): void {
    const halfW = this.viewport.width / 2 / this.scaleValue;
    const halfH = this.viewport.height / 2 / this.scaleValue;
    const size = boundsSize(this.bounds);
    const center = boundsCenter(this.bounds);

    const x =
      size.width <= halfW * 2
        ? center.x
        : clamp(this.centerWorld.x, this.bounds.minX + halfW, this.bounds.maxX - halfW);
    const y =
      size.height <= halfH * 2
        ? center.y
        : clamp(this.centerWorld.y, this.bounds.minY + halfH, this.bounds.maxY - halfH);

    this.centerWorld = { x, y };
  }

  /**
   * 画面に映っている盤上のヘクスを、行→列の順で返す。
   * 盤の外は含まない。走査順は決定的。
   */
  visibleHexes(boardWidth: number, boardHeight: number): { offset: Offset; hex: Hex }[] {
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: this.viewport.width, y: this.viewport.height });

    // 端のヘクスが欠けないよう、1ヘクス分の余白を取ってから盤面に収める
    const minCol = Math.max(0, Math.floor(topLeft.x / COLUMN_SPACING) - 1);
    const maxCol = Math.min(boardWidth - 1, Math.ceil(bottomRight.x / COLUMN_SPACING) + 1);
    const minRowBase = Math.floor(topLeft.y / HEX_HEIGHT) - 1;
    const maxRowBase = Math.ceil(bottomRight.y / HEX_HEIGHT) + 1;

    const result: { offset: Offset; hex: Hex }[] = [];
    for (let row = Math.max(0, minRowBase); row <= Math.min(boardHeight - 1, maxRowBase); row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const offset: Offset = { col, row };
        result.push({ offset, hex: toAxial(offset) });
      }
    }
    return result;
  }
}

function boundsCenter(bounds: WorldBounds): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}
