/**
 * 画面の組み立て（実装計画書 第7.2章・第7.3章）。
 *
 * カメラ・入力・描画・コマンドを繋ぐ層。ルールの判断は一切せず、
 * 「できるかどうか」は必ず `core` に尋ねる。
 *
 * 操作は **プレビュー → 確定** の2段階（第7.2章）。
 * 誤タップで駒が飛んでいかないことを、Phase 3 の時点で守っておく。
 */

import { hexEquals, hexKey, toOffset, type Hex, type HexKey } from '@/core/hex';
import { terrainIdAt, unitDef, type GameData } from '@/core/map';
import { reachableHexes, unitAt, type ReachableMap } from '@/core/movement';
import { reduce } from '@/core/reducer';
import { createInitialState } from '@/core/state';
import type { GameState, Unit, UnitId } from '@/core/types';
import { PointerGestures, type GesturePoint } from '@/input/pointer';
import { drawBoard, type RenderScene, type RenderUnit } from '@/render/board-renderer';
import { Camera } from '@/render/camera';
import { boardBounds, worldToHex } from '@/render/hex-layout';
import { CanvasSurface } from '@/render/surface';

const WHEEL_ZOOM_STEP = 1.12;
const BUTTON_ZOOM_STEP = 1.25;
const KEY_PAN_STEP = 64;

export interface AppElements {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly readout: HTMLElement;
  readonly turnLabel: HTMLElement;
  readonly confirm: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly endTurn: HTMLButtonElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly zoomFit: HTMLButtonElement;
}

/** 選択の段階。プレビューを挟むことで、確定操作なしには盤面が動かない。 */
interface Selection {
  readonly unitId: UnitId;
  readonly reachable: ReachableMap;
  readonly stoppable: ReadonlySet<HexKey>;
  readonly preview: readonly Hex[] | null;
}

