/**
 * 戦闘計算（実装計画書 第4.4章）。
 *
 * ```
 * A = 基礎攻撃力 × 戦力比 × expMul + Σ（隣接する自軍の 基礎攻撃力 × 戦力比）× SUPPORT_RATE
 * D = DEF + Σ（隣接する自軍の DEF）× SUPPORT_RATE
 * ダメージ = A_攻撃側 ÷ ( D_防御側 × 地形効果 ) × DAMAGE_SCALE
 * ```
 *
 * 設計上の要点が3つある。
 *
 * 1. **防御は掛けずに割る。** 原作の「減衰率の加算」方式は合計 100% で無敵が成立したが、
 *    除数にすれば 0 には収束しない。さらに下限1のため、無敵の組み合わせは原理的にない
 * 2. **同時解決。** 与ダメージと返しダメージを戦闘前の状態から両方先に求めてから適用する。
 *    適用順序による差が生じないので、盤面から結果を完全に読める
 * 3. **支援は借りる側ではなく貸す側の強さで決まる。** 重装戦車を隣に置けば厚い盾になり、
 *    突撃戦車を隣に置けば鋭い矛になる
 */

import { distance, neighbors, type Hex } from './hex';
import { terrainIdAt, unitDef, type GameData } from './map';
import { canStandOn, unitAt } from './movement';
import { MAX_STRENGTH, type GameState, type Unit, type UnitDef, type UnitId } from './types';

/** 支援1件の内訳。UI の「誰がいくら足しているか」表示にそのまま使う（第7.5章）。 */
export interface SupportEntry {
  readonly unitId: UnitId;
  readonly amount: number;
}

/** 片側ぶんの戦闘力の内訳。 */
export interface CombatSide {
  readonly unitId: UnitId;
  /** 効果攻撃力 A。 */
  readonly attack: number;
  /** 効果防御力 D（地形効果は含まない）。 */
  readonly defense: number;
  /** 地形効果。航空ユニットは常に 1.0。 */
  readonly terrainDefense: number;
  readonly attackSupport: readonly SupportEntry[];
  readonly defenseSupport: readonly SupportEntry[];
  readonly encircled: boolean;
  /** 支援が無効化されているか（通信妨害車が隣接している）。 */
  readonly supportSuppressed: boolean;
  readonly expLevel: number;
}

/** 1回の戦闘の予測。UI にも AI にもこれをそのまま見せる。 */
export interface CombatForecast {
  readonly attacker: CombatSide;
  readonly defender: CombatSide;
  /** 防御側が受けるダメージ。 */
  readonly damageToDefender: number;
  /** 攻撃側が受ける返しダメージ。返しがなければ 0。 */
  readonly damageToAttacker: number;
  readonly counterPossible: boolean;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
}

/** 戦力比。残存戦力に比例して火力が落ちる。 */
export function strengthRatio(unit: Unit): number {
  return unit.strength / MAX_STRENGTH;
}

/** 経験値から熟練度レベルを求める。 */
export function expLevel(data: GameData, exp: number): number {
  let level = 0;
  for (const threshold of data.rules.expThresholds) {
    if (exp >= threshold) level += 1;
  }
  return level;
}

/** 熟練度の攻撃倍率。攻撃にのみ効き、防御には影響しない（第4.4章）。 */
export function expMultiplier(data: GameData, exp: number): number {
  return 1 + data.rules.expStep * expLevel(data, exp);
}

/**
 * 目標に対する基礎攻撃力。
 * **航空目標には `power.air` を直接使い、`matchup` はかからない**（第5.1.1章）。
 * 0 なら「そもそも攻撃できない組み合わせ」。
 */
export function baseAttack(attacker: UnitDef, target: UnitDef): number {
  if (target.armorClass === 'air') return attacker.power.air;
  return attacker.power.ground * attacker.matchup[target.armorClass];
}

/** 盤上にいる隣接ユニット。積載中の駒は数に入らない。 */
function adjacentUnits(state: GameState, hex: Hex): Unit[] {
  const result: Unit[] = [];
  for (const neighbor of neighbors(hex)) {
    const unit = unitAt(state, neighbor);
    if (unit !== undefined) result.push(unit);
  }
  return result;
}

/** 通信妨害車が隣接していれば、そのユニットは支援を受けられない。 */
function isSupportSuppressed(data: GameData, state: GameState, unit: Unit, hex: Hex): boolean {
  return adjacentUnits(state, hex).some(
    (other) => other.owner !== unit.owner && unitDef(data, other.type).suppressSupport,
  );
}

