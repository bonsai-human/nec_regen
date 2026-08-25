/**
 * AI v1 — 貪欲（実装計画書 第6章）。
 *
 * 各ユニットについて実行可能な行動を列挙し、単純なスコアで最良手を選ぶ。
 *
 * 1. 攻撃可能な敵がいれば、`与ダメージ − 想定反撃ダメージ` が最大の攻撃を選ぶ
 * 2. 占領可能な施設に乗れるなら占領
 * 3. 戦力が半分以下なら自軍施設へ後退して修理
 * 4. どれも無ければ、最も近い敵または未占領施設へ前進
 *
 * **決定性が最優先。** 候補は必ず明示的にソートしてから走査し、同点は
 * ユニットID・座標といった安定した基準で決める。`Map` の反復順に依存しない。
 */

import type { Command } from '@/core/commands';
import { attackableTargets, forecastCombat } from '@/core/combat';
import { captureBlockedReason, facilityAt, repairsUnit } from '@/core/facility';
import { distance, hexKey, type Hex } from '@/core/hex';
import { unitDef, type GameData } from '@/core/map';
import { reachableHexes, type ReachableHex } from '@/core/movement';
import { reduce } from '@/core/reducer';
import { MAX_STRENGTH, type FactionId, type GameState, type Unit } from '@/core/types';
import type { AiPlayer } from './types';

/** 後退して修理を考え始める戦力の割合。 */
const RETREAT_THRESHOLD = 0.5;

export class GreedyAi implements AiPlayer {
  readonly name = 'greedy-v1';

  planTurn(data: GameData, state: GameState, faction: FactionId): Command[] {
    const commands: Command[] = [];
    let current = state;

    // 誰から動かすかで結果が変わるため、ID 昇順に固定する
    const order = current.units
      .filter((unit) => unit.owner === faction)
      .map((unit) => unit.id)
      .sort((a, b) => a - b);

    for (const unitId of order) {
      if (current.outcome !== null) break;
      const unit = current.units.find((item) => item.id === unitId);
      if (unit === undefined || unit.hasActed || unit.carriedBy !== null) continue;

      for (const command of this.planUnit(data, current, unit)) {
        try {
          current = reduce(data, current, command).state;
          commands.push(command);
        } catch {
          // 想定外の局面では、その駒の行動をあきらめて次へ進む
          break;
        }
        if (current.outcome !== null) break;
      }
    }

    // 決着したらそこで終わり。決着後の endTurn は受け付けられない
    if (current.outcome === null) commands.push({ type: 'endTurn' });
    return commands;
  }

  /** 1ユニット分の行動計画。0〜2個のコマンドを返す。 */
  private planUnit(data: GameData, state: GameState, unit: Unit): Command[] {
    const attack = this.bestAttack(data, state, unit);
    if (attack !== null) return attack;

    const capture = this.bestCapture(data, state, unit);
    if (capture !== null) return capture;

    const retreat = this.bestRetreat(data, state, unit);
    if (retreat !== null) return retreat;

    return this.advance(data, state, unit);
  }

