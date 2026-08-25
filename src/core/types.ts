/**
 * ゲームの中核となる型定義（実装計画書 第4章・第5章）。
 *
 * ここに定義する値はすべて **JSON へそのまま落とせる形**にしておく。
 * セーブ/ロードとリプレイ（第3.2章）が `GameState` の JSON 化で成立し、
 * `Map` / `Set` を持ち込まないことで走査順も決定的になる。
 */

import type { Hex } from './hex';

/** 移動タイプ（第4.3章）。地形コスト表のキーになる。 */
export type MoveType = 'foot' | 'track' | 'wheel' | 'air' | 'ship' | 'sub';

export const MOVE_TYPES: readonly MoveType[] = ['foot', 'track', 'wheel', 'air', 'ship', 'sub'];

/** 耐性クラス（第5.1.1章）。`matchup` の参照キーになる。 */
export type ArmorClass = 'infantry' | 'light' | 'armor' | 'ship' | 'sub' | 'air';

export const ARMOR_CLASSES: readonly ArmorClass[] = [
  'infantry',
  'light',
  'armor',
  'ship',
  'sub',
  'air',
];

/**
 * 相性が定義される耐性クラス。
 * **航空目標には `power.air` を直接使い、`matchup` はかからない**（第5.1.1章）。
 */
export type MatchupClass = Exclude<ArmorClass, 'air'>;

export const MATCHUP_CLASSES: readonly MatchupClass[] = [
  'infantry',
  'light',
  'armor',
  'ship',
  'sub',
];

/** 施設の種別（第4.6章）。同名の地形 ID を持つ。 */
export type FacilityKind = 'hq' | 'factory' | 'port' | 'airfield';

export const FACILITY_KINDS: readonly FacilityKind[] = ['hq', 'factory', 'port', 'airfield'];

/** 勝敗条件（第4.8章）。マップ JSON で有効なものを指定する。 */
export type VictoryCondition = 'annihilation' | 'hq' | 'turnLimit';

export const VICTORY_CONDITIONS: readonly VictoryCondition[] = ['annihilation', 'hq', 'turnLimit'];

/**
 * 陣営 ID。実データは `red` / `blue` の2陣営だが、
 * **3陣営以上もデータ構造上は許容する**（UI / AI は対応しない・第12章C）。
 */
export type FactionId = string;

/** ユニット種別 ID（`units.json` のキー）。 */
export type UnitTypeId = string;

/** 地形 ID（`terrain.json` のキー）。 */
export type TerrainId = string;

/** 盤上の個体を指す ID。マップ読み込み時に 1 から順に振る。 */
export type UnitId = number;

/** 攻撃力。対地と対空は独立した2値（第5.1.2章 照合#1）。 */
export interface Power {
  readonly ground: number;
  readonly air: number;
}

/** 射程。直接攻撃は `{ min: 1, max: 1 }`、間接砲は `{ min: 2, max: 4 }` のように表す。 */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * 積載能力（第4.7章）。
 *
 * `allow` は「運べる耐性クラス → 消費する積載枠」の対応表で、
 * 載っていないクラスは運べない。輸送機の「**歩兵2 または車両1**」は
 * `capacity: 2` に対し歩兵1枠・車両2枠、という形で表現する。
 */
export interface CargoSpec {
  readonly capacity: number;
  readonly allow: Readonly<Partial<Record<ArmorClass, number>>>;
}

/** ユニット性能の定義（`data/units.json`・第5.1章）。 */
export interface UnitDef {
  readonly id: UnitTypeId;
  readonly name: string;
  /** 設計制約2の記録欄。「このユニットでなければ務まらない仕事」。 */
  readonly designRole: string;
  /** 重砲・地雷は移動できないため移動タイプを持たない。 */
  readonly movementType: MoveType | null;
  readonly movePoints: number;
  readonly armorClass: ArmorClass;
  /** DEF。除数として使う（1.05〜5.00）。 */
  readonly defense: number;
  readonly power: Power;
  /** 0=攻撃不可 / 0.7 / 0.85 / 1.0 / 1.15 の5段階。 */
  readonly matchup: Readonly<Record<MatchupClass, number>>;
  /** 攻撃手段を持たない駒（輸送機・揚陸艦・通信妨害車・地雷）は null。 */
  readonly range: Range | null;
  /** true なら移動したターンには攻撃できない（間接砲）。 */
  readonly indirect: boolean;
  /** true なら移動経路の任意地点で1回攻撃でき、残 MP で移動を続行できる（バギー系）。 */
  readonly attackDuringMove: boolean;
  /** true ならこの駒の攻撃に返しダメージが発生しない。 */
  readonly noCounter: boolean;
  /** 占領できるのは歩兵系のみ（第4.6章）。 */
  readonly canCapture: boolean;
  /** true なら潜水艦を攻撃できる。駆逐艦のみ（第4.5章）。 */
  readonly canDetectSub: boolean;
  /** true なら隣接する敵の支援効果を無効化する（通信妨害車）。 */
  readonly suppressSupport: boolean;
  /** 1 以上なら攻撃後その分だけ行動不能（電磁砲艦）。 */
  readonly reloadTurns: number;
  readonly cargo: CargoSpec;
  /** マップ設計と AI 評価に使う戦力価値。 */
  readonly value: number;
  readonly sprite: string;
}

