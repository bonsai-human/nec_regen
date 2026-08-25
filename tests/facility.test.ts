import { describe, expect, it } from 'vitest';
import { hexKey, neighbors, toAxial, toOffset, type Hex } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import { facilityAt, repairsUnit, spawnReinforcements } from '@/core/facility';
import { reduce, reduceAll } from '@/core/reducer';
import { createInitialState } from '@/core/state';
import { evaluateVictory } from '@/core/victory';
import { loadRules, loadTerrain, loadUnits, parseMap } from '@/data';
import type { GameState, UnitTypeId } from '@/core/types';

const units = loadUnits();
const terrain = loadTerrain();
const rules = loadRules();

const LEGEND: Record<string, string> = {
  '.': 'plain',
  r: 'road',
  m: 'mountain',
  s: 'sea',
  F: 'factory',
  Q: 'hq',
  P: 'port',
};

interface Placement {
  readonly at: [number, number];
  readonly type: UnitTypeId;
  readonly owner: string;
  readonly strength?: number;
}

function build(
  rows: string[],
  placements: Placement[] = [],
  facilities: unknown[] = [],
  overrides: Record<string, unknown> = {},
): { data: GameData; state: GameState } {
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
    facilities,
    units: placements.map((placement) => ({
      hex: placement.at,
      type: placement.type,
      owner: placement.owner,
      strength: placement.strength ?? 10,
    })),
    ...overrides,
  };
  const map = parseMap(raw, { units, terrain }, 'test.json');
  const data: GameData = { board: createBoard(map), map, units, terrain, rules };
  return { data, state: createInitialState(data) };
}

function at(col: number, row: number): Hex {
  return toAxial({ col, row });
}

/** 盤内にある隣接ヘクスをオフセットで返す。 */
function ringOf(col: number, row: number, width: number, height: number): [number, number][] {
  return neighbors(at(col, row))
    .map((hex) => toOffset(hex))
    .filter((o) => o.col >= 0 && o.col < width && o.row >= 0 && o.row < height)
    .map((o): [number, number] => [o.col, o.row]);
}

describe('占領（第4.6章）', () => {
  const facilities = [{ hex: [1, 1], kind: 'factory', owner: null, queue: [], interval: 0 }];

  it('歩兵が施設ヘクスの上で占領できる', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      facilities,
    );
    const result = reduce(data, state, { type: 'capture', unitId: 1 });
    expect(facilityAt(result.state, at(1, 1))?.owner).toBe('red');
    expect(result.events[0]).toMatchObject({ type: 'facilityCaptured', owner: 'red' });
    // 占領すると行動終了
    expect(result.state.units.find((unit) => unit.id === 1)?.hasActed).toBe(true);
  });

  it('占領できない駒は占領できない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'mbt', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    expect(() => reduce(data, state, { type: 'capture', unitId: 1 })).toThrow(/占領できません/);
  });

  it('すでに自軍のものなら占領できない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    expect(() => reduce(data, state, { type: 'capture', unitId: 1 })).toThrow(/すでに占領/);
  });

  it('占領した瞬間から増援の時計が動き出す', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: null, queue: ['mbt'], interval: 3 }],
    );
    expect(facilityAt(state, at(1, 1))?.nextSpawnTurn).toBeNull();
    const result = reduce(data, state, { type: 'capture', unitId: 1 });
    expect(facilityAt(result.state, at(1, 1))?.nextSpawnTurn).toBe(state.turn + 3);
  });
});

describe('増援（第4.6章）', () => {
  it('間隔ターンごとにキューの先頭が隣接ヘクスへ出現する', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [{ at: [2, 2], type: 'infantry', owner: 'blue' }],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: ['mbt', 'infantry'], interval: 1 }],
    );
    // 出現ターンに達していなければ何も起きない
    expect(spawnReinforcements(data, state, 'red').spawned).toHaveLength(0);

    const ready: GameState = { ...state, turn: 2 };
    const result = spawnReinforcements(data, ready, 'red');
    expect(result.spawned).toHaveLength(1);

    const spawned = result.spawned[0]!.unit;
    expect(spawned.type).toBe('mbt');
    expect(spawned.strength).toBe(10);
    expect(spawned.exp).toBe(0);
    // 出現したターンは行動済み
    expect(spawned.hasActed).toBe(true);
    // キューが減り、次の出現予定が入る
    const facility = facilityAt(result.state, at(1, 1))!;
    expect(facility.queue).toEqual(['infantry']);
    expect(facility.nextSpawnTurn).toBe(3);
  });

  it('出現位置は決定的で、何度計算しても同じヘクスになる', () => {
    const scenario = (): GameState => {
      const { data, state } = build(
        ['rrr', 'rFr', 'rrr'],
        [{ at: [2, 2], type: 'infantry', owner: 'blue' }],
        [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: ['mbt'], interval: 1 }],
      );
      return spawnReinforcements(data, { ...state, turn: 2 }, 'red').state;
    };
    const first = scenario().units.find((unit) => unit.type === 'mbt')!;
    const second = scenario().units.find((unit) => unit.type === 'mbt')!;
    expect(hexKey(first.hex)).toBe(hexKey(second.hex));
    // 北から時計回りに走査するので、真上が空いていればそこに出る
    expect(toOffset(first.hex)).toEqual({ col: 1, row: 0 });
  });

  it('隣接がすべて塞がっていると出現せず、キューは待機する', () => {
    // 工場の隣接6ヘクスを敵で埋める
    const ring = ringOf(1, 1, 3, 3);
    expect(ring).toHaveLength(6);
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      ring.map((cell) => ({ at: cell, type: 'infantry', owner: 'blue' })),
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: ['mbt'], interval: 1 }],
    );
    const result = spawnReinforcements(data, { ...state, turn: 2 }, 'red');
    expect(result.spawned).toHaveLength(0);
    // キューは減らない
    expect(facilityAt(result.state, at(1, 1))?.queue).toEqual(['mbt']);
  });

  it('ターン開始時に自動で出現する', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [2, 2], type: 'infantry', owner: 'blue' },
        { at: [0, 2], type: 'infantry', owner: 'red' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: ['mbt'], interval: 1 }],
    );
    // 赤 → 青 → 赤 と手番を回すとターンが2になり、赤のターン開始で出現する
    const result = reduceAll(data, state, [{ type: 'endTurn' }, { type: 'endTurn' }]);
    expect(result.state.units.some((unit) => unit.type === 'mbt')).toBe(true);
    expect(result.events.some((event) => event.type === 'reinforcementSpawned')).toBe(true);
  });
});

