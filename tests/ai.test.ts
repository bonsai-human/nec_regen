import { describe, expect, it } from 'vitest';
import { GreedyAi } from '@/ai/greedy';
import { toAxial } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import { reduceAll } from '@/core/reducer';
import { createInitialState } from '@/core/state';
import { loadGameData, loadRules, loadTerrain, loadUnits, parseMap } from '@/data';
import type { Command } from '@/core/commands';
import type { GameState, UnitTypeId } from '@/core/types';

const units = loadUnits();
const terrain = loadTerrain();
const rules = loadRules();

const LEGEND: Record<string, string> = { '.': 'plain', r: 'road', F: 'factory' };

interface Placement {
  readonly at: [number, number];
  readonly type: UnitTypeId;
  readonly owner: string;
  readonly strength?: number;
}

function build(
  rows: string[],
  placements: Placement[],
  facilities: unknown[] = [],
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
  };
  const map = parseMap(raw, { units, terrain }, 'test.json');
  const data: GameData = { board: createBoard(map), map, units, terrain, rules };
  return { data, state: createInitialState(data) };
}

void toAxial;

const ai = new GreedyAi();

describe('AI v1 の行動選択（第6章）', () => {
  it('決着していなければ endTurn で終わる', () => {
    const { data, state } = build(
      ['rrrrr', 'rrrrr', 'rrrrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [4, 1], type: 'mbt', owner: 'blue' },
      ],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands.at(-1)).toEqual({ type: 'endTurn' });
  });

  it('返した手はそのまま流せる（不正なコマンドを返さない）', () => {
    const { data, state } = build(
      ['rrrrr', 'rrrrr', 'rrrrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [4, 1], type: 'mbt', owner: 'blue' },
      ],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(() => reduceAll(data, state, commands)).not.toThrow();
  });

  it('隣接した敵を攻撃する', () => {
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'assault_tank', owner: 'red' },
        { at: [1, 1], type: 'infantry', owner: 'blue' },
      ],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands.some((command) => command.type === 'attack')).toBe(true);
  });

  it('割に合わない攻撃はしない', () => {
    // 歩兵が要塞戦車に殴りかかっても、返しの方が大きい
    const { data, state } = build(
      ['rrr', 'rrr', 'rrr'],
      [
        { at: [0, 1], type: 'infantry', owner: 'red' },
        { at: [1, 1], type: 'fortress_tank', owner: 'blue' },
      ],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands.some((command) => command.type === 'attack')).toBe(false);
  });

  it('乗っている施設を占領する', () => {
    const { data, state } = build(
      ['rrr', 'rFr', 'rrr'],
      [
        { at: [1, 1], type: 'infantry', owner: 'red' },
        { at: [2, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: null, queue: [], interval: 0 }],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands[0]).toEqual({ type: 'capture', unitId: 1 });
  });

  it('遠くにいるときは敵へ近づく', () => {
    const { data, state } = build(
      ['rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [7, 1], type: 'mbt', owner: 'blue' },
      ],
    );
    const commands = ai.planTurn(data, state, 'red');
    const move = commands.find((command) => command.type === 'move');
    expect(move).toBeDefined();

    const after = reduceAll(data, state, commands).state;
    const moved = after.units.find((unit) => unit.id === 1)!;
    const enemy = after.units.find((unit) => unit.id === 2)!;
    // 近づいている
    expect(Math.abs(moved.hex.q - enemy.hex.q)).toBeLessThan(7);
  });

  it('殴れる相手がいないとき、損耗した駒は自軍施設へ後退する', () => {
    // 敵は移動力と射程の外。攻撃が選べない状況を作る
    const { data, state } = build(
      ['rrrrrrrrrrrr', 'rFrrrrrrrrrr', 'rrrrrrrrrrrr'],
      [
        { at: [3, 1], type: 'mbt', owner: 'red', strength: 3 },
        { at: [11, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands.some((command) => command.type === 'attack')).toBe(false);

    const after = reduceAll(data, state, commands).state;
    // 工場に入って全快している
    expect(after.units.find((unit) => unit.id === 1)?.strength).toBe(10);
  });

  it('攻撃は後退より優先される（計画書の優先順位どおり）', () => {
    const { data, state } = build(
      ['rrrrr', 'rFrrr', 'rrrrr'],
      [
        { at: [3, 1], type: 'mbt', owner: 'red', strength: 3 },
        { at: [4, 2], type: 'infantry', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: 'red', queue: [], interval: 0 }],
    );
    const commands = ai.planTurn(data, state, 'red');
    expect(commands.some((command) => command.type === 'attack')).toBe(true);
  });
});

describe('AI の決定性（第6章 決定性の要件・最重要）', () => {
  const scenario = (): { data: GameData; state: GameState } =>
    build(
      ['rrrrr', 'rFrrr', 'rrrrr'],
      [
        { at: [0, 1], type: 'mbt', owner: 'red' },
        { at: [0, 2], type: 'infantry', owner: 'red' },
        { at: [4, 1], type: 'mbt', owner: 'blue' },
        { at: [4, 2], type: 'assault_tank', owner: 'blue' },
      ],
      [{ hex: [1, 1], kind: 'factory', owner: null, queue: [], interval: 0 }],
    );

  it('同じ局面には必ず同じ手を返す', () => {
    const first = scenario();
    const second = scenario();
    const a = ai.planTurn(first.data, first.state, 'red');
    const b = ai.planTurn(second.data, second.state, 'red');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('同じ AI 同士を戦わせると、毎回まったく同じ棋譜になる', () => {
    const play = (): { commands: Command[]; state: GameState } => {
      const { data, state } = scenario();
      let current = state;
      const commands: Command[] = [];
      for (let turn = 0; turn < 40 && current.outcome === null; turn++) {
        const planned = ai.planTurn(data, current, current.activeFaction);
        commands.push(...planned);
        current = reduceAll(data, current, planned).state;
      }
      return { commands, state: current };
    };
    const first = play();
    const second = play();
    expect(JSON.stringify(first.commands)).toBe(JSON.stringify(second.commands));
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
  });
});

describe('自己対戦（第6章）', () => {
  it('同梱マップで最後まで進み、例外も膠着も起きない', () => {
    const data = loadGameData('map01_crossroads');
    let state = createInitialState(data);
    let steps = 0;
    const limit = 400;

    while (state.outcome === null && steps < limit) {
      const commands = ai.planTurn(data, state, state.activeFaction);
      // 手番ごとに必ず1つ以上のコマンドが返る（最低でも endTurn）
      expect(commands.length).toBeGreaterThan(0);
      state = reduceAll(data, state, commands).state;
      steps += 1;
    }

    // ターン制限（40）で必ず決着する
    expect(state.outcome).not.toBeNull();
    expect(steps).toBeLessThan(limit);
  });

  it('自己対戦の結果は再現する', () => {
    const run = (): GameState => {
      const data = loadGameData('map01_crossroads');
      let state = createInitialState(data);
      for (let i = 0; i < 200 && state.outcome === null; i++) {
        state = reduceAll(data, state, ai.planTurn(data, state, state.activeFaction)).state;
      }
      return state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
