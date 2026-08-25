import { describe, expect, it } from 'vitest';
import { hexKey, toAxial, type Hex } from '@/core/hex';
import { createBoard, type GameData } from '@/core/map';
import { validateCommand, type Command } from '@/core/commands';
import { CommandError, reduce, reduceAll } from '@/core/reducer';
import { createInitialState } from '@/core/state';
import { loadGameData, loadTerrain, loadUnits, parseMap } from '@/data';
import type { GameState } from '@/core/types';

const units = loadUnits();
const terrain = loadTerrain();

function build(): { data: GameData; state: GameState } {
  const raw = {
    id: 'test',
    name: 'テスト',
    width: 6,
    height: 3,
    turnLimit: 10,
    victory: ['annihilation'],
    factions: ['red', 'blue'],
    tiles: Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => 'road')),
    facilities: [],
    units: [
      { hex: [0, 1], type: 'mbt', owner: 'red', strength: 10 },
      { hex: [1, 1], type: 'infantry', owner: 'red', strength: 10 },
      { hex: [5, 1], type: 'mbt', owner: 'blue', strength: 10 },
    ],
  };
  const map = parseMap(raw, { units, terrain }, 'test.json');
  const data: GameData = { board: createBoard(map), map, units, terrain };
  return { data, state: createInitialState(data) };
}

function at(col: number, row: number): Hex {
  return toAxial({ col, row });
}

describe('初期状態', () => {
  it('マップ定義から盤上の状態を組み立てる', () => {
    const { state } = build();
    expect(state.turn).toBe(1);
    expect(state.activeFaction).toBe('red');
    expect(state.units).toHaveLength(3);
    expect(state.units[0]).toMatchObject({ id: 1, type: 'mbt', owner: 'red', strength: 10 });
    expect(state.units.every((unit) => !unit.hasMoved && !unit.hasActed)).toBe(true);
    expect(state.nextUnitId).toBe(4);
    expect(state.outcome).toBeNull();
  });

  it('同梱マップからも組み立てられる', () => {
    const state = createInitialState(loadGameData('map01_crossroads'));
    expect(state.units).toHaveLength(20);
    expect(state.facilities).toHaveLength(10);
    // 中立の工場は増援の予定を持たない
    const neutral = state.facilities.filter((facility) => facility.owner === null);
    expect(neutral.every((facility) => facility.nextSpawnTurn === null)).toBe(true);
    // 所有されている工場は次の出現ターンを持つ（誰でも読める・第4.6章）
    const owned = state.facilities.filter(
      (facility) => facility.owner !== null && facility.queue.length > 0,
    );
    expect(owned.every((facility) => facility.nextSpawnTurn !== null)).toBe(true);
  });
});

