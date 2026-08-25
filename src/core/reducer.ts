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

import { validateCommand, type Command } from './commands';
import { forecastCombat, type CombatForecast } from './combat';
import { facilityAt, repairAvailableAt, spawnReinforcements } from './facility';
import type { Hex } from './hex';
import { unitDef, type GameData } from './map';
import { pathCost } from './movement';
import { nextSpawnTurnFor } from './state';
import {
  MAX_STRENGTH,
  type FacilityKind,
  type FactionId,
  type GameState,
  type Outcome,
  type Unit,
  type UnitId,
  type UnitTypeId,
} from './types';
import { evaluateVictory } from './victory';

export type GameEvent =
  | {
      readonly type: 'unitMoved';
      readonly unitId: UnitId;
      readonly from: Hex;
      readonly to: Hex;
      readonly path: readonly Hex[];
      readonly cost: number;
    }
  | {
      readonly type: 'unitsFought';
      readonly attackerId: UnitId;
      readonly defenderId: UnitId;
      readonly damageToDefender: number;
      readonly damageToAttacker: number;
    }
  | { readonly type: 'unitDestroyed'; readonly unitId: UnitId; readonly hex: Hex }
  | { readonly type: 'unitRepaired'; readonly unitId: UnitId; readonly hex: Hex }
  | {
      readonly type: 'facilityCaptured';
      readonly hex: Hex;
      readonly kind: FacilityKind;
      readonly owner: FactionId;
    }
  | {
      readonly type: 'reinforcementSpawned';
      readonly unitId: UnitId;
      readonly unitType: UnitTypeId;
      readonly hex: Hex;
    }
  | { readonly type: 'unitWaited'; readonly unitId: UnitId }
  | {
      readonly type: 'turnEnded';
      readonly faction: FactionId;
      readonly nextFaction: FactionId;
      readonly turn: number;
    }
  | { readonly type: 'gameEnded'; readonly outcome: Outcome };

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

  const result = apply(data, state, command);
  return withVictoryCheck(data, result);
}

function apply(data: GameData, state: GameState, command: Command): ReduceResult {
  switch (command.type) {
    case 'move':
      return applyMove(data, state, command.unitId, command.path);
    case 'attack':
      return applyAttack(data, state, command.unitId, command.targetId);
    case 'capture':
      return applyCapture(state, command.unitId);
    case 'wait':
      return applyWait(data, state, command.unitId);
    case 'endTurn':
      return applyEndTurn(data, state);
    default:
      throw new CommandError('未知のコマンドです');
  }
}

/** 決着したらその場で記録する。以降のコマンドはすべて拒否される。 */
function withVictoryCheck(data: GameData, result: ReduceResult): ReduceResult {
  if (result.state.outcome !== null) return result;
  const outcome = evaluateVictory(data, result.state);
  if (outcome === null) return result;
  return {
    state: { ...result.state, outcome },
    events: [...result.events, { type: 'gameEnded', outcome }],
  };
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
  const unit = requireUnit(state, unitId);
  const destination = path.at(-1) ?? unit.hex;
  const cost = pathCost(data, unitDef(data, unit.type), path);

  let moved: Unit = { ...unit, hex: destination, hasMoved: true };
  const events: GameEvent[] = [
    { type: 'unitMoved', unitId, from: unit.hex, to: destination, path: [...path], cost },
  ];

  // 自軍施設に入ると即時全快し、その時点で行動終了になる（第4.6章）
  if (moved.strength < MAX_STRENGTH && repairAvailableAt(data, state, moved, destination)) {
    moved = { ...moved, strength: MAX_STRENGTH, hasActed: true };
    events.push({ type: 'unitRepaired', unitId, hex: destination });
  }

  return { state: { ...state, units: replaceUnit(state.units, moved) }, events };
}

/**
 * 戦闘の適用（第4.4章）。
 *
 * 1. 戦闘前の状態から与ダメージと返しダメージを**両方先に**求める
 * 2. 計算が終わってから同時に適用する
 * 3. 戦力0のユニットを解決後にまとめて取り除く
 */