describe('修理（第4.6章）', () => {
  it('施設の種別ごとに直せるユニットが決まっている', () => {
    const mbt = units.get('mbt')!;
    const destroyer = units.get('destroyer')!;
    const fighter = units.get('fighter')!;

    expect(repairsUnit('factory', mbt)).toBe(true);
    expect(repairsUnit('factory', destroyer)).toBe(false);
    expect(repairsUnit('factory', fighter)).toBe(false);
    expect(repairsUnit('port', destroyer)).toBe(true);
    expect(repairsUnit('airfield', fighter)).toBe(true);
    expect(repairsUnit('hq', mbt)).toBe(true);
  });

  it('自軍施設に入ると即時全快し、その時点で行動終了になる', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 0], type: 'mbt', owner: 'red', strength: 3 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    const result = reduce(data, state, {
      type: 'move',
      unitId: 1,
      path: [at(1, 0), at(1, 1)],
    });
    const repaired = result.state.units.find((unit) => unit.id === 1)!;
    expect(repaired.strength).toBe(10);
    expect(repaired.hasActed).toBe(true);
    expect(result.events.some((event) => event.type === 'unitRepaired')).toBe(true);
  });

  it('満タンの駒は施設に入っても行動終了にならない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 0], type: 'mbt', owner: 'red', strength: 10 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    const result = reduce(data, state, {
      type: 'move',
      unitId: 1,
      path: [at(1, 0), at(1, 1)],
    });
    expect(result.state.units.find((unit) => unit.id === 1)?.hasActed).toBe(false);
  });

  it('敵の施設では修理できない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 0], type: 'infantry', owner: 'red', strength: 3 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'blue', queue: [], interval: 0 }],
    );
    const result = reduce(data, state, {
      type: 'move',
      unitId: 1,
      path: [at(1, 0), at(1, 1)],
    });
    expect(result.state.units.find((unit) => unit.id === 1)?.strength).toBe(3);
  });

  it('熟練度は修理で失われない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 0], type: 'mbt', owner: 'red', strength: 3 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    const veteran: GameState = {
      ...state,
      units: state.units.map((unit) => (unit.id === 1 ? { ...unit, exp: 5 } : unit)),
    };
    const result = reduce(data, veteran, {
      type: 'move',
      unitId: 1,
      path: [at(1, 0), at(1, 1)],
    });
    expect(result.state.units.find((unit) => unit.id === 1)?.exp).toBe(5);
  });
});

describe('勝敗判定（第4.8章）', () => {
  it('敵を全滅させると勝ち', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'assault_tank', owner: 'red' },
        { at: [1, 1], type: 'infantry', owner: 'blue', strength: 1 },
      ],
    );
    const result = reduce(data, state, { type: 'attack', unitId: 1, targetId: 2 });
    expect(result.state.outcome).toEqual({ winner: 'red', reason: 'annihilation' });
    expect(result.events.some((event) => event.type === 'gameEnded')).toBe(true);
  });

  it('司令部を奪われると負け', () => {
    const { data, state } = build(
      ['Qrr', 'rQr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [
        { hex: [1, 1], kind: 'hq', owner: 'blue', queue: [], interval: 0 },
        { hex: [0, 0], kind: 'hq', owner: 'red', queue: [], interval: 0 },
      ],
      { victory: ['hq'] },
    );
    const result = reduce(data, state, { type: 'capture', unitId: 1 });
    expect(result.state.outcome).toEqual({ winner: 'red', reason: 'hq' });
  });

  it('決着後はコマンドを受け付けない', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'assault_tank', owner: 'red' },
        { at: [1, 1], type: 'infantry', owner: 'blue', strength: 1 },
      ],
    );
    const finished = reduce(data, state, { type: 'attack', unitId: 1, targetId: 2 }).state;
    expect(() => reduce(data, finished, { type: 'endTurn' })).toThrow(/決着/);
  });

  it('ターン制限を超えると残存戦力で判定する', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'infantry', owner: 'blue', strength: 1 },
      ],
      [],
      { turnLimit: 1, victory: ['annihilation', 'turnLimit'] },
    );
    // 赤 → 青 と手番を終えるとターン2になり、制限を超える
    const result = reduceAll(data, state, [{ type: 'endTurn' }, { type: 'endTurn' }]);
    expect(result.state.outcome).toEqual({ winner: 'red', reason: 'turnLimit' });
  });

  it('残存戦力も施設数も並べば引き分け', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'mbt', owner: 'blue' },
      ],
      [],
      { turnLimit: 1, victory: ['turnLimit'] },
    );
    const result = reduceAll(data, state, [{ type: 'endTurn' }, { type: 'endTurn' }]);
    expect(result.state.outcome).toEqual({ winner: null, reason: 'draw' });
  });

  it('決着していなければ null', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [2, 1], type: 'mbt', owner: 'blue' },
      ],
    );
    expect(evaluateVictory(data, state)).toBeNull();
  });
});
