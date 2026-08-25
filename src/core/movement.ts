/**
 * 移動コスト・到達範囲・経路探索（実装計画書 第4.3章）。
 *
 * 進入できるかどうかは**2つのルールだけ**で決まる。
 *
 * 1. 地形表のコストが `−`（null）なら進入できない
 * 2. コストがそのユニットの総移動力を超える地形には進入できない
 *
 * ユニットごとの個別制限は設けない。要塞戦車が荒地に入れないのは
 * 「重装甲だから」ではなく、移動力2ではコスト3を払えないという計算結果である。
 *
 * ZOC は「連続進入の禁止」として実装する。停止を強制するのではなく、
 * **ZOC ヘクスに入った次は必ず ZOC 外へ出なければならない**。
 * 出られる先がなければ、結果としてそこで移動が終わる。
 */

import { hexKey, neighbors, type Hex, type HexKey } from './hex';
import { terrainIdAt, unitDef, type GameData } from './map';
import type { GameState, Unit, UnitDef, UnitId } from './types';

/** 到達できるヘクス1つぶんの情報。 */
export interface ReachableHex {
  readonly hex: Hex;
  /** 到達までに消費する移動力。 */
  readonly cost: number;
  /** 出発地点から自分までの経路（両端を含む）。 */
  readonly path: readonly Hex[];
  /** そこで移動を終えられるか。味方が立っているヘクスは通過専用になる。 */
  readonly canStop: boolean;
}

export type ReachableMap = ReadonlyMap<HexKey, ReachableHex>;

/**
 * その地形へ進入するコスト。進入できない場合は null。
 * 移動タイプを持たない駒（重砲・地雷）はどこへも進入できない。
 */
export function moveCostFor(data: GameData, def: UnitDef, hex: Hex): number | null {
  if (def.movementType === null) return null;
  const terrainId = terrainIdAt(data.board, hex);
  if (terrainId === null) return null;
  const terrain = data.terrain.get(terrainId);
  if (terrain === undefined) return null;

  const cost = terrain.moveCost[def.movementType];
  if (cost === null) return null;
  // ルール2: 総移動力を超えるコストの地形には、何ターンかけても進入できない
  if (cost > def.movePoints) return null;
  return cost;
}

/** そのユニットがその地形の上に存在できるか（配置・増援・積み下ろしの判定にも使う）。 */
export function canStandOn(data: GameData, def: UnitDef, hex: Hex): boolean {
  const terrainId = terrainIdAt(data.board, hex);
  if (terrainId === null) return false;
  const terrain = data.terrain.get(terrainId);
  if (terrain === undefined) return false;
  if (def.movementType === null) return terrain.moveCost.foot !== null;
  return moveCostFor(data, def, hex) !== null;
}

/** 指定ヘクスにいるユニット（積載中の駒は盤上にいないものとして扱う）。 */
export function unitAt(state: GameState, hex: Hex): Unit | undefined {
  return state.units.find(
    (unit) => unit.carriedBy === null && unit.hex.q === hex.q && unit.hex.r === hex.r,
  );
}

/**
 * ZOC を発生させるユニットか。
 * 発生させるのは地上・海上ユニットのみで、航空ユニットは対象外（第4.3章）。
 */
export function emitsZoc(def: UnitDef): boolean {
  return def.movementType !== 'air' && def.armorClass !== 'air';
}

/** 航空ユニットは ZOC の影響を受けない（原作準拠）。 */
export function affectedByZoc(def: UnitDef): boolean {
  return def.movementType !== 'air' && def.armorClass !== 'air';
}

/** 指定した陣営から見て ZOC になっているヘクスの集合。 */
export function zocHexes(data: GameData, state: GameState, faction: string): Set<HexKey> {
  const result = new Set<HexKey>();
  for (const unit of state.units) {
    if (unit.owner === faction || unit.carriedBy !== null) continue;
    if (!emitsZoc(unitDef(data, unit.type))) continue;
    for (const hex of neighbors(unit.hex)) {
      result.add(hexKey(hex));
    }
  }
  return result;
}

/**
 * 未占領（中立または敵）の施設ヘクスへは、占領できるユニットしか進入できない（第4.6章）。
 * 自軍が占領済みの施設ヘクスには誰でも入れる（修理を受けられるかは別の判定）。
 */
