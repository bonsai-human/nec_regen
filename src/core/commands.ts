/**
 * コマンド定義と検証（実装計画書 第3.2章）。
 *
 * すべてのプレイヤー操作・AI 操作を Command として表現し、単一の reducer で状態を更新する。
 * 乱数がないので「初期状態 + コマンド列」だけで局面が完全に再現でき、
 * アンドゥ・リプレイ・セーブ・AI の先読みがすべてこの一本の道から得られる。
 *
 * 攻撃・占領・積載は Phase 4 以降で追加する。
 */

import type { Hex } from './hex';
import { unitDef, type GameData } from './map';
import { validatePath } from './movement';
import type { GameState, UnitId } from './types';

export type Command =
  | { readonly type: 'move'; readonly unitId: UnitId; readonly path: readonly Hex[] }
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
