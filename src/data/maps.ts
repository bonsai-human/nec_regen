/**
 * `data/maps/*.json` の読み込みと検証（実装計画書 第5.3章）。
 *
 * > 読み込み時にスキーマ検証を行い、不正なマップは明示的なエラーで落とす
 * > （存在しない地形ID、範囲外の座標、初期ユニットの重複配置、
 * > 増援の出現余地がない施設などを検出）。
 *
 * 加えて、**ルール上プレイ不能になる配置**もここで弾く。
 * 外洋に置かれた歩兵や、敵の工場の上に置かれた戦車は、
 * 実行時ではなくマップを読んだ瞬間に分かるべき誤りである。
 */

import { neighbors, toAxial, type Hex } from '@/core/hex';
import {
  FACILITY_KINDS,
  MAX_STRENGTH,
  VICTORY_CONDITIONS,
  type FacilityDef,
  type FacilityKind,
  type FactionId,
  type MapDef,
  type TerrainDef,
  type TerrainId,
  type UnitDef,
  type UnitPlacement,
  type UnitTypeId,
  type VictoryCondition,
} from '@/core/types';
import { Validator } from './schema';

const MAP_KEYS = [
  'id',
  'name',
  'width',
  'height',
  'turnLimit',
  'victory',
  'factions',
  'tiles',
  'facilities',
  'units',
  'designNote',
] as const;

const FACILITY_ENTRY_KEYS = ['hex', 'kind', 'owner', 'queue', 'interval'] as const;
const UNIT_ENTRY_KEYS = ['hex', 'type', 'owner', 'strength'] as const;

const MAX_DIMENSION = 100;

export interface MapParseContext {
  readonly units: ReadonlyMap<UnitTypeId, UnitDef>;
  readonly terrain: ReadonlyMap<TerrainId, TerrainDef>;
}

export function parseMap(raw: unknown, context: MapParseContext, source = 'map.json'): MapDef {
  const v = new Validator(source);
  const record = v.record('map', raw);
  if (record === undefined) {
    v.throwIfFailed();
    throw new Error('到達しない');
  }
  v.noExtraKeys('map', record, MAP_KEYS);

  const id = v.string('map.id', record['id']);
  const name = v.string('map.name', record['name']);
  const width = v.integer('map.width', record['width'], 1, MAX_DIMENSION);
  const height = v.integer('map.height', record['height'], 1, MAX_DIMENSION);
  const turnLimit = v.integer('map.turnLimit', record['turnLimit'], 1, 999);
  const victory = parseVictory(v, record['victory']);
  const factions = parseFactions(v, record['factions']);

  if (
    id === undefined ||
    name === undefined ||
    width === undefined ||
    height === undefined ||
    turnLimit === undefined ||
    victory === undefined ||
    factions === undefined
  ) {
    v.throwIfFailed();
    throw new Error('到達しない');
  }

  const tiles = parseTiles(v, record['tiles'], width, height, context.terrain);
  const inBounds = (hex: [number, number]): boolean =>
    hex[0] >= 0 && hex[0] < width && hex[1] >= 0 && hex[1] < height;
  const terrainAt = (col: number, row: number): TerrainDef | undefined => {
    const terrainId = tiles?.[row]?.[col];
    return terrainId === undefined ? undefined : context.terrain.get(terrainId);
  };

  const facilities = parseFacilities(v, record['facilities'], {
    context,
    factions,
    inBounds,
    terrainAt,
  });
  const units = parseUnitPlacements(v, record['units'], {
    context,
    factions,
    facilities,
    inBounds,
    terrainAt,
  });

  const designNote =
    record['designNote'] === undefined
      ? undefined
      : v.string('map.designNote', record['designNote']);

  checkSpawnRoom(v, facilities, context, { width, height, terrainAt });
  checkVictoryFeasible(v, victory, facilities, factions);
  checkSubmarineHasAnswer(v, units, facilities, context, factions);

  v.throwIfFailed();

  const parsed: MapDef = {
    id,
    name,
    width,
    height,
    turnLimit,
    victory,
    factions,
    tiles: tiles ?? [],
    facilities,
    units,
    ...(designNote === undefined ? {} : { designNote }),
  };
  return parsed;
}

