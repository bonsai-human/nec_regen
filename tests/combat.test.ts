import { describe, expect, it } from 'vitest';
import {
  attackableTargets,
  baseAttack,
  expLevel,
  expMultiplier,
  forecastCombat,
  isEncircled,
} from '@/core/combat';
import { neighbors, toAxial, toOffset, type Hex } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import { createInitialState } from '@/core/state';
import { loadRules, loadTerrain, loadUnits, parseMap } from '@/data';
import type { GameState, UnitTypeId } from '@/core/types';

const units = loadUnits();
const terrain = loadTerrain();
const rules = loadRules();

const LEGEND: Record<string, string> = {
  '.': 'plain',
  r: 'road',
  h: 'hill',
  f: 'forest',
  m: 'mountain',
  s: 'sea',
};

interface Placement {
  readonly at: [number, number];
  readonly type: UnitTypeId;
  readonly owner: string;
  readonly strength?: number;
  readonly exp?: number;
}

function build(rows: string[], placements: Placement[]): { data: GameData; state: GameState } {
  const tiles = rows.map((row) => [...row].map((ch) => LEGEND[ch] ?? 'plain'));
  const raw = {
    id: 'test',
    name: 'テスト',
    width: tiles[0]?.length ?? 0,
    height: tiles.length,
    turnLimit: 99,
    victory: ['annihilation'],
    factions: ['red', 'blue'],
    tiles,
    facilities: [],
    units: placements.map((placement) => ({
      hex: placement.at,
      type: placement.type,
      owner: placement.owner,
      strength: placement.strength ?? 10,
    })),
  };
  const map = parseMap(raw, { units, terrain }, 'test.json');
  const data: GameData = { board: createBoard(map), map, units, terrain, rules };
  const base = createInitialState(data);
  const state: GameState = {
    ...base,
    units: base.units.map((unit, index) => ({ ...unit, exp: placements[index]?.exp ?? 0 })),
  };
  return { data, state };
}

function at(col: number, row: number): Hex {
  return toAxial({ col, row });
}

/** 目標の隣接ヘクスを、盤内のものだけオフセットで返す。 */
function ringOf(col: number, row: number, width: number, height: number): [number, number][] {
  return neighbors(at(col, row))
    .map((hex) => toOffset(hex))
    .filter((o) => o.col >= 0 && o.col < width && o.row >= 0 && o.row < height)
    .map((o): [number, number] => [o.col, o.row]);
}

describe('基礎攻撃力', () => {
  it('地上目標には power.ground × matchup を使う', () => {
    const mbt = units.get('mbt')!;
    const aaTank = units.get('aa_tank')!;
    // 主力戦車 → 対空戦車（装甲）は power 10 × 相性 1.0
    expect(baseAttack(mbt, aaTank)).toBeCloseTo(10);
    // 主力戦車 → バギー（軽車両）は 10 × 1.15
    expect(baseAttack(mbt, units.get('buggy')!)).toBeCloseTo(11.5);
  });

  it('航空目標には power.air を直接使い、matchup はかからない（第5.1.1章）', () => {
    const aaTank = units.get('aa_tank')!;
    const fighter = units.get('fighter')!;
    expect(baseAttack(aaTank, fighter)).toBe(13);
    // 戦闘機は地上を撃てない
    expect(baseAttack(fighter, units.get('mbt')!)).toBe(0);
  });
});

describe('熟練度', () => {
  const { data } = build(['..'], [{ at: [0, 0], type: 'mbt', owner: 'red' }]);

  it('必要経験値でレベルが上がり、攻撃倍率が最大 +20% になる', () => {
    expect(expLevel(data, 0)).toBe(0);
    expect(expLevel(data, 2)).toBe(0);
    expect(expLevel(data, 3)).toBe(1);
    expect(expLevel(data, 7)).toBe(1);
    expect(expLevel(data, 8)).toBe(2);
    expect(expLevel(data, 99)).toBe(2);
    expect(expMultiplier(data, 0)).toBeCloseTo(1.0);
    expect(expMultiplier(data, 3)).toBeCloseTo(1.1);
    expect(expMultiplier(data, 8)).toBeCloseTo(1.2);
  });
});