export function canEnterFacility(state: GameState, def: UnitDef, owner: string, hex: Hex): boolean {
  const facility = state.facilities.find((item) => item.hex.q === hex.q && item.hex.r === hex.r);
  if (facility === undefined) return true;
  if (facility.owner === owner) return true;
  return def.canCapture;
}

/** 探索の内部状態。同じヘクスでも「直前に ZOC へ入ったか」で行ける先が変わる。 */
interface SearchNode {
  readonly hex: Hex;
  /** 直前の一歩で ZOC ヘクスへ入ったか。true なら次は ZOC 外へ出るしかない。 */
  readonly inZoc: boolean;
  readonly cost: number;
  readonly path: readonly Hex[];
}

function nodeKey(hex: Hex, inZoc: boolean): string {
  return `${hexKey(hex)}|${inZoc ? '1' : '0'}`;
}

export interface ReachOptions {
  /** 残り移動力を明示する（攻撃後移動などで使う）。既定はユニットの総移動力。 */
  readonly movePoints?: number;
  /**
   * 出発ヘクスがすでに ZOC 内でも、そこから出る1歩は連続進入に当たらない（第4.3章）。
   * バギーの攻撃後移動のように、区間の途中から再開する場合に true を渡す。
   */
  readonly startInZoc?: boolean;
}

/**
 * ユニットが今の手番で到達できるヘクスを、経路つきで返す。
 *
 * 経路探索は移動コスト付きダイクストラ。**同じコストなら常に同じ経路**を選ぶよう、
 * 取り出し順を (コスト → q → r → ZOC 状態) で完全に決めている（第6章 決定性の要件）。
 */
export function reachableHexes(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  options: ReachOptions = {},
): ReachableMap {
  const unit = state.units.find((item) => item.id === unitId);
  const result = new Map<HexKey, ReachableHex>();
  // 盤上にいない駒（未知の ID・積載中）は動かせない
  if (unit?.carriedBy !== null) return result;

  const def = unitDef(data, unit.type);
  const budget = options.movePoints ?? def.movePoints;
  const zoc = affectedByZoc(def) ? zocHexes(data, state, unit.owner) : new Set<HexKey>();

  const start: SearchNode = {
    hex: unit.hex,
    inZoc: options.startInZoc ?? false,
    cost: 0,
    path: [unit.hex],
  };

  const best = new Map<string, number>([[nodeKey(start.hex, start.inZoc), 0]]);
  const queue: SearchNode[] = [start];
  record(result, start, canStopAt(data, state, unit, def, start.hex));

  while (queue.length > 0) {
    const node = takeCheapest(queue);
    if (node.cost > (best.get(nodeKey(node.hex, node.inZoc)) ?? Infinity)) continue;

    for (const next of neighbors(node.hex)) {
      const stepCost = moveCostFor(data, def, next);
      if (stepCost === null) continue;

      const total = node.cost + stepCost;
      if (total > budget) continue;

      // 敵ユニット（地雷を含む）のいるヘクスは通過できない
      const occupant = unitAt(state, next);
      if (occupant !== undefined && occupant.owner !== unit.owner) continue;
      if (!canEnterFacility(state, def, unit.owner, next)) continue;

      // ZOC ヘクスへの連続進入は禁止
      const nextInZoc = zoc.has(hexKey(next));
      if (nextInZoc && node.inZoc) continue;

      const key = nodeKey(next, nextInZoc);
      if (total >= (best.get(key) ?? Infinity)) continue;
      best.set(key, total);

      const candidate: SearchNode = {
        hex: next,
        inZoc: nextInZoc,
        cost: total,
        path: [...node.path, next],
      };
      queue.push(candidate);
      record(result, candidate, canStopAt(data, state, unit, def, next));
    }
  }

  return result;
}

/** 同じヘクスに複数の経路が届いた場合、安い方（同額なら先に見つけた方）を残す。 */
function record(result: Map<HexKey, ReachableHex>, node: SearchNode, canStop: boolean): void {
  const key = hexKey(node.hex);
  const existing = result.get(key);
  if (existing !== undefined && existing.cost <= node.cost) return;
  result.set(key, { hex: node.hex, cost: node.cost, path: node.path, canStop });
}

