/**
 * 画面の組み立て（実装計画書 第7.2章・第7.3章）。
 *
 * カメラ・入力・描画を繋ぐだけの層。ルールは何も知らない。
 * Phase 2 の範囲は「マップを見て回れること」なので、
 * 操作はカメラ移動とヘクスの選択に限る。
 */

import { hexEquals, toOffset, type Hex } from '@/core/hex';
import { terrainIdAt, unitDef, type GameData } from '@/core/map';
import { PointerGestures, type GesturePoint } from '@/input/pointer';
import { Camera } from '@/render/camera';
import { drawBoard, type RenderScene, type RenderUnit } from '@/render/board-renderer';
import { boardBounds, worldToHex } from '@/render/hex-layout';
import { CanvasSurface } from '@/render/surface';

/** ホイール1ノッチあたりのズーム倍率。 */
const WHEEL_ZOOM_STEP = 1.12;
/** ボタン・キーボード1回あたりのズーム倍率。 */
const BUTTON_ZOOM_STEP = 1.25;
/** 方向キー1回あたりの移動量（CSS ピクセル）。 */
const KEY_PAN_STEP = 64;

export interface AppElements {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly readout: HTMLElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly zoomFit: HTMLButtonElement;
}

export class App {
  private readonly surface: CanvasSurface;
  private readonly camera: Camera;
  private readonly gestures: PointerGestures;
  private readonly units: readonly RenderUnit[];
  private hovered: Hex | null = null;
  private selected: Hex | null = null;
  private frame: number | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly data: GameData,
    private readonly elements: AppElements,
  ) {
    this.surface = new CanvasSurface(elements.canvas);
    this.units = data.map.units.map((placement) => ({
      hex: placement.hex,
      type: placement.type,
      owner: placement.owner,
      strength: placement.strength,
    }));

    const rect = elements.stage.getBoundingClientRect();
    this.camera = new Camera({
      bounds: boardBounds(data.board.width, data.board.height),
      viewport: { width: rect.width, height: rect.height },
    });

    this.gestures = new PointerGestures(elements.canvas, {
      onTap: (point) => {
        this.select(this.hexAt(point));
      },
      onDoubleTap: (point) => {
        this.camera.zoomBy(BUTTON_ZOOM_STEP * BUTTON_ZOOM_STEP, point);
        this.requestRender();
      },
      onLongPress: (point) => {
        // 長押しは「情報表示」（第7.2章）。今は選択と同じ内容を読み上げ欄に出す
        this.select(this.hexAt(point));
      },
      onDrag: ({ dx, dy }) => {
        this.camera.panByScreen(dx, dy);
        this.requestRender();
      },
      onPinch: ({ factor, center, dx, dy }) => {
        this.camera.panByScreen(dx, dy);
        this.camera.zoomBy(factor, center);
        this.requestRender();
      },
      onHover: (point) => {
        this.setHovered(point === null ? null : this.hexAt(point));
      },
      onWheel: (delta, point) => {
        this.camera.zoomBy(delta < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, point);
        this.requestRender();
      },
    });

    this.bindControls();
    this.observeResize();
    this.fitViewport();
    this.requestRender();
  }

  dispose(): void {
    this.gestures.dispose();
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  private bindControls(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      handler: (event: Event) => void,
    ): void => {
      target.addEventListener(type, handler);
      this.disposers.push(() => {
        target.removeEventListener(type, handler);
      });
    };

    on(this.elements.zoomIn, 'click', () => {
      this.camera.zoomBy(BUTTON_ZOOM_STEP);
      this.requestRender();
    });
    on(this.elements.zoomOut, 'click', () => {
      this.camera.zoomBy(1 / BUTTON_ZOOM_STEP);
      this.requestRender();
    });
    on(this.elements.zoomFit, 'click', () => {
      this.camera.fit();
      this.requestRender();
    });

    on(window, 'keydown', (event) => {
      this.handleKey(event as KeyboardEvent);
    });
    on(window, 'resize', () => {
      this.fitViewport();
    });
  }

  private handleKey(event: KeyboardEvent): void {
    const panKeys: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_STEP, 0],
      ArrowRight: [-KEY_PAN_STEP, 0],
      ArrowUp: [0, KEY_PAN_STEP],
      ArrowDown: [0, -KEY_PAN_STEP],
    };
    const pan = panKeys[event.key];
    if (pan !== undefined) {
      event.preventDefault();
      this.camera.panByScreen(pan[0], pan[1]);
      this.requestRender();
      return;
    }

    switch (event.key) {
      case '+':
      case '=':
        this.camera.zoomBy(BUTTON_ZOOM_STEP);
        this.requestRender();
        break;
      case '-':
        this.camera.zoomBy(1 / BUTTON_ZOOM_STEP);
        this.requestRender();
        break;
      case 'Escape':
        this.select(null);
        break;
      default:
        break;
    }
  }

  private observeResize(): void {
    const observer = new ResizeObserver(() => {
      this.fitViewport();
    });
    observer.observe(this.elements.stage);
    this.disposers.push(() => {
      observer.disconnect();
    });
  }

  private fitViewport(): void {
    const rect = this.elements.stage.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    this.surface.resize(size);
    this.camera.setViewport(size);
    this.requestRender();
  }

  /** 画面座標のヘクス。盤外なら null。 */
  private hexAt(point: GesturePoint): Hex | null {
    const hex = worldToHex(this.camera.screenToWorld(point));
    return terrainIdAt(this.data.board, hex) === null ? null : hex;
  }

  private setHovered(hex: Hex | null): void {
    if (hex === null && this.hovered === null) return;
    if (hex !== null && this.hovered !== null && hexEquals(hex, this.hovered)) return;
    this.hovered = hex;
    this.updateReadout();
    this.requestRender();
  }

  private select(hex: Hex | null): void {
    this.selected = hex;
    this.updateReadout();
    this.requestRender();
  }

  /**
   * 選択（なければホバー）しているヘクスの内容を文字で出す。
   * ホバーできない端末でも同じ情報に届くことが要件（第7.1章）。
   */
  private updateReadout(): void {
    const hex = this.selected ?? this.hovered;
    if (hex === null) {
      this.elements.readout.textContent = 'ヘクスをタップすると内容を表示します';
      return;
    }
    const offset = toOffset(hex);
    const terrainId = terrainIdAt(this.data.board, hex);
    const terrain = terrainId === null ? null : this.data.terrain.get(terrainId);
    const unit = this.units.find((item) => hexEquals(item.hex, hex));
    const parts = [`(${offset.col}, ${offset.row})`, terrain?.name ?? '盤外'];
    if (unit !== undefined) {
      const def = unitDef(this.data, unit.type);
      parts.push(`${def.name}（${unit.owner} / 戦力 ${unit.strength}）`);
    }
    this.elements.readout.textContent = parts.join(' · ');
  }

  private requestRender(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    const scene: RenderScene = {
      units: this.units,
      hovered: this.hovered,
      selected: this.selected,
    };
    drawBoard(this.surface.ctx, this.data, this.camera, scene, this.surface.logicalSize);
  }
}