describe('ダメージ計算（第4.4章のゴールデン値）', () => {
  /** 計画書「相性の輪が成立していることの確認」の表と突き合わせる。 */
  const duel = (
    attackerType: UnitTypeId,
    defenderType: UnitTypeId,
  ): { damage: number; counter: number } => {
    // 地形効果を 1.0 にするため道路の上で殴り合わせる。
    // 1行の盤だと盤外のヘクスで包囲が成立してしまうので、3行の中央に置く
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: attackerType, owner: 'red' },
        { at: [1, 1], type: defenderType, owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    return { damage: forecast.damageToDefender, counter: forecast.damageToAttacker };
  };

  it('主力戦車 → 対空戦車は戦車の圧勝（4.1 対 1.1）', () => {
    const result = duel('mbt', 'aa_tank');
    expect(result.damage).toBe(4); // 10 ÷ 1.45 × 0.6 = 4.1
    expect(result.counter).toBe(1); // 4.2 ÷ 1.65 × 0.6 × 0.7 = 1.1
  });

  it('対空戦車 → 戦闘機は一方勝ち（返しがない）', () => {
    const result = duel('aa_tank', 'fighter');
    expect(result.damage).toBe(5); // 13 ÷ 1.45 × 0.6 = 5.4
    expect(result.counter).toBe(0); // 戦闘機は地上を撃てない
  });

  it('戦闘機 → 攻撃機は圧勝（7.4 対 1.2）', () => {
    const result = duel('fighter', 'attacker');
    expect(result.damage).toBe(7);
    expect(result.counter).toBe(1);
  });

  it('攻撃機 → 主力戦車は一方勝ち（戦車は対空を持たない）', () => {
    const result = duel('attacker', 'mbt');
    // 攻撃機の対装甲は ◎1.15。14 × 1.15 ÷ 1.65 × 0.6 = 5.9
    // （計画書 第5.1.1章の検証表はこの行だけ matchup を掛け忘れて 5.1 としている）
    expect(result.damage).toBe(6);
    expect(result.counter).toBe(0);
  });

  it('攻撃機 ⇔ 対空戦車は攻め合いになる', () => {
    const result = duel('attacker', 'aa_tank');
    // 16.1 ÷ 1.45 × 0.6 = 6.7 / 返しは 13 ÷ 1.45 × 0.6 × 0.7 = 3.8
    expect(result.damage).toBe(7);
    expect(result.counter).toBe(4);
    // 一方的ではなく、撃ち合いになっていること
    expect(result.counter).toBeGreaterThan(0);
  });

  it('駆逐艦 → 潜水艦は駆逐艦の勝ち', () => {
    const { data, state } = build(
      ['sss', 'sss', 'sss'],
      [
        { at: [0, 1], type: 'destroyer', owner: 'red' },
        { at: [1, 1], type: 'submarine', owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.damageToDefender).toBe(4); // 11.5 ÷ 1.65 × 0.6 = 4.2
    expect(forecast.damageToAttacker).toBe(3); // 11.9 ÷ 2.00 × 0.6 × 0.7 = 2.5
  });

  it('潜水艦 → コルベットは一方勝ち（対潜を持たないので反撃できない）', () => {
    const { data, state } = build(
      ['sssss', 'sssss', 'sssss'],
      [
        { at: [0, 1], type: 'submarine', owner: 'red' },
        { at: [1, 1], type: 'corvette', owner: 'blue' },
        // 「回答のない駒を置かない」というマップ検証を満たすための遠方の駆逐艦
        { at: [4, 1], type: 'destroyer', owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.damageToDefender).toBe(6); // 16.1 ÷ 1.65 × 0.6 = 5.9
    expect(forecast.counterPossible).toBe(false);
    expect(forecast.damageToAttacker).toBe(0);
  });
});

describe('要塞戦車の攻城戦（第5.1章の検証表）', () => {
  it('正面から殴ると割に合わない', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'assault_tank', owner: 'red' },
        { at: [1, 1], type: 'fortress_tank', owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.damageToDefender).toBe(2); // 16.1 ÷ 5.00 × 0.6 = 1.9
    expect(forecast.damageToAttacker).toBe(4); // 20.7 ÷ 2.00 × 0.6 × 0.7 = 4.3
  });

  it('包囲すると攻防が半減し、殴り勝てるようになる', () => {
    // 要塞戦車を6ヘクスすべて赤で囲む
    const ring = ringOf(2, 2, 5, 5);
    expect(ring).toHaveLength(6);
    const { data, state } = build(
      ['rrrrr', 'rrrrr', 'rrrrr', 'rrrrr', 'rrrrr'],
      [
        { at: [2, 2], type: 'fortress_tank', owner: 'blue' },
        ...ring.map((cell) => ({ at: cell, type: 'assault_tank', owner: 'red' })),
      ],
    );
    const fortress = state.units.find((unit) => unit.type === 'fortress_tank')!;
    expect(isEncircled(data, state, fortress, 'red')).toBe(true);

    const attacker = state.units.find((unit) => unit.id === 2)!;
    const forecast = forecastCombat(data, state, attacker.id, fortress.id);
    expect(forecast.defender.encircled).toBe(true);
    // 包囲で防御が半減し、さらに周囲の味方から攻撃支援が乗る
    expect(forecast.damageToDefender).toBeGreaterThanOrEqual(4);
    // 要塞戦車の攻撃も半減するので返しは軽くなる
    expect(forecast.damageToAttacker).toBeLessThanOrEqual(3);
  });

  it('盤外のヘクスは「埋まっている」と見なす', () => {
    // 盤の角に置けば、埋めるべきヘクスは盤内の隣接分だけで済む
    const ring = ringOf(0, 0, 2, 2);
    const { data, state } = build(
      ['..', '..'],
      [
        { at: [0, 0], type: 'mbt', owner: 'blue' },
        ...ring.map((cell) => ({ at: cell, type: 'mbt', owner: 'red' })),
      ],
    );
    const target = state.units.find((unit) => unit.owner === 'blue')!;
    expect(ring.length).toBeLessThan(6);
    expect(isEncircled(data, state, target, 'red')).toBe(true);
  });

  it('進入できない地形は塞ぐ必要がない（山に押し付ける）', () => {
    // 戦車は山岳へ入れないので、山に面した方向は埋めなくても包囲が成立する
    const rows = ['mmmmm', 'mmmmm', 'rrrrr', 'rrrrr', 'rrrrr'];
    const target: [number, number] = [2, 2];
    const ring = ringOf(target[0], target[1], 5, 5);
    const legend = rows.map((row) => [...row]);
    const open = ring.filter((cell) => legend[cell[1]]?.[cell[0]] !== 'm');
    expect(open.length).toBeLessThan(ring.length);

    const { data, state } = build(rows, [
      { at: target, type: 'mbt', owner: 'blue' },
      ...open.map((cell) => ({ at: cell, type: 'mbt', owner: 'red' })),
    ]);
    const blue = state.units.find((unit) => unit.owner === 'blue')!;
    expect(isEncircled(data, state, blue, 'red')).toBe(true);
  });
});

describe('支援効果', () => {
  it('隣接する味方の攻撃力を借りて火力が上がる', () => {
    const alone = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'aa_tank', owner: 'blue' },
      ],
    );
    const soloDamage = forecastCombat(alone.data, alone.state, 1, 2).damageToDefender;

    const supported = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'aa_tank', owner: 'blue' },
        { at: [1, 0], type: 'assault_tank', owner: 'red' },
      ],
    );
    const forecast = forecastCombat(supported.data, supported.state, 1, 2);
    expect(forecast.attacker.attackSupport).toHaveLength(1);
    expect(forecast.damageToDefender).toBeGreaterThan(soloDamage);
  });

  it('その目標を攻撃できない駒は攻撃支援に寄与しない', () => {
    // 対空ミサイル車は地上目標への matchup が 0
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'aa_tank', owner: 'blue' },
        { at: [1, 0], type: 'sam_vehicle', owner: 'red' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.attacker.attackSupport).toHaveLength(0);
  });

  it('防御支援には貸す側の DEF がそのまま効く', () => {
    const alone = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'infantry', owner: 'blue' },
      ],
    );
    const soloDamage = forecastCombat(alone.data, alone.state, 1, 2).damageToDefender;

    const shielded = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'infantry', owner: 'blue' },
        { at: [2, 2], type: 'mine', owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(shielded.data, shielded.state, 1, 2);
    // 地雷は DEF 5.00 で全ユニット最硬。隣に置くと歩兵が見違えるほど硬くなる
    expect(forecast.defender.defenseSupport).toHaveLength(1);
    expect(forecast.damageToDefender).toBeLessThan(soloDamage);
  });

  it('損耗した駒は攻撃支援も弱い', () => {
    const full = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'aa_tank', owner: 'blue' },
        { at: [1, 0], type: 'assault_tank', owner: 'red', strength: 10 },
      ],
    );
    const weak = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'aa_tank', owner: 'blue' },
        { at: [1, 0], type: 'assault_tank', owner: 'red', strength: 2 },
      ],
    );
    const strong = forecastCombat(full.data, full.state, 1, 2).attacker.attackSupport[0]!.amount;
    const weakened = forecastCombat(weak.data, weak.state, 1, 2).attacker.attackSupport[0]!.amount;
    expect(weakened).toBeCloseTo(strong * 0.2);
  });

  it('通信妨害車が隣接すると支援が無効になる', () => {
    // 攻撃側 (1,1) の隣に味方の支援と敵の妨害車を並べる
    const ring = ringOf(1, 1, 4, 3);
    const { data, state } = build(
      ['rrrr', 'rrrr', 'rrrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: ring[0]!, type: 'aa_tank', owner: 'blue' },
        { at: ring[1]!, type: 'assault_tank', owner: 'red' },
        { at: ring[2]!, type: 'jammer', owner: 'blue' },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.attacker.supportSuppressed).toBe(true);
    expect(forecast.attacker.attackSupport).toHaveLength(0);
  });
});