function parseVictory(v: Validator, raw: unknown): VictoryCondition[] | undefined {
  const list = v.array('map.victory', raw);
  if (list === undefined) return undefined;
  if (list.length === 0) {
    v.fail('map.victory', '勝敗条件を1つ以上指定してください');
    return undefined;
  }
  const conditions: VictoryCondition[] = [];
  for (const [index, entry] of list.entries()) {
    const condition = v.enum(`map.victory[${index}]`, entry, VICTORY_CONDITIONS);
    if (condition === undefined) continue;
    if (conditions.includes(condition)) {
      v.fail(`map.victory[${index}]`, `勝敗条件が重複しています: ${condition}`);
      continue;
    }
    conditions.push(condition);
  }
  return conditions;
}

function parseFactions(v: Validator, raw: unknown): FactionId[] | undefined {
  const list = v.array('map.factions', raw);
  if (list === undefined) return undefined;
  if (list.length < 2) {
    v.fail('map.factions', '陣営は2つ以上必要です');
    return undefined;
  }
  const factions: FactionId[] = [];
  for (const [index, entry] of list.entries()) {
    const faction = v.string(`map.factions[${index}]`, entry);
    if (faction === undefined) continue;
    factions.push(faction);
  }
  v.uniqueIds('map.factions', factions);
  return factions;
}

function parseTiles(
  v: Validator,
  raw: unknown,
  width: number,
  height: number,
  terrain: ReadonlyMap<TerrainId, TerrainDef>,
): TerrainId[][] | undefined {
  const rows = v.array('map.tiles', raw);
  if (rows === undefined) return undefined;
  if (rows.length !== height) {
    v.fail('map.tiles', `${height} 行必要ですが ${rows.length} 行あります`);
  }

  const tiles: TerrainId[][] = [];
  for (const [row, rawRow] of rows.entries()) {
    const cells = v.array(`map.tiles[${row}]`, rawRow);
    if (cells === undefined) continue;
    if (cells.length !== width) {
      v.fail(`map.tiles[${row}]`, `${width} 列必要ですが ${cells.length} 列あります`);
    }
    const parsedRow: TerrainId[] = [];
    for (const [col, cell] of cells.entries()) {
      const terrainId = v.string(`map.tiles[${row}][${col}]`, cell);
      if (terrainId === undefined) continue;
      if (!terrain.has(terrainId)) {
        v.fail(`map.tiles[${row}][${col}]`, `存在しない地形です: ${terrainId}`);
        continue;
      }
      parsedRow.push(terrainId);
    }
    tiles.push(parsedRow);
  }
  return tiles;
}

interface PlacementContext {
  readonly context: MapParseContext;
  readonly factions: readonly FactionId[];
  readonly inBounds: (hex: [number, number]) => boolean;
  readonly terrainAt: (col: number, row: number) => TerrainDef | undefined;
}

function parseHexPair(v: Validator, path: string, raw: unknown): [number, number] | undefined {
  const list = v.array(path, raw);
  if (list === undefined) return undefined;
  if (list.length !== 2) {
    v.fail(path, '[列, 行] の2要素で指定してください');
    return undefined;
  }
  const col = v.integer(`${path}[0]`, list[0], -MAX_DIMENSION, MAX_DIMENSION);
  const row = v.integer(`${path}[1]`, list[1], -MAX_DIMENSION, MAX_DIMENSION);
  if (col === undefined || row === undefined) return undefined;
  return [col, row];
}

