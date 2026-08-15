import './styles.css';
import { CanvasSurface } from '@/render/surface';

/**
 * Phase 0 のエントリポイント。
 * 空の Canvas をレスポンシブに保持するところまでを担う。
 * マップ描画・入力・ゲームループは Phase 1 以降で載せる。
 */

const BOARD_BG = '#0e1116';

function mount(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  const stage = canvas?.parentElement;
  if (canvas === null || stage === undefined || stage === null) {
    throw new Error('#board が見つかりませんでした。');
  }

  const surface = new CanvasSurface(canvas);

  const render = (): void => {
    surface.clear(BOARD_BG);
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

mount();
