import { describe, expect, it } from 'vitest';
import { hexKey, toAxial, type Hex } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import {
  findPath,
  moveCostFor,
  reachableHexes,
  stoppableHexes,
  validatePath,
  zocHexes,
} from '@/core/movement';
import { createInitialState } from '@/core/state';
import { loadTerrain, loadUnits, parseMap } from '@/data';
import type { GameState, UnitTypeId } from '@/core/types';

const units = loadUnits();
const terrain = loadTerrain();

/**
 * 移動のテストは**地形を1文字で書いた小さな盤**で行う。
 * 何が効いているのかが一目で分かる形にしておかないと、
 * 失敗したときに原因を追えなくなる。
 */
const LEGEND: Record<string, string> = {
  '.': 'plain',
  r: 'road',
  h: 'hill',
  f: 'forest',
  x: 'badlands',
  m: 'mountain',
  '~': 'river',
  s: 'sea',
  F: 'factory',
  Q: 'hq',
};

interface Placement {
  readonly at: [number, number];
  readonly type: UnitTypeId;
  readonly owner: string;
}

function build(
  rows: string[],
  placements: Placement[] = [],
  facilities: unknown[] = [],
): { data: GameData; state: GameState } {
  const tiles = rows.map((row) => [...row].map((ch) => LEGEND[ch] ?? 'plain'));
  const raw = {
    id: 'test',
    name: 'テスト',
    width: tiles[0]?.length ?? 0,
    height: tiles.length,
    turnLimit: 20,
    victory: ['annihilation'],
    factions: ['red', 'blue'],
    tiles,
    facilities,
    units: placements.map((placement) => ({
      hex: placement.at,
      type: placement.type,
      owner: placement.owner,
      strength: 10,
    })),
  };
  const map = parseMap(raw, { units, terrain }, 'test.json');
  const data: GameData = { board: createBoard(map), map, units, terrain };
  return { data, state: createInitialState(data) };
}

function at(col: number, row: number): Hex {
  return toAxial({ col, row });
}

function costTo(
  data: GameData,
  state: GameState,
  unitId: number,
  col: number,
  row: number,
): number | undefined {
  return reachableHexes(data, state, unitId).get(hexKey(at(col, row)))?.cost;
}

describe('地形コスト（第5.2章の階段構造）', () => {
  const { data } = build(['.rhxm']);

  it('移動タイプごとにコストが変わる', () => {
    const infantry = units.get('infantry')!;
    const mbt = units.get('mbt')!;
    const bike = units.get('bike_infantry')!;

    // 道路はどの移動タイプでも1
    expect(moveCostFor(data, infantry, at(1, 0))).toBe(1);
    expect(moveCostFor(data, mbt, at(1, 0))).toBe(1);
    expect(moveCostFor(data, bike, at(1, 0))).toBe(1);

    // 丘陵は 歩1 / 装甲2 / タイヤ3
    expect(moveCostFor(data, infantry, at(2, 0))).toBe(1);
    expect(moveCostFor(data, mbt, at(2, 0))).toBe(2);
    expect(moveCostFor(data, bike, at(2, 0))).toBe(3);
  });

  it('タイヤは荒地から先へ進めない', () => {
    expect(moveCostFor(data, units.get('bike_infantry')!, at(3, 0))).toBeNull();
    expect(moveCostFor(data, units.get('mbt')!, at(3, 0))).toBe(3);
  });

  it('山岳に入れるのは徒歩系だけ。多脚戦車は入れて主力戦車は入れない', () => {
    expect(moveCostFor(data, units.get('infantry')!, at(4, 0))).toBe(2);
    expect(moveCostFor(data, units.get('heavy_infantry')!, at(4, 0))).toBe(2);
    expect(moveCostFor(data, units.get('walker')!, at(4, 0))).toBe(2);
    expect(moveCostFor(data, units.get('mbt')!, at(4, 0))).toBeNull();
  });

  it('要塞戦車が荒地に入れないのは移動力2でコスト3を払えないから（第4.3章）', () => {
    const fortress = units.get('fortress_tank')!;
    expect(fortress.movePoints).toBe(2);
    // 地形表のコスト自体は track の 3 で、進入不可の「−」ではない
    expect(terrain.get('badlands')?.moveCost.track).toBe(3);
    expect(moveCostFor(data, fortress, at(3, 0))).toBeNull();
  });

  it('移動タイプを持たない駒はどこへも進入できない', () => {
    expect(moveCostFor(data, units.get('heavy_artillery')!, at(1, 0))).toBeNull();
    expect(moveCostFor(data, units.get('mine')!, at(1, 0))).toBeNull();
  });
});

