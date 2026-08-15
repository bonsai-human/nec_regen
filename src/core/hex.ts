/**
 * ヘクス座標系と幾何計算（実装計画書 第4.1章）。
 *
 * - 盤面は**フラットトップ**の六角形を、列ごとに縦へずらして並べる
 * - 保存形式は人間が読める **odd-q オフセット座標**（列 col・行 row）
 * - 内部計算はすべて**軸座標 (q, r)** で行い、距離はキューブ座標で求める
 *
 * ```
 * 軸座標への変換: q = col,  r = row - (col - (col & 1)) / 2
 * 距離:           (|dq| + |dq + dr| + |dr|) / 2
 * ```
 *
 * 本作は乱数を使わない（第1.1章）ため、複数ヘクスを返す関数は
 * **必ず決まった順序**で返す。増援の出現位置や AI の候補手の並びが
 * 実行のたびに変わってはならない。
 */

/** 軸座標。盤面のあらゆる内部計算はこの形で扱う。 */
export interface Hex {
  readonly q: number;
  readonly r: number;
}

/** odd-q オフセット座標。マップ JSON の保存形式。 */
export interface Offset {
  readonly col: number;
  readonly row: number;
}

/** 近隣6方向。フラットトップなので上下（N/S）が平ら、左右に頂点が来る。 */
export type Direction = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';

/**
 * 方向の走査順。**北から時計回り**に固定する。
 * 増援の出現位置（第4.6章「隣接ヘクスを固定の方向順に走査し、最初の空きヘクス」）は
 * この順序に依存するため、並べ替えてはならない。
 */
export const DIRECTIONS: readonly Direction[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

const DIRECTION_VECTORS: Readonly<Record<Direction, Hex>> = {
  N: { q: 0, r: -1 },
  NE: { q: 1, r: -1 },
  SE: { q: 1, r: 0 },
  S: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  NW: { q: -1, r: 0 },
};

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function offset(col: number, row: number): Offset {
  return { col, row };
}

/** odd-q オフセット座標 → 軸座標。 */
export function toAxial(o: Offset): Hex {
  return { q: o.col, r: o.row - (o.col - (o.col & 1)) / 2 };
}

/** 軸座標 → odd-q オフセット座標。 */
export function toOffset(h: Hex): Offset {
  return { col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 };
}

/** キューブ座標。距離計算のために使う。 */
export interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function toCube(h: Hex): Cube {
  return { x: h.q, y: -h.q - h.r, z: h.r };
}

export function fromCube(c: Cube): Hex {
  return { q: c.x, r: c.z };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Map / Set のキーに使う文字列表現。 */
export type HexKey = string;

export function hexKey(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: HexKey): Hex {
  const parts = key.split(',');
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (parts.length !== 2 || !Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`ヘクスキーの形式が不正です: ${key}`);
  }
  return { q, r };
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSubtract(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexScale(h: Hex, factor: number): Hex {
  return { q: h.q * factor, r: h.r * factor };
}

/** 指定方向の単位ベクトル。 */
export function directionVector(direction: Direction): Hex {
  return DIRECTION_VECTORS[direction];
}

/** 指定方向の隣接ヘクス。 */
export function neighbor(h: Hex, direction: Direction): Hex {
  return hexAdd(h, DIRECTION_VECTORS[direction]);
}

/** 隣接6ヘクス。`DIRECTIONS` と同じ並び（北から時計回り）で返す。 */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((direction) => neighbor(h, direction));
}

/** 2ヘクス間の距離（キューブ距離）。 */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** a と b が隣接しているか。 */
export function isAdjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

/**
 * 中心から距離 radius 以内のヘクス（中心を含む）。
 * 並びは q 昇順 → r 昇順に固定する。
 */
export function hexesInRange(center: Hex, radius: number): Hex[] {
  if (radius < 0) return [];
  const result: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) {
      result.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return result;
}

/**
 * 中心からちょうど距離 radius のヘクス（リング）。
 * 並びは `hexesInRange` と同じ規則に揃える。
 */
export function hexesInRing(center: Hex, radius: number): Hex[] {
  if (radius < 0) return [];
  if (radius === 0) return [{ q: center.q, r: center.r }];
  return hexesInRange(center, radius).filter((h) => distance(center, h) === radius);
}

/**
 * 射程帯（min 〜 max）に入るヘクス。間接砲の射程（例: 2〜4）をそのまま表す。
 * 射程 min より内側は「近すぎて撃てない」ため含めない。
 */
export function hexesInBand(center: Hex, min: number, max: number): Hex[] {
  if (max < min) return [];
  return hexesInRange(center, max).filter((h) => {
    const d = distance(center, h);
    return d >= min && d <= max;
  });
}
