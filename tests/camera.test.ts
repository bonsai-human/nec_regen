import { describe, expect, it } from 'vitest';
import { toAxial } from '@/core/hex';
import { Camera, MAX_SCALE, MIN_TAP_SCALE } from '@/render/camera';
import { boardBounds, hexToWorld, worldToHex } from '@/render/hex-layout';

const BOARD = { width: 21, height: 14 };

function makeCamera(viewport = { width: 1280, height: 720 }): Camera {
  return new Camera({ bounds: boardBounds(BOARD.width, BOARD.height), viewport });
}

describe('カメラの座標変換', () => {
  it('ワールドと画面を往復しても元に戻る', () => {
    const camera = makeCamera();
    for (const point of [
      { x: 0, y: 0 },
      { x: 12.5, y: -4 },
      { x: -3.25, y: 9.75 },
    ]) {
      const round = camera.screenToWorld(camera.worldToScreen(point));
      expect(round.x).toBeCloseTo(point.x);
      expect(round.y).toBeCloseTo(point.y);
    }
  });

  it('画面の中心には注視点が来る', () => {
    const camera = makeCamera({ width: 800, height: 600 });
    const center = camera.worldToScreen(camera.center);
    expect(center.x).toBeCloseTo(400);
    expect(center.y).toBeCloseTo(300);
  });

  it('画面座標からヘクスを引き当てられる', () => {
    const camera = makeCamera();
    for (const offset of [
      { col: 0, row: 0 },
      { col: 10, row: 7 },
      { col: 20, row: 13 },
    ]) {
      const hex = toAxial(offset);
      const screen = camera.hexToScreen(hex);
      expect(worldToHex(camera.screenToWorld(screen)), `${offset.col},${offset.row}`).toEqual(hex);
    }
  });
});

describe('初期ズーム', () => {
  it('広い画面では盤面全体が入る', () => {
    const camera = makeCamera({ width: 1600, height: 1000 });
    expect(camera.scale).toBeGreaterThanOrEqual(camera.fitScale - 0.001);
    const topLeft = camera.worldToScreen({
      x: boardBounds(BOARD.width, BOARD.height).minX,
      y: boardBounds(BOARD.width, BOARD.height).minY,
    });
    expect(topLeft.x).toBeGreaterThanOrEqual(-1);
    expect(topLeft.y).toBeGreaterThanOrEqual(-1);
  });

  it('狭い画面ではタップできる大きさを優先する（第7.3章）', () => {
    // スマートフォン縦。全体を入れると1ヘクスが 44px を割るので、拡大側を選ぶ
    const camera = makeCamera({ width: 390, height: 640 });
    expect(camera.fitScale).toBeLessThan(MIN_TAP_SCALE);
    expect(camera.scale).toBe(MIN_TAP_SCALE);
    // ヘクスの幅が 44 CSS px 以上
    expect(camera.scale * 2).toBeGreaterThanOrEqual(44);
  });

  it('拡大率には上限と下限がある', () => {
    const camera = makeCamera({ width: 390, height: 640 });
    camera.zoomBy(100);
    expect(camera.scale).toBe(MAX_SCALE);
    camera.zoomBy(0.001);
    expect(camera.scale).toBeCloseTo(camera.minScale);
  });
});