function parseFacilities(v: Validator, raw: unknown, ctx: PlacementContext): FacilityDef[] {
  const list = v.array('map.facilities', raw) ?? [];
  const facilities: FacilityDef[] = [];
  const occupied = new Set<string>();

  for (const [index, entry] of list.entries()) {
    const path = `map.facilities[${index}]`;
    const record = v.record(path, entry);
    if (record === undefined) continue;
    v.noExtraKeys(path, record, FACILITY_ENTRY_KEYS);

    const pair = parseHexPair(v, `${path}.hex`, record['hex']);
    const kind = v.enum<FacilityKind>(`${path}.kind`, record['kind'], FACILITY_KINDS);
    const interval = v.integer(`${path}.interval`, record['interval'], 0, 20);
    const owner =
      record['owner'] === null ? null : v.enum(`${path}.owner`, record['owner'], ctx.factions);
    const queue = parseQueue(v, `${path}.queue`, record['queue'], ctx.context);

    if (
      pair === undefined ||
      kind === undefined ||
      interval === undefined ||
      owner === undefined ||
      queue === undefined
    ) {
      continue;
    }

    if (!ctx.inBounds(pair)) {
      v.fail(`${path}.hex`, `盤外の座標です: (${pair[0]}, ${pair[1]})`);
      continue;
    }

    const key = `${pair[0]},${pair[1]}`;
    if (occupied.has(key)) {
      v.fail(`${path}.hex`, `施設が重複配置されています: (${pair[0]}, ${pair[1]})`);
      continue;
    }
    occupied.add(key);

    // 施設は対応する地形の上にしか置けない（工場の施設は工場ヘクスに）
    const terrain = ctx.terrainAt(pair[0], pair[1]);
    if (terrain !== undefined && terrain.id !== kind) {
      v.fail(`${path}.kind`, `地形 ${terrain.id} の上に ${kind} は置けません`);
      continue;
    }

    if (queue.length > 0 && interval === 0) {
      v.fail(`${path}.interval`, '増援キューがある施設には1以上の出現間隔が必要です');
      continue;
    }

    facilities.push({ hex: toAxial({ col: pair[0], row: pair[1] }), kind, owner, queue, interval });
  }

  return facilities;
}

function parseQueue(
  v: Validator,
  path: string,
  raw: unknown,
  context: MapParseContext,
): UnitTypeId[] | undefined {
  const list = v.array(path, raw);
  if (list === undefined) return undefined;
  const queue: UnitTypeId[] = [];
  let ok = true;
  for (const [index, entry] of list.entries()) {
    const type = v.string(`${path}[${index}]`, entry);
    if (type === undefined) {
      ok = false;
      continue;
    }
    if (!context.units.has(type)) {
      v.fail(`${path}[${index}]`, `存在しないユニット種別です: ${type}`);
      ok = false;
      continue;
    }
    queue.push(type);
  }
  return ok ? queue : undefined;
}

function parseUnitPlacements(
  v: Validator,
  raw: unknown,
  ctx: PlacementContext & { readonly facilities: readonly FacilityDef[] },
): UnitPlacement[] {
  const list = v.array('map.units', raw) ?? [];
  const placements: UnitPlacement[] = [];
  const occupied = new Set<string>();

  for (const [index, entry] of list.entries()) {
    const path = `map.units[${index}]`;
    const record = v.record(path, entry);
    if (record === undefined) continue;
    v.noExtraKeys(path, record, UNIT_ENTRY_KEYS);

    const pair = parseHexPair(v, `${path}.hex`, record['hex']);
    const type = v.string(`${path}.type`, record['type']);
    const owner = v.enum(`${path}.owner`, record['owner'], ctx.factions);
    const strength = v.integer(`${path}.strength`, record['strength'], 1, MAX_STRENGTH);

    if (pair === undefined || type === undefined || owner === undefined || strength === undefined) {
      continue;
    }

    const def = ctx.context.units.get(type);
    if (def === undefined) {
      v.fail(`${path}.type`, `存在しないユニット種別です: ${type}`);
      continue;
    }
    if (!ctx.inBounds(pair)) {
      v.fail(`${path}.hex`, `盤外の座標です: (${pair[0]}, ${pair[1]})`);
      continue;
    }

    const key = `${pair[0]},${pair[1]}`;
    if (occupied.has(key)) {
      v.fail(`${path}.hex`, `ユニットが重複配置されています: (${pair[0]}, ${pair[1]})`);
      continue;
    }
    occupied.add(key);

    const terrain = ctx.terrainAt(pair[0], pair[1]);
    if (terrain !== undefined && !canOccupy(def, terrain)) {
      v.fail(`${path}.hex`, `${def.name} は ${terrain.name} に配置できません`);
      continue;
    }

    // 未占領・敵の施設ヘクスに乗れるのは占領できるユニットだけ（第4.6章）
    const facility = ctx.facilities.find(
      (item) =>
        item.hex.q === toAxial({ col: pair[0], row: pair[1] }).q &&
        item.hex.r === toAxial({ col: pair[0], row: pair[1] }).r,
    );
    if (facility !== undefined && facility.owner !== owner && !def.canCapture) {
      v.fail(`${path}.hex`, `${def.name} は自軍以外の施設ヘクスに配置できません`);
      continue;
    }

    placements.push({ hex: toAxial({ col: pair[0], row: pair[1] }), type, owner, strength });
  }

  return placements;
}

