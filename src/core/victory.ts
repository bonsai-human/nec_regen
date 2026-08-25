/**
 * 勝敗判定（実装計画書 第4.8章）。
 *
 * 有効にする条件はマップ JSON が指定する。
 *
 * 1. 敵ユニットの全滅
 * 2. 敵司令部の占領
 * 3. 規定ターン経過時点での判定（残存戦力・占領施設数で比較）
 */

import { facilityCount } from './facility';
import { unitDef, type GameData } from './map';
import type { FactionId, GameState, Outcome } from './types';
import { MAX_STRENGTH } from './types';

/** 陣営の残存戦力を、ユニットの戦力価値で重み付けして合計する。 */
export function remainingValue(data: GameData, state: GameState, faction: FactionId): number {
  return state.units
    .filter((unit) => unit.owner === faction)
    .reduce(
      (total, unit) => total + (unitDef(data, unit.type).value * unit.strength) / MAX_STRENGTH,
      0,
    );
}

/**
 * 決着していれば内容を返す。まだなら null。
 * 判定は決定的で、同じ盤面なら必ず同じ結果になる。
 */
export function evaluateVictory(data: GameData, state: GameState): Outcome | null {
  if (state.outcome !== null) return state.outcome;

  // 2. 司令部の占領。奪われた側の負けなので、全滅より先に見る
  if (state.victory.includes('hq')) {
    const fallen = state.factions.filter((faction) => hasLostHq(data, state, faction));
    if (fallen.length > 0) {
      const survivors = state.factions.filter((faction) => !fallen.includes(faction));
      return { winner: survivors.length === 1 ? (survivors[0] ?? null) : null, reason: 'hq' };
    }
  }

  // 1. 全滅
  if (state.victory.includes('annihilation')) {
    // 施設に格納しているユニットは撃破されたわけではない。
    // 出せる駒が残っている限り全滅ではない（第4.6章）
    const alive = state.factions.filter(
      (faction) =>
        state.units.some((unit) => unit.owner === faction) ||
        state.facilities.some(
          (facility) => facility.owner === faction && facility.garrison.length > 0,
        ),
    );
    if (alive.length === 1) return { winner: alive[0] ?? null, reason: 'annihilation' };
    if (alive.length === 0) return { winner: null, reason: 'draw' };
  }

  // 3. ターン制限。規定ターンを超えた時点で残存戦力と占領施設数を比べる
  if (state.turn > state.turnLimit) {
    return judgeByScore(data, state);
  }

  return null;
}

/** マップ定義で司令部を持っていた陣営が、それを奪われたか。 */
function hasLostHq(data: GameData, state: GameState, faction: FactionId): boolean {
  const owned = data.map.facilities.filter(
    (facility) => facility.kind === 'hq' && facility.owner === faction,
  );
  if (owned.length === 0) return false;
  return owned.every((initial) => {
    const current = state.facilities.find(
      (facility) => facility.hex.q === initial.hex.q && facility.hex.r === initial.hex.r,
    );
    return current !== undefined && current.owner !== faction;
  });
}

/**
 * ターン制限による判定。残存戦力を第1基準、占領施設数を第2基準にする。
 * どちらも並べば引き分け。
 */
function judgeByScore(data: GameData, state: GameState): Outcome {
  const scored = state.factions
    .map((faction) => ({
      faction,
      value: remainingValue(data, state, faction),
      facilities: facilityCount(state, faction),
    }))
    .sort(
      (a, b) =>
        b.value - a.value || b.facilities - a.facilities || a.faction.localeCompare(b.faction),
    );

  const first = scored[0];
  const second = scored[1];
  if (first === undefined) return { winner: null, reason: 'draw' };
  const tied = second?.value === first.value && second?.facilities === first.facilities;
  if (tied) return { winner: null, reason: 'draw' };
  return { winner: first.faction, reason: 'turnLimit' };
}
