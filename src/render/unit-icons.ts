/**
 * ユニットの図形（実装計画書 第7.4章）。
 *
 * スプライト素材が入るまでの繋ぎだが、文字だけでは盤面が読めないため、
 * **種別ごとのシルエットを Canvas のパスで自作する**。
 * 外部素材を使わないので権利上の問題もない（第11章）。
 *
 * 形は「何ができる駒か」が一目で分かることだけを狙う。
 * 歩兵は人型、装甲は砲塔付きの車体、間接砲は仰角のついた砲身、
 * 航空は矢印、艦艇は船体、というように役割ごとに分ける。
 */

import type { UnitDef, UnitTypeId } from '@/core/types';

export type IconKind =
  | 'infantry'
  | 'bike'
  | 'buggy'
  | 'carrier'
  | 'tank'
  | 'walker'
  | 'artillery'
  | 'antiAir'
  | 'jammer'
  | 'mine'
  | 'fighter'
  | 'attacker'
  | 'plane'
  | 'ship'
  | 'submarine';

const ICONS: Readonly<Record<UnitTypeId, IconKind>> = {
  infantry: 'infantry',
  heavy_infantry: 'infantry',
  bike_infantry: 'bike',
  buggy: 'buggy',
  indirect_buggy: 'buggy',
  apc: 'carrier',
  fast_tank: 'tank',
  mbt: 'tank',
  assault_tank: 'tank',
  heavy_tank: 'tank',
  fortress_tank: 'tank',
  walker: 'walker',
  heavy_artillery: 'artillery',
  spg: 'artillery',
  rocket_artillery: 'artillery',
  aa_tank: 'antiAir',
  sam_vehicle: 'antiAir',
  jammer: 'jammer',
  mine: 'mine',
  fighter: 'fighter',
  attacker: 'attacker',
  transport_plane: 'plane',
  corvette: 'ship',
  destroyer: 'ship',
  missile_cruiser: 'ship',
  landing_ship: 'ship',
  railgun_ship: 'ship',
  submarine: 'submarine',
};

export function iconKindFor(def: UnitDef): IconKind {
  const known = ICONS[def.id];
  if (known !== undefined) return known;
  if (def.armorClass === 'air') return 'plane';
  if (def.armorClass === 'sub') return 'submarine';
  if (def.armorClass === 'ship') return 'ship';
  if (def.armorClass === 'infantry') return 'infantry';
  return 'tank';
}

/**
 * 中心 (0,0)・半径1の座標系で図形を描く。
 * 呼び出し側が `translate` と `scale` を掛けてから使う。
 */
export function traceIcon(ctx: CanvasRenderingContext2D, kind: IconKind): void {
  switch (kind) {
    case 'infantry':
      traceInfantry(ctx);
      break;
    case 'bike':
      traceBike(ctx);
      break;
    case 'buggy':
      traceBuggy(ctx);
      break;
    case 'carrier':
      traceCarrier(ctx);
      break;
    case 'tank':
      traceTank(ctx);
      break;
    case 'walker':
      traceWalker(ctx);
      break;
    case 'artillery':
      traceArtillery(ctx);
      break;
    case 'antiAir':
      traceAntiAir(ctx);
      break;
    case 'jammer':
      traceJammer(ctx);
      break;
    case 'mine':
      traceMine(ctx);
      break;
    case 'fighter':
      traceFighter(ctx);
      break;
    case 'attacker':
      traceAttacker(ctx);
      break;
    case 'plane':
      tracePlane(ctx);
      break;
    case 'ship':
      traceShip(ctx);
      break;
    case 'submarine':
      traceSubmarine(ctx);
      break;
    default:
      traceTank(ctx);
      break;
  }
}

/** 人型。頭と肩で「歩いている駒」を表す。 */
function traceInfantry(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, -0.42, 0.24, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(-0.42, 0.52);
  ctx.lineTo(-0.3, -0.1);
  ctx.quadraticCurveTo(0, -0.26, 0.3, -0.1);
  ctx.lineTo(0.42, 0.52);
  ctx.closePath();
}

