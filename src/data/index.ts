/**
 * ゲームデータの読み込み口（実装計画書 第5章）。
 *
 * JSON は Vite がビルド時にバンドルする。読み込み結果は必ず検証を通してから
 * `core` へ渡すため、`core` 側は「壊れたデータ」を考慮しなくてよい。
 */

import { createBoard, type GameData } from '@/core/map';
import type { MapDef, RulesDef, TerrainDef, TerrainId, UnitDef, UnitTypeId } from '@/core/types';
import rawRules from '../../data/rules.json';
import rawTerrain from '../../data/terrain.json';
import rawUnits from '../../data/units.json';
import rawMap01 from '../../data/maps/map01_crossroads.json';
import { parseMap } from './maps';
import { parseRules } from './rules';
import { parseTerrain } from './terrain';
import { parseUnits } from './units';

export { SchemaError } from './schema';
export { parseMap } from './maps';
export { parseRules } from './rules';
export { parseTerrain } from './terrain';
export { parseUnits } from './units';

/** 同梱マップの一覧。追加したらここに載せる。 */
const RAW_MAPS: Readonly<Record<string, unknown>> = {
  map01_crossroads: rawMap01,
};

export const MAP_IDS: readonly string[] = Object.keys(RAW_MAPS);

let cachedRules: RulesDef | undefined;
let cachedUnits: ReadonlyMap<UnitTypeId, UnitDef> | undefined;
let cachedTerrain: ReadonlyMap<TerrainId, TerrainDef> | undefined;

export function loadUnits(): ReadonlyMap<UnitTypeId, UnitDef> {
  cachedUnits ??= parseUnits(rawUnits, 'data/units.json');
  return cachedUnits;
}

export function loadRules(): RulesDef {
  cachedRules ??= parseRules(rawRules, 'data/rules.json');
  return cachedRules;
}

export function loadTerrain(): ReadonlyMap<TerrainId, TerrainDef> {
  cachedTerrain ??= parseTerrain(rawTerrain, 'data/terrain.json');
  return cachedTerrain;
}

export function loadMap(mapId: string): MapDef {
  const raw = RAW_MAPS[mapId];
  if (raw === undefined) {
    throw new Error(`存在しないマップです: ${mapId}`);
  }
  return parseMap(raw, { units: loadUnits(), terrain: loadTerrain() }, `data/maps/${mapId}.json`);
}

/** マップ1つ分の、ルール解決に必要な静的データ一式を組み立てる。 */
export function loadGameData(mapId: string): GameData {
  const units = loadUnits();
  const terrain = loadTerrain();
  const map = loadMap(mapId);
  return { board: createBoard(map), map, units, terrain, rules: loadRules() };
}