describe('地形効果', () => {
  it('地形が硬いほど被ダメージが減る', () => {
    const damageOn = (tile: string): number => {
      const { data, state } = build(
        [`rrr`, `r${tile}r`, `rrr`],
        [
          { at: [0, 1], type: 'mbt', owner: 'red' },
          { at: [1, 1], type: 'infantry', owner: 'blue' },
        ],
      );
      return forecastCombat(data, state, 1, 2).damageToDefender;
    };
    expect(damageOn('r')).toBeGreaterThanOrEqual(damageOn('.'));
    expect(damageOn('.')).toBeGreaterThanOrEqual(damageOn('h'));
    expect(damageOn('h')).toBeGreaterThanOrEqual(damageOn('m'));
  });

  it('航空ユニットは地形に守られない', () => {
    const onMountain = build(
      ['rrr', 'rmr', 'rrr'],
      [
        { at: [0, 1], type: 'aa_tank', owner: 'red' },
        { at: [1, 1], type: 'fighter', owner: 'blue' },
      ],
    );
    const onRoad = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'aa_tank', owner: 'red' },
        { at: [1, 1], type: 'fighter', owner: 'blue' },
      ],
    );
    expect(forecastCombat(onMountain.data, onMountain.state, 1, 2).damageToDefender).toBe(
      forecastCombat(onRoad.data, onRoad.state, 1, 2).damageToDefender,
    );
  });
});