describe('パンの制限', () => {
  it('盤面の外まで流れていかない', () => {
    const camera = makeCamera({ width: 390, height: 640 });
    const bounds = boardBounds(BOARD.width, BOARD.height);
    camera.panByScreen(-99999, -99999);
    expect(camera.center.x).toBeLessThanOrEqual(bounds.maxX);
    expect(camera.center.y).toBeLessThanOrEqual(bounds.maxY);
    camera.panByScreen(99999, 99999);
    expect(camera.center.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(camera.center.y).toBeGreaterThanOrEqual(bounds.minY);
  });

  it('盤面が画面より小さければ中央に固定される', () => {
    const camera = makeCamera({ width: 2400, height: 1600 });
    const before = { ...camera.center };
    camera.panByScreen(300, 300);
    expect(camera.center.x).toBeCloseTo(before.x);
    expect(camera.center.y).toBeCloseTo(before.y);
  });

  it('掴んだ向きに盤面が動く', () => {
    const camera = makeCamera({ width: 390, height: 640 });
    const before = camera.center.x;
    camera.panByScreen(50, 0); // 指を右へ動かす = 盤面を右へ引っ張る
    expect(camera.center.x).toBeLessThan(before);
  });
});

describe('ズームの支点', () => {
  it('指の下のヘクスが動かない', () => {
    const camera = makeCamera({ width: 800, height: 600 });
    const anchor = { x: 220, y: 180 };
    const before = worldToHex(camera.screenToWorld(anchor));
    camera.zoomBy(1.6, anchor);
    const after = worldToHex(camera.screenToWorld(anchor));
    expect(after).toEqual(before);
  });

  it('支点を指定しなければ画面中心が保たれる', () => {
    const camera = makeCamera({ width: 800, height: 600 });
    const before = { ...camera.center };
    camera.zoomBy(1.3);
    expect(camera.center.x).toBeCloseTo(before.x);
    expect(camera.center.y).toBeCloseTo(before.y);
  });
});

describe('画面サイズの変化', () => {
  it('回転しても注視点と倍率を維持する（第7.3章）', () => {
    const camera = makeCamera({ width: 390, height: 800 });
    camera.setScale(30);
    camera.panByScreen(-120, -80);
    const before = { ...camera.center };
    const boardCenter = {
      x:
        (boardBounds(BOARD.width, BOARD.height).minX +
          boardBounds(BOARD.width, BOARD.height).maxX) /
        2,
      y:
        (boardBounds(BOARD.width, BOARD.height).minY +
          boardBounds(BOARD.width, BOARD.height).maxY) /
        2,
    };

    camera.setViewport({ width: 800, height: 390 });

    expect(camera.scale).toBe(30);
    // 横に広がったぶん端が見えすぎないよう内側へ寄るが、初期位置には戻らない
    expect(Math.abs(camera.center.x - before.x)).toBeLessThan(2);
    expect(camera.center.y).toBeCloseTo(before.y, 1);
    expect(camera.center.x).not.toBeCloseTo(boardCenter.x, 1);
  });

  it('全体表示に戻せる', () => {
    const camera = makeCamera({ width: 1280, height: 720 });
    camera.setScale(MAX_SCALE);
    camera.panByScreen(-500, -300);
    camera.fit();
    expect(camera.scale).toBeCloseTo(Math.min(camera.fitScale, MAX_SCALE));
  });
});

describe('可視範囲', () => {
  it('画面に映るヘクスだけを返す', () => {
    const camera = makeCamera({ width: 390, height: 640 });
    camera.setScale(MAX_SCALE);
    const visible = camera.visibleHexes(BOARD.width, BOARD.height);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(BOARD.width * BOARD.height);

    // 返ってきたヘクスは、余白1ヘクス分を見ても画面から大きく外れていない
    for (const { hex } of visible) {
      const screen = camera.worldToScreen(hexToWorld(hex));
      expect(screen.x).toBeGreaterThan(-4 * camera.scale);
      expect(screen.x).toBeLessThan(390 + 4 * camera.scale);
    }
  });

  it('全体表示なら盤面のすべてを含む', () => {
    const camera = makeCamera({ width: 1600, height: 1000 });
    camera.fit();
    expect(camera.visibleHexes(BOARD.width, BOARD.height)).toHaveLength(BOARD.width * BOARD.height);
  });

  it('盤外は含まれず、走査順は行→列で決定的', () => {
    const camera = makeCamera({ width: 1600, height: 1000 });
    camera.fit();
    const visible = camera.visibleHexes(BOARD.width, BOARD.height);
    for (const { offset } of visible) {
      expect(offset.col).toBeGreaterThanOrEqual(0);
      expect(offset.col).toBeLessThan(BOARD.width);
      expect(offset.row).toBeGreaterThanOrEqual(0);
      expect(offset.row).toBeLessThan(BOARD.height);
    }
    expect(visible[0]?.offset).toEqual({ col: 0, row: 0 });
    expect(visible[1]?.offset).toEqual({ col: 1, row: 0 });
    expect(visible.at(-1)?.offset).toEqual({ col: BOARD.width - 1, row: BOARD.height - 1 });
  });
});
