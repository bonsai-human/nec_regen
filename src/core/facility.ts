/**
 * 施設の占領・増援・修理（実装計画書 第4.6章）。
 *
 * 生産は存在せず、ユニットの供給源はマップ初期配置と施設の増援キューだけ。
 * したがって施設は「資源を生む場所」ではなく、**盤面の主導権そのもの**になる。
 */

import { DIRECTIONS, neighbors, type Hex } from './hex';
import { unitDef, type GameData } from './map';
import { canStandOn, unitAt } from './movement';
import {
  MAX_STRENGTH,
  type Facility,
  type FacilityKind,
  type FactionId,
  type GameState,
  type Unit,
  type UnitDef,
  type UnitId,
} from './types';

export function facilityAt(state: GameState, hex: Hex): Facility | undefined {
  return state.facilities.find((item) => item.hex.q === hex.q && item.hex.r === hex.r);
}

/**
 * 占領できない理由（できるなら null）。
 * 占領は歩兵系のみが、未占領または敵の施設ヘクスの上で実行できる（第4.6章）。
 */
export function captureBlockedReason(
  data: GameData,
  state: GameState,
  unitId: UnitId,
): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return `ユニットが見つかりません: ${unitId}`;

  const def = unitDef(data, unit.type);
  if (!def.canCapture) return `${def.name} は占領できません`;

  const facility = facilityAt(state, unit.hex);
  if (facility === undefined) return 'このヘクスに施設はありません';
  if (facility.owner === unit.owner) return 'すでに占領しています';
  return null;
}

/** その施設で修理を受けられるユニットか（工場＝地上、港＝海上、飛行場＝航空）。 */
export function repairsUnit(kind: FacilityKind, def: UnitDef): boolean {
  const movement = def.movementType;
  const isAir = movement === 'air' || def.armorClass === 'air';
  const isNaval = movement === 'ship' || movement === 'sub';

  switch (kind) {
    case 'factory':
    case 'hq':
      return !isAir && !isNaval;
    case 'port':
      return isNaval;
    case 'airfield':
      return isAir;
    default:
      return false;
  }
}

/** そのヘクスで修理を受けられるか。自軍が所有している施設であることが条件。 */
export function repairAvailableAt(
  data: GameData,
  state: GameState,
  unit: Unit,
  hex: Hex = unit.hex,
): boolean {
  const facility = facilityAt(state, hex);
  if (facility?.owner !== unit.owner) return false;
  return repairsUnit(facility.kind, unitDef(data, unit.type));
}

export interface SpawnResult {
  readonly state: GameState;
  readonly spawned: readonly { facility: Facility; unit: Unit }[];
}

/**
 * ターン開始時の増援（第4.6章）。
 *
 * - 出現位置は**決定的**に決める（隣接ヘクスを固定の方向順に走査し、最初の空きヘクス）
 * - **隣接がすべて塞がっていれば出現せず、キューはその場で待機する。**
 *   敵工場の出口を囲んで増援を止めるのが有効な戦術になる
 * - 出現したユニットは戦力10・熟練度0で、そのターンは行動済み
 */
export function spawnReinforcements(
  data: GameData,
  state: GameState,
  faction: FactionId,
): SpawnResult {
  const spawned: { facility: Facility; unit: Unit }[] = [];
  let nextUnitId = state.nextUnitId;
  let units = [...state.units];

  const facilities = state.facilities.map((facility) => {
    if (facility.owner !== faction) return facility;
    if (facility.queue.length === 0 || facility.nextSpawnTurn === null) return facility;
    if (state.turn < facility.nextSpawnTurn) return facility;

    const type = facility.queue[0];
    if (type === undefined) return facility;
    const def = data.units.get(type);
    if (def === undefined) return facility;

    const hex = findSpawnHex(data, { ...state, units }, facility.hex, def);
    // 出口が塞がっていれば、キューを消費せずに待つ
    if (hex === null) return facility;

    const unit: Unit = {
      id: nextUnitId,
      type,
      owner: faction,
      hex,
      strength: MAX_STRENGTH,
      exp: 0,
      hasMoved: true,
      hasActed: true,
      reloading: 0,
      cargo: [],
      carriedBy: null,
    };
    nextUnitId += 1;
    units = [...units, unit];

    const queue = facility.queue.slice(1);
    const updated: Facility = {
      ...facility,
      queue,
      nextSpawnTurn: queue.length > 0 ? state.turn + facility.interval : null,
    };
    spawned.push({ facility: updated, unit });
    return updated;
  });

  if (spawned.length === 0) return { state, spawned };
  return { state: { ...state, units, facilities, nextUnitId }, spawned };
}

/**
 * 出現できる最初の隣接ヘクス。`DIRECTIONS`（北から時計回り）の順に走査する。
 * この順序を変えると、既存のリプレイが再現しなくなる。
 */
function findSpawnHex(
  data: GameData,
  state: GameState,
  facilityHex: Hex,
  def: UnitDef,
): Hex | null {
  const around = neighbors(facilityHex);
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const hex = around[i];
    if (hex === undefined) continue;
    if (!canStandOn(data, def, hex)) continue;
    if (unitAt(state, hex) !== undefined) continue;
    return hex;
  }
  return null;
}

/** 各陣営が所有している施設の数。ターン制限時の判定に使う。 */
export function facilityCount(state: GameState, faction: FactionId): number {
  return state.facilities.filter((facility) => facility.owner === faction).length;
}