/**
 * 包囲されているか（第4.4章）。
 *
 * **盤外のヘクスと、対象が進入できない地形のヘクスは「埋まっている」と見なす。**
 * 包囲とは逃げ場のない状態を指すので、そもそも逃げられない方向を塞ぐ必要はない。
 * 結果として「敵を山や海に押し付けてから包囲する」のが最も効率的な手になる。
 */
export function isEncircled(
  data: GameData,
  state: GameState,
  target: Unit,
  by: string,
  targetHex: Hex = target.hex,
): boolean {
  const def = unitDef(data, target.type);
  return neighbors(targetHex).every((hex) => {
    if (terrainIdAt(data.board, hex) === null) return true;
    if (!canStandOn(data, def, hex)) return true;
    return unitAt(state, hex)?.owner === by;
  });
}

/** 攻撃支援。その目標を攻撃できない駒は何も足さない（matchup が 0 なので自然にそうなる）。 */
function attackSupport(
  data: GameData,
  state: GameState,
  unit: Unit,
  hex: Hex,
  target: UnitDef,
): SupportEntry[] {
  const entries: SupportEntry[] = [];
  for (const ally of adjacentUnits(state, hex)) {
    if (ally.owner !== unit.owner || ally.id === unit.id) continue;
    const amount = baseAttack(unitDef(data, ally.type), target) * strengthRatio(ally);
    if (amount <= 0) continue;
    entries.push({ unitId: ally.id, amount: amount * data.rules.supportRate });
  }
  return entries;
}

/** 防御支援。攻撃支援と違い、貸す側の戦力比は掛からない。 */
function defenseSupport(data: GameData, state: GameState, unit: Unit, hex: Hex): SupportEntry[] {
  const entries: SupportEntry[] = [];
  for (const ally of adjacentUnits(state, hex)) {
    if (ally.owner !== unit.owner || ally.id === unit.id) continue;
    entries.push({
      unitId: ally.id,
      amount: unitDef(data, ally.type).defense * data.rules.supportRate,
    });
  }
  return entries;
}