describe('ダメージの丸め', () => {
  it('最硬の状態でも必ず1以上削れる（無敵は存在しない・第4.4章）', () => {
    // 要塞戦車が丘陵に立ち、隣接5体の重装戦車に守られる
    const { data, state } = build(
      ['hhh', 'hhh', 'hhh'],
      [
        { at: [1, 1], type: 'fortress_tank', owner: 'blue' },
        { at: [1, 0], type: 'heavy_tank', owner: 'blue' },
        { at: [0, 0], type: 'heavy_tank', owner: 'blue' },
        { at: [0, 1], type: 'heavy_tank', owner: 'blue' },
        { at: [2, 0], type: 'heavy_tank', owner: 'blue' },
        { at: [2, 1], type: 'heavy_tank', owner: 'blue' },
        { at: [1, 2], type: 'infantry', owner: 'red' },
      ],
    );
    const attacker = state.units.find((unit) => unit.owner === 'red')!;
    const fortress = state.units.find((unit) => unit.type === 'fortress_tank')!;
    const forecast = forecastCombat(data, state, attacker.id, fortress.id);
    expect(forecast.damageToDefender).toBeGreaterThanOrEqual(1);
  });

  it('残りの戦力を超えるダメージにはならない', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'assault_tank', owner: 'red' },
        { at: [1, 1], type: 'infantry', owner: 'blue', strength: 2 },
      ],
    );
    const forecast = forecastCombat(data, state, 1, 2);
    expect(forecast.damageToDefender).toBe(2);
    expect(forecast.defenderDestroyed).toBe(true);
  });

  it('弱った敵にとどめを刺すときの反撃はごく小さい', () => {
    const healthy = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [1, 1], type: 'mbt', owner: 'blue', strength: 10 },
      ],
    );
    const dying = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [1, 1], type: 'mbt', owner: 'blue', strength: 1 },
      ],
    );
    expect(forecastCombat(dying.data, dying.state, 1, 2).damageToAttacker).toBeLessThan(
      forecastCombat(healthy.data, healthy.state, 1, 2).damageToAttacker,
    );
  });
});

describe('攻撃できる相手', () => {
  it('射程内の敵だけを返す', () => {
    const { data, state } = build(
      ['rrrrr'],
      [
        { at: [0, 0], type: 'spg', owner: 'red' },
        { at: [1, 0], type: 'mbt', owner: 'blue' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
        { at: [4, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    // 自走砲の射程は 2〜4。隣接には撃てない
    const targets = attackableTargets(data, state, 1).map((unit) => unit.id);
    expect(targets).toEqual([3, 4]);
  });

  it('潜水艦を狙えるのは対潜手段を持つ駒だけ', () => {
    const { data, state } = build(
      ['sssss', 'sssss', 'sssss'],
      [
        { at: [0, 1], type: 'corvette', owner: 'red' },
        { at: [1, 1], type: 'submarine', owner: 'blue' },
        { at: [4, 1], type: 'destroyer', owner: 'red' },
      ],
    );
    expect(attackableTargets(data, state, 1)).toHaveLength(0);
    // 駆逐艦なら狙える（潜水艦の隣まで進んだ場合）
    expect(attackableTargets(data, state, 3, at(2, 1))).toHaveLength(1);
  });

  it('移動先を指定すると、その位置からの射程で判定する', () => {
    const { data, state } = build(
      ['rrrr'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [3, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    expect(attackableTargets(data, state, 1)).toHaveLength(0);
    expect(attackableTargets(data, state, 1, at(2, 0))).toHaveLength(1);
  });
});