  /**
   * 「与ダメージ − 想定反撃ダメージ」が最大になる攻撃。
   * 移動してから殴れる場合も含めて数え上げる。
   */
  private bestAttack(data: GameData, state: GameState, unit: Unit): Command[] | null {
    const def = unitDef(data, unit.type);
    if (def.range === null) return null;

    interface Candidate {
      readonly score: number;
      readonly targetId: number;
      readonly path: readonly Hex[] | null;
      readonly destinationKey: string;
    }
    const candidates: Candidate[] = [];

    const evaluateFrom = (from: Hex, path: readonly Hex[] | null): void => {
      for (const target of attackableTargets(data, state, unit.id, from)) {
        const forecast = forecastCombat(data, state, unit.id, target.id, from);
        const targetDef = unitDef(data, target.type);
        // 撃破できる手は、その駒の価値ぶんだけ価値が高い
        const killBonus = forecast.defenderDestroyed ? targetDef.value / 100 : 0;
        const score = forecast.damageToDefender - forecast.damageToAttacker + killBonus;
        candidates.push({ score, targetId: target.id, path, destinationKey: hexKey(from) });
      }
    };

    evaluateFrom(unit.hex, null);

    // 間接砲は移動したターンには攻撃できない（第4.3章）
    if (!def.indirect && !unit.hasMoved) {
      for (const entry of sortedReachable(data, state, unit)) {
        if (hexKey(entry.hex) === hexKey(unit.hex)) continue;
        evaluateFrom(entry.hex, entry.path);
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.targetId - b.targetId ||
        a.destinationKey.localeCompare(b.destinationKey),
    );
    const best = candidates[0];
    // 返しの方が大きい攻撃はしない。撃破できる手は killBonus で必ず正になる
    if (best === undefined || best.score <= 0) return null;

    const commands: Command[] = [];
    if (best.path !== null) {
      commands.push({ type: 'move', unitId: unit.id, path: best.path });
    }
    commands.push({ type: 'attack', unitId: unit.id, targetId: best.targetId });
    return commands;
  }

  /** 占領できるならする。乗れる施設が射程内にあれば移動してから占領する。 */
  private bestCapture(data: GameData, state: GameState, unit: Unit): Command[] | null {
    const def = unitDef(data, unit.type);
    if (!def.canCapture) return null;

    if (captureBlockedReason(data, state, unit.id) === null) {
      return [{ type: 'capture', unitId: unit.id }];
    }
    if (unit.hasMoved) return null;

    for (const entry of sortedReachable(data, state, unit)) {
      if (!entry.canStop) continue;
      const facility = facilityAt(state, entry.hex);
      if (facility === undefined || facility.owner === unit.owner) continue;
      return [
        { type: 'move', unitId: unit.id, path: entry.path },
        { type: 'capture', unitId: unit.id },
      ];
    }
    return null;
  }

  /** 戦力が半分以下なら、修理できる自軍施設へ後退する。 */
  private bestRetreat(data: GameData, state: GameState, unit: Unit): Command[] | null {
    if (unit.strength > MAX_STRENGTH * RETREAT_THRESHOLD) return null;
    if (unit.hasMoved) return null;

    const def = unitDef(data, unit.type);
    for (const entry of sortedReachable(data, state, unit)) {
      if (!entry.canStop) continue;
      const facility = facilityAt(state, entry.hex);
      if (facility?.owner !== unit.owner) continue;
      if (!repairsUnit(facility.kind, def)) continue;
      return [{ type: 'move', unitId: unit.id, path: entry.path }];
    }
    return null;
  }

  /** 最も近い敵か未占領施設へ近づく。動けないなら待機する。 */
  private advance(data: GameData, state: GameState, unit: Unit): Command[] {
    if (unit.hasMoved) return [{ type: 'wait', unitId: unit.id }];

    const goals = this.goalsFor(data, state, unit);
    if (goals.length === 0) return [{ type: 'wait', unitId: unit.id }];

    const options = sortedReachable(data, state, unit).filter((entry) => entry.canStop);
    if (options.length === 0) return [{ type: 'wait', unitId: unit.id }];

    let best = options[0]!;
    let bestDistance = minDistance(best.hex, goals);
    for (const entry of options) {
      const value = minDistance(entry.hex, goals);
      // 同じ距離なら、消費移動力が少ない方（＝手前で止まる方）を選ぶ
      if (value < bestDistance || (value === bestDistance && entry.cost < best.cost)) {
        best = entry;
        bestDistance = value;
      }
    }

    if (hexKey(best.hex) === hexKey(unit.hex)) return [{ type: 'wait', unitId: unit.id }];
    return [{ type: 'move', unitId: unit.id, path: best.path }];
  }

  /** 前進の目標。敵ユニットと、自軍のものでない施設。 */
  private goalsFor(data: GameData, state: GameState, unit: Unit): Hex[] {
    const def = unitDef(data, unit.type);
    const goals: Hex[] = [];

    for (const other of state.units) {
      if (other.owner === unit.owner || other.carriedBy !== null) continue;
      goals.push(other.hex);
    }
    if (def.canCapture) {
      for (const facility of state.facilities) {
        if (facility.owner !== unit.owner) goals.push(facility.hex);
      }
    }
    return goals;
  }
}

/** 到達範囲を、走査順が固定された配列にして返す。 */
function sortedReachable(data: GameData, state: GameState, unit: Unit): ReachableHex[] {
  return [...reachableHexes(data, state, unit.id).values()].sort(
    (a, b) => a.cost - b.cost || a.hex.q - b.hex.q || a.hex.r - b.hex.r,
  );
}

function minDistance(hex: Hex, goals: readonly Hex[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const value = distance(hex, goal);
    if (value < best) best = value;
  }
  return best;
}