/** そのユニットがその地形に存在できるか。移動タイプを持たない駒は陸上に置く。 */
export function canOccupy(unit: UnitDef, terrain: TerrainDef): boolean {
  if (unit.movementType === null) return terrain.moveCost.foot !== null;
  return terrain.moveCost[unit.movementType] !== null;
}

/**
 * 増援の出現余地がない施設を検出する（第4.6章）。
 * 隣接ヘクスがすべて塞がっていると増援は待機し続け、キューが死ぬ。
 */
function checkSpawnRoom(
  v: Validator,
  facilities: readonly FacilityDef[],
  context: MapParseContext,
  board: {
    readonly width: number;
    readonly height: number;
    readonly terrainAt: (col: number, row: number) => TerrainDef | undefined;
  },
): void {
  for (const [index, facility] of facilities.entries()) {
    if (facility.queue.length === 0) continue;

    const around = neighbors(facility.hex)
      .map((hex) => offsetOf(hex))
      .filter(([col, row]) => col >= 0 && col < board.width && row >= 0 && row < board.height)
      .map(([col, row]) => board.terrainAt(col, row))
      .filter((terrain): terrain is TerrainDef => terrain !== undefined);

    for (const [queueIndex, type] of facility.queue.entries()) {
      const def = context.units.get(type);
      if (def === undefined) continue;
      if (!around.some((terrain) => canOccupy(def, terrain))) {
        v.fail(
          `map.facilities[${index}].queue[${queueIndex}]`,
          `${def.name} が出現できる隣接ヘクスがありません`,
        );
      }
    }
  }
}

function offsetOf(hex: Hex): [number, number] {
  return [hex.q, hex.r + (hex.q - (hex.q & 1)) / 2];
}

/** 司令部の占領を勝敗条件にするなら、全陣営に司令部が要る。 */
function checkVictoryFeasible(
  v: Validator,
  victory: readonly VictoryCondition[],
  facilities: readonly FacilityDef[],
  factions: readonly FactionId[],
): void {
  if (!victory.includes('hq')) return;
  for (const faction of factions) {
    const owned = facilities.some((item) => item.kind === 'hq' && item.owner === faction);
    if (!owned) {
      v.fail('map.victory', `陣営 ${faction} の司令部がないため、司令部占領を勝敗条件にできません`);
    }
  }
}

/**
 * 潜水艦を配置するマップには、相手側にも必ず対潜手段を用意する（第4.5章）。
 * 「回答のない駒を置いてはならない」というマップ設計上の制約をここで機械的に守る。
 */
function checkSubmarineHasAnswer(
  v: Validator,
  units: readonly UnitPlacement[],
  facilities: readonly FacilityDef[],
  context: MapParseContext,
  factions: readonly FactionId[],
): void {
  const byFaction = new Map<FactionId, UnitDef[]>(factions.map((faction) => [faction, []]));
  for (const placement of units) {
    const def = context.units.get(placement.type);
    if (def !== undefined) byFaction.get(placement.owner)?.push(def);
  }
  for (const facility of facilities) {
    if (facility.owner === null) continue;
    for (const type of facility.queue) {
      const def = context.units.get(type);
      if (def !== undefined) byFaction.get(facility.owner)?.push(def);
    }
  }

  for (const [faction, defs] of byFaction) {
    if (!defs.some((def) => def.armorClass === 'sub')) continue;
    for (const other of factions) {
      if (other === faction) continue;
      const answers = byFaction.get(other) ?? [];
      if (!answers.some((def) => def.canDetectSub)) {
        v.fail(
          'map.units',
          `陣営 ${faction} が潜水艦を持つのに、陣営 ${other} に対潜手段がありません`,
        );
      }
    }
  }
}