/** 地形の定義（`data/terrain.json`・第5.2章）。 */
export interface TerrainDef {
  readonly id: TerrainId;
  readonly name: string;
  /** 0=道路・施設 / 1=平地 / 2=丘陵 / 3=荒地 / 4=山岳 / 5=水域。 */
  readonly tier: number;
  /** 移動コスト。null は**進入不可**を表す。 */
  readonly moveCost: Readonly<Record<MoveType, number | null>>;
  /** 地形効果（防御倍率）。1.0〜1.4。航空ユニットはこれを受けない。 */
  readonly defense: number;
}

/** 施設の初期定義（マップ JSON の `facilities`）。 */
export interface FacilityDef {
  readonly hex: Hex;
  readonly kind: FacilityKind;
  /** null は中立（未占領）。 */
  readonly owner: FactionId | null;
  /**
   * 開始時点で施設の中に格納されているユニット。
   * 施設は生産設備ではなく**格納庫**なので、これが中身のすべてになる。
   */
  readonly garrison: readonly UnitTypeId[];
}

/** ユニットの初期配置（マップ JSON の `units`）。 */
export interface UnitPlacement {
  readonly hex: Hex;
  readonly type: UnitTypeId;
  readonly owner: FactionId;
  readonly strength: number;
}

/** 検証済みのマップ定義（`data/maps/*.json`・第5.3章）。 */
export interface MapDef {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly turnLimit: number;
  readonly victory: readonly VictoryCondition[];
  readonly factions: readonly FactionId[];
  /** odd-q オフセットの `tiles[row][col]`。 */
  readonly tiles: readonly (readonly TerrainId[])[];
  readonly facilities: readonly FacilityDef[];
  readonly units: readonly UnitPlacement[];
  readonly designNote?: string;
}

/** ユニットの初期戦力（第4.4章「戦力10制」）。 */
export const MAX_STRENGTH = 10;

/**
 * 戦闘のテンポを決める定数（`data/rules.json`・第4.4章）。
 * バランス調整で触るのはここだけで済むよう、コードには埋め込まない。
 */
export interface RulesDef {
  /** 隣接する味方から借りられる割合。 */
  readonly supportRate: number;
  /** 包囲されたときの攻防の倍率。 */
  readonly encircleMul: number;
  /** 全体の削れ具合。 */
  readonly damageScale: number;
  /** 返しダメージに掛かる係数。 */
  readonly counterCoef: number;
  /** 熟練度1レベルあたりの攻撃倍率の増分。 */
  readonly expStep: number;
  /** レベル1以降に必要な経験値（昇順）。 */
  readonly expThresholds: readonly number[];
  readonly expOnAttack: number;
  readonly expOnKill: number;
  readonly expOnCounter: number;
}

/** 盤上のユニット1体の状態。 */
export interface Unit {
  readonly id: UnitId;
  readonly type: UnitTypeId;
  readonly owner: FactionId;
  /** 輸送ユニットに積載されている間も、位置は輸送側と同じヘクスを指す。 */
  readonly hex: Hex;
  /** 戦力 S。0 で撃破。 */
  readonly strength: number;
  /** 熟練度の元になる経験値。マップ内限定で持ち越さない（第0章）。 */
  readonly exp: number;
  /** このターンに移動を終えたか。 */
  readonly hasMoved: boolean;
  /** このターンの行動（攻撃・占領・積載・待機）を終えたか。 */
  readonly hasActed: boolean;
  /** 再装填の残りターン数。0 なら行動できる（電磁砲艦）。 */
  readonly reloading: number;
  /** 積載中のユニット ID。順序は積んだ順で固定する。 */
  readonly cargo: readonly UnitId[];
  /** 積載されている場合、その輸送ユニットの ID。 */
  readonly carriedBy: UnitId | null;
}

/**
 * 施設に格納されているユニット。盤上には出ていないので、
 * 攻撃も支援も包囲もされない。取り出すには `deploy` が要る。
 */
export interface StoredUnit {
  readonly id: UnitId;
  readonly type: UnitTypeId;
  /** 格納しても熟練度は失われない。同一の部隊が補充を受けたものと見なす（第4.6章）。 */
  readonly exp: number;
  /**
   * このターンすでに格納・搬出に関わったか。
   * 格納した直後は `true` なので、**搬出できるのは次のターン以降**になる。
   */
  readonly hasActed: boolean;
}

/** 施設1つの状態。 */
export interface Facility {
  readonly hex: Hex;
  readonly kind: FacilityKind;
  readonly owner: FactionId | null;
  /**
   * 中に格納されているユニット。収容数に上限はない。
   * 敵味方を問わず中身を参照できる（第4.6章）ため、隠さずに持つ。
   * 施設が占領されると、中身もそのまま新しい所有者のものになる。
   */
  readonly garrison: readonly StoredUnit[];
}

/** 決着の内容（第4.8章）。 */
export interface Outcome {
  readonly winner: FactionId | null;
  readonly reason: VictoryCondition | 'draw';
}

/** ゲーム全体の状態。これを JSON 化したものがセーブデータになる。 */
export interface GameState {
  readonly mapId: string;
  /**
   * 1 始まり。**全陣営が1回ずつ手番を終えると1つ進む**（`activeFaction` が先頭へ戻るとき）。
   * 増援の出現間隔とターン制限は、この数え方を基準にする。
   */
  readonly turn: number;
  readonly factions: readonly FactionId[];
  readonly activeFaction: FactionId;
  readonly turnLimit: number;
  readonly victory: readonly VictoryCondition[];
  readonly units: readonly Unit[];
  readonly facilities: readonly Facility[];
  /** 次に払い出すユニット ID。 */
  readonly nextUnitId: UnitId;
  readonly outcome: Outcome | null;
}
