/**
 * 施設の占領・格納・搬出（実装計画書 第4.6章）。
 *
 * 生産は存在しない。**施設は生産設備ではなく格納庫**で、
 * 中に入っているユニットを出し入れできるだけ。出し切れば空になる。
 *
 * 修理はこの格納庫を経由する形で表す。
 *
 * ```
 * ターンN   : 自軍施設へ入り `store`（行動終了）。中で全快する
 * ターンN+1 : `deploy` で隣接ヘクスへ搬出（搬出したターンは行動終了）
 * ターンN+2 : ようやく動かせる
 * ```
 *
 * 回復量ではなく**この2ターンの往復そのもの**が修理のコストになる。
 * だから回復は段階的ではなく即時全快でよい（第4.6章の結論はこの経緯から出ている）。
 */

import { neighbors, type Hex } from './hex';
import { unitDef, type GameData } from './map';
import { canStandOn, unitAt } from './movement';
import {
  type Facility,
  type FacilityKind,
  type FactionId,
  type GameState,
  type StoredUnit,
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

/** その施設に格納できるユニットか（工場＝地上、港＝海上、飛行場＝航空）。 */
export function accepts(kind: FacilityKind, def: UnitDef): boolean {
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

/**
 * 格納できない理由（できるなら null）。
 * 自軍が所有していて、その施設が受け入れられる種別であることが条件。
 */
export function storeBlockedReason(
  data: GameData,
  state: GameState,
  unitId: UnitId,
): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return `ユニットが見つかりません: ${unitId}`;

  const facility = facilityAt(state, unit.hex);
  if (facility === undefined) return 'このヘクスに施設はありません';
  if (facility.owner !== unit.owner) return '自軍の施設にしか格納できません';

  const def = unitDef(data, unit.type);
  if (!accepts(facility.kind, def)) {
    return `${facilityName(facility.kind)}に ${def.name} は格納できません`;
  }
  // 積荷ごと格納されると中身の扱いが曖昧になるので、先に降ろさせる
  if (unit.cargo.length > 0) return '積荷を降ろしてから格納してください';
  return null;
}

/** 搬出できない理由（できるなら null）。 */
export function deployBlockedReason(
  data: GameData,
  state: GameState,
  facilityHex: Hex,
  storedId: UnitId,
  to: Hex,
): string | null {
  const facility = facilityAt(state, facilityHex);
  if (facility === undefined) return 'このヘクスに施設はありません';
  if (facility.owner !== state.activeFaction) return '自軍の施設ではありません';

  const stored = facility.garrison.find((item) => item.id === storedId);
  if (stored === undefined) return 'その施設にそのユニットは入っていません';
  // 格納した直後は行動済みなので、搬出できるのは次のターンから
  if (stored.hasActed) return 'このユニットはこのターンすでに動いています';

  const def = unitDef(data, stored.type);
  if (!isAdjacent(facilityHex, to)) return '搬出先は施設の隣でなければなりません';
  if (!canStandOn(data, def, to)) return `${def.name} はそのヘクスに出られません`;
  if (unitAt(state, to) !== undefined) return '搬出先が塞がっています';
  return null;
}

/**
 * 搬出できるヘクス。施設の隣接6ヘクスのうち、空いていて地形が許すもの。
 *
 * **隣接がすべて塞がっていれば1体も出せない**ので、
 * 敵施設の周囲を固めて中身を閉じ込めるのが有効な戦術になる（第4.6章）。
 */
export function deployableHexes(
  data: GameData,
  state: GameState,
  facilityHex: Hex,
  def: UnitDef,
): Hex[] {
  return neighbors(facilityHex).filter(
    (hex) => canStandOn(data, def, hex) && unitAt(state, hex) === undefined,
  );
}

function isAdjacent(from: Hex, to: Hex): boolean {
  return neighbors(from).some((hex) => hex.q === to.q && hex.r === to.r);
}

export function facilityName(kind: FacilityKind): string {
  switch (kind) {
    case 'factory':
      return '工場';
    case 'hq':
      return '司令部';
    case 'port':
      return '港';
    case 'airfield':
      return '飛行場';
    default:
      return kind;
  }
}

/** 施設の中身をひとまとめに扱うための入れ替え。 */
export function replaceFacility(
  facilities: readonly Facility[],
  hex: Hex,
  next: (facility: Facility) => Facility,
): Facility[] {
  return facilities.map((facility) =>
    facility.hex.q === hex.q && facility.hex.r === hex.r ? next(facility) : facility,
  );
}

/** ある陣営が搬出できる状態の格納ユニットを、施設ごとに列挙する。 */
export function readyGarrison(
  state: GameState,
  faction: FactionId,
): { facility: Facility; stored: StoredUnit }[] {
  const found: { facility: Facility; stored: StoredUnit }[] = [];
  for (const facility of state.facilities) {
    if (facility.owner !== faction) continue;
    for (const stored of facility.garrison) {
      if (!stored.hasActed) found.push({ facility, stored });
    }
  }
  return found;
}

/** 各陣営が所有している施設の数。ターン制限時の判定に使う。 */
export function facilityCount(state: GameState, faction: FactionId): number {
  return state.facilities.filter((facility) => facility.owner === faction).length;
}
