/**
 * 状態更新（実装計画書 第3.2章）。
 *
 * ```
 * reduce(state, command) => { state, events }
 * ```
 *
 * `events` は描画・アニメーション・効果音のトリガに使い、core は描画を知らない。
 * **同じ状態に同じコマンドを流せば、必ず同じ結果になる**（第6章 決定性の要件）。
 * 状態は常に新しいオブジェクトとして作り、元の状態は書き換えない。
 * これによりアンドゥがスナップショットの差し替えだけで済む。
 *
 * 計画書の署名は `reduce(state, command)` だが、実装では静的データ（盤面・
 * ユニット定義）を第1引数で受け取る。`GameData` はマップごとに不変なので、
 * 「同じマップなら state と command だけで結果が決まる」という性質は変わらない。
 */

import type { Hex } from './hex';
import { unitDef, type GameData } from './map';
import { pathCost } from './movement';
import { validateCommand, type Command } from './commands';
import { nextSpawnTurnFor } from './state';
import type { FactionId, GameState, Unit, UnitId } from './types';

export type GameEvent =
  | {
      readonly type: 'unitMoved';
      readonly unitId: UnitId;
      readonly from: Hex;
      readonly to: Hex;
      readonly path: readonly Hex[];
      readonly cost: number;
    }
  | { readonly type: 'unitWaited'; readonly unitId: UnitId }
  | {
      readonly type: 'turnEnded';
      readonly faction: FactionId;
      readonly nextFaction: FactionId;
      readonly turn: number;
    };

export interface ReduceResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** コマンドが実行できないときに投げる。UI は事前に `validateCommand` で弾く。 */
export class CommandError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CommandError';
  }
}

export function reduce(data: GameData, state: GameState, command: Command): ReduceResult {
  const error = validateCommand(data, state, command);
  if (error !== null) throw new CommandError(error);

  switch (command.type) {
    case 'move':
      return applyMove(data, state, command.unitId, command.path);
    case 'wait':
      return applyWait(state, command.unitId);
    case 'endTurn':
      return applyEndTurn(state);
    default:
      throw new CommandError('未知のコマンドです');
  }
}

/** コマンド列をまとめて流す。リプレイとシナリオテストで使う。 */
export function reduceAll(
  data: GameData,
  state: GameState,
  commands: readonly Command[],
): ReduceResult {
  let current = state;
  const events: GameEvent[] = [];
  for (const command of commands) {
    const result = reduce(data, current, command);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

function applyMove(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  path: readonly Hex[],
): ReduceResult {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) throw new CommandError(`ユニットが見つかりません: ${unitId}`);

  const destination = path.at(-1) ?? unit.hex;
  const cost = pathCost(data, unitDef(data, unit.type), path);

  const moved: Unit = { ...unit, hex: destination, hasMoved: true };
  return {
    state: { ...state, units: replaceUnit(state.units, moved) },
    events: [{ type: 'unitMoved', unitId, from: unit.hex, to: destination, path: [...path], cost }],
  };
}

function applyWait(state: GameState, unitId: UnitId): ReduceResult {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) throw new CommandError(`ユニットが見つかりません: ${unitId}`);

  const waited: Unit = { ...unit, hasMoved: true, hasActed: true };
  return {
    state: { ...state, units: replaceUnit(state.units, waited) },
    events: [{ type: 'unitWaited', unitId }],
  };
}

/**
 * 手番を次の陣営へ渡す（第4.2章）。
 *
 * ターン開始フェーズのうち、Phase 3 の範囲は「再装填の解除」と
 * 「行動済みフラグのリセット」まで。増援の出現は Phase 4 で足す。
 */
function applyEndTurn(state: GameState): ReduceResult {
  const index = state.factions.indexOf(state.activeFaction);
  const nextIndex = (index + 1) % state.factions.length;
  const nextFaction = state.factions[nextIndex];
  if (nextFaction === undefined) throw new CommandError('次の陣営が見つかりません');

  // 先頭の陣営に戻ったらターンが1つ進む
  const wrapped = nextIndex === 0;
  const turn = wrapped ? state.turn + 1 : state.turn;

  const units = state.units.map((unit) =>
    unit.owner === nextFaction
      ? {
          ...unit,
          hasMoved: false,
          hasActed: false,
          reloading: Math.max(0, unit.reloading - 1),
        }
      : unit,
  );

  const facilities = state.facilities.map((facility) =>
    facility.nextSpawnTurn === null && facility.owner !== null
      ? {
          ...facility,
          nextSpawnTurn: nextSpawnTurnFor(
            facility.owner,
            facility.queue.length,
            facility.interval,
            turn,
          ),
        }
      : facility,
  );

  return {
    state: { ...state, turn, activeFaction: nextFaction, units, facilities },
    events: [{ type: 'turnEnded', faction: state.activeFaction, nextFaction, turn }],
  };
}

function replaceUnit(units: readonly Unit[], next: Unit): Unit[] {
  return units.map((unit) => (unit.id === next.id ? next : unit));
}