/** 人型に車輪を1つ足してバイクにする。 */
function traceBike(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, -0.46, 0.2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(-0.34, 0.1);
  ctx.lineTo(-0.24, -0.18);
  ctx.quadraticCurveTo(0, -0.32, 0.24, -0.18);
  ctx.lineTo(0.34, 0.1);
  ctx.closePath();
  ctx.moveTo(0.62, 0.34);
  ctx.arc(0.34, 0.34, 0.28, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(-0.06, 0.34);
  ctx.arc(-0.34, 0.34, 0.28, 0, Math.PI * 2);
  ctx.closePath();
}

/** 平たい車体と大きな車輪。速いが薄い駒。 */
function traceBuggy(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.62, 0.06);
  ctx.lineTo(-0.34, -0.34);
  ctx.lineTo(0.28, -0.34);
  ctx.lineTo(0.62, 0.06);
  ctx.closePath();
  ctx.moveTo(-0.12, 0.3);
  ctx.arc(-0.36, 0.3, 0.24, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(0.6, 0.3);
  ctx.arc(0.36, 0.3, 0.24, 0, Math.PI * 2);
  ctx.closePath();
}

/** 箱形の車体。中に何かを積める駒。 */
function traceCarrier(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.6, -0.3);
  ctx.lineTo(0.44, -0.3);
  ctx.lineTo(0.62, 0.04);
  ctx.lineTo(-0.6, 0.04);
  ctx.closePath();
  ctx.moveTo(-0.14, 0.3);
  ctx.arc(-0.38, 0.3, 0.24, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(0.58, 0.3);
  ctx.arc(0.34, 0.3, 0.24, 0, Math.PI * 2);
  ctx.closePath();
}

/** 車体・砲塔・砲身。装甲の基本形。 */
function traceTank(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  // 履帯
  ctx.moveTo(-0.66, 0.16);
  ctx.lineTo(0.66, 0.16);
  ctx.lineTo(0.56, 0.46);
  ctx.lineTo(-0.56, 0.46);
  ctx.closePath();
  // 車体
  ctx.moveTo(-0.54, -0.1);
  ctx.lineTo(0.54, -0.1);
  ctx.lineTo(0.62, 0.14);
  ctx.lineTo(-0.62, 0.14);
  ctx.closePath();
  // 砲塔
  ctx.moveTo(-0.28, -0.42);
  ctx.lineTo(0.2, -0.42);
  ctx.lineTo(0.28, -0.12);
  ctx.lineTo(-0.34, -0.12);
  ctx.closePath();
  // 砲身
  ctx.rect(0.24, -0.36, 0.5, 0.13);
}

/** 砲塔付きの車体に脚。山にも登れる装甲。 */
function traceWalker(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.44, -0.34);
  ctx.lineTo(0.32, -0.34);
  ctx.lineTo(0.44, 0.02);
  ctx.lineTo(-0.5, 0.02);
  ctx.closePath();
  ctx.rect(0.34, -0.3, 0.42, 0.12);
  // 脚
  ctx.moveTo(-0.42, 0.02);
  ctx.lineTo(-0.62, 0.52);
  ctx.lineTo(-0.44, 0.52);
  ctx.lineTo(-0.26, 0.02);
  ctx.closePath();
  ctx.moveTo(0.14, 0.02);
  ctx.lineTo(0.3, 0.52);
  ctx.lineTo(0.48, 0.52);
  ctx.lineTo(0.32, 0.02);
  ctx.closePath();
}

/** 仰角のついた長い砲身。届く距離が命の駒。 */
function traceArtillery(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.6, 0.16);
  ctx.lineTo(0.5, 0.16);
  ctx.lineTo(0.42, 0.46);
  ctx.lineTo(-0.52, 0.46);
  ctx.closePath();
  ctx.moveTo(-0.5, -0.06);
  ctx.lineTo(0.28, -0.06);
  ctx.lineTo(0.4, 0.14);
  ctx.lineTo(-0.56, 0.14);
  ctx.closePath();
  // 砲身（仰角）
  ctx.save();
  ctx.translate(-0.1, -0.12);
  ctx.rotate(-Math.PI / 5);
  ctx.rect(0, -0.07, 0.92, 0.14);
  ctx.restore();
}

/** 上を向いた発射機。空を撃つ駒。 */
function traceAntiAir(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.6, 0.14);
  ctx.lineTo(0.6, 0.14);
  ctx.lineTo(0.5, 0.46);
  ctx.lineTo(-0.5, 0.46);
  ctx.closePath();
  ctx.moveTo(-0.5, -0.04);
  ctx.lineTo(0.44, -0.04);
  ctx.lineTo(0.54, 0.12);
  ctx.lineTo(-0.58, 0.12);
  ctx.closePath();
  // 斜め上を向いた2本の発射筒
  for (const offset of [-0.16, 0.1]) {
    ctx.save();
    ctx.translate(offset, -0.1);
    ctx.rotate(-Math.PI / 3.2);
    ctx.rect(0, -0.06, 0.66, 0.12);
    ctx.restore();
  }
}

