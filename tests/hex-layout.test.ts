import { describe, expect, it } from 'vitest';
import { hex, neighbors, toAxial } from '@/core/hex';
import {
  boardBounds,
  boundsSize,
  COLUMN_SPACING,
  HEX_HEIGHT,
  hexCorners,
  hexToWorld,
  roundHex,
  worldToHex,
} from '@/render/hex-layout';

describe('ヘクスと画面座標の対応', () => {
  it('原点のヘクスはワールド原点に乗る', () => {
    expect(hexToWorld(hex(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('列が1つ進むと幅の 3/4 だけ右へ、半ヘクス分だけ下へずれる（フラットトップ）', () => {
    const first = hexToWorld(toAxial({ col: 0, row: 0 }));
    const second = hexToWorld(toAxial({ col: 1, row: 0 }));
    expect(second.x - first.x).toBeCloseTo(COLUMN_SPACING);
    expect(second.y - first.y).toBeCloseTo(HEX_HEIGHT / 2);
  });

  it('同じ列で行が1つ進むと、ちょうど1ヘクス分だけ下へ動く', () => {
    const first = hexToWorld(toAxial({ col: 3, row: 4 }));
    const second = hexToWorld(toAxial({ col: 3, row: 5 }));
    expect(second.x - first.x).toBeCloseTo(0);
    expect(second.y - first.y).toBeCloseTo(HEX_HEIGHT);
  });

  it('中心のワールド座標からは必ず元のヘクスに戻る', () => {
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        expect(worldToHex(hexToWorld(hex(q, r))), `${q},${r}`).toEqual(hex(q, r));
      }
    }
  });

  it('中心から少しずれた点でも同じヘクスに丸められる', () => {
    const center = hexToWorld(hex(2, -1));
    const offsets: [number, number][] = [
      [0.3, 0],
      [-0.3, 0],
      [0, 0.4],
      [0, -0.4],
      [0.25, 0.25],
    ];
    for (const [dx, dy] of offsets) {
      expect(worldToHex({ x: center.x + dx, y: center.y + dy })).toEqual(hex(2, -1));
    }
  });

  it('隣のヘクスとの境界を越えるとその隣に切り替わる', () => {
    const origin = hex(0, 0);
    for (const target of neighbors(origin)) {
      const center = hexToWorld(target);
      // 中心の 85% まで寄れば、確実に隣のヘクス側に入る
      expect(worldToHex({ x: center.x * 0.85, y: center.y * 0.85 })).toEqual(target);
    }
  });

  it('丸めはキューブ座標の制約 q + r + s = 0 を保つ', () => {
    const rounded = roundHex(1.4, -0.8);
    expect(Number.isInteger(rounded.q)).toBe(true);
    expect(Number.isInteger(rounded.r)).toBe(true);
  });

  it('6頂点は等間隔で、外接円の半径が1になる', () => {
    const corners = hexCorners({ x: 0, y: 0 });
    expect(corners).toHaveLength(6);
    for (const corner of corners) {
      expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1);
    }
    // フラットトップなので左右に頂点が来る
    expect(corners[0]?.x).toBeCloseTo(1);
    expect(corners[0]?.y).toBeCloseTo(0);
    expect(corners[3]?.x).toBeCloseTo(-1);
    expect(corners[3]?.y).toBeCloseTo(0);
  });
});

describe('盤面の範囲', () => {
  it('すべてのヘクスが範囲の内側に収まる', () => {
    const width = 21;
    const height = 14;
    const bounds = boardBounds(width, height);
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) {
        const point = hexToWorld(toAxial({ col, row }));
        expect(point.x, `${col},${row}`).toBeGreaterThanOrEqual(bounds.minX);
        expect(point.x, `${col},${row}`).toBeLessThanOrEqual(bounds.maxX);
        expect(point.y, `${col},${row}`).toBeGreaterThanOrEqual(bounds.minY);
        expect(point.y, `${col},${row}`).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  });

  it('大きさは列数・行数に比例して増える', () => {
    const small = boundsSize(boardBounds(5, 5));
    const wide = boundsSize(boardBounds(10, 5));
    const tall = boundsSize(boardBounds(5, 10));
    expect(wide.width).toBeGreaterThan(small.width);
    expect(wide.height).toBeCloseTo(small.height);
    expect(tall.height).toBeGreaterThan(small.height);
    expect(tall.width).toBeCloseTo(small.width);
  });
});
