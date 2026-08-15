/**
 * `data/units.json` の読み込みと検証（実装計画書 第5.1章）。
 *
 * 数値の妥当性だけでなく、**設計制約に反するデータを弾く**ことも役割にする。
 * 例えば「攻撃力を持つのに射程がない」「移動力があるのに移動タイプがない」は
 * ルール上あり得ない組み合わせなので、読み込み時に落とす。
 */

import {
  ARMOR_CLASSES,
  MATCHUP_CLASSES,
  MOVE_TYPES,
  type ArmorClass,
  type CargoSpec,
  type MatchupClass,
  type Power,
  type Range,
  type UnitDef,
  type UnitTypeId,
} from '@/core/types';
import { Validator } from './schema';

const UNIT_KEYS = [
  'id',
  'name',
  'designRole',
  'movementType',
  'movePoints',
  'armorClass',
  'defense',
  'power',
  'matchup',
  'range',
  'indirect',
  'attackDuringMove',
  'noCounter',
  'canCapture',
  'canDetectSub',
  'suppressSupport',
  'reloadTurns',
  'cargo',
  'value',
  'sprite',
] as const;

/** matchup が取りうる値。5段階に固定されている（第5.1.1章）。 */
const MATCHUP_VALUES: readonly number[] = [0, 0.7, 0.85, 1.0, 1.15];

export function parseUnits(raw: unknown, source = 'units.json'): Map<UnitTypeId, UnitDef> {
  const v = new Validator(source);
  const list = v.array('units', raw) ?? [];
  const defs: UnitDef[] = [];

  for (const [index, entry] of list.entries()) {
    const def = parseUnit(v, `units[${index}]`, entry);
    if (def !== undefined) defs.push(def);
  }

  v.uniqueIds(
    'units',
    defs.map((def) => def.id),
  );
  v.throwIfFailed();

  return new Map(defs.map((def) => [def.id, def]));
}

function parseUnit(v: Validator, path: string, raw: unknown): UnitDef | undefined {
  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, UNIT_KEYS);

  const id = v.string(`${path}.id`, record['id']);
  const name = v.string(`${path}.name`, record['name']);
  const designRole = v.string(`${path}.designRole`, record['designRole']);
  const armorClass = v.enum<ArmorClass>(`${path}.armorClass`, record['armorClass'], ARMOR_CLASSES);
  const defense = v.number(`${path}.defense`, record['defense'], 1.0, 5.0);
  const movePoints = v.integer(`${path}.movePoints`, record['movePoints'], 0, 12);
  const reloadTurns = v.integer(`${path}.reloadTurns`, record['reloadTurns'], 0, 3);
  const value = v.integer(`${path}.value`, record['value'], 0, 10000);
  const sprite = v.string(`${path}.sprite`, record['sprite']);
  const power = parsePower(v, `${path}.power`, record['power']);
  const matchup = parseMatchup(v, `${path}.matchup`, record['matchup']);
  const cargo = parseCargo(v, `${path}.cargo`, record['cargo']);
  const range = parseRange(v, `${path}.range`, record['range']);

  const movementType =
    record['movementType'] === null
      ? null
      : v.enum(`${path}.movementType`, record['movementType'], MOVE_TYPES);

  const indirect = v.boolean(`${path}.indirect`, record['indirect']);
  const attackDuringMove = v.boolean(`${path}.attackDuringMove`, record['attackDuringMove']);
  const noCounter = v.boolean(`${path}.noCounter`, record['noCounter']);
  const canCapture = v.boolean(`${path}.canCapture`, record['canCapture']);
  const canDetectSub = v.boolean(`${path}.canDetectSub`, record['canDetectSub']);
  const suppressSupport = v.boolean(`${path}.suppressSupport`, record['suppressSupport']);

  if (
    id === undefined ||
    name === undefined ||
    designRole === undefined ||
    armorClass === undefined ||
    defense === undefined ||
    movePoints === undefined ||
    reloadTurns === undefined ||
    value === undefined ||
    sprite === undefined ||
    power === undefined ||
    matchup === undefined ||
    cargo === undefined ||
    range === undefined ||
    movementType === undefined ||
    indirect === undefined ||
    attackDuringMove === undefined ||
    noCounter === undefined ||
    canCapture === undefined ||
    canDetectSub === undefined ||
    suppressSupport === undefined
  ) {
    return undefined;
  }

  checkConsistency(v, path, {
    movementType,
    movePoints,
    power,
    range: range.value,
    indirect,
    attackDuringMove,
  });

  return {
    id,
    name,
    designRole,
    movementType,
    movePoints,
    armorClass,
    defense,
    power,
    matchup,
    range: range.value,
    indirect,
    attackDuringMove,
    noCounter,
    canCapture,
    canDetectSub,
    suppressSupport,
    reloadTurns,
    cargo,
    value,
    sprite,
  };
}

