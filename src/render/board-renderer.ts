/**
 * 盤面の描画（実装計画書 第7.4章・第7.5章）。
 *
 * レイヤの順序は 地形 → グリッド → 地形効果の目印 → 施設 → ハイライト → ユニット → 効果。
 * **カメラの可視範囲のヘクスだけ**を描くので、マップが大きくなっても
 * 1フレームの描画量は画面サイズでしか決まらない。
 *
 * 「読む」ための情報（地形の硬さ・増援の予定・与えたダメージ）は装飾ではなく
 * 機能として扱う（第7.5章）。盤面を見ただけで判断できることを優先する。
 *
 * `core` を読むだけで、状態は一切書き換えない（第3.1章）。
 */

import { hexKey, type Hex, type HexKey } from '@/core/hex';
import { terrainIdAt, type GameData } from '@/core/map';
import { MAX_STRENGTH, type FactionId, type UnitTypeId } from '@/core/types';
import type { Camera } from './camera';
import { hexCorners, type Point } from './hex-layout';
import { COLORS, factionColor, terrainColor } from './palette';
import { iconKindFor, traceIcon } from './unit-icons';

/** 描画に必要な最小限のユニット情報。 */
export interface RenderUnit {
  readonly hex: Hex;
  readonly type: UnitTypeId;
  readonly owner: FactionId;
  readonly strength: number;
  /** 行動を終えた駒は沈める。 */
  readonly acted?: boolean;
}

/** 戦闘や修理の直後に一瞬だけ出す表示（第7.5章「何が起きたか」）。 */
export interface RenderFlash {
  readonly hex: Hex;
  readonly text: string;
  readonly color: string;
  /** 0（出た瞬間）→ 1（消える直前）。 */
  readonly progress: number;
}

export interface RenderScene {
  readonly units: readonly RenderUnit[];
  readonly hovered: Hex | null;
  readonly selected: Hex | null;
  /** 選択中のユニットが移動を終えられるヘクス。 */
  readonly reachable: ReadonlySet<HexKey> | null;
  /** 選択中のユニットが攻撃できる敵のヘクス。 */
  readonly targets: ReadonlySet<HexKey> | null;
  /** 確定前の移動経路プレビュー（第7.2章「プレビュー → 確定」）。 */
  readonly path: readonly Hex[] | null;
  /** ダメージ予測を出している攻撃目標。 */
  readonly focus: Hex | null;
  /** 施設ごとの現在の所有者。マップ定義ではなく盤面の状態を映す。 */
  readonly facilityOwners: ReadonlyMap<HexKey, FactionId | null> | null;
  /** 施設ごとの「あと何ターンで増援が出るか」。 */
  readonly spawnCountdown: ReadonlyMap<HexKey, number> | null;
  readonly flashes: readonly RenderFlash[];
}

