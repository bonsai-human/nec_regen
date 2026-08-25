/**
 * ヘクスと画面座標の対応（実装計画書 第4.1章・第7.4章）。
 *
 * 盤面は**フラットトップ**（左右に頂点、上下が平ら）の六角形を、
 * 列ごとに縦へずらして並べる。ここでは外接円の半径を 1 とした
 * **ワールド座標**で計算し、実際のピクセル倍率はカメラが持つ。
 *
 * こうしておくと、ズーム倍率が変わってもこの層は一切変更しなくてよい。
 */

import { hex, type Hex } from '@/core/hex';

/** 外接円の半径を 1 としたときのヘクスの寸法。 */
export const HEX_WIDTH = 2;
export const HEX_HEIGHT = Math.sqrt(3);
/** 隣の列までの水平距離。フラットトップでは幅の 3/4。 */
export const COLUMN_SPACING = 1.5;
/** 同じ列の隣の行までの垂直距離。 */
export const ROW_SPACING = HEX_HEIGHT;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** ヘクスの中心のワールド座標。 */
export function hexToWorld(h: Hex): Point {
  return {
    x: COLUMN_SPACING * h.q,
    y: HEX_HEIGHT * (h.r + h.q / 2),
  };
}

/** ワールド座標が乗っているヘクス。 */
export function worldToHex(point: Point): Hex {
  const q = (2 / 3) * point.x;
  const r = (-1 / 3) * point.x + (Math.sqrt(3) / 3) * point.y;
  return roundHex(q, r);
}

/** 端数を含む軸座標を、最も近いヘクスに丸める（キューブ座標で丸めてから戻す）。 */
export function roundHex(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  // 最もずれの大きい軸を、他の2軸から導き直す
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  // Math.round(-0.2) は -0 を返す。-0 は 0 と Object.is で区別されてしまうため潰しておく
  return hex(normalizeZero(rq), normalizeZero(rr));
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** ヘクスの6頂点のワールド座標。フラットトップなので0°から60°刻み。 */
export function hexCorners(center: Point): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * 60 * i;
    corners.push({ x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) });
  }
  return corners;
}

/** 盤面全体を覆う矩形（ワールド座標）。カメラの移動範囲とズーム下限に使う。 */
export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boardBounds(width: number, height: number): WorldBounds {
  // odd-q の奇数列は半ヘクス分下へずれるため、その分を縦に足す
  const lastColumnShift = width > 1 ? HEX_HEIGHT / 2 : 0;
  return {
    minX: -HEX_WIDTH / 2,
    minY: -HEX_HEIGHT / 2,
    maxX: COLUMN_SPACING * (width - 1) + HEX_WIDTH / 2,
    maxY: ROW_SPACING * (height - 1) + lastColumnShift + HEX_HEIGHT / 2,
  };
}

export function boundsSize(bounds: WorldBounds): { width: number; height: number } {
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}
