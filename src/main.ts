import './styles.css';
import { CanvasSurface } from '@/render/surface';
import { loadGameData, MAP_IDS } from '@/data';

/**
 * エントリポイント。
 *
 * Phase 1 時点では、マップ・ユニット・地形の JSON を読み込んで検証が通ることを
 * 画面上で確認できるところまで。マップ描画・入力・ゲームループは Phase 2 以降で載せる。
 */

const BOARD_BG = '#0e1116';
const TEXT_COLOR = '#7d8590';

function mount(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  const stage = canvas?.parentElement;
  if (canvas === null || stage === undefined || stage === null) {
    throw new Error('#board が見つかりませんでした。');
  }

  const surface = new CanvasSurface(canvas);
  const status = describeData();

  const render = (): void => {
    surface.clear(BOARD_BG);
    const { width, height } = surface.logicalSize;
    const ctx = surface.ctx;
    ctx.save();
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [index, line] of status.entries()) {
      ctx.fillText(line, width / 2, height / 2 + (index - (status.length - 1) / 2) * 20);
    }
    ctx.restore();
  };

  const fit = (): void => {
    const rect = stage.getBoundingClientRect();
    if (surface.resize({ width: rect.width, height: rect.height })) {
      render();
    }
  };

  new ResizeObserver(fit).observe(stage);
  // DPR は端末の回転や外部ディスプレイ接続で変化しうる
  window.addEventListener('resize', fit);
  fit();
  render();
}

/** 読み込んだデータの要約。検証に失敗した場合はその内容をそのまま出す。 */
function describeData(): string[] {
  const mapId = MAP_IDS[0];
  if (mapId === undefined) return ['マップが1つも登録されていません'];
  try {
    const data = loadGameData(mapId);
    return [
      `${data.map.name}（${data.map.width} × ${data.map.height}）`,
      `ユニット ${data.units.size} 種 / 地形 ${data.terrain.size} 種 / 初期配置 ${data.map.units.length} 体`,
      '盤面の描画は Phase 2 から',
    ];
  } catch (error) {
    return [
      'データの読み込みに失敗しました',
      error instanceof Error ? error.message : String(error),
    ];
  }
}

mount();