/** ユニット名を添える最小倍率。これ未満はシルエットだけにする。 */
const LABEL_MIN_SCALE = 26;
/** 施設マークを描く最小倍率。 */
const FACILITY_MIN_SCALE = 10;
/** 地形効果の目印を描く最小倍率。 */
const TERRAIN_PIP_MIN_SCALE = 14;

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  data: GameData,
  camera: Camera,
  scene: RenderScene,
  viewport: { width: number; height: number },
  labelFor: (type: UnitTypeId) => string,
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

  // 地形効果の目印。硬い地形ほど点が増える（第5.2章の階段構造を盤面で読めるように）
  if (scale >= TERRAIN_PIP_MIN_SCALE) {
    for (const { hex } of visible) {
      const id = terrainIdAt(data.board, hex);
      if (id === null) continue;
      const defense = data.terrain.get(id)?.defense ?? 1;
      const pips = Math.round((defense - 1) * 10);
      // 1.1（平地・砂浜）は事実上の基準なので描かない。効く地形だけを目立たせる
      if (pips <= 1) continue;
      drawDefensePips(ctx, camera.hexToScreen(hex), scale, pips);
    }
  }

  // 施設。占領対象なので、所有者と増援の予定が分かる印を重ねる
  if (scale >= FACILITY_MIN_SCALE) {
    for (const facility of data.map.facilities) {
      const center = camera.hexToScreen(facility.hex);
      if (!onScreen(center, scale, viewport)) continue;
      const countdown = scene.spawnCountdown?.get(hexKey(facility.hex));
      drawFacility(ctx, center, scale, ownerAt(scene, facility.hex, data), countdown);
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

  // 攻撃できる敵
  if (scene.targets !== null) {
    for (const { hex } of visible) {
      if (!scene.targets.has(hexKey(hex))) continue;
      tracePath(ctx, camera.hexToScreen(hex), scale);
      ctx.fillStyle = COLORS.target;
      ctx.fill();
    }
  }

  if (scene.path !== null && scene.path.length > 1) {
    drawPath(ctx, camera, scene.path, scale);
  }

  if (scene.hovered !== null) {
    drawOutline(ctx, camera, scene.hovered, COLORS.hover, Math.max(1.5, scale * 0.06));
  }
  if (scene.selected !== null) {
    drawOutline(ctx, camera, scene.selected, COLORS.text, Math.max(2, scale * 0.09));
  }
  if (scene.focus !== null) {
    drawOutline(ctx, camera, scene.focus, COLORS.focus, Math.max(2, scale * 0.11));
  }

  // ユニット
  for (const unit of scene.units) {
    const center = camera.hexToScreen(unit.hex);
    if (!onScreen(center, scale, viewport)) continue;
    drawUnit(ctx, data, center, scale, unit, labelFor(unit.type));
  }

  // 戦闘結果などの一時表示
  for (const flash of scene.flashes) {
    drawFlash(ctx, camera.hexToScreen(flash.hex), scale, flash);
  }

  ctx.restore();
}

/** マップ定義ではなく、いまの所有者を使う。 */
function ownerAt(scene: RenderScene, hex: Hex, data: GameData): FactionId | null {
  const owner = scene.facilityOwners?.get(hexKey(hex));
  if (owner !== undefined) return owner;
  const initial = data.map.facilities.find((item) => item.hex.q === hex.q && item.hex.r === hex.r);
  return initial?.owner ?? null;
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

/** 地形の硬さを点の数で表す。1.1 → 1個、1.4 → 4個。 */
function drawDefensePips(
  ctx: CanvasRenderingContext2D,
  center: Point,
  scale: number,
  pips: number,
): void {
  const radius = Math.max(1, scale * 0.05);
  const gap = radius * 2.6;
  const startX = center.x - ((pips - 1) * gap) / 2;
  const y = center.y - scale * 0.62;

  ctx.save();
  ctx.fillStyle = COLORS.terrainPip;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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

/**
 * 施設の所有者と、増援まであと何ターンかを描く。
 * 「3ターン後にここへ敵戦車が出る」という読みを盤面から直接できるようにする（第4.6章）。
 */
function drawFacility(
  ctx: CanvasRenderingContext2D,
  center: Point,
  scale: number,
  owner: FactionId | null,
  countdown: number | undefined,
): void {
  const color = owner === null ? COLORS.facilityNeutral : factionColor(owner).edge;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, scale * 0.66, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, scale * 0.09);
  ctx.strokeStyle = color;
  ctx.stroke();

  if (countdown !== undefined && scale >= TERRAIN_PIP_MIN_SCALE) {
    const badgeX = center.x + scale * 0.5;
    const badgeY = center.y - scale * 0.5;
    const radius = scale * 0.3;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.badgeBg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale * 0.04);
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = `${Math.round(scale * 0.34)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(countdown), badgeX, badgeY);
  }
  ctx.restore();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  data: GameData,
  center: Point,
  scale: number,
  unit: RenderUnit,
  label: string,
): void {
  const colors = factionColor(unit.owner);
  const def = data.units.get(unit.type);
  const showLabel = scale >= LABEL_MIN_SCALE;
  const iconScale = scale * (showLabel ? 0.5 : 0.62);
  const iconY = center.y - (showLabel ? scale * 0.12 : 0);

  ctx.save();
  // 行動を終えた駒は沈める。次に動かせる駒が一目で分かるようにする
  if (unit.acted === true) ctx.globalAlpha = 0.5;

  // 台座。陣営の色はここで見せ、シルエットは白抜きにする
  ctx.beginPath();
  ctx.arc(center.x, center.y, scale * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, scale * 0.05);
  ctx.strokeStyle = colors.edge;
  ctx.stroke();

  if (def !== undefined) {
    ctx.save();
    ctx.translate(center.x, iconY);
    ctx.scale(iconScale, iconScale);
    traceIcon(ctx, iconKindFor(def));
    ctx.restore();
    ctx.fillStyle = COLORS.unitIcon;
    ctx.fill('evenodd');
  }

  if (showLabel) {
    ctx.fillStyle = COLORS.text;
    ctx.font = `${Math.round(scale * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, center.x, center.y + scale * 0.34);
  }

  // 損耗している駒だけ戦力を出す。満タンの駒で画面を埋めない
  if (unit.strength < MAX_STRENGTH) {
    const barWidth = scale * 0.9;
    const barHeight = Math.max(2.5, scale * 0.13);
    const x = center.x - barWidth / 2;
    const y = center.y + scale * 0.56;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = strengthColor(unit.strength);
    ctx.fillRect(x, y, (barWidth * unit.strength) / MAX_STRENGTH, barHeight);

    if (scale >= LABEL_MIN_SCALE) {
      ctx.fillStyle = COLORS.text;
      ctx.font = `${Math.round(scale * 0.24)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(unit.strength), center.x, y + barHeight + scale * 0.18);
    }
  }

  ctx.restore();
}

/** 戦力バーの色。減るほど赤に寄せて、危ない駒が目に入るようにする。 */
function strengthColor(strength: number): string {
  if (strength >= 7) return '#66c07a';
  if (strength >= 4) return '#d8c14a';
  return '#d86a5a';
}

/** ダメージなどの一時表示。上へ流れながら消える。 */
function drawFlash(
  ctx: CanvasRenderingContext2D,
  center: Point,
  scale: number,
  flash: RenderFlash,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - flash.progress);
  ctx.font = `bold ${Math.round(Math.max(14, scale * 0.6))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, scale * 0.09);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillStyle = flash.color;
  const y = center.y - scale * (0.4 + flash.progress * 0.9);
  ctx.strokeText(flash.text, center.x, y);
  ctx.fillText(flash.text, center.x, y);
  ctx.restore();
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
