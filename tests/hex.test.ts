import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  distance,
  fromCube,
  hex,
  hexAdd,
  hexesInBand,
  hexesInRange,
  hexesInRing,
  hexEquals,
  hexKey,
  hexScale,
  hexSubtract,
  isAdjacent,
  neighbor,
  neighbors,
  offset,
  parseHexKey,
  toAxial,
  toCube,
  toOffset,
  type Direction,
  type Hex,
} from '@/core/hex';

describe('座標変換（odd-q オフセット ⇔ 軸座標）', () => {
  it('計画書の変換式どおりに変換する', () => {
    // q = col, r = row - (col - (col & 1)) / 2
    expect(toAxial(offset(0, 0))).toEqual(hex(0, 0));
    expect(toAxial(offset(1, 0))).toEqual(hex(1, 0));
    expect(toAxial(offset(2, 0))).toEqual(hex(2, -1));
    expect(toAxial(offset(3, 0))).toEqual(hex(3, -1));
    expect(toAxial(offset(4, 0))).toEqual(hex(4, -2));
    expect(toAxial(offset(0, 5))).toEqual(hex(0, 5));
    expect(toAxial(offset(5, 3))).toEqual(hex(5, 1));
  });

  it('負の列でも往復して元に戻る', () => {
    for (let col = -8; col <= 8; col++) {
      for (let row = -8; row <= 8; row++) {
        const o = offset(col, row);
        expect(toOffset(toAxial(o))).toEqual(o);
      }
    }
  });

  it('軸座標からも往復して元に戻る', () => {
    for (let q = -8; q <= 8; q++) {
      for (let r = -8; r <= 8; r++) {
        const h = hex(q, r);
        expect(toAxial(toOffset(h))).toEqual(h);
      }
    }
  });

  it('キューブ座標は x + y + z = 0 を満たす', () => {
    for (let q = -5; q <= 5; q++) {
      for (let r = -5; r <= 5; r++) {
        const c = toCube(hex(q, r));
        expect(c.x + c.y + c.z).toBe(0);
        expect(fromCube(c)).toEqual(hex(q, r));
      }
    }
  });
});

describe('近隣', () => {
  it('6方向を北から時計回りに返す', () => {
    expect([...DIRECTIONS]).toEqual(['N', 'NE', 'SE', 'S', 'SW', 'NW']);
    expect(neighbors(hex(0, 0))).toEqual([
      hex(0, -1),
      hex(1, -1),
      hex(1, 0),
      hex(0, 1),
      hex(-1, 1),
      hex(-1, 0),
    ]);
  });

  it('隣接ヘクスはすべて距離1', () => {
    for (const h of neighbors(hex(3, -2))) {
      expect(distance(hex(3, -2), h)).toBe(1);
      expect(isAdjacent(hex(3, -2), h)).toBe(true);
    }
  });

  it('オフセット座標で見ても隣接している（列のずれが正しい）', () => {
    // 偶数列 col=2 の北東はオフセットで (3, 行-1)、奇数列 col=3 の北東は (4, 同じ行)
    expect(toOffset(neighbor(toAxial(offset(2, 5)), 'NE'))).toEqual(offset(3, 4));
    expect(toOffset(neighbor(toAxial(offset(3, 5)), 'NE'))).toEqual(offset(4, 5));
    // 南北は列に関係なく行が ±1
    expect(toOffset(neighbor(toAxial(offset(2, 5)), 'N'))).toEqual(offset(2, 4));
    expect(toOffset(neighbor(toAxial(offset(3, 5)), 'S'))).toEqual(offset(3, 6));
  });

  it('反対方向へ進むと元に戻る', () => {
    const opposite: Record<Direction, Direction> = {
      N: 'S',
      NE: 'SW',
      SE: 'NW',
      S: 'N',
      SW: 'NE',
      NW: 'SE',
    };
    const origin = hex(-2, 4);
    for (const direction of DIRECTIONS) {
      expect(neighbor(neighbor(origin, direction), opposite[direction])).toEqual(origin);
    }
  });

  it('隣接判定は自分自身に対しては偽', () => {
    expect(isAdjacent(hex(1, 1), hex(1, 1))).toBe(false);
  });
});