/**
 * 取り出し順を完全に決めるための優先度付き取り出し。
 * 盤面は高々 100×100 なので、素朴な線形走査で足りる。
 */
function takeCheapest(queue: SearchNode[]): SearchNode {
  let bestIndex = 0;
  for (let i = 1; i < queue.length; i++) {
    if (compareNodes(queue[i]!, queue[bestIndex]!) < 0) bestIndex = i;
  }
  const [node] = queue.splice(bestIndex, 1);
  return node!;
}

function compareNodes(a: SearchNode, b: SearchNode): number {
  return (
    a.cost - b.cost || a.hex.q - b.hex.q || a.hex.r - b.hex.r || Number(a.inZoc) - Number(b.inZoc)
  );
}

/** そのヘクスで移動を終えられるか。味方のいるヘクスは通過できるが停止できない。 */
function canStopAt(data: GameData, state: GameState, unit: Unit, def: UnitDef, hex: Hex): boolean {
  const occupant = unitAt(state, hex);
  if (occupant !== undefined && occupant.id !== unit.id) return false;
  return canStandOn(data, def, hex);
}

/** 到達可能なヘクスのうち、実際に移動を終えられるものだけ。 */
export function stoppableHexes(reachable: ReachableMap): ReachableHex[] {
  return [...reachable.values()].filter((entry) => entry.canStop);
}

/** 目的地までの経路。到達できない場合は null。 */
export function findPath(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  target: Hex,
  options: ReachOptions = {},
): readonly Hex[] | null {
  const entry = reachableHexes(data, state, unitId, options).get(hexKey(target));
  if (entry?.canStop !== true) return null;
  return entry.path;
}

/**
 * 与えられた経路が正しいかを検証する。
 * UI が作った経路も、リプレイから流れてきた経路も、同じ関門を通す。
 * 問題があれば理由を返し、なければ null を返す。
 */
export function validatePath(
  data: GameData,
  state: GameState,
  unitId: UnitId,
  path: readonly Hex[],
  options: ReachOptions = {},
): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  if (unit === undefined) return `ユニットが見つかりません: ${unitId}`;
  if (unit.carriedBy !== null) return '積載中のユニットは行動できません';

  const first = path[0];
  const last = path.at(-1);
  if (first === undefined || last === undefined) return '経路が空です';
  if (first.q !== unit.hex.q || first.r !== unit.hex.r) {
    return '経路がユニットの現在位置から始まっていません';
  }

  const def = unitDef(data, unit.type);
  const budget = options.movePoints ?? def.movePoints;
  const zoc = affectedByZoc(def) ? zocHexes(data, state, unit.owner) : new Set<HexKey>();

  let cost = 0;
  let inZoc = options.startInZoc ?? false;
  const visited = new Set<HexKey>([hexKey(first)]);

  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    if (!neighbors(from).some((hex) => hex.q === to.q && hex.r === to.r)) {
      return '経路が繋がっていません';
    }
    if (visited.has(hexKey(to))) return '経路が同じヘクスを通っています';
    visited.add(hexKey(to));

    const stepCost = moveCostFor(data, def, to);
    if (stepCost === null) return `${def.name} はそのヘクスへ進入できません`;
    cost += stepCost;
    if (cost > budget) return '移動力が足りません';

    const occupant = unitAt(state, to);
    if (occupant !== undefined && occupant.owner !== unit.owner) {
      return '敵ユニットのいるヘクスは通過できません';
    }
    if (!canEnterFacility(state, def, unit.owner, to)) {
      return '未占領の施設ヘクスには占領できるユニットしか進入できません';
    }

    const nextInZoc = zoc.has(hexKey(to));
    if (nextInZoc && inZoc) return 'ZOC ヘクスへ続けて進入することはできません';
    inZoc = nextInZoc;
  }

  if (path.length > 1 && !canStopAt(data, state, unit, def, last)) {
    return 'そのヘクスでは移動を終えられません';
  }
  return null;
}

/** 経路の消費移動力。検証を通っていることが前提。 */
export function pathCost(data: GameData, def: UnitDef, path: readonly Hex[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    cost += moveCostFor(data, def, path[i]!) ?? 0;
  }
  return cost;
}
