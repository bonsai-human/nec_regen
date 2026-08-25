import { describe, expect, it } from 'vitest';
import { loadTerrain, loadUnits, parseMap, parseTerrain, parseUnits, SchemaError } from '@/data';

/**
 * 「不正なマップは明示的なエラーで落とす」（実装計画書 第5.3章）の検証。
 * 落ちること自体より、**何が悪いのかがメッセージから分かること**を確かめる。
 */

const context = { units: loadUnits(), terrain: loadTerrain() };

type Json = Record<string, unknown>;

/** 5×3 の平地。ここに問題を1つずつ差し込んで、確実に弾かれることを見る。 */
function baseMap(overrides: Json = {}): Json {
  return {
    id: 'test_map',
    name: 'テスト',
    width: 5,
    height: 3,
    turnLimit: 10,
    victory: ['annihilation'],
    factions: ['red', 'blue'],
    tiles: [
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
    ],
    facilities: [],
    units: [
      { hex: [0, 0], type: 'infantry', owner: 'red', strength: 10 },
      { hex: [4, 2], type: 'infantry', owner: 'blue', strength: 10 },
    ],
    ...overrides,
  };
}

function issuesOf(map: Json): string[] {
  try {
    parseMap(map, context, 'test_map.json');
  } catch (error) {
    if (error instanceof SchemaError) return [...error.issues];
    throw error;
  }
  throw new Error('検証に失敗しませんでした');
}