describe('距離', () => {
  it('同一ヘクスは0', () => {
    expect(distance(hex(2, -3), hex(2, -3))).toBe(0);
  });

  it('直線上では歩数と一致する', () => {
    for (const direction of DIRECTIONS) {
      let current = hex(0, 0);
      for (let step = 1; step <= 5; step++) {
        current = neighbor(current, direction);
        expect(distance(hex(0, 0), current)).toBe(step);
      }
    }
  });

  it('対称であり、三角不等式を満たす', () => {
    const a = hex(0, 0);
    const b = hex(3, -1);
    const c = hex(-2, 4);
    expect(distance(a, b)).toBe(distance(b, a));
    expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
  });

  it('オフセット座標の見た目に釣られない（列のずれを正しく吸収する）', () => {
    // 同じ行の隣の列は隣接している
    expect(distance(toAxial(offset(4, 4)), toAxial(offset(5, 4)))).toBe(1);
    // 2列離れると同じ行でも距離2
    expect(distance(toAxial(offset(4, 4)), toAxial(offset(6, 4)))).toBe(2);
    // 斜めに離れた例
    expect(distance(toAxial(offset(0, 0)), toAxial(offset(4, 2)))).toBe(4);
  });
});

describe('範囲', () => {
  it('半径 n の範囲は 3n(n+1)+1 ヘクス', () => {
    for (let radius = 0; radius <= 5; radius++) {
      expect(hexesInRange(hex(0, 0), radius)).toHaveLength(3 * radius * (radius + 1) + 1);
    }
  });

  it('範囲内のヘクスはすべて距離が半径以下', () => {
    const center = hex(2, -1);
    for (const h of hexesInRange(center, 3)) {
      expect(distance(center, h)).toBeLessThanOrEqual(3);
    }
  });

  it('負の半径では空、半径0では中心のみ', () => {
    expect(hexesInRange(hex(1, 1), -1)).toEqual([]);
    expect(hexesInRange(hex(1, 1), 0)).toEqual([hex(1, 1)]);
  });

  it('リングは半径 n で 6n ヘクス（n=0 は中心のみ）', () => {
    expect(hexesInRing(hex(0, 0), 0)).toEqual([hex(0, 0)]);
    for (let radius = 1; radius <= 4; radius++) {
      const ring = hexesInRing(hex(1, 2), radius);
      expect(ring).toHaveLength(6 * radius);
      for (const h of ring) {
        expect(distance(hex(1, 2), h)).toBe(radius);
      }
    }
  });

  it('リング1は隣接6ヘクスと同じ集合', () => {
    const expected = new Set(neighbors(hex(0, 0)).map(hexKey));
    const actual = new Set(hexesInRing(hex(0, 0), 1).map(hexKey));
    expect(actual).toEqual(expected);
  });

  it('射程帯は min 未満を含まない（間接砲の最小射程）', () => {
    const center = hex(0, 0);
    const band = hexesInBand(center, 2, 4);
    for (const h of band) {
      const d = distance(center, h);
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(4);
    }
    // 2〜4 の帯は 半径4の範囲 から 半径1の範囲 を除いたもの
    expect(band).toHaveLength(3 * 4 * 5 + 1 - (3 * 1 * 2 + 1));
    expect(hexesInBand(center, 3, 2)).toEqual([]);
    expect(hexesInBand(center, 1, 1)).toHaveLength(6);
  });

  it('返す順序は決定的で、呼ぶたびに一致する', () => {
    const first = hexesInRange(hex(1, -1), 3).map(hexKey);
    const second = hexesInRange(hex(1, -1), 3).map(hexKey);
    expect(first).toEqual(second);
    // q 昇順 → r 昇順
    const sorted = [...first].sort((a, b) => {
      const x = parseHexKey(a);
      const y = parseHexKey(b);
      return x.q - y.q || x.r - y.r;
    });
    expect(first).toEqual(sorted);
  });
});

describe('ベクトル演算とキー', () => {
  it('加算・減算・スケール', () => {
    expect(hexAdd(hex(1, 2), hex(3, -4))).toEqual(hex(4, -2));
    expect(hexSubtract(hex(1, 2), hex(3, -4))).toEqual(hex(-2, 6));
    expect(hexScale(hex(2, -3), 3)).toEqual(hex(6, -9));
  });

  it('等価判定は値で行う', () => {
    expect(hexEquals(hex(1, 2), { q: 1, r: 2 })).toBe(true);
    expect(hexEquals(hex(1, 2), hex(2, 1))).toBe(false);
  });

  it('キーは往復でき、不正な文字列は例外になる', () => {
    const samples: Hex[] = [hex(0, 0), hex(-3, 7), hex(12, -5)];
    for (const h of samples) {
      expect(parseHexKey(hexKey(h))).toEqual(h);
    }
    expect(() => parseHexKey('1')).toThrow();
    expect(() => parseHexKey('1,2,3')).toThrow();
    expect(() => parseHexKey('a,b')).toThrow();
    expect(() => parseHexKey('1.5,2')).toThrow();
  });
});
