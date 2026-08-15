/**
 * `data/terrain.json` の読み込みと検証（実装計画書 第5.2章）。
 */

import { MOVE_TYPES, type MoveType, type TerrainDef, type TerrainId } from '@/core/types';
import { Validator } from './schema';

const TERRAIN_KEYS = ['id', 'name', 'tier', 'moveCost', 'defense'] as const;

/** 地形の段階。0=道路・施設 … 4=山岳 / 5=水域。 */
const MAX_TIER = 5;

export function parseTerrain(raw: unknown, source = 'terrain.json'): Map<TerrainId, TerrainDef> {
  const v = new Validator(source);
  const list = v.array('terrain', raw) ?? [];
  const defs: TerrainDef[] = [];

  for (const [index, entry] of list.entries()) {
    const path = `terrain[${index}]`;
    const record = v.record(path, entry);
    if (record === undefined) continue;
    v.noExtraKeys(path, record, TERRAIN_KEYS);

    const id = v.string(`${path}.id`, record['id']);
    const name = v.string(`${path}.name`, record['name']);
    const tier = v.integer(`${path}.tier`, record['tier'], 0, MAX_TIER);
    const defense = v.number(`${path}.defense`, record['defense'], 1.0, 2.0);
    const moveCost = parseMoveCost(v, `${path}.moveCost`, record['moveCost']);

    if (
      id === undefined ||
      name === undefined ||
      tier === undefined ||
      defense === undefined ||
      moveCost === undefined
    ) {
      continue;
    }

    // 航空はすべての地形をコスト1で通る（第5.2章）
    if (moveCost.air !== 1) {
      v.fail(`${path}.moveCost.air`, '航空はすべての地形をコスト1で通る必要があります');
    }

    defs.push({ id, name, tier, moveCost, defense });
  }

  v.uniqueIds(
    'terrain',
    defs.map((def) => def.id),
  );
  v.throwIfFailed();

  return new Map(defs.map((def) => [def.id, def]));
}

function parseMoveCost(
  v: Validator,
  path: string,
  raw: unknown,
): Record<MoveType, number | null> | undefined {
  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, MOVE_TYPES);

  const cost = {} as Record<MoveType, number | null>;
  let ok = true;
  for (const moveType of MOVE_TYPES) {
    const value = record[moveType];
    if (value === null) {
      cost[moveType] = null;
      continue;
    }
    // 進入不可は null で表す。コスト0は「消費なしで無限に動ける」ことになるため認めない
    const n = v.integer(`${path}.${moveType}`, value, 1, 9);
    if (n === undefined) {
      ok = false;
      continue;
    }
    cost[moveType] = n;
  }
  return ok ? cost : undefined;
}
