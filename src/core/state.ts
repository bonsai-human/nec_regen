/**
 * 初期状態の組み立て（実装計画書 第4.2章）。
 *
 * マップ定義は「盤面の設計図」であり、`GameState` は「いま盤上で起きていること」。
 * 両者を分けておくことで、`GameState` だけを JSON 化すればセーブになる（第3.2章）。
 */

import type { GameData } from './map';
import { type Facility, type FactionId, type GameState, type Unit, type UnitId } from './types';

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

  const facilities: Facility[] = data.map.facilities.map((facility) => ({
    hex: facility.hex,
    kind: facility.kind,
    owner: facility.owner,
    queue: facility.queue,
    interval: facility.interval,
    nextSpawnTurn: nextSpawnTurnFor(facility.owner, facility.queue.length, facility.interval, 1),
  }));

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
    nextUnitId: units.length + 1,
    outcome: null,
  };
}

/**
 * 次に増援が出るターン。所有者がいて、キューが残っていて、間隔が設定されているときだけ動く。
 * 敵味方を問わず参照できる値として持つ（第4.6章）。
 */
export function nextSpawnTurnFor(
  owner: FactionId | null,
  queueLength: number,
  interval: number,
  fromTurn: number,
): number | null {
  if (owner === null || queueLength === 0 || interval <= 0) return null;
  return fromTurn + interval;
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
