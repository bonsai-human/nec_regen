/**
 * コマンド定義と検証（実装計画書 第3.2章）。
 *
 * すべてのプレイヤー操作・AI 操作を Command として表現し、単一の reducer で状態を更新する。
 * 乱数がないので「初期状態 + コマンド列」だけで局面が完全に再現でき、
 * アンドゥ・リプレイ・セーブ・AI の先読みがすべてこの一本の道から得られる。
 *
 * 積載（load / unload）は Phase 9 で追加する。
 */

import { attackBlockedReason } from './combat';
import { captureBlockedReason, deployBlockedReason, storeBlockedReason } from './facility';
import type { Hex } from './hex';
import { unitDef, type GameData } from './map';
import { validatePath } from './movement';
import type { GameState, UnitId } from './types';

export type Command =
  | { readonly type: 'move'; readonly unitId: UnitId; readonly path: readonly Hex[] }
  | { readonly type: 'attack'; readonly unitId: UnitId; readonly targetId: UnitId }
  | { readonly type: 'capture'; readonly unitId: UnitId }
  /** 自軍施設の中へしまう。行動終了。中で全快する。 */
  | { readonly type: 'store'; readonly unitId: UnitId }
  /** 自軍施設の中から隣接ヘクスへ出す。出したターンは行動終了。 */
  | {
      readonly type: 'deploy';
      readonly facilityHex: Hex;
      readonly storedId: UnitId;
      readonly to: Hex;
    }
  | { readonly type: 'wait'; readonly unitId: UnitId }
  | { readonly type: 'endTurn' };

export type CommandType = Command['type'];

/**
 * コマンドが今の局面で実行できるかを調べる。
 * 実行できない理由をそのまま文字列で返す（UI にも AI にも同じ理由が見える）。
 */
export function validateCommand(data: GameData, state: GameState, command: Command): string | null {
  if (state.outcome !== null) return 'すでに決着しています';

  switch (command.type) {
    case 'move':
      return validateMove(data, state, command.unitId, command.path);
    case 'attack':
      return validateAttack(data, state, command.unitId, command.targetId);
    case 'capture':
      return validateCapture(data, state, command.unitId);
    case 'store':
      return validateStore(data, state, command.unitId);
    case 'deploy':
      return deployBlockedReason(data, state, command.facilityHex, command.storedId, command.to);
    case 'wait':
      return validateActor(state, command.unitId);
    case 'endTurn':
      return null;
    default:
      return '未知のコマンドです';
  }
}

/** 手番・所属・行動済みの確認。移動系と行動系で共通する門番。 */
function validateActor(state: GameState, unitId: UnitId): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return `ユニットが見つかりません: ${unitId}`;
  if (unit.owner !== state.activeFaction) return '相手のユニットは動かせません';
  if (unit.carriedBy !== null) return '積載中のユニットは行動できません';
  if (unit.reloading > 0) return '再装填中のため行動できません';
  if (unit.hasActed) return 'このユニットは行動を終えています';
  return null;
}

function validateMove(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  path: readonly Hex[],
): string | null {
  const actorError = validateActor(state, unitId);
  if (actorError !== null) return actorError;

  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return `ユニットが見つかりません: ${unitId}`;
  if (unit.hasMoved) return 'このユニットは移動を終えています';

  const def = unitDef(data, unit.type);
  if (def.movementType === null) return `${def.name} は自力では移動できません`;

  return validatePath(data, state, unitId, path);
}

function validateAttack(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  targetId: UnitId,
): string | null {
  const actorError = validateActor(state, unitId);
  if (actorError !== null) return actorError;

  const attacker = state.units.find((item) => item.id === unitId);
  const defender = state.units.find((item) => item.id === targetId);
  if (attacker === undefined) return `ユニットが見つかりません: ${unitId}`;
  if (defender === undefined) return `目標が見つかりません: ${targetId}`;

  // 間接砲は移動したターンには攻撃できない（第4.3章）
  const def = unitDef(data, attacker.type);
  if (def.indirect && attacker.hasMoved) {
    return `${def.name} は移動したターンには攻撃できません`;
  }

  return attackBlockedReason(data, attacker, defender);
}

function validateCapture(data: GameData, state: GameState, unitId: UnitId): string | null {
  const actorError = validateActor(state, unitId);
  if (actorError !== null) return actorError;
  return captureBlockedReason(data, state, unitId);
}

function validateStore(data: GameData, state: GameState, unitId: UnitId): string | null {
  const actorError = validateActor(state, unitId);
  if (actorError !== null) return actorError;
  return storeBlockedReason(data, state, unitId);
}