/** アンテナ。攻撃せず、隣接する敵の支援を潰す駒。 */
function traceJammer(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.56, 0.14);
  ctx.lineTo(0.56, 0.14);
  ctx.lineTo(0.46, 0.46);
  ctx.lineTo(-0.46, 0.46);
  ctx.closePath();
  ctx.moveTo(-0.48, -0.02);
  ctx.lineTo(0.4, -0.02);
  ctx.lineTo(0.5, 0.12);
  ctx.lineTo(-0.54, 0.12);
  ctx.closePath();
  // 皿型アンテナ
  ctx.moveTo(-0.04, -0.06);
  ctx.lineTo(0.04, -0.06);
  ctx.lineTo(0.04, -0.34);
  ctx.lineTo(-0.04, -0.34);
  ctx.closePath();
  ctx.moveTo(-0.36, -0.44);
  ctx.quadraticCurveTo(0, -0.78, 0.36, -0.44);
  ctx.quadraticCurveTo(0, -0.56, -0.36, -0.44);
  ctx.closePath();
}

/** 棘のある設置物。動かず、通せんぼする駒。 */
function traceMine(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * 0.64, Math.sin(angle) * 0.64);
    ctx.lineTo(Math.cos(angle + 0.16) * 0.5, Math.sin(angle + 0.16) * 0.5);
    ctx.closePath();
  }
  ctx.moveTo(0.34, 0);
  ctx.arc(0, 0, 0.34, 0, Math.PI * 2);
  ctx.closePath();
}

/** 後退翼の矢印。制空の駒。 */
function traceFighter(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -0.64);
  ctx.lineTo(0.18, -0.1);
  ctx.lineTo(0.68, 0.26);
  ctx.lineTo(0.68, 0.4);
  ctx.lineTo(0.12, 0.24);
  ctx.lineTo(0.12, 0.5);
  ctx.lineTo(0.3, 0.66);
  ctx.lineTo(-0.3, 0.66);
  ctx.lineTo(-0.12, 0.5);
  ctx.lineTo(-0.12, 0.24);
  ctx.lineTo(-0.68, 0.4);
  ctx.lineTo(-0.68, 0.26);
  ctx.lineTo(-0.18, -0.1);
  ctx.closePath();
}

/** 直線翼の機体。地上を叩く駒。 */
function traceAttacker(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -0.6);
  ctx.quadraticCurveTo(0.2, -0.4, 0.2, 0.1);
  ctx.lineTo(0.72, 0.16);
  ctx.lineTo(0.72, 0.34);
  ctx.lineTo(0.2, 0.36);
  ctx.lineTo(0.24, 0.62);
  ctx.lineTo(-0.24, 0.62);
  ctx.lineTo(-0.2, 0.36);
  ctx.lineTo(-0.72, 0.34);
  ctx.lineTo(-0.72, 0.16);
  ctx.lineTo(-0.2, 0.1);
  ctx.quadraticCurveTo(-0.2, -0.4, 0, -0.6);
  ctx.closePath();
}

/** 太い胴体の輸送機。 */
function tracePlane(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.22, 0.6, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(-0.74, 0.06);
  ctx.lineTo(0.74, 0.06);
  ctx.lineTo(0.74, 0.24);
  ctx.lineTo(-0.74, 0.24);
  ctx.closePath();
  ctx.moveTo(-0.32, 0.48);
  ctx.lineTo(0.32, 0.48);
  ctx.lineTo(0.32, 0.62);
  ctx.lineTo(-0.32, 0.62);
  ctx.closePath();
}

/** 船体と艦橋。 */
function traceShip(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.72, 0.12);
  ctx.lineTo(0.72, 0.12);
  ctx.lineTo(0.44, 0.5);
  ctx.lineTo(-0.5, 0.5);
  ctx.closePath();
  ctx.moveTo(-0.24, -0.24);
  ctx.lineTo(0.26, -0.24);
  ctx.lineTo(0.32, 0.1);
  ctx.lineTo(-0.3, 0.1);
  ctx.closePath();
  ctx.rect(-0.06, -0.62, 0.12, 0.4);
}

/** 潜航する船体とセイル。 */
function traceSubmarine(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, 0.18, 0.7, 0.26, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(-0.14, -0.32);
  ctx.lineTo(0.16, -0.32);
  ctx.lineTo(0.22, 0.06);
  ctx.lineTo(-0.2, 0.06);
  ctx.closePath();
  ctx.rect(-0.02, -0.56, 0.05, 0.26);
}
