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
import { facilityAt, replaceFacility } from './facility';
import type { Hex } from './hex';
import { unitDef, type GameData } from './map';
import { pathCost } from './movement';
import {
  MAX_STRENGTH,
  type FacilityKind,
  type FactionId,
  type GameState,
  type Outcome,
  type StoredUnit,
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
  | {
      readonly type: 'facilityCaptured';
      readonly hex: Hex;
      readonly kind: FacilityKind;
      readonly owner: FactionId;
      /** 中身ごと手に入れた場合の体数。 */
      readonly garrisonTaken: number;
    }
  | {
      readonly type: 'unitStored';
      readonly unitId: UnitId;
      readonly unitType: UnitTypeId;
      readonly hex: Hex;
      /** 格納と同時に回復した戦力。0 なら無傷のまま入った。 */
      readonly healed: number;
    }
  | {
      readonly type: 'unitDeployed';
      readonly unitId: UnitId;
      readonly unitType: UnitTypeId;
      readonly from: Hex;
      readonly to: Hex;
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
    case 'store':
      return applyStore(state, command.unitId);
    case 'deploy':
      return applyDeploy(state, command.facilityHex, command.storedId, command.to);
    case 'wait':
      return applyWait(state, command.unitId);
    case 'endTurn':
      return applyEndTurn(state);
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

  // 施設ヘクスに乗っただけでは回復しない。修理は `store` を経由する（第4.6章）
  const moved: Unit = { ...unit, hex: destination, hasMoved: true };
  const events: GameEvent[] = [
    { type: 'unitMoved', unitId, from: unit.hex, to: destination, path: [...path], cost },
  ];

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

/**
 * 占領（第4.6章）。
 *
 * 施設は攻撃できないので、中身が失われることはない。
 * そのかわり**占領されると中身ごと相手のものになる。**
 * 前線の施設に部隊を預けるのは、それ自体が賭けになる。
 *
 * 奪った中身はその場では出せない（`hasActed` を立てる）。搬出は次のターンから。
 */
function applyCapture(state: GameState, unitId: UnitId): ReduceResult {
  const unit = requireUnit(state, unitId);
  const facility = facilityAt(state, unit.hex);
  if (facility === undefined) throw new CommandError('このヘクスに施設はありません');

  const facilities = replaceFacility(state.facilities, facility.hex, (item) => ({
    ...item,
    owner: unit.owner,
    garrison: item.garrison.map((stored) => ({ ...stored, hasActed: true })),
  }));
  const units = replaceUnit(state.units, { ...unit, hasMoved: true, hasActed: true });

  return {
    state: { ...state, units, facilities },
    events: [
      {
        type: 'facilityCaptured',
        hex: facility.hex,
        kind: facility.kind,
        owner: unit.owner,
        garrisonTaken: facility.garrison.length,
      },
    ],
  };
}

/**
 * 格納（第4.6章）。
 *
 * 盤上から消えて施設の中に入り、その場で全快する。行動は終了する。
 * 熟練度は保持され、収容数に上限はない。
 */
function applyStore(state: GameState, unitId: UnitId): ReduceResult {
  const unit = requireUnit(state, unitId);
  const facility = facilityAt(state, unit.hex);
  if (facility === undefined) throw new CommandError('このヘクスに施設はありません');

  const stored: StoredUnit = {
    id: unit.id,
    type: unit.type,
    exp: unit.exp,
    // 格納したターンはもう動かせない。搬出できるのは次のターンから
    hasActed: true,
  };

  const facilities = replaceFacility(state.facilities, facility.hex, (item) => ({
    ...item,
    garrison: [...item.garrison, stored],
  }));
  const units = state.units.filter((item) => item.id !== unitId);

  return {
    state: { ...state, units, facilities },
    events: [
      {
        type: 'unitStored',
        unitId,
        unitType: unit.type,
        hex: facility.hex,
        healed: MAX_STRENGTH - unit.strength,
      },
    ],
  };
}

/**
 * 搬出（第4.6章）。
 *
 * 施設の隣接ヘクスへ全快の状態で出る。出したターンは行動終了なので、動かせるのは次のターン。
 * 隣接がすべて塞がっていれば1体も出せない。
 */
function applyDeploy(state: GameState, facilityHex: Hex, storedId: UnitId, to: Hex): ReduceResult {
  const facility = facilityAt(state, facilityHex);
  if (facility === undefined) throw new CommandError('このヘクスに施設はありません');
  const stored = facility.garrison.find((item) => item.id === storedId);
  if (stored === undefined) throw new CommandError('その施設にそのユニットは入っていません');

  const unit: Unit = {
    id: stored.id,
    type: stored.type,
    owner: facility.owner ?? state.activeFaction,
    hex: to,
    strength: MAX_STRENGTH,
    exp: stored.exp,
    hasMoved: true,
    hasActed: true,
    reloading: 0,
    cargo: [],
    carriedBy: null,
  };

  const facilities = replaceFacility(state.facilities, facilityHex, (item) => ({
    ...item,
    garrison: item.garrison.filter((entry) => entry.id !== storedId),
  }));

  return {
    state: { ...state, units: [...state.units, unit], facilities },
    events: [
      { type: 'unitDeployed', unitId: stored.id, unitType: stored.type, from: facilityHex, to },
    ],
  };
}

function applyWait(state: GameState, unitId: UnitId): ReduceResult {
  const unit = requireUnit(state, unitId);
  const waited: Unit = { ...unit, hasMoved: true, hasActed: true };
  return {
    state: { ...state, units: replaceUnit(state.units, waited) },
    events: [{ type: 'unitWaited', unitId }],
  };
}

/**
 * 手番を次の陣営へ渡す（第4.2章）。
 *
 * ターン開始フェーズはこの中で行う。
 * 1. 再装填中のユニットの状態を解除する
 * 2. 盤上のユニットの行動済みフラグをリセットする
 * 3. **自軍施設に格納されているユニットも**同じようにリセットする。
 *    これで、前のターンに格納したユニットが今ターンから搬出できるようになる
 *
 * 自動で出現する増援はない。中身は手番のプレイヤーが `deploy` で出す。
 */
function applyEndTurn(state: GameState): ReduceResult {
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

  const facilities = state.facilities.map((facility) =>
    facility.owner === nextFaction && facility.garrison.length > 0
      ? {
          ...facility,
          garrison: facility.garrison.map((stored) => ({ ...stored, hasActed: false })),
        }
      : facility,
  );

  const events: GameEvent[] = [
    { type: 'turnEnded', faction: state.activeFaction, nextFaction, turn },
  ];

  return {
    state: { ...state, turn, activeFaction: nextFaction, units, facilities },
    events,
  };
}

function requireUnit(state: GameState, unitId: UnitId): Unit {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) throw new CommandError(`ユニットが見つかりません: ${unitId}`);
  return unit;
}

function replaceUnit(units: readonly Unit[], next: Unit): Unit[] {
  return units.map((unit) => (unit.id === next.id ? next : unit));
}
