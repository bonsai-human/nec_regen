import './styles.css';
import { loadGameData, MAP_IDS } from '@/data';
import { App } from '@/ui/app';

/**
 * エントリポイント。
 *
 * Phase 2 の範囲は「マップを見て回れること」まで。
 * 移動・戦闘は Phase 3 以降で載せる。
 */

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`要素が見つかりませんでした: ${selector}`);
  }
  return element;
}

function mount(): void {
  const readout = required<HTMLElement>('#readout');
  try {
    const mapId = MAP_IDS[0];
    if (mapId === undefined) throw new Error('マップが1つも登録されていません。');

    const data = loadGameData(mapId);
    required<HTMLElement>('#map-name').textContent =
      `${data.map.name}（${data.map.width} × ${data.map.height}）`;

    new App(data, {
      canvas: required<HTMLCanvasElement>('#board'),
      stage: required<HTMLElement>('#stage'),
      readout,
      zoomIn: required<HTMLButtonElement>('#zoom-in'),
      zoomOut: required<HTMLButtonElement>('#zoom-out'),
      zoomFit: required<HTMLButtonElement>('#zoom-fit'),
    });
    readout.textContent = 'ヘクスをタップすると内容を表示します';
  } catch (error) {
    // データ検証に失敗した場合は、何が悪いのかを画面にそのまま出す
    readout.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

mount();
