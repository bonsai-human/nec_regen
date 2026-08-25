/**
 * 盤面（タイル配列）の生成と参照（実装計画書 第5.3章）。
 *
 * 地形は本作では**変化しない**（橋の破壊などは見送り・第5.1.3章）ため、
 * 盤面は `GameState` とは別に、マップから作られる不変データとして持つ。
 * これにより `GameState` の JSON は軽く保たれ、セーブデータも小さくなる。
 */

import { toAxial, toOffset, type Hex, type Offset } from './hex';
import type { MapDef, RulesDef, TerrainDef, TerrainId, UnitDef, UnitTypeId } from './types';

/** odd-q オフセットの矩形盤面。 */
export interface Board {
  readonly width: number;
  readonly height: number;
  /** `row * width + col` で引く一次元配列。 */
  readonly tiles: readonly TerrainId[];
}

export function createBoard(map: MapDef): Board {
  const tiles: TerrainId[] = [];
  for (let row = 0; row < map.height; row++) {
    const line = map.tiles[row];
    if (line === undefined) {
      throw new Error(`マップ ${map.id}: ${row} 行目のタイルがありません。`);
    }
    for (let col = 0; col < map.width; col++) {
      const id = line[col];
      if (id === undefined) {
        throw new Error(`マップ ${map.id}: タイル (${col}, ${row}) がありません。`);
      }
      tiles.push(id);
    }
  }
  return { width: map.width, height: map.height, tiles };
}

/** オフセット座標が盤面の内側にあるか。 */
export function containsOffset(board: Board, o: Offset): boolean {
  return o.col >= 0 && o.col < board.width && o.row >= 0 && o.row < board.height;
}

/** 軸座標が盤面の内側にあるか。 */
export function contains(board: Board, h: Hex): boolean {
  return containsOffset(board, toOffset(h));
}

/** 盤外なら null を返す。呼び出し側で必ず境界を意識させるため、例外にはしない。 */
export function terrainIdAt(board: Board, h: Hex): TerrainId | null {
  const o = toOffset(h);
  if (!containsOffset(board, o)) return null;
  return board.tiles[o.row * board.width + o.col] ?? null;
}

/**
 * 盤上の全ヘクス。行→列の順（左上から右へ、次の行へ）で返す。
 * 走査順は決定的でなければならない（第1.1章）。
 */
export function allHexes(board: Board): Hex[] {
  const result: Hex[] = [];
  for (let row = 0; row < board.height; row++) {
    for (let col = 0; col < board.width; col++) {
      result.push(toAxial({ col, row }));
    }
  }
  return result;
}

/**
 * ルールを解決するために必要な静的データ一式。
 * `core` の各関数はこれと `GameState` を受け取って動く（DOM もファイル I/O も知らない）。
 */
export interface GameData {
  readonly board: Board;
  readonly map: MapDef;
  readonly units: ReadonlyMap<UnitTypeId, UnitDef>;
  readonly terrain: ReadonlyMap<TerrainId, TerrainDef>;
  /** 戦闘のテンポを決める定数（第4.4章）。 */
  readonly rules: RulesDef;
}

export function unitDef(data: GameData, type: UnitTypeId): UnitDef {
  const def = data.units.get(type);
  if (def === undefined) {
    throw new Error(`未定義のユニット種別です: ${type}`);
  }
  return def;
}

export function terrainDef(data: GameData, id: TerrainId): TerrainDef {
  const def = data.terrain.get(id);
  if (def === undefined) {
    throw new Error(`未定義の地形です: ${id}`);
  }
  return def;
}

/** 盤外を参照した場合は例外。移動・戦闘の計算は必ず盤内で行う。 */
export function terrainAt(data: GameData, h: Hex): TerrainDef {
  const id = terrainIdAt(data.board, h);
  if (id === null) {
    const o = toOffset(h);
    throw new Error(`盤外のヘクスを参照しました: (${o.col}, ${o.row})`);
  }
  return terrainDef(data, id);
}