describe('移動コマンド', () => {
  it('ユニットを動かし、移動済みになる', () => {
    const { data, state } = build();
    const result = reduce(data, state, {
      type: 'move',
      unitId: 1,
      path: [at(0, 1), at(1, 0), at(2, 0)],
    });

    const moved = result.state.units.find((unit) => unit.id === 1);
    expect(hexKey(moved!.hex)).toBe(hexKey(at(2, 0)));
    expect(moved?.hasMoved).toBe(true);
    expect(moved?.hasActed).toBe(false);
    expect(result.events).toEqual([
      {
        type: 'unitMoved',
        unitId: 1,
        from: at(0, 1),
        to: at(2, 0),
        path: [at(0, 1), at(1, 0), at(2, 0)],
        cost: 2,
      },
    ]);
  });

  it('元の状態は書き換えない（アンドゥのためにスナップショットが要る）', () => {
    const { data, state } = build();
    const before = JSON.stringify(state);
    reduce(data, state, { type: 'move', unitId: 1, path: [at(0, 1), at(1, 0)] });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('相手のユニットは動かせない', () => {
    const { data, state } = build();
    const command: Command = { type: 'move', unitId: 3, path: [at(5, 1), at(4, 1)] };
    expect(validateCommand(data, state, command)).toMatch(/相手のユニット/);
    expect(() => reduce(data, state, command)).toThrow(CommandError);
  });

  it('同じユニットは1ターンに1回しか移動できない', () => {
    const { data, state } = build();
    const first = reduce(data, state, { type: 'move', unitId: 1, path: [at(0, 1), at(1, 0)] });
    const command: Command = { type: 'move', unitId: 1, path: [at(1, 0), at(2, 0)] };
    expect(validateCommand(data, first.state, command)).toMatch(/移動を終えて/);
  });

  it('自力で動けない駒は移動コマンドを受け付けない', () => {
    const raw = {
      id: 'test',
      name: 'テスト',
      width: 3,
      height: 1,
      turnLimit: 10,
      victory: ['annihilation'],
      factions: ['red', 'blue'],
      tiles: [['plain', 'plain', 'plain']],
      facilities: [],
      units: [
        { hex: [0, 0], type: 'heavy_artillery', owner: 'red', strength: 10 },
        { hex: [2, 0], type: 'infantry', owner: 'blue', strength: 10 },
      ],
    };
    const map = parseMap(raw, { units, terrain }, 'test.json');
    const data: GameData = { board: createBoard(map), map, units, terrain };
    const state = createInitialState(data);
    expect(
      validateCommand(data, state, { type: 'move', unitId: 1, path: [at(0, 0), at(1, 0)] }),
    ).toMatch(/自力では移動できません/);
  });

  it('不正な経路は理由つきで弾かれる', () => {
    const { data, state } = build();
    expect(
      validateCommand(data, state, { type: 'move', unitId: 1, path: [at(0, 1), at(4, 1)] }),
    ).toMatch(/繋がって/);
  });
});

describe('待機コマンド', () => {
  it('行動を終えたことになる', () => {
    const { data, state } = build();
    const result = reduce(data, state, { type: 'wait', unitId: 1 });
    const unit = result.state.units.find((item) => item.id === 1);
    expect(unit?.hasMoved).toBe(true);
    expect(unit?.hasActed).toBe(true);
    expect(result.events).toEqual([{ type: 'unitWaited', unitId: 1 }]);
  });

  it('移動したあとでも待機できる', () => {
    const { data, state } = build();
    const moved = reduce(data, state, { type: 'move', unitId: 1, path: [at(0, 1), at(1, 0)] });
    expect(validateCommand(data, moved.state, { type: 'wait', unitId: 1 })).toBeNull();
  });
});

describe('ターン終了', () => {
  it('手番が次の陣営へ移り、その陣営の行動済みが解除される', () => {
    const { data, state } = build();
    const moved = reduce(data, state, { type: 'move', unitId: 1, path: [at(0, 1), at(1, 0)] });
    const ended = reduce(data, moved.state, { type: 'endTurn' });

    expect(ended.state.activeFaction).toBe('blue');
    // 赤の移動済みフラグは、赤の手番が回ってくるまで残る
    expect(ended.state.units.find((unit) => unit.id === 1)?.hasMoved).toBe(true);
    expect(ended.state.units.find((unit) => unit.id === 3)?.hasMoved).toBe(false);
    expect(ended.events[0]).toMatchObject({
      type: 'turnEnded',
      faction: 'red',
      nextFaction: 'blue',
    });
  });

  it('全陣営が1回ずつ手番を終えるとターンが1つ進む', () => {
    const { data, state } = build();
    const afterRed = reduce(data, state, { type: 'endTurn' });
    expect(afterRed.state.turn).toBe(1);
    const afterBlue = reduce(data, afterRed.state, { type: 'endTurn' });
    expect(afterBlue.state.turn).toBe(2);
    expect(afterBlue.state.activeFaction).toBe('red');
    // 赤の手番が戻ってきたので、赤の駒は再び動ける
    expect(afterBlue.state.units.find((unit) => unit.id === 1)?.hasMoved).toBe(false);
  });
});

describe('決定性（第10章 決定性テスト）', () => {
  const script: Command[] = [
    { type: 'move', unitId: 1, path: [at(0, 1), at(1, 0), at(2, 0)] },
    { type: 'wait', unitId: 2 },
    { type: 'endTurn' },
    { type: 'move', unitId: 3, path: [at(5, 1), at(4, 1), at(3, 1)] },
    { type: 'endTurn' },
    { type: 'move', unitId: 1, path: [at(2, 0), at(3, 0)] },
    { type: 'endTurn' },
  ];

  it('同じ初期状態に同じコマンド列を2回流すと、最終状態が完全に一致する', () => {
    const first = build();
    const second = build();
    const a = reduceAll(first.data, first.state, script);
    const b = reduceAll(second.data, second.state, script);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('コマンド列を保存すれば初期状態から再現できる（リプレイ）', () => {
    const { data, state } = build();
    const played = reduceAll(data, state, script);
    const replayed = reduceAll(data, createInitialState(data), script);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(played.state));
  });

  it('状態は JSON へ落として復元できる（セーブ/ロード）', () => {
    const { data, state } = build();
    const played = reduceAll(data, state, script.slice(0, 3));
    const restored = JSON.parse(JSON.stringify(played.state)) as GameState;
    const continuedFromRestored = reduceAll(data, restored, script.slice(3));
    const continuedDirectly = reduceAll(data, played.state, script.slice(3));
    expect(JSON.stringify(continuedFromRestored.state)).toBe(
      JSON.stringify(continuedDirectly.state),
    );
  });
});