describe('到達範囲', () => {
  it('道路を進むバイク兵は移動力9ぶん遠くまで届く', () => {
    const { data, state } = build(
      ['rrrrrrrrrr'],
      [{ at: [0, 0], type: 'bike_infantry', owner: 'red' }],
    );
    expect(costTo(data, state, 1, 9, 0)).toBe(9);
  });

  it('平地ではタイヤのコストが2倍になり、届く距離が半分になる', () => {
    const { data, state } = build(
      ['..........'],
      [{ at: [0, 0], type: 'bike_infantry', owner: 'red' }],
    );
    expect(costTo(data, state, 1, 4, 0)).toBe(8);
    expect(costTo(data, state, 1, 5, 0)).toBeUndefined();
  });

  it('歩兵は遅いが地形を選ばない', () => {
    const { data, state } = build(['.mmm'], [{ at: [0, 0], type: 'infantry', owner: 'red' }]);
    // 山岳はコスト2。移動力3では1つだけ越えられる
    expect(costTo(data, state, 1, 1, 0)).toBe(2);
    expect(costTo(data, state, 1, 2, 0)).toBeUndefined();
  });

  it('移動力0の駒は出発地点から動けない', () => {
    const { data, state } = build(['...'], [{ at: [1, 0], type: 'heavy_artillery', owner: 'red' }]);
    const reachable = reachableHexes(data, state, 1);
    expect([...reachable.keys()]).toEqual([hexKey(at(1, 0))]);
  });

  it('味方のヘクスは通過できるが停止できない', () => {
    const { data, state } = build(
      ['.....'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [1, 0], type: 'infantry', owner: 'red' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    expect(reachable.get(hexKey(at(1, 0)))?.canStop).toBe(false);
    // 味方を飛び越えた先には停止できる
    expect(reachable.get(hexKey(at(2, 0)))?.canStop).toBe(true);
  });

  it('敵ユニットのいるヘクスは通過できない', () => {
    // 1列しかないので、敵が道を完全に塞ぐ
    const { data, state } = build(
      ['....'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [1, 0], type: 'infantry', owner: 'blue' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    expect(reachable.has(hexKey(at(1, 0)))).toBe(false);
    expect(reachable.has(hexKey(at(2, 0)))).toBe(false);
  });

  it('外洋は艦艇だけが進める', () => {
    const { data, state } = build(['.sss'], [{ at: [0, 0], type: 'infantry', owner: 'red' }]);
    expect(reachableHexes(data, state, 1).has(hexKey(at(1, 0)))).toBe(false);

    const sea = build(['ssss'], [{ at: [0, 0], type: 'destroyer', owner: 'red' }]);
    expect(reachableHexes(sea.data, sea.state, 1).has(hexKey(at(3, 0)))).toBe(true);
  });

  it('到達範囲は呼ぶたびに同じ結果になる（決定性）', () => {
    const { data, state } = build(
      ['.r.h.', 'f.x.f', '.h.r.'],
      [{ at: [0, 0], type: 'mbt', owner: 'red' }],
    );
    const first = [...reachableHexes(data, state, 1).entries()].map(
      ([key, value]) => `${key}:${value.cost}:${value.path.map(hexKey).join('>')}`,
    );
    const second = [...reachableHexes(data, state, 1).entries()].map(
      ([key, value]) => `${key}:${value.cost}:${value.path.map(hexKey).join('>')}`,
    );
    expect(first).toEqual(second);
  });
});

describe('ZOC（第4.3章）', () => {
  it('敵に隣接するヘクスが ZOC になる。航空ユニットは ZOC を生まない', () => {
    const { data, state } = build(
      ['.....', '.....', '.....'],
      [{ at: [2, 1], type: 'mbt', owner: 'blue' }],
    );
    const zoc = zocHexes(data, state, 'red');
    expect(zoc.size).toBe(6);
    expect(zoc.has(hexKey(at(2, 0)))).toBe(true);
    expect(zoc.has(hexKey(at(2, 1)))).toBe(false); // 敵自身のヘクスは ZOC ではない

    const air = build(
      ['.....', '.....', '.....'],
      [{ at: [2, 1], type: 'fighter', owner: 'blue' }],
    );
    expect(zocHexes(air.data, air.state, 'red').size).toBe(0);
  });

  it('どの経路も ZOC ヘクスへ続けて進入しない', () => {
    const { data, state } = build(
      ['rrrrrr', 'rrrrrr', 'rrrrrr'],
      [
        { at: [0, 1], type: 'bike_infantry', owner: 'red' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
        { at: [3, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    const zoc = zocHexes(data, state, 'red');
    const reachable = reachableHexes(data, state, 1);
    expect(reachable.size).toBeGreaterThan(1);

    for (const entry of reachable.values()) {
      // 出発地点は判定の対象外（そこから出る一歩は連続進入に当たらない）
      for (let i = 2; i < entry.path.length; i++) {
        const previous = zoc.has(hexKey(entry.path[i - 1]!));
        const current = zoc.has(hexKey(entry.path[i]!));
        expect(previous && current, entry.path.map(hexKey).join(' > ')).toBe(false);
      }
    }
  });

  it('ZOC が連続する場所は、その手前で足が止まる', () => {
    // 奇数列のヘクスは下の行の3ヘクスに接するので、敵1体で ZOC が3つ並ぶ
    const { data, state } = build(
      ['rrrrrr', 'rrrrrr'],
      [
        { at: [0, 1], type: 'bike_infantry', owner: 'red' },
        { at: [3, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    const zoc = zocHexes(data, state, 'red');
    for (const col of [2, 3, 4]) {
      expect(zoc.has(hexKey(at(col, 1))), `(${col}, 1)`).toBe(true);
    }

    const reachable = reachableHexes(data, state, 1);
    // 迂回路のない2行の盤なので、連続する2つ目の ZOC には入れない
    expect(reachable.has(hexKey(at(2, 1)))).toBe(true);
    expect(reachable.has(hexKey(at(3, 1)))).toBe(false);
    // 敵の向こう側へも回り込めない（戦線が成立している）
    expect(reachable.has(hexKey(at(5, 1)))).toBe(false);
  });

  it('ZOC を1つだけ通り抜けるのは許される（単独の敵の脇をかすめる）', () => {
    const { data, state } = build(
      ['rrrrrr', 'rrrrrr', 'rrrrrr'],
      [
        { at: [0, 1], type: 'bike_infantry', owner: 'red' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    expect(reachable.has(hexKey(at(2, 1)))).toBe(true); // ZOC へ1回進入
    expect(reachable.has(hexKey(at(3, 1)))).toBe(true); // 抜けた先
    expect(reachable.has(hexKey(at(5, 1)))).toBe(true);
  });

  it('出発地点が ZOC 内でも、そこから出る一歩は連続進入に当たらない', () => {
    const { data, state } = build(
      ['rrrr', 'rrrr'],
      [
        { at: [1, 1], type: 'bike_infantry', owner: 'red' },
        { at: [1, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    // 出発地点 (1,1) は敵 (1,0) の ZOC。そこから普通に動ける
    expect(reachable.has(hexKey(at(3, 1)))).toBe(true);
  });

  it('航空ユニットは ZOC の影響を受けない', () => {
    const { data, state } = build(
      ['rrrrrr', 'rrrrrr'],
      [
        { at: [0, 1], type: 'fighter', owner: 'red' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
        { at: [3, 0], type: 'mbt', owner: 'blue' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    expect(reachable.has(hexKey(at(3, 1)))).toBe(true);
  });

  it('戦線を張ると突破できない', () => {
    // 敵を縦に並べて壁を作る。壁の左右が連続 ZOC になり、抜けられない
    const { data, state } = build(
      ['rrrrr', 'rrrrr', 'rrrrr', 'rrrrr'],
      [
        { at: [0, 1], type: 'bike_infantry', owner: 'red' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
        { at: [2, 1], type: 'mbt', owner: 'blue' },
        { at: [2, 2], type: 'mbt', owner: 'blue' },
        { at: [2, 3], type: 'mbt', owner: 'blue' },
      ],
    );
    const reachable = reachableHexes(data, state, 1);
    for (let row = 0; row < 4; row++) {
      expect(reachable.has(hexKey(at(3, row))), `(3, ${row})`).toBe(false);
      expect(reachable.has(hexKey(at(4, row))), `(4, ${row})`).toBe(false);
    }
  });
});

describe('施設への進入（第4.6章）', () => {
  const facilities = [{ hex: [2, 0], kind: 'factory', owner: null, queue: [], interval: 0 }];

  it('未占領の工場には占領できる駒しか入れない', () => {
    const tank = build(['..F..'], [{ at: [0, 0], type: 'mbt', owner: 'red' }], facilities);
    expect(reachableHexes(tank.data, tank.state, 1).has(hexKey(at(2, 0)))).toBe(false);

    const infantry = build(['..F..'], [{ at: [0, 0], type: 'infantry', owner: 'red' }], facilities);
    expect(reachableHexes(infantry.data, infantry.state, 1).has(hexKey(at(2, 0)))).toBe(true);
  });

  it('自軍の工場には誰でも入れる（修理のため）', () => {
    const owned = [{ hex: [2, 0], kind: 'factory', owner: 'red', queue: [], interval: 0 }];
    const tank = build(['..F..'], [{ at: [0, 0], type: 'mbt', owner: 'red' }], owned);
    expect(reachableHexes(tank.data, tank.state, 1).has(hexKey(at(2, 0)))).toBe(true);
  });
});

describe('経路', () => {
  it('最短コストの経路を返す', () => {
    // 上の道路（コスト1）と下の丘陵（コスト2）。道路側が選ばれる
    const { data, state } = build(['rrrr', '.hh.'], [{ at: [0, 1], type: 'mbt', owner: 'red' }]);
    const path = findPath(data, state, 1, at(3, 1));
    expect(path).not.toBeNull();
    // 上の道路（1+1+1+1=4）を通る。丘陵を2つ踏むと 2+2+1=5 になるので選ばれない
    expect(reachableHexes(data, state, 1).get(hexKey(at(3, 1)))?.cost).toBe(4);
    expect(path?.map(hexKey)).not.toContain(hexKey(at(1, 1)));
  });

  it('届かない場所には経路が出ない', () => {
    const { data, state } = build(['..mmm..'], [{ at: [0, 0], type: 'mbt', owner: 'red' }]);
    expect(findPath(data, state, 1, at(6, 0))).toBeNull();
  });

  it('停止できないヘクスは目的地にできない', () => {
    const { data, state } = build(
      ['...'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [1, 0], type: 'infantry', owner: 'red' },
      ],
    );
    expect(findPath(data, state, 1, at(1, 0))).toBeNull();
  });
});

describe('経路の検証', () => {
  const scenario = (): { data: GameData; state: GameState } =>
    build(
      ['rrrr', 'rrrr'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [2, 0], type: 'mbt', owner: 'blue' },
      ],
    );

  it('正しい経路は通る', () => {
    const { data, state } = scenario();
    expect(validatePath(data, state, 1, [at(0, 0), at(1, 0)])).toBeNull();
  });

  it('現在位置から始まらない経路を弾く', () => {
    const { data, state } = scenario();
    expect(validatePath(data, state, 1, [at(1, 0), at(1, 1)])).toMatch(/現在位置/);
  });

  it('繋がっていない経路を弾く', () => {
    const { data, state } = scenario();
    expect(validatePath(data, state, 1, [at(0, 0), at(3, 1)])).toMatch(/繋がって/);
  });

  it('移動力を超える経路を弾く', () => {
    const { data, state } = build(['hhhhh'], [{ at: [0, 0], type: 'assault_tank', owner: 'red' }]);
    // 突撃戦車は移動力4。丘陵コスト2なので2ヘクスまで
    expect(validatePath(data, state, 1, [at(0, 0), at(1, 0), at(2, 0)])).toBeNull();
    expect(validatePath(data, state, 1, [at(0, 0), at(1, 0), at(2, 0), at(3, 0)])).toMatch(
      /移動力/,
    );
  });

  it('同じヘクスを2度通る経路を弾く', () => {
    const { data, state } = scenario();
    expect(validatePath(data, state, 1, [at(0, 0), at(1, 0), at(0, 0)])).toMatch(/同じヘクス/);
  });

  it('敵のヘクスを通る経路を弾く', () => {
    const { data, state } = scenario();
    expect(validatePath(data, state, 1, [at(0, 0), at(1, 0), at(2, 0)])).toMatch(/敵ユニット/);
  });
});

describe('停止できるヘクスの一覧', () => {
  it('通過専用のヘクスを除いた一覧を返す', () => {
    const { data, state } = build(
      ['....'],
      [
        { at: [0, 0], type: 'mbt', owner: 'red' },
        { at: [1, 0], type: 'infantry', owner: 'red' },
      ],
    );
    const stoppable = stoppableHexes(reachableHexes(data, state, 1)).map((entry) =>
      hexKey(entry.hex),
    );
    expect(stoppable).toContain(hexKey(at(0, 0)));
    expect(stoppable).not.toContain(hexKey(at(1, 0)));
    expect(stoppable).toContain(hexKey(at(2, 0)));
  });
});
