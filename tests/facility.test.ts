import { describe, expect, it } from 'vitest';
import { neighbors, toAxial, toOffset, type Hex } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import { accepts, deployableHexes, facilityAt } from '@/core/facility';
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
  const facilities = [{ hex: [1, 1], kind: 'factory', owner: null, garrison: [] }];

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
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: [] }],
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
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: [] }],
    );
    expect(() => reduce(data, state, { type: 'capture', unitId: 1 })).toThrow(/すでに占領/);
  });

  it('占領すると中身ごと相手のものになる', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: null, garrison: ['mbt'] }],
    );
    const result = reduce(data, state, { type: 'capture', unitId: 1 });
    const facility = facilityAt(result.state, at(1, 1))!;
    expect(facility.owner).toBe('red');
    expect(facility.garrison.map((stored) => stored.type)).toEqual(['mbt']);
    expect(result.events[0]).toMatchObject({ type: 'facilityCaptured', garrisonTaken: 1 });
    // 奪ったその場では出せない。搬出は次のターンから
    expect(facility.garrison.every((stored) => stored.hasActed)).toBe(true);
  });
});

describe('格納と搬出（第4.6章）', () => {
  /** 工場に赤の駒が1つ乗っている盤。 */
  function onFactory(strength: number, type: UnitTypeId = 'mbt') {
    return build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type, owner: 'red', strength },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: [] }],
    );
  }

  it('自軍施設に格納すると盤上から消え、中で全快する', () => {
    const { data, state } = onFactory(3);
    const result = reduce(data, state, { type: 'store', unitId: 1 });

    expect(result.state.units.find((unit) => unit.id === 1)).toBeUndefined();
    const garrison = facilityAt(result.state, at(1, 1))!.garrison;
    expect(garrison).toHaveLength(1);
    expect(garrison[0]).toMatchObject({ id: 1, type: 'mbt', hasActed: true });
    expect(result.events[0]).toMatchObject({ type: 'unitStored', healed: 7 });
  });

  it('格納しても熟練度は失われない', () => {
    const { data, state } = onFactory(3);
    const veteran: GameState = {
      ...state,
      units: state.units.map((unit) => (unit.id === 1 ? { ...unit, exp: 5 } : unit)),
    };
    const stored = reduce(data, veteran, { type: 'store', unitId: 1 }).state;
    expect(facilityAt(stored, at(1, 1))!.garrison[0]?.exp).toBe(5);

    // 出したときも同じ部隊として戻ってくる
    const ready = reduceAll(data, stored, [{ type: 'endTurn' }, { type: 'endTurn' }]).state;
    const out = reduce(data, ready, {
      type: 'deploy',
      facilityHex: at(1, 1),
      storedId: 1,
      to: at(1, 0),
    }).state;
    const unit = out.units.find((item) => item.id === 1)!;
    expect(unit.exp).toBe(5);
    expect(unit.strength).toBe(10);
  });

  it('格納したターンには搬出できず、次のターンから出せる', () => {
    const { data, state } = onFactory(3);
    const stored = reduce(data, state, { type: 'store', unitId: 1 }).state;

    expect(() =>
      reduce(data, stored, { type: 'deploy', facilityHex: at(1, 1), storedId: 1, to: at(1, 0) }),
    ).toThrow(/すでに動いています/);

    // 赤 → 青 → 赤 と回すと、また出せるようになる
    const ready = reduceAll(data, stored, [{ type: 'endTurn' }, { type: 'endTurn' }]).state;
    expect(facilityAt(ready, at(1, 1))!.garrison[0]?.hasActed).toBe(false);

    const result = reduce(data, ready, {
      type: 'deploy',
      facilityHex: at(1, 1),
      storedId: 1,
      to: at(1, 0),
    });
    const unit = result.state.units.find((item) => item.id === 1)!;
    expect(toOffset(unit.hex)).toEqual({ col: 1, row: 0 });
    // 出したターンは動かせない
    expect(unit.hasActed).toBe(true);
    expect(facilityAt(result.state, at(1, 1))!.garrison).toHaveLength(0);
    expect(result.events[0]).toMatchObject({ type: 'unitDeployed', unitId: 1 });
  });

  it('隣接していないヘクスへは搬出できない', () => {
    const { data, state } = build(
      ['rrrrr', 'rrFrr', 'rrrrr'],
      [{ at: [4, 2], type: 'infantry', owner: 'blue' }],
      [{ hex: [2, 1], kind: 'factory', owner: 'red', garrison: ['mbt'] }],
    );
    expect(() =>
      reduce(data, state, { type: 'deploy', facilityHex: at(2, 1), storedId: 2, to: at(4, 1) }),
    ).toThrow(/施設の隣/);
  });

  it('隣接がすべて塞がっていると1体も出せない', () => {
    const ring = ringOf(1, 1, 3, 3);
    expect(ring).toHaveLength(6);
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      ring.map((cell) => ({ at: cell, type: 'infantry', owner: 'blue' })),
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: ['mbt'] }],
    );
    const mbt = units.get('mbt')!;
    expect(deployableHexes(data, state, at(1, 1), mbt)).toHaveLength(0);
    expect(() =>
      reduce(data, state, { type: 'deploy', facilityHex: at(1, 1), storedId: 7, to: at(1, 0) }),
    ).toThrow(/塞がって/);
  });

  it('自動では何も出てこない。出すのはプレイヤーの手番の操作', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [2, 2], type: 'infantry', owner: 'blue' },
        { at: [0, 2], type: 'infantry', owner: 'red' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: ['mbt'] }],
    );
    const result = reduceAll(data, state, [{ type: 'endTurn' }, { type: 'endTurn' }]);
    expect(result.state.units.some((unit) => unit.type === 'mbt')).toBe(false);
    expect(facilityAt(result.state, at(1, 1))!.garrison).toHaveLength(1);
  });

  it('施設ヘクスに乗っただけでは回復しない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 0], type: 'mbt', owner: 'red', strength: 3 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: [] }],
    );
    const result = reduce(data, state, { type: 'move', unitId: 1, path: [at(1, 0), at(1, 1)] });
    const moved = result.state.units.find((unit) => unit.id === 1)!;
    expect(moved.strength).toBe(3);
    // 移動しただけなので、まだ格納する行動が残っている
    expect(moved.hasActed).toBe(false);
  });

  it('敵の施設には格納できない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red', strength: 3 },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'blue', garrison: [] }],
    );
    expect(() => reduce(data, state, { type: 'store', unitId: 1 })).toThrow(/自軍の施設/);
  });

  it('施設の種別ごとに格納できるユニットが決まっている', () => {
    const mbt = units.get('mbt')!;
    const destroyer = units.get('destroyer')!;
    const fighter = units.get('fighter')!;

    expect(accepts('factory', mbt)).toBe(true);
    expect(accepts('factory', destroyer)).toBe(false);
    expect(accepts('factory', fighter)).toBe(false);
    expect(accepts('port', destroyer)).toBe(true);
    expect(accepts('airfield', fighter)).toBe(true);
    expect(accepts('hq', mbt)).toBe(true);
  });

  it('工場に艦艇は格納できない', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrs'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'destroyer', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', garrison: [] }],
    );
    // 歩兵は入れる。駆逐艦はそもそも工場ヘクスに立てない
    expect(() => reduce(data, state, { type: 'store', unitId: 1 })).not.toThrow();
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
        { hex: [1, 1], kind: 'hq', owner: 'blue', garrison: [] },
        { hex: [0, 0], kind: 'hq', owner: 'red', garrison: [] },
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
