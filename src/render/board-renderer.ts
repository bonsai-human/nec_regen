/**
 * 盤面の描画（実装計画書 第7.4章）。
 *
 * レイヤの順序は 地形 → グリッド → 施設 → ハイライト → ユニット。
 * **カメラの可視範囲のヘクスだけ**を描くので、マップが大きくなっても
 * 1フレームの描画量は画面サイズでしか決まらない。
 *
 * `core` を読むだけで、状態は一切書き換えない（第3.1章）。
 */

import { hexKey, type Hex, type HexKey } from '@/core/hex';
import { terrainIdAt, type GameData } from '@/core/map';
import { MAX_STRENGTH, type FactionId, type UnitTypeId } from '@/core/types';
import type { Camera } from './camera';
import { hexCorners, type Point } from './hex-layout';
import { COLORS, factionColor, terrainColor, unitLabel } from './palette';

/** 描画に必要な最小限のユニット情報。初期配置も `GameState` の駒も同じ形で渡せる。 */
export interface RenderUnit {
  readonly hex: Hex;
  readonly type: UnitTypeId;
  readonly owner: FactionId;
  readonly strength: number;
}

export interface RenderScene {
  readonly units: readonly RenderUnit[];
  /** カーソル / 指の下にあるヘクス。 */
  readonly hovered: Hex | null;
  /** 選択中のヘクス。 */
  readonly selected: Hex | null;
  /** 選択中のユニットが移動を終えられるヘクス。 */
  readonly reachable: ReadonlySet<HexKey> | null;
  /** 確定前の移動経路プレビュー（第7.2章「プレビュー → 確定」）。 */
  readonly path: readonly Hex[] | null;
}

/** ラベルを描いても潰れない最小倍率。これ未満では記号を省く。 */
const LABEL_MIN_SCALE = 16;
/** 施設マークを描く最小倍率。 */
const FACILITY_MIN_SCALE = 10;

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  data: GameData,
  camera: Camera,
  scene: RenderScene,
  viewport: { width: number; height: number },
): void {
  ctx.save();
  ctx.fillStyle = COLORS.outOfBoard;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const visible = camera.visibleHexes(data.board.width, data.board.height);
  const scale = camera.scale;

  // 地形とグリッド
  for (const { hex } of visible) {
    const id = terrainIdAt(data.board, hex);
    if (id === null) continue;
    const center = camera.hexToScreen(hex);
    tracePath(ctx, center, scale);
    ctx.fillStyle = terrainColor(id);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    ctx.stroke();
  }

  // 施設（占領対象なので、地形色だけでなく所有者が分かる印を重ねる）
  if (scale >= FACILITY_MIN_SCALE) {
    for (const facility of data.map.facilities) {
      const center = camera.hexToScreen(facility.hex);
      if (!onScreen(center, scale, viewport)) continue;
      drawFacility(ctx, center, scale, facility.owner);
    }
  }

  // 移動できるヘクス。ユニットの下に敷いて、駒の視認性を落とさない
  if (scene.reachable !== null) {
    for (const { hex } of visible) {
      if (!scene.reachable.has(hexKey(hex))) continue;
      tracePath(ctx, camera.hexToScreen(hex), scale);
      ctx.fillStyle = COLORS.reachable;
      ctx.fill();
    }
  }

  // 経路プレビュー
  if (scene.path !== null && scene.path.length > 1) {
    drawPath(ctx, camera, scene.path, scale);
  }

  // ハイライト
  if (scene.hovered !== null) {
    drawOutline(ctx, camera, scene.hovered, COLORS.hover, Math.max(1.5, scale * 0.06));
  }
  if (scene.selected !== null) {
    drawOutline(ctx, camera, scene.selected, COLORS.text, Math.max(2, scale * 0.09));
  }

  // ユニット
  for (const unit of scene.units) {
    const center = camera.hexToScreen(unit.hex);
    if (!onScreen(center, scale, viewport)) continue;
    drawUnit(ctx, center, scale, unit);
  }

  ctx.restore();
}

function tracePath(ctx: CanvasRenderingContext2D, center: Point, scale: number): void {
  const corners = hexCorners({ x: 0, y: 0 });
  ctx.beginPath();
  for (const [index, corner] of corners.entries()) {
    const x = center.x + corner.x * scale;
    const y = center.y + corner.y * scale;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  hex: Hex,
  color: string,
  lineWidth: number,
): void {
  tracePath(ctx, camera.hexToScreen(hex), camera.scale);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** 経路を線で描き、終点に停止位置の印を置く。 */
function drawPath(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  path: readonly Hex[],
  scale: number,
): void {
  ctx.save();
  ctx.beginPath();
  for (const [index, hex] of path.entries()) {
    const point = camera.hexToScreen(hex);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.lineWidth = Math.max(2, scale * 0.14);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.path;
  ctx.stroke();

  const destination = path.at(-1);
  if (destination !== undefined) {
    const point = camera.hexToScreen(destination);
    ctx.beginPath();
    ctx.arc(point.x, point.y, scale * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.path;
    ctx.fill();
  }
  ctx.restore();
}

function drawFacility(
  ctx: CanvasRenderingContext2D,
  center: Point,
  scale: number,
  owner: FactionId | null,
): void {
  const color = owner === null ? COLORS.facilityNeutral : factionColor(owner).edge;
  ctx.beginPath();
  ctx.arc(center.x, center.y, scale * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, scale * 0.08);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  center: Point,
  scale: number,
  unit: RenderUnit,
): void {
  const colors = factionColor(unit.owner);
  const radius = scale * 0.52;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, scale * 0.05);
  ctx.strokeStyle = colors.edge;
  ctx.stroke();

  if (scale >= LABEL_MIN_SCALE) {
    ctx.fillStyle = COLORS.text;
    ctx.font = `${Math.round(scale * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(unitLabel(unit.type), center.x, center.y);
  }

  // 損耗している駒だけ戦力を出す。満タンの駒で画面を埋めない
  if (unit.strength < MAX_STRENGTH && scale >= LABEL_MIN_SCALE) {
    const barWidth = radius * 1.5;
    const barHeight = Math.max(2, scale * 0.1);
    const x = center.x - barWidth / 2;
    const y = center.y + radius * 0.85;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = colors.edge;
    ctx.fillRect(x, y, (barWidth * unit.strength) / MAX_STRENGTH, barHeight);
  }
}

/** ヘクス1つ分の余白を見て、画面外の描画を省く。 */
function onScreen(
  center: Point,
  scale: number,
  viewport: { width: number; height: number },
): boolean {
  return (
    center.x >= -scale &&
    center.y >= -scale &&
    center.x <= viewport.width + scale &&
    center.y <= viewport.height + scale
  );
}

/** デバッグ・テスト用。可視ヘクスのキー一覧を返す。 */
export function visibleHexKeys(data: GameData, camera: Camera): string[] {
  return camera.visibleHexes(data.board.width, data.board.height).map(({ hex }) => hexKey(hex));
}