/** ルール上あり得ない組み合わせを弾く。 */
function checkConsistency(
  v: Validator,
  path: string,
  unit: {
    movementType: string | null;
    movePoints: number;
    power: Power;
    range: Range | null;
    indirect: boolean;
    attackDuringMove: boolean;
  },
): void {
  const armed = unit.power.ground > 0 || unit.power.air > 0;

  if (armed && unit.range === null) {
    v.fail(`${path}.range`, '攻撃力を持つユニットには射程が必要です');
  }
  if (!armed && unit.range !== null) {
    v.fail(`${path}.range`, '攻撃力を持たないユニットに射程は指定できません');
  }
  if (unit.movementType === null && unit.movePoints !== 0) {
    v.fail(`${path}.movePoints`, '移動タイプを持たないユニットの移動力は0である必要があります');
  }
  if (unit.movementType !== null && unit.movePoints === 0) {
    v.fail(`${path}.movementType`, '移動力0のユニットは移動タイプを持ちません');
  }
  if (unit.indirect && unit.attackDuringMove) {
    v.fail(
      `${path}.attackDuringMove`,
      '移動後に攻撃できない間接砲が、移動中に攻撃することはできません',
    );
  }
}

function parsePower(v: Validator, path: string, raw: unknown): Power | undefined {
  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, ['ground', 'air']);
  const ground = v.integer(`${path}.ground`, record['ground'], 0, 20);
  const air = v.integer(`${path}.air`, record['air'], 0, 20);
  if (ground === undefined || air === undefined) return undefined;
  return { ground, air };
}

function parseMatchup(
  v: Validator,
  path: string,
  raw: unknown,
): Record<MatchupClass, number> | undefined {
  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, MATCHUP_CLASSES);

  const matchup = {} as Record<MatchupClass, number>;
  let ok = true;
  for (const armorClass of MATCHUP_CLASSES) {
    const value = record[armorClass];
    if (typeof value !== 'number' || !MATCHUP_VALUES.includes(value)) {
      v.fail(
        `${path}.${armorClass}`,
        `${MATCHUP_VALUES.join(' / ')} のいずれかである必要があります`,
      );
      ok = false;
      continue;
    }
    matchup[armorClass] = value;
  }
  return ok ? matchup : undefined;
}

/**
 * 射程。攻撃手段を持たない駒は null を取るため、
 * 「未指定（検証失敗）」と「null（攻撃手段なし）」を区別して返す。
 */
function parseRange(v: Validator, path: string, raw: unknown): { value: Range | null } | undefined {
  if (raw === null) return { value: null };

  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, ['min', 'max']);

  const min = v.integer(`${path}.min`, record['min'], 1, 9);
  const max = v.integer(`${path}.max`, record['max'], 1, 9);
  if (min === undefined || max === undefined) return undefined;
  if (min > max) {
    v.fail(path, `最小射程が最大射程を超えています（${min} > ${max}）`);
    return undefined;
  }
  return { value: { min, max } };
}

function parseCargo(v: Validator, path: string, raw: unknown): CargoSpec | undefined {
  const record = v.record(path, raw);
  if (record === undefined) return undefined;
  v.noExtraKeys(path, record, ['capacity', 'allow']);

  const capacity = v.integer(`${path}.capacity`, record['capacity'], 0, 6);
  const allowRecord = v.record(`${path}.allow`, record['allow']);
  if (capacity === undefined || allowRecord === undefined) return undefined;

  if (capacity === 0) {
    if (Object.keys(allowRecord).length > 0) {
      v.fail(path, '積載量0のユニットに積載対象は指定できません');
      return undefined;
    }
    return { capacity, allow: {} };
  }

  const allow: Partial<Record<ArmorClass, number>> = {};
  let ok = true;
  for (const [key, slots] of Object.entries(allowRecord)) {
    const armorClass = v.enum<ArmorClass>(`${path}.allow.${key}`, key, ARMOR_CLASSES);
    const cost = v.integer(`${path}.allow.${key}`, slots, 1, 6);
    if (armorClass === undefined || cost === undefined) {
      ok = false;
      continue;
    }
    if (cost > capacity) {
      v.fail(`${path}.allow.${key}`, `消費枠 ${cost} が積載量 ${capacity} を超えています`);
      ok = false;
      continue;
    }
    allow[armorClass] = cost;
  }

  if (Object.keys(allow).length === 0 && ok) {
    v.fail(path, '積載量があるのに積載対象が指定されていません');
    ok = false;
  }

  return ok ? { capacity, allow } : undefined;
}