function sum(entries: readonly SupportEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

/** 地形効果。航空ユニットは地形に守られない（第5.2章）。 */
export function terrainDefenseFor(data: GameData, def: UnitDef, hex: Hex): number {
  if (def.movementType === 'air' || def.armorClass === 'air') return 1.0;
  const terrainId = terrainIdAt(data.board, hex);
  if (terrainId === null) return 1.0;
  return data.terrain.get(terrainId)?.defense ?? 1.0;
}

function buildSide(
  data: GameData,
  state: GameState,
  unit: Unit,
  hex: Hex,
  opponent: Unit,
): CombatSide {
  const def = unitDef(data, unit.type);
  const opponentDef = unitDef(data, opponent.type);
  const suppressed = isSupportSuppressed(data, state, unit, hex);
  const encircled = isEncircled(data, state, unit, opponent.owner, hex);

  const attackEntries = suppressed ? [] : attackSupport(data, state, unit, hex, opponentDef);
  const defenseEntries = suppressed ? [] : defenseSupport(data, state, unit, hex);

  const own = baseAttack(def, opponentDef) * strengthRatio(unit) * expMultiplier(data, unit.exp);
  const attack = own + sum(attackEntries);
  const defense = def.defense + sum(defenseEntries);
  const multiplier = encircled ? data.rules.encircleMul : 1;

  return {
    unitId: unit.id,
    attack: attack * multiplier,
    defense: defense * multiplier,
    terrainDefense: terrainDefenseFor(data, def, hex),
    attackSupport: attackEntries,
    defenseSupport: defenseEntries,
    encircled,
    supportSuppressed: suppressed,
    expLevel: expLevel(data, unit.exp),
  };
}

/**
 * 攻撃側から見て、その相手を攻撃できるか。できない理由を返す（できるなら null）。
 * `fromHex` を渡すと、その位置から攻撃した場合を判定する（移動後の攻撃）。
 */
export function attackBlockedReason(
  data: GameData,
  attacker: Unit,
  defender: Unit,
  fromHex: Hex = attacker.hex,
): string | null {
  if (attacker.owner === defender.owner) return '味方は攻撃できません';
  if (attacker.carriedBy !== null || defender.carriedBy !== null) {
    return '積載中のユニットは戦闘に関われません';
  }

  const attackerDef = unitDef(data, attacker.type);
  const defenderDef = unitDef(data, defender.type);

  if (attackerDef.range === null) return `${attackerDef.name} は攻撃できません`;
  if (baseAttack(attackerDef, defenderDef) <= 0) {
    return `${attackerDef.name} は ${defenderDef.name} を攻撃できません`;
  }
  // 潜水艦を攻撃できるのは対潜手段を持つ駒だけ（第4.5章）
  if (defenderDef.armorClass === 'sub' && !attackerDef.canDetectSub) {
    return '潜水艦を攻撃できるのは対潜手段を持つユニットだけです';
  }

  const range = distance(fromHex, defender.hex);
  if (range < attackerDef.range.min || range > attackerDef.range.max) {
    return '射程外です';
  }
  return null;
}

/** 返しダメージが発生するか。すべて「防御側が攻撃側を攻撃できるか」だけで決まる。 */
export function canCounter(
  data: GameData,
  attacker: Unit,
  defender: Unit,
  attackerHex: Hex = attacker.hex,
): boolean {
  if (unitDef(data, attacker.type).noCounter) return false;
  return (
    attackBlockedReason(data, defender, attacker, defender.hex) === null &&
    withinCounterRange(data, defender, attackerHex)
  );
}

function withinCounterRange(data: GameData, defender: Unit, attackerHex: Hex): boolean {
  const def = unitDef(data, defender.type);
  if (def.range === null) return false;
  const range = distance(defender.hex, attackerHex);
  return range >= def.range.min && range <= def.range.max;
}

/** ダメージの丸め。四捨五入し、1 以上・相手の残存戦力以下にする（第4.4章）。 */
function roundDamage(raw: number, targetStrength: number): number {
  const rounded = Math.round(raw);
  return Math.min(Math.max(rounded, 1), targetStrength);
}

/**
 * 戦闘を予測する。**状態は一切変更しない。**
 * UI のダメージ予測表示（第7.5章）と AI の評価が、まったく同じ値を見ることになる。
 */
export function forecastCombat(
  data: GameData,
  state: GameState,
  attackerId: UnitId,
  defenderId: UnitId,
  attackerHex?: Hex,
): CombatForecast {
  const attacker = state.units.find((unit) => unit.id === attackerId);
  const defender = state.units.find((unit) => unit.id === defenderId);
  if (attacker === undefined || defender === undefined) {
    throw new Error(`戦闘するユニットが見つかりません: ${attackerId} / ${defenderId}`);
  }

  const fromHex = attackerHex ?? attacker.hex;
  // 移動後の攻撃を予測する場合、攻撃側は移動先にいるものとして支援と包囲を数える
  const simulated: GameState =
    attackerHex === undefined
      ? state
      : {
          ...state,
          units: state.units.map((unit) =>
            unit.id === attacker.id ? { ...unit, hex: fromHex } : unit,
          ),
        };
  const movedAttacker = { ...attacker, hex: fromHex };

  const attackerSide = buildSide(data, simulated, movedAttacker, fromHex, defender);
  const defenderSide = buildSide(data, simulated, defender, defender.hex, movedAttacker);

  const damageToDefender = roundDamage(
    (attackerSide.attack / (defenderSide.defense * defenderSide.terrainDefense)) *
      data.rules.damageScale,
    defender.strength,
  );

  const counter = canCounter(data, movedAttacker, defender, fromHex);
  const damageToAttacker = counter
    ? roundDamage(
        (defenderSide.attack / (attackerSide.defense * attackerSide.terrainDefense)) *
          data.rules.damageScale *
          data.rules.counterCoef,
        attacker.strength,
      )
    : 0;

  return {
    attacker: attackerSide,
    defender: defenderSide,
    damageToDefender,
    damageToAttacker,
    counterPossible: counter,
    defenderDestroyed: damageToDefender >= defender.strength,
    attackerDestroyed: damageToAttacker >= attacker.strength,
  };
}

/**
 * その位置から攻撃できる敵の一覧。ID 昇順で返す（決定性のため）。
 */
export function attackableTargets(
  data: GameData,
  state: GameState,
  attackerId: UnitId,
  fromHex?: Hex,
): Unit[] {
  const attacker = state.units.find((unit) => unit.id === attackerId);
  if (attacker === undefined) return [];
  const hex = fromHex ?? attacker.hex;

  return state.units
    .filter((defender) => attackBlockedReason(data, attacker, defender, hex) === null)
    .sort((a, b) => a.id - b.id);
}
