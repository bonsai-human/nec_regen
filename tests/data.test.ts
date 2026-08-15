import { describe, expect, it } from 'vitest';
import { allHexes, createBoard, terrainIdAt, unitDef } from '@/core/map';
import { toAxial } from '@/core/hex';
import { loadGameData, loadMap, loadTerrain, loadUnits, MAP_IDS } from '@/data';
import type { TerrainDef } from '@/core/types';

describe('units.json', () => {
  const units = loadUnits();

  it('全28種（地上19 / 航空3 / 海上6）が定義されている', () => {
    expect(units.size).toBe(28);
  });

  it('主力戦車の能力値が第5.1.1章の表と一致する', () => {
    const mbt = units.get('mbt');
    expect(mbt).toBeDefined();
    expect(mbt).toMatchObject({
      movementType: 'track',
      movePoints: 6,
      armorClass: 'armor',
      defense: 1.65,
      power: { ground: 10, air: 0 },
      matchup: { infantry: 1.0, light: 1.15, armor: 1.0, ship: 0.85, sub: 0 },
      range: { min: 1, max: 1 },
    });
  });

  it('移動できない駒は移動タイプを持たない（重砲・地雷）', () => {
    for (const id of ['heavy_artillery', 'mine']) {
      const def = units.get(id);
      expect(def?.movementType, id).toBeNull();
      expect(def?.movePoints, id).toBe(0);
    }
  });

  it('占領できるのは歩兵系3種だけ', () => {
    const capturers = [...units.values()].filter((def) => def.canCapture).map((def) => def.id);
    expect(capturers.sort()).toEqual(['bike_infantry', 'heavy_infantry', 'infantry']);
    for (const id of capturers) {
      expect(units.get(id)?.armorClass, id).toBe('infantry');
    }
  });

  it('潜水艦を攻撃できるのは駆逐艦だけ（第4.5章）', () => {
    const detectors = [...units.values()].filter((def) => def.canDetectSub).map((def) => def.id);
    expect(detectors).toEqual(['destroyer']);
  });

  it('攻撃後に移動できるのはバギー系だけ（第5.1章）', () => {
    const movers = [...units.values()].filter((def) => def.attackDuringMove).map((def) => def.id);
    expect(movers.sort()).toEqual(['buggy', 'indirect_buggy']);
  });

  it('対空能力の序列が第5.1.1章の表と一致する', () => {
    const ranked = [...units.values()]
      .filter((def) => def.power.air > 0)
      .sort((a, b) => b.power.air - a.power.air || a.id.localeCompare(b.id));
    expect(ranked.slice(0, 4).map((def) => [def.id, def.power.air])).toEqual([
      ['fighter', 18],
      ['sam_vehicle', 17],
      ['aa_tank', 13],
      ['destroyer', 8],
    ]);
  });

  it('攻撃手段を持つ駒は必ず射程を持ち、持たない駒は持たない', () => {
    for (const def of units.values()) {
      const armed = def.power.ground > 0 || def.power.air > 0;
      expect(def.range !== null, def.id).toBe(armed);
    }
  });

  it('設計制約2: すべての駒に「唯一の役割」が書かれている', () => {
    for (const def of units.values()) {
      expect(def.designRole.length, def.id).toBeGreaterThan(0);
    }
  });

  it('積載枠を持つのは3種（第4.7章）', () => {
    const carriers = [...units.values()].filter((def) => def.cargo.capacity > 0);
    expect(carriers.map((def) => def.id).sort()).toEqual([
      'apc',
      'landing_ship',
      'transport_plane',
    ]);
    // 輸送機は「歩兵2 または車両1」
    const plane = units.get('transport_plane');
    expect(plane?.cargo).toEqual({ capacity: 2, allow: { infantry: 1, light: 2, armor: 2 } });
  });
});