function applyAttack(
  data: GameData,
  state: GameState,
  attackerId: UnitId,
  defenderId: UnitId,
): ReduceResult {
  const attacker = requireUnit(state, attackerId);
  const defender = requireUnit(state, defenderId);
  const forecast: CombatForecast = forecastCombat(data, state, attackerId, defenderId);

  const defenderStrength = defender.strength - forecast.damageToDefender;
  const attackerStrength = attacker.strength - forecast.damageToAttacker;
  const defenderDestroyed = defenderStrength <= 0;

  const rules = data.rules;
  const attackerExp = attacker.exp + rules.expOnAttack + (defenderDestroyed ? rules.expOnKill : 0);
  const defenderExp = defender.exp + (forecast.damageToAttacker > 0 ? rules.expOnCounter : 0);

  const nextAttacker: Unit = {
    ...attacker,
    strength: attackerStrength,
    exp: attackerExp,
    hasMoved: true,
    hasActed: true,
    reloading: unitDef(data, attacker.type).reloadTurns,
  };
  const nextDefender: Unit = { ...defender, strength: defenderStrength, exp: defenderExp };

  const events: GameEvent[] = [
    {
      type: 'unitsFought',
      attackerId,
      defenderId,
      damageToDefender: forecast.damageToDefender,
      damageToAttacker: forecast.damageToAttacker,
    },
  ];
  if (defenderStrength <= 0) {
    events.push({ type: 'unitDestroyed', unitId: defenderId, hex: defender.hex });
  }
  if (attackerStrength <= 0) {
    events.push({ type: 'unitDestroyed', unitId: attackerId, hex: attacker.hex });
  }

  const units = state.units
    .map((unit) => {
      if (unit.id === attackerId) return nextAttacker;
      if (unit.id === defenderId) return nextDefender;
      return unit;
    })
    .filter((unit) => unit.strength > 0);

  return { state: { ...state, units }, events };
}

function applyCapture(state: GameState, unitId: UnitId): ReduceResult {
  const unit = requireUnit(state, unitId);
  const facility = facilityAt(state, unit.hex);
  if (facility === undefined) throw new CommandError('このヘクスに施設はありません');

  const captured = {
    ...facility,
    owner: unit.owner,
    // 占領した瞬間から増援の時計が動き出す
    nextSpawnTurn: nextSpawnTurnFor(
      unit.owner,
      facility.queue.length,
      facility.interval,
      state.turn,
    ),
  };

  const units = replaceUnit(state.units, { ...unit, hasMoved: true, hasActed: true });
  const facilities = state.facilities.map((item) => (item === facility ? captured : item));

  return {
    state: { ...state, units, facilities },
    events: [
      { type: 'facilityCaptured', hex: facility.hex, kind: facility.kind, owner: unit.owner },
    ],
  };
}

function applyWait(data: GameData, state: GameState, unitId: UnitId): ReduceResult {
  const unit = requireUnit(state, unitId);
  let waited: Unit = { ...unit, hasMoved: true, hasActed: true };
  const events: GameEvent[] = [{ type: 'unitWaited', unitId }];

  // その場で行動を終えた先が自軍施設なら修理を受ける
  if (waited.strength < MAX_STRENGTH && repairAvailableAt(data, state, waited)) {
    waited = { ...waited, strength: MAX_STRENGTH };
    events.push({ type: 'unitRepaired', unitId, hex: waited.hex });
  }

  return { state: { ...state, units: replaceUnit(state.units, waited) }, events };
}

/**
 * 手番を次の陣営へ渡す（第4.2章）。
 *
 * ターン開始フェーズはこの中で行う。
 * 1. 占領済み施設からの増援を出現させる
 * 2. 再装填中のユニットの状態を解除する
 * 3. 全ユニットの行動済みフラグをリセットする
 */
function applyEndTurn(data: GameData, state: GameState): ReduceResult {
  const index = state.factions.indexOf(state.activeFaction);
  const nextIndex = (index + 1) % state.factions.length;
  const nextFaction = state.factions[nextIndex];
  if (nextFaction === undefined) throw new CommandError('次の陣営が見つかりません');

  // 先頭の陣営に戻ったらターンが1つ進む
  const turn = nextIndex === 0 ? state.turn + 1 : state.turn;

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

  const events: GameEvent[] = [
    { type: 'turnEnded', faction: state.activeFaction, nextFaction, turn },
  ];

  const spawn = spawnReinforcements(
    data,
    { ...state, turn, activeFaction: nextFaction, units },
    nextFaction,
  );
  for (const entry of spawn.spawned) {
    events.push({
      type: 'reinforcementSpawned',
      unitId: entry.unit.id,
      unitType: entry.unit.type,
      hex: entry.unit.hex,
    });
  }

  return { state: spawn.state, events };
}

function requireUnit(state: GameState, unitId: UnitId): Unit {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) throw new CommandError(`ユニットが見つかりません: ${unitId}`);
  return unit;
}

function replaceUnit(units: readonly Unit[], next: Unit): Unit[] {
  return units.map((unit) => (unit.id === next.id ? next : unit));
}