describe('マップの検証', () => {
  it('基準となるマップはそのまま通る', () => {
    expect(() => parseMap(baseMap(), context, 'test_map.json')).not.toThrow();
  });

  it('存在しない地形 ID を弾く', () => {
    const tiles = baseMap()['tiles'] as string[][];
    const broken = tiles.map((row) => [...row]);
    broken[1]![2] = 'lava';
    const issues = issuesOf(baseMap({ tiles: broken }));
    expect(issues.join('\n')).toContain('存在しない地形です: lava');
    expect(issues.join('\n')).toContain('map.tiles[1][2]');
  });

  it('範囲外の座標を弾く', () => {
    const issues = issuesOf(
      baseMap({ units: [{ hex: [9, 9], type: 'infantry', owner: 'red', strength: 10 }] }),
    );
    expect(issues.join('\n')).toContain('盤外の座標です: (9, 9)');
  });

  it('初期ユニットの重複配置を弾く', () => {
    const issues = issuesOf(
      baseMap({
        units: [
          { hex: [1, 1], type: 'infantry', owner: 'red', strength: 10 },
          { hex: [1, 1], type: 'mbt', owner: 'red', strength: 10 },
        ],
      }),
    );
    expect(issues.join('\n')).toContain('ユニットが重複配置されています: (1, 1)');
  });

  it('増援の出現余地がない施設を弾く', () => {
    // 中央の工場を外洋で囲むと、戦車の増援は永久に出られない
    const issues = issuesOf(
      baseMap({
        tiles: [
          ['sea', 'sea', 'sea', 'sea', 'sea'],
          ['sea', 'sea', 'factory', 'sea', 'sea'],
          ['sea', 'sea', 'sea', 'sea', 'sea'],
        ],
        units: [],
        facilities: [{ hex: [2, 1], kind: 'factory', owner: 'red', garrison: ['mbt'] }],
      }),
    );
    expect(issues.join('\n')).toContain('主力戦車 を搬出できる隣接ヘクスがありません');
  });

  it('施設と地形の食い違いを弾く', () => {
    const issues = issuesOf(
      baseMap({
        facilities: [{ hex: [2, 1], kind: 'factory', owner: 'red', garrison: [] }],
      }),
    );
    expect(issues.join('\n')).toContain('地形 plain の上に factory は置けません');
  });

  it('司令部占領を勝敗条件にするなら全陣営に司令部が要る', () => {
    const tiles = [
      ['hq', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    const issues = issuesOf(
      baseMap({
        tiles,
        victory: ['hq'],
        units: [],
        facilities: [{ hex: [0, 0], kind: 'hq', owner: 'red', garrison: [] }],
      }),
    );
    expect(issues.join('\n')).toContain('陣営 blue の司令部がない');
  });

  it('自軍以外の施設ヘクスに占領できない駒は置けない（第4.6章）', () => {
    const tiles = [
      ['factory', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    const issues = issuesOf(
      baseMap({
        tiles,
        facilities: [{ hex: [0, 0], kind: 'factory', owner: null, garrison: [] }],
        units: [{ hex: [0, 0], type: 'mbt', owner: 'red', strength: 10 }],
      }),
    );
    expect(issues.join('\n')).toContain('主力戦車 は自軍以外の施設ヘクスに配置できません');
  });

  it('進入できない地形へのユニット配置を弾く', () => {
    const tiles = [
      ['sea', 'sea', 'sea', 'sea', 'sea'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    const issues = issuesOf(
      baseMap({
        tiles,
        units: [{ hex: [0, 0], type: 'infantry', owner: 'red', strength: 10 }],
      }),
    );
    expect(issues.join('\n')).toContain('歩兵 は 外洋 に配置できません');
  });

  it('潜水艦に対する回答がないマップを弾く（第4.5章）', () => {
    const tiles = [
      ['sea', 'sea', 'sea', 'sea', 'sea'],
      ['sea', 'sea', 'sea', 'sea', 'sea'],
      ['sea', 'sea', 'sea', 'sea', 'sea'],
    ];
    const withoutAnswer = issuesOf(
      baseMap({
        tiles,
        units: [
          { hex: [0, 0], type: 'submarine', owner: 'red', strength: 10 },
          { hex: [4, 2], type: 'corvette', owner: 'blue', strength: 10 },
        ],
      }),
    );
    expect(withoutAnswer.join('\n')).toContain('陣営 blue に対潜手段がありません');

    // 駆逐艦を置けば通る
    expect(() =>
      parseMap(
        baseMap({
          tiles,
          units: [
            { hex: [0, 0], type: 'submarine', owner: 'red', strength: 10 },
            { hex: [4, 2], type: 'destroyer', owner: 'blue', strength: 10 },
          ],
        }),
        context,
        'test_map.json',
      ),
    ).not.toThrow();
  });

  it('タイルの行数・列数の食い違いを弾く', () => {
    const issues = issuesOf(baseMap({ tiles: [['plain', 'plain']] }));
    expect(issues.join('\n')).toContain('3 行必要ですが 1 行あります');
    expect(issues.join('\n')).toContain('5 列必要ですが 2 列あります');
  });

  it('施設の中身の不備を弾く', () => {
    const tiles = [
      ['factory', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    const unknownType = issuesOf(
      baseMap({
        tiles,
        units: [],
        facilities: [{ hex: [0, 0], kind: 'factory', owner: 'red', garrison: ['nonexistent'] }],
      }),
    );
    expect(unknownType.join('\n')).toContain('存在しないユニット種別です: nonexistent');

    // 出現間隔という概念はない。施設は格納庫なので、中身の指定だけで完結する
    const legacy = issuesOf(
      baseMap({
        tiles,
        units: [],
        facilities: [
          { hex: [0, 0], kind: 'factory', owner: 'red', garrison: ['infantry'], interval: 3 },
        ],
      }),
    );
    expect(legacy.join('\n')).toContain('map.facilities[0].interval: 未知のフィールドです');
  });

  it('未知のフィールドと未知の陣営を弾く', () => {
    const issues = issuesOf(baseMap({ enemyAi: 'hard' }));
    expect(issues.join('\n')).toContain('map.enemyAi: 未知のフィールドです');

    const badOwner = issuesOf(
      baseMap({ units: [{ hex: [1, 1], type: 'infantry', owner: 'green', strength: 10 }] }),
    );
    expect(badOwner.join('\n')).toContain('red / blue のいずれか');
  });

  it('問題は1件目で止めず、まとめて報告する', () => {
    const issues = issuesOf(
      baseMap({
        units: [
          { hex: [9, 9], type: 'infantry', owner: 'red', strength: 10 },
          { hex: [1, 1], type: 'nonexistent', owner: 'red', strength: 10 },
          { hex: [2, 2], type: 'infantry', owner: 'red', strength: 99 },
        ],
      }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('units.json の検証', () => {
  function unit(overrides: Json = {}): Json {
    return {
      id: 'test_unit',
      name: 'テスト',
      designRole: 'テスト用',
      movementType: 'track',
      movePoints: 6,
      armorClass: 'armor',
      defense: 1.65,
      power: { ground: 10, air: 0 },
      matchup: { infantry: 1.0, light: 1.0, armor: 1.0, ship: 0.85, sub: 0 },
      range: { min: 1, max: 1 },
      indirect: false,
      attackDuringMove: false,
      noCounter: false,
      canCapture: false,
      canDetectSub: false,
      suppressSupport: false,
      reloadTurns: 0,
      cargo: { capacity: 0, allow: {} },
      value: 400,
      sprite: 'test',
      ...overrides,
    };
  }

  function unitIssues(overrides: Json): string {
    try {
      parseUnits([unit(overrides)], 'test');
    } catch (error) {
      if (error instanceof SchemaError) return error.issues.join('\n');
      throw error;
    }
    throw new Error('検証に失敗しませんでした');
  }

  it('基準となる定義はそのまま通る', () => {
    expect(() => parseUnits([unit()], 'test')).not.toThrow();
  });

  it('matchup は5段階の値しか受け付けない', () => {
    expect(
      unitIssues({ matchup: { infantry: 1.3, light: 1, armor: 1, ship: 1, sub: 0 } }),
    ).toContain('matchup.infantry');
  });

  it('攻撃力と射程の食い違いを弾く', () => {
    expect(unitIssues({ power: { ground: 0, air: 0 } })).toContain(
      '攻撃力を持たないユニットに射程は指定できません',
    );
    expect(unitIssues({ range: null })).toContain('攻撃力を持つユニットには射程が必要です');
  });

  it('移動タイプと移動力の食い違いを弾く', () => {
    expect(unitIssues({ movementType: null })).toContain(
      '移動タイプを持たないユニットの移動力は0である必要があります',
    );
    expect(unitIssues({ movePoints: 0 })).toContain('移動力0のユニットは移動タイプを持ちません');
  });

  it('間接砲が移動中に攻撃する定義を弾く', () => {
    expect(unitIssues({ indirect: true, attackDuringMove: true })).toContain(
      '移動後に攻撃できない間接砲が、移動中に攻撃することはできません',
    );
  });

  it('最小射程が最大射程を超える定義を弾く', () => {
    expect(unitIssues({ range: { min: 4, max: 2 } })).toContain('最小射程が最大射程を超えています');
  });

  it('積載の矛盾を弾く', () => {
    expect(unitIssues({ cargo: { capacity: 0, allow: { infantry: 1 } } })).toContain(
      '積載量0のユニットに積載対象は指定できません',
    );
    expect(unitIssues({ cargo: { capacity: 2, allow: {} } })).toContain(
      '積載量があるのに積載対象が指定されていません',
    );
    expect(unitIssues({ cargo: { capacity: 2, allow: { armor: 3 } } })).toContain(
      '消費枠 3 が積載量 2 を超えています',
    );
  });

  it('未知のフィールドと ID の重複を弾く', () => {
    expect(unitIssues({ cost: 400 })).toContain('未知のフィールドです');
    let message = '';
    try {
      parseUnits([unit(), unit()], 'test');
    } catch (error) {
      message = error instanceof SchemaError ? error.issues.join('\n') : '';
    }
    expect(message).toContain('ID が重複しています: test_unit');
  });
});

describe('terrain.json の検証', () => {
  function terrain(overrides: Json = {}): Json {
    return {
      id: 'test_terrain',
      name: 'テスト',
      tier: 1,
      moveCost: { foot: 1, track: 1, wheel: 2, air: 1, ship: null, sub: null },
      defense: 1.1,
      ...overrides,
    };
  }

  it('基準となる定義はそのまま通る', () => {
    expect(() => parseTerrain([terrain()], 'test')).not.toThrow();
  });

  it('航空コストが1でない定義を弾く', () => {
    expect(() =>
      parseTerrain(
        [terrain({ moveCost: { foot: 1, track: 1, wheel: 2, air: 2, ship: null, sub: null } })],
        'test',
      ),
    ).toThrow(/航空はすべての地形をコスト1で通る/);
  });

  it('コスト0（実質無限移動）を弾く', () => {
    expect(() =>
      parseTerrain(
        [terrain({ moveCost: { foot: 0, track: 1, wheel: 2, air: 1, ship: null, sub: null } })],
        'test',
      ),
    ).toThrow(/1 以上/);
  });

  it('移動タイプの綴り間違いを弾く', () => {
    expect(() =>
      parseTerrain(
        [terrain({ moveCost: { foot: 1, track: 1, wheels: 2, air: 1, ship: null, sub: null } })],
        'test',
      ),
    ).toThrow(/未知のフィールドです/);
  });
});