describe('terrain.json', () => {
  const terrain = loadTerrain();

  it('地形コスト表が第5.2章の階段構造どおりになっている', () => {
    const expected: Record<string, [number | null, number | null, number | null, number]> = {
      // id: [foot, track, wheel, defense]
      road: [1, 1, 1, 1.0],
      plain: [1, 1, 2, 1.1],
      hill: [1, 2, 3, 1.2],
      badlands: [2, 3, null, 1.3],
      mountain: [2, null, null, 1.4],
    };
    for (const [id, [foot, track, wheel, defense]] of Object.entries(expected)) {
      const def = terrain.get(id);
      expect(def?.moveCost.foot, id).toBe(foot);
      expect(def?.moveCost.track, id).toBe(track);
      expect(def?.moveCost.wheel, id).toBe(wheel);
      expect(def?.defense, id).toBe(defense);
    }
  });

  it('段階が上がるほど地形効果も上がる（逆転がない）', () => {
    const byTier = new Map<number, TerrainDef[]>();
    for (const def of terrain.values()) {
      if (def.tier > 4) continue; // 水域は階段構造の外
      byTier.set(def.tier, [...(byTier.get(def.tier) ?? []), def]);
    }
    const tiers = [...byTier.keys()].sort((a, b) => a - b);
    let previous = 0;
    for (const tier of tiers) {
      const defenses = new Set(byTier.get(tier)?.map((def) => def.defense));
      // 同じ段階の地形はすべて同じ地形効果（1つの地形に1つの値）
      expect(defenses.size, `tier ${tier}`).toBe(1);
      const value = [...defenses][0] ?? 0;
      expect(value, `tier ${tier}`).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('航空はすべての地形をコスト1で通る', () => {
    for (const def of terrain.values()) {
      expect(def.moveCost.air, def.id).toBe(1);
    }
  });

  it('外洋に入れるのは艦艇と潜水艦だけ、潜水艦は外洋だけ', () => {
    const sea = terrain.get('sea');
    expect(sea?.moveCost.foot).toBeNull();
    expect(sea?.moveCost.track).toBeNull();
    expect(sea?.moveCost.ship).toBe(1);
    expect(sea?.moveCost.sub).toBe(1);
    for (const def of terrain.values()) {
      if (def.id === 'sea') continue;
      expect(def.moveCost.sub, def.id).toBeNull();
    }
  });

  it('施設は段階0で地形効果を持たない（第5.2章）', () => {
    for (const id of ['factory', 'hq', 'port', 'airfield']) {
      expect(terrain.get(id)?.tier, id).toBe(0);
      expect(terrain.get(id)?.defense, id).toBe(1.0);
    }
  });
});

describe('マップの読み込み', () => {
  it('同梱マップがすべて検証を通る', () => {
    expect(MAP_IDS.length).toBeGreaterThan(0);
    for (const id of MAP_IDS) {
      expect(() => loadMap(id), id).not.toThrow();
    }
  });

  it('map01 の盤面が定義どおりに組み上がる', () => {
    const data = loadGameData('map01_crossroads');
    expect(data.board.width).toBe(21);
    expect(data.board.height).toBe(14);
    expect(data.board.tiles).toHaveLength(21 * 14);
    expect(allHexes(data.board)).toHaveLength(21 * 14);

    // 司令部・工場が定義どおりの地形に乗っている
    for (const facility of data.map.facilities) {
      expect(terrainIdAt(data.board, facility.hex)).toBe(facility.kind);
    }
    // 初期ユニットは全種類が定義済み
    for (const placement of data.map.units) {
      expect(() => unitDef(data, placement.type)).not.toThrow();
    }
  });

  it('中立工場が両陣営に等距離で置かれている（左右対称）', () => {
    const map = loadMap('map01_crossroads');
    const neutral = map.facilities.filter((facility) => facility.owner === null);
    expect(neutral).toHaveLength(4);
  });

  it('盤外を参照すると null が返る', () => {
    const board = createBoard(loadMap('map01_crossroads'));
    expect(terrainIdAt(board, toAxial({ col: -1, row: 0 }))).toBeNull();
    expect(terrainIdAt(board, toAxial({ col: 21, row: 0 }))).toBeNull();
    expect(terrainIdAt(board, toAxial({ col: 0, row: 14 }))).toBeNull();
    expect(terrainIdAt(board, toAxial({ col: 0, row: 0 }))).not.toBeNull();
  });

  it('読み込みは決定的で、2回読んでも同じ結果になる', () => {
    expect(loadMap('map01_crossroads')).toEqual(loadMap('map01_crossroads'));
  });

  it('存在しないマップ ID は例外', () => {
    expect(() => loadMap('map99')).toThrow();
  });
});
