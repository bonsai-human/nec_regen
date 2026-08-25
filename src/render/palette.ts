/**
 * 描画に使う色と記号（実装計画書 第7.4章）。
 *
 * > ユニット表現は Phase 2 までは色付きヘクス＋記号のプレースホルダ。
 * > Phase 7 以降で自作スプライトに差し替える
 *
 * 地形色は**段階が上がるほど濃く**なるようにして、
 * コストと防御の階段構造（第5.2章）が色でも読めるようにしている。
 */

import type { FactionId, TerrainId, UnitTypeId } from '@/core/types';

export const COLORS = {
  background: '#0e1116',
  grid: 'rgba(255, 255, 255, 0.10)',
  gridStrong: 'rgba(255, 255, 255, 0.22)',
  outOfBoard: '#0b0e12',
  hover: 'rgba(255, 255, 255, 0.28)',
  /** 移動できるヘクスの敷き色。地形の判別を潰さない程度に薄く重ねる。 */
  reachable: 'rgba(110, 168, 254, 0.30)',
  path: '#ffd479',
  /** 攻撃できる敵の敷き色。 */
  target: 'rgba(226, 84, 76, 0.38)',
  /** ダメージ予測を出している目標の枠。 */
  focus: '#ffd479',
  facilityNeutral: '#c9ccd1',
  text: '#e6e9ee',
  textDim: '#9aa2ad',
} as const;

const TERRAIN_COLORS: Readonly<Record<TerrainId, string>> = {
  road: '#6d6553',
  bridge: '#7b6a4e',
  factory: '#4c5666',
  hq: '#5b4d6e',
  port: '#3f5a6b',
  airfield: '#525d6b',
  plain: '#41603c',
  beach: '#8c7d55',
  hill: '#6b5d38',
  forest: '#294628',
  city: '#565764',
  badlands: '#6d4b39',
  swamp: '#37473f',
  mountain: '#5c5450',
  river: '#25445d',
  shallows: '#2c5b73',
  sea: '#15314a',
};

export function terrainColor(id: TerrainId): string {
  return TERRAIN_COLORS[id] ?? '#333a44';
}

const FACTION_COLORS: Readonly<Record<FactionId, { fill: string; edge: string }>> = {
  red: { fill: '#c2453f', edge: '#f0a9a5' },
  blue: { fill: '#3f6fc2', edge: '#a5c2f0' },
};

export function factionColor(faction: FactionId): { fill: string; edge: string } {
  return FACTION_COLORS[faction] ?? { fill: '#8a8f98', edge: '#d5d8dd' };
}

/**
 * ユニットの仮表示ラベル。スプライトが入るまでの繋ぎなので、
 * 2文字までで種別を見分けられることだけを狙う。
 */
const UNIT_LABELS: Readonly<Record<UnitTypeId, string>> = {
  infantry: '歩',
  heavy_infantry: '重歩',
  bike_infantry: 'バイ',
  buggy: 'バギ',
  indirect_buggy: '間バ',
  apc: '輸車',
  fast_tank: '快速',
  mbt: '主力',
  assault_tank: '突撃',
  heavy_tank: '重装',
  fortress_tank: '要塞',
  walker: '多脚',
  heavy_artillery: '重砲',
  spg: '自走',
  rocket_artillery: 'ロケ',
  aa_tank: '対空',
  sam_vehicle: '対ミ',
  jammer: '妨害',
  mine: '地雷',
  fighter: '戦闘',
  attacker: '攻撃',
  transport_plane: '輸機',
  corvette: 'コル',
  destroyer: '駆逐',
  missile_cruiser: '巡洋',
  submarine: '潜水',
  landing_ship: '揚陸',
  railgun_ship: '電磁',
};

export function unitLabel(type: UnitTypeId): string {
  return UNIT_LABELS[type] ?? '？';
}