export class App {
  private readonly surface: CanvasSurface;
  private readonly camera: Camera;
  private readonly gestures: PointerGestures;
  private state: GameState;
  private selection: Selection | null = null;
  private hovered: Hex | null = null;
  private frame: number | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly data: GameData,
    private readonly elements: AppElements,
  ) {
    this.state = createInitialState(data);
    this.surface = new CanvasSurface(elements.canvas);

    const rect = elements.stage.getBoundingClientRect();
    this.camera = new Camera({
      bounds: boardBounds(data.board.width, data.board.height),
      viewport: { width: rect.width, height: rect.height },
    });

    this.gestures = new PointerGestures(elements.canvas, {
      onTap: (point) => {
        this.handleTap(this.hexAt(point));
      },
      onDoubleTap: (point) => {
        this.camera.zoomBy(BUTTON_ZOOM_STEP * BUTTON_ZOOM_STEP, point);
        this.requestRender();
      },
      onLongPress: (point) => {
        // 長押しは情報表示（第7.2章）。盤面は動かさない
        this.hovered = this.hexAt(point);
        this.updatePanel();
        this.requestRender();
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
    this.updatePanel();
    this.requestRender();
  }

  dispose(): void {
    this.gestures.dispose();
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  // ---- 操作 ---------------------------------------------------------------

  /**
   * タップ1回で起きること。
   *
   * 1. 選択中で、プレビュー中の目的地をもう一度叩いた → 移動を確定する
   * 2. 選択中で、行ける先を叩いた → 経路をプレビューする
   * 3. 自軍の動かせる駒を叩いた → 選択して移動範囲を出す
   * 4. それ以外 → 選択を解除して、そのヘクスの情報を出す
   */
  private handleTap(hex: Hex | null): void {
    this.hovered = hex;
    if (hex === null) {
      this.clearSelection();
      return;
    }

    const selection = this.selection;
    if (selection !== null) {
      const previewEnd = selection.preview?.at(-1);
      if (previewEnd !== undefined && hexEquals(previewEnd, hex)) {
        this.commitMove();
        return;
      }
      if (selection.stoppable.has(hexKey(hex))) {
        const entry = selection.reachable.get(hexKey(hex));
        this.selection = { ...selection, preview: entry?.path ?? null };
        this.updatePanel();
        this.requestRender();
        return;
      }
    }

    const unit = unitAt(this.state, hex);
    if (unit !== undefined && this.canControl(unit)) {
      this.select(unit.id);
      return;
    }

    this.clearSelection();
  }

  private canControl(unit: Unit): boolean {
    return (
      unit.owner === this.state.activeFaction &&
      unit.carriedBy === null &&
      !unit.hasActed &&
      !unit.hasMoved &&
      this.state.outcome === null
    );
  }

  private select(unitId: UnitId): void {
    const reachable = reachableHexes(this.data, this.state, unitId);
    const stoppable = new Set<HexKey>();
    for (const [key, entry] of reachable) {
      if (entry.canStop) stoppable.add(key);
    }
    this.selection = { unitId, reachable, stoppable, preview: null };
    this.updatePanel();
    this.requestRender();
  }

  private clearSelection(): void {
    this.selection = null;
    this.updatePanel();
    this.requestRender();
  }

  /** プレビュー中の経路を実際のコマンドとして流す。 */
  private commitMove(): void {
    const selection = this.selection;
    const path = selection?.preview;
    if (selection === null || path === undefined || path === null) return;

    try {
      const result = reduce(this.data, this.state, {
        type: 'move',
        unitId: selection.unitId,
        path,
      });
      this.state = result.state;
      this.selection = null;
    } catch (error) {
      // core が拒否した理由をそのまま見せる。UI 側で握り潰さない
      this.elements.readout.textContent = error instanceof Error ? error.message : String(error);
    }
    this.updatePanel();
    this.requestRender();
  }

  private endTurn(): void {
    this.state = reduce(this.data, this.state, { type: 'endTurn' }).state;
    this.selection = null;
    this.updatePanel();
    this.requestRender();
  }

  // ---- 入力の配線 ---------------------------------------------------------

  private bindControls(): void {
    const on = (target: HTMLElement | Window, type: string, handler: () => void): void => {
      target.addEventListener(type, handler);
      this.disposers.push(() => {
        target.removeEventListener(type, handler);
      });
    };

    on(this.elements.confirm, 'click', () => {
      this.commitMove();
    });
    on(this.elements.cancel, 'click', () => {
      this.clearSelection();
    });
    on(this.elements.endTurn, 'click', () => {
      this.endTurn();
    });
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

    const keyHandler = (event: Event): void => {
      this.handleKey(event as KeyboardEvent);
    };
    window.addEventListener('keydown', keyHandler);
    this.disposers.push(() => {
      window.removeEventListener('keydown', keyHandler);
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
      case 'Enter':
        if ((this.selection?.preview ?? null) !== null) this.commitMove();
        else this.endTurn();
        break;
      case 'Escape':
        this.clearSelection();
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

  private hexAt(point: GesturePoint): Hex | null {
    const hex = worldToHex(this.camera.screenToWorld(point));
    return terrainIdAt(this.data.board, hex) === null ? null : hex;
  }

  private setHovered(hex: Hex | null): void {
    if (hex === null && this.hovered === null) return;
    if (hex !== null && this.hovered !== null && hexEquals(hex, this.hovered)) return;
    this.hovered = hex;
    this.updatePanel();
    this.requestRender();
  }

  // ---- 表示 ---------------------------------------------------------------

  private updatePanel(): void {
    const { turnLabel, readout, confirm, cancel } = this.elements;
    turnLabel.textContent = `ターン ${this.state.turn} · ${this.factionName(this.state.activeFaction)}の手番`;

    const previewing = (this.selection?.preview ?? null) !== null;
    confirm.hidden = !previewing;
    cancel.hidden = this.selection === null;

    readout.textContent = this.describeFocus();
  }

  private describeFocus(): string {
    const selection = this.selection;
    if (selection !== null) {
      const unit = this.state.units.find((item) => item.id === selection.unitId);
      if (unit !== undefined) {
        const def = unitDef(this.data, unit.type);
        const preview = selection.preview;
        if (preview !== null && preview !== undefined) {
          const cost = selection.reachable.get(hexKey(preview.at(-1)!))?.cost ?? 0;
          return `${def.name} を ${this.describeHex(preview.at(-1)!)} へ（移動力 ${cost} / ${def.movePoints}）· もう一度タップか「確定」で移動`;
        }
        return `${def.name}（移動力 ${def.movePoints}）· 行き先をタップ`;
      }
    }

    const hex = this.hovered;
    if (hex === null) return 'ユニットをタップすると移動範囲を表示します';
    return this.describeHex(hex, true);
  }

  private describeHex(hex: Hex, withUnit = false): string {
    const offset = toOffset(hex);
    const terrainId = terrainIdAt(this.data.board, hex);
    const terrain = terrainId === null ? null : this.data.terrain.get(terrainId);
    const parts = [`(${offset.col}, ${offset.row})`, terrain?.name ?? '盤外'];
    if (withUnit) {
      const unit = unitAt(this.state, hex);
      if (unit !== undefined) {
        const def = unitDef(this.data, unit.type);
        parts.push(
          `${def.name}（${this.factionName(unit.owner)} / 戦力 ${unit.strength}${unit.hasMoved ? ' / 移動済' : ''}）`,
        );
      }
    }
    return parts.join(' · ');
  }

  private factionName(faction: string): string {
    if (faction === 'red') return '赤軍';
    if (faction === 'blue') return '青軍';
    return faction;
  }

  private requestRender(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    const units: RenderUnit[] = this.state.units
      .filter((unit) => unit.carriedBy === null)
      .map((unit) => ({
        hex: unit.hex,
        type: unit.type,
        owner: unit.owner,
        strength: unit.strength,
      }));

    const selected = this.selection
      ? (this.state.units.find((unit) => unit.id === this.selection?.unitId)?.hex ?? null)
      : null;

    const scene: RenderScene = {
      units,
      hovered: this.hovered,
      selected,
      reachable: this.selection?.stoppable ?? null,
      path: this.selection?.preview ?? null,
    };
    drawBoard(this.surface.ctx, this.data, this.camera, scene, this.surface.logicalSize);
  }
}
