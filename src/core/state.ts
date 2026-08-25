/**
 * 初期状態の組み立て（実装計画書 第4.2章）。
 *
 * マップ定義は「盤面の設計図」であり、`GameState` は「いま盤上で起きていること」。
 * 両者を分けておくことで、`GameState` だけを JSON 化すればセーブになる（第3.2章）。
 */

import type { GameData } from './map';
import { type Facility, type GameState, type StoredUnit, type Unit, type UnitId } from './types';

/** 最初の手番は `factions` の先頭。マップ JSON の並びが先手・後手を決める。 */
export function createInitialState(data: GameData): GameState {
  const units: Unit[] = data.map.units.map((placement, index) => ({
    id: index + 1,
    type: placement.type,
    owner: placement.owner,
    hex: placement.hex,
    strength: placement.strength,
    exp: 0,
    hasMoved: false,
    hasActed: false,
    reloading: 0,
    cargo: [],
    carriedBy: null,
  }));

  // 格納されているユニットにも盤上と同じ ID 空間から番号を振る。
  // 搬出して戻したときに「同じ部隊」として熟練度を引き継げるようにするため。
  let nextUnitId = units.length + 1;
  const facilities: Facility[] = data.map.facilities.map((facility) => {
    const garrison: StoredUnit[] = facility.garrison.map((type) => {
      const stored: StoredUnit = { id: nextUnitId, type, exp: 0, hasActed: false };
      nextUnitId += 1;
      return stored;
    });
    return { hex: facility.hex, kind: facility.kind, owner: facility.owner, garrison };
  });

  const first = data.map.factions[0];
  if (first === undefined) {
    throw new Error(`マップ ${data.map.id} に陣営が定義されていません。`);
  }

  return {
    mapId: data.map.id,
    turn: 1,
    factions: data.map.factions,
    activeFaction: first,
    turnLimit: data.map.turnLimit,
    victory: data.map.victory,
    units,
    facilities,
    nextUnitId,
    outcome: null,
  };
}

export function findUnit(state: GameState, id: UnitId): Unit | undefined {
  return state.units.find((unit) => unit.id === id);
}

export function requireUnit(state: GameState, id: UnitId): Unit {
  const unit = findUnit(state, id);
  if (unit === undefined) {
    throw new Error(`ユニットが見つかりません: ${id}`);
  }
  return unit;
}
