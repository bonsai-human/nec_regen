/**
 * 画面の組み立て（実装計画書 第7.2章・第7.3章・第7.5章）。
 *
 * カメラ・入力・描画・コマンドを繋ぐ層。ルールの判断は一切せず、
 * 「できるかどうか」も「どれだけ削れるか」も必ず `core` に尋ねる。
 *
 * 操作は **プレビュー → 確定** の2段階（第7.2章）。
 * 攻撃前には**与ダメージと返しダメージを必ず両方**表示する（第7.5章）。
 */

import { GreedyAi } from '@/ai/greedy';
import { validateCommand, type Command } from '@/core/commands';
import { attackableTargets, forecastCombat, type CombatForecast } from '@/core/combat';
import { captureBlockedReason, facilityAt } from '@/core/facility';
import { hexEquals, hexKey, toOffset, type Hex, type HexKey } from '@/core/hex';
import { terrainIdAt, unitDef, type GameData } from '@/core/map';
import { moveCostFor, reachableHexes, unitAt, type ReachableMap } from '@/core/movement';
import { reduce, type GameEvent } from '@/core/reducer';
import { createInitialState } from '@/core/state';
import type { FactionId, GameState, Unit, UnitId } from '@/core/types';
import { PointerGestures, type GesturePoint } from '@/input/pointer';
import {
  drawBoard,
  type RenderFlash,
  type RenderScene,
  type RenderUnit,
} from '@/render/board-renderer';
import { Camera } from '@/render/camera';
import { unitLabel } from '@/render/palette';
import { boardBounds, worldToHex } from '@/render/hex-layout';
import { CanvasSurface } from '@/render/surface';

const WHEEL_ZOOM_STEP = 1.12;
const BUTTON_ZOOM_STEP = 1.25;
const KEY_PAN_STEP = 64;
/** AI の手を1つずつ見せる間隔（ミリ秒）。何が起きたか追えるようにする。 */
const AI_STEP_MS = 260;
/** ダメージ表示が消えるまでの時間（ミリ秒）。 */
const FLASH_MS = 1100;

/** プレイヤーが操作する陣営。残りは AI が担当する（1人用・第0章）。 */
const HUMAN_FACTION: FactionId = 'red';

export interface AppElements {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly readout: HTMLElement;
  readonly turnLabel: HTMLElement;
  readonly confirm: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly undo: HTMLButtonElement;
  readonly capture: HTMLButtonElement;
  readonly wait: HTMLButtonElement;
  readonly endTurn: HTMLButtonElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly zoomFit: HTMLButtonElement;
  readonly result: HTMLElement;
  readonly resultText: HTMLElement;
  readonly restart: HTMLButtonElement;
}

type Preview =
  | { readonly kind: 'move'; readonly path: readonly Hex[] }
  | { readonly kind: 'attack'; readonly targetId: UnitId; readonly forecast: CombatForecast };

interface Selection {
  readonly unitId: UnitId;
  readonly reachable: ReachableMap;
  readonly stoppable: ReadonlySet<HexKey>;
  readonly targets: readonly UnitId[];
  readonly preview: Preview | null;
}

export class App {
  private readonly surface: CanvasSurface;
  private readonly camera: Camera;
  private readonly gestures: PointerGestures;
  private readonly ai = new GreedyAi();
  private state: GameState;
  private selection: Selection | null = null;
  private hovered: Hex | null = null;
  private frame: number | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  /** 自ターン内のアンドゥ用スナップショット（第7.2章）。手番が移ると捨てる。 */
  private history: GameState[] = [];
  /** 直近の出来事の一時表示。 */
  private flashes: { hex: Hex; text: string; color: string; born: number }[] = [];
  /** 直近の戦闘結果などの文章。 */
  private lastReport = '';
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
    if (this.aiTimer !== null) clearTimeout(this.aiTimer);
  }

  // ---- 操作 ---------------------------------------------------------------

  /**
   * タップ1回で起きること。
   *
   * 1. プレビュー中の対象をもう一度叩いた → 確定する
   * 2. 選択中の駒で殴れる敵を叩いた → ダメージ予測を出す
   * 3. 選択中の駒が行ける先を叩いた → 経路をプレビューする
   * 4. 自軍の動かせる駒を叩いた → 選択する
   * 5. それ以外 → 選択を解除して、そのヘクスの情報を出す
   */
  private handleTap(hex: Hex | null): void {
    this.hovered = hex;
    if (hex === null || this.isBusy()) {
      this.clearSelection();
      return;
    }

    const selection = this.selection;
    if (selection !== null) {
      if (selection.preview !== null && this.isPreviewTarget(selection, hex)) {
        this.commit();
        return;
      }

      const target = unitAt(this.state, hex);
      if (target !== undefined && selection.targets.includes(target.id)) {
        this.previewAttack(selection, target.id);
        return;
      }

      const entry = selection.stoppable.has(hexKey(hex))
        ? selection.reachable.get(hexKey(hex))
        : undefined;
      if (entry !== undefined) {
        this.selection = { ...selection, preview: { kind: 'move', path: entry.path } };
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

  private isPreviewTarget(selection: Selection, hex: Hex): boolean {
    const preview = selection.preview;
    if (preview === null) return false;
    if (preview.kind === 'move') {
      const end = preview.path.at(-1);
      return end !== undefined && hexEquals(end, hex);
    }
    const target = this.state.units.find((unit) => unit.id === preview.targetId);
    return target !== undefined && hexEquals(target.hex, hex);
  }

  private canControl(unit: Unit): boolean {
    return (
      unit.owner === this.state.activeFaction &&
      this.state.activeFaction === HUMAN_FACTION &&
      unit.carriedBy === null &&
      !unit.hasActed &&
      this.state.outcome === null
    );
  }

  private select(unitId: UnitId): void {
    const unit = this.state.units.find((item) => item.id === unitId);
    if (unit === undefined) return;

    const reachable: ReachableMap = unit.hasMoved
      ? new Map()
      : reachableHexes(this.data, this.state, unitId);
    const stoppable = new Set<HexKey>();
    for (const [key, entry] of reachable) {
      if (entry.canStop) stoppable.add(key);
    }

    this.selection = {
      unitId,
      reachable,
      stoppable,
      targets: this.targetsFor(unitId),
      preview: null,
    };
    this.updatePanel();
    this.requestRender();
  }

  /** その駒が今いる位置から殴れる敵。 */
  private targetsFor(unitId: UnitId): UnitId[] {
    const unit = this.state.units.find((item) => item.id === unitId);
    if (unit === undefined) return [];
    // 間接砲は移動したターンには攻撃できない（第4.3章）
    if (unitDef(this.data, unit.type).indirect && unit.hasMoved) return [];
    return attackableTargets(this.data, this.state, unitId).map((target) => target.id);
  }

  private previewAttack(selection: Selection, targetId: UnitId): void {
    const forecast = forecastCombat(this.data, this.state, selection.unitId, targetId);
    this.selection = { ...selection, preview: { kind: 'attack', targetId, forecast } };
    this.updatePanel();
    this.requestRender();
  }

  private clearSelection(): void {
    this.selection = null;
    this.updatePanel();
    this.requestRender();
  }

  /** プレビュー中の内容をコマンドとして流す。 */
  private commit(): void {
    const selection = this.selection;
    const preview = selection?.preview ?? null;
    if (selection === null || preview === null) return;

    const command: Command =
      preview.kind === 'move'
        ? { type: 'move', unitId: selection.unitId, path: preview.path }
        : { type: 'attack', unitId: selection.unitId, targetId: preview.targetId };

    if (!this.dispatch(command)) return;

    // 移動しただけならまだ行動が残っているので、選択を保ったまま次の判断へ
    const unit = this.state.units.find((item) => item.id === selection.unitId);
    if (preview.kind === 'move' && unit !== undefined && !unit.hasActed) {
      this.select(selection.unitId);
    } else {
      this.clearSelection();
    }
  }

  /** コマンドを1つ流す。拒否されたら理由を表示して false を返す。 */
  private dispatch(command: Command): boolean {
    const error = validateCommand(this.data, this.state, command);
    if (error !== null) {
      this.elements.readout.textContent = error;
      return false;
    }

    // アンドゥのためのスナップショット。ターン終了で捨てる
    if (command.type !== 'endTurn') this.history.push(this.state);

    const result = reduce(this.data, this.state, command);
    this.state = result.state;
    this.report(result.events);
    this.updatePanel();
    this.requestRender();
    return true;
  }

  /**
   * 起きたことを画面に出す（第7.5章）。
   * core が返すイベントをそのまま文章と一時表示に変える。
   */
  private report(events: readonly GameEvent[]): void {
    const lines: string[] = [];
    for (const event of events) {
      switch (event.type) {
        case 'unitsFought': {
          const attacker = this.unitName(event.attackerId);
          const defender = this.unitName(event.defenderId);
          lines.push(
            `${attacker} → ${defender}: ${event.damageToDefender} ダメージ（返し ${event.damageToAttacker}）`,
          );
          const defenderHex = this.hexOf(event.defenderId);
          if (defenderHex !== null) {
            this.pushFlash(defenderHex, `-${event.damageToDefender}`, '#ff8f7a');
          }
          const attackerHex = this.hexOf(event.attackerId);
          if (attackerHex !== null && event.damageToAttacker > 0) {
            this.pushFlash(attackerHex, `-${event.damageToAttacker}`, '#ffd479');
          }
          break;
        }
        case 'unitDestroyed':
          lines.push('撃破');
          this.pushFlash(event.hex, '撃破', '#ff6a5a');
          break;
        case 'unitRepaired':
          lines.push('修理して全快');
          this.pushFlash(event.hex, '全快', '#7ad18a');
          break;
        case 'facilityCaptured':
          lines.push(`${this.facilityName(event.kind)}を占領`);
          this.pushFlash(event.hex, '占領', '#9ec5ff');
          break;
        case 'reinforcementSpawned':
          lines.push(`増援: ${unitDef(this.data, event.unitType).name}`);
          this.pushFlash(event.hex, '増援', '#9ec5ff');
          break;
        case 'unitMoved':
        case 'unitWaited':
        case 'turnEnded':
        case 'gameEnded':
          // 盤面と手番表示で分かるので、文章にはしない
          break;
        default:
          break;
      }
    }
    if (lines.length > 0) this.lastReport = lines.join(' · ');
  }

  private pushFlash(hex: Hex, text: string, color: string): void {
    this.flashes.push({ hex, text, color, born: performance.now() });
  }

  private unitName(unitId: UnitId): string {
    const unit = this.state.units.find((item) => item.id === unitId);
    return unit === undefined ? 'ユニット' : unitDef(this.data, unit.type).name;
  }

  private hexOf(unitId: UnitId): Hex | null {
    return this.state.units.find((item) => item.id === unitId)?.hex ?? null;
  }

  private facilityName(kind: string): string {
    switch (kind) {
      case 'factory':
        return '工場';
      case 'hq':
        return '司令部';
      case 'port':
        return '港';
      case 'airfield':
        return '飛行場';
      default:
        return '施設';
    }
  }

  /** 自ターン内なら何手でも戻せる（第7.2章）。 */
  private undo(): void {
    if (this.isBusy()) return;
    const previous = this.history.pop();
    if (previous === undefined) return;
    this.state = previous;
    this.selection = null;
    this.lastReport = '';
    this.flashes = [];
    this.updatePanel();
    this.requestRender();
  }

  private captureHere(): void {
    const selection = this.selection;
    if (selection === null) return;
    if (this.dispatch({ type: 'capture', unitId: selection.unitId })) this.clearSelection();
  }

  private waitHere(): void {
    const selection = this.selection;
    if (selection === null) return;
    if (this.dispatch({ type: 'wait', unitId: selection.unitId })) this.clearSelection();
  }

  private endTurn(): void {
    if (this.isBusy()) return;
    if (!this.dispatch({ type: 'endTurn' })) return;
    // 相手の手番を挟むと巻き戻せなくなる（第7.2章）
    this.history = [];
    this.clearSelection();
    this.runAiTurns();
  }

  /**
   * AI の手番を1コマンドずつ進める。
   * 一気に適用すると何が起きたのか分からないので、間隔を空けて見せる。
   */
  private runAiTurns(): void {
    if (this.state.outcome !== null || this.state.activeFaction === HUMAN_FACTION) {
      this.aiTimer = null;
      this.updatePanel();
      return;
    }

    const queue = this.ai.planTurn(this.data, this.state, this.state.activeFaction);
    const step = (index: number): void => {
      const command = queue[index];
      if (command === undefined) {
        this.aiTimer = null;
        this.runAiTurns();
        return;
      }
      if (validateCommand(this.data, this.state, command) === null) {
        const result = reduce(this.data, this.state, command);
        this.state = result.state;
        this.report(result.events);
        this.requestRender();
      }
      this.aiTimer = setTimeout(() => {
        step(index + 1);
      }, AI_STEP_MS);
      this.updatePanel();
    };

    this.aiTimer = setTimeout(() => {
      step(0);
    }, AI_STEP_MS);
    this.updatePanel();
  }

  /** AI が動いている間、あるいは決着後は操作を受け付けない。 */
  private isBusy(): boolean {
    return this.aiTimer !== null || this.state.outcome !== null;
  }

  /** マップを最初からやり直す。AI が決定的なので同じ展開を再現できる（第7.2章）。 */
  private restart(): void {
    if (this.aiTimer !== null) clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.state = createInitialState(this.data);
    this.selection = null;
    this.hovered = null;
    this.history = [];
    this.flashes = [];
    this.lastReport = '';
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
      this.commit();
    });
    on(this.elements.cancel, 'click', () => {
      this.clearSelection();
    });
    on(this.elements.undo, 'click', () => {
      this.undo();
    });
    on(this.elements.capture, 'click', () => {
      this.captureHere();
    });
    on(this.elements.wait, 'click', () => {
      this.waitHere();
    });
    on(this.elements.endTurn, 'click', () => {
      this.endTurn();
    });
    on(this.elements.restart, 'click', () => {
      this.restart();
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
        if ((this.selection?.preview ?? null) !== null) this.commit();
        else this.endTurn();
        break;
      case 'u':
      case 'U':
        this.undo();
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
    const { turnLabel, readout, confirm, cancel, undo, capture, wait, result, resultText } =
      this.elements;

    turnLabel.textContent = `ターン ${this.state.turn} / ${this.state.turnLimit} · ${this.factionName(this.state.activeFaction)}の手番`;

    const selection = this.selection;
    const previewing = (selection?.preview ?? null) !== null;
    confirm.hidden = !previewing;
    cancel.hidden = selection === null;
    undo.hidden = this.history.length === 0 || this.isBusy();
    capture.hidden =
      selection === null || captureBlockedReason(this.data, this.state, selection.unitId) !== null;
    wait.hidden = selection === null || previewing;

    const outcome = this.state.outcome;
    result.hidden = outcome === null;
    if (outcome !== null) {
      resultText.textContent =
        outcome.winner === null
          ? '引き分け'
          : `${this.factionName(outcome.winner)}の勝利 · ${this.reasonName(outcome.reason)}`;
    }

    const focus = this.describeFocus();
    readout.textContent = this.lastReport === '' ? focus : `${this.lastReport} ｜ ${focus}`;
  }

  private describeFocus(): string {
    if (this.state.outcome !== null) return '決着しました';
    if (this.aiTimer !== null) return `${this.factionName(this.state.activeFaction)}の手番です…`;

    const selection = this.selection;
    const unit =
      selection === null
        ? undefined
        : this.state.units.find((item) => item.id === selection.unitId);

    if (selection !== null && unit !== undefined) {
      const def = unitDef(this.data, unit.type);
      const preview = selection.preview;

      if (preview?.kind === 'attack') {
        const target = this.state.units.find((item) => item.id === preview.targetId);
        const targetName = target === undefined ? '敵' : unitDef(this.data, target.type).name;
        const forecast = preview.forecast;
        // 与ダメージと返しダメージは必ずセットで見せる（第7.5章）
        const parts = [
          `${def.name} → ${targetName}`,
          `与ダメージ ${forecast.damageToDefender}`,
          `返し ${forecast.damageToAttacker}`,
        ];
        if (forecast.attacker.attackSupport.length > 0) {
          parts.push(`支援 ${forecast.attacker.attackSupport.length}体`);
        }
        if (forecast.defender.encircled) parts.push('包囲成立');
        parts.push('もう一度タップか「確定」で攻撃');
        return parts.join(' · ');
      }

      if (preview?.kind === 'move') {
        const end = preview.path.at(-1) ?? unit.hex;
        const cost = selection.reachable.get(hexKey(end))?.cost ?? 0;
        return `${def.name} を ${this.describeHex(end)} へ（移動力 ${cost} / ${def.movePoints}）· もう一度タップか「確定」で移動`;
      }

      const level = expLevelOf(this.data, unit.exp);
      const status = [`${def.name}`, `戦力 ${unit.strength}`];
      if (level > 0) status.push(`熟練 Lv${level}`);
      if (!unit.hasMoved) status.push(`移動力 ${def.movePoints}`);

      const actions: string[] = [];
      if (!unit.hasMoved) actions.push('行き先');
      if (selection.targets.length > 0) actions.push('攻撃する敵');
      status.push(actions.length > 0 ? `${actions.join('か')}をタップ` : '「待機」で行動終了');
      return status.join(' · ');
    }

    const hex = this.hovered;
    if (hex === null) return 'ユニットをタップすると移動範囲と攻撃目標を表示します';
    return this.describeHex(hex, true);
  }

  private describeHex(hex: Hex, withUnit = false): string {
    const offset = toOffset(hex);
    const terrainId = terrainIdAt(this.data.board, hex);
    const terrain = terrainId === null ? null : this.data.terrain.get(terrainId);
    const parts = [`(${offset.col}, ${offset.row})`];

    if (terrain !== null && terrain !== undefined) {
      // 地形効果は「守ってくれるか、何もしないか」なので、その場で読めるようにする
      const defense = terrain.defense > 1 ? `防御 ×${terrain.defense.toFixed(1)}` : '防御なし';
      parts.push(`${terrain.name}（${defense}${this.describeMoveCost(hex)}）`);
    } else {
      parts.push('盤外');
    }

    parts.push(...this.describeFacility(hex));

    if (withUnit) {
      const unit = unitAt(this.state, hex);
      if (unit !== undefined) {
        const def = unitDef(this.data, unit.type);
        parts.push(
          `${def.name}（${this.factionName(unit.owner)} / 戦力 ${unit.strength}${unit.hasActed ? ' / 行動済' : ''}）`,
        );
      }
    }
    return parts.join(' · ');
  }

  /** 選択中のユニットにとっての進入コスト。選んでいなければ何も出さない。 */
  private describeMoveCost(hex: Hex): string {
    const selection = this.selection;
    if (selection === null) return '';
    const unit = this.state.units.find((item) => item.id === selection.unitId);
    if (unit === undefined) return '';
    const cost = moveCostFor(this.data, unitDef(this.data, unit.type), hex);
    return cost === null ? ' / 進入不可' : ` / 移動コスト ${cost}`;
  }

  /**
   * 施設の中身。**キューの内容と次の出現ターンは敵味方を問わずいつでも読める**（第4.6章）。
   * 「3ターン後にここへ敵戦車が出る」という読みを成立させるための表示。
   */
  private describeFacility(hex: Hex): string[] {
    const facility = facilityAt(this.state, hex);
    if (facility === undefined) return [];

    const owner = facility.owner === null ? '中立' : this.factionName(facility.owner);
    const parts = [`${this.facilityName(facility.kind)}: ${owner}`];

    if (facility.queue.length === 0) {
      parts.push('増援なし');
      return parts;
    }

    const queue = facility.queue.map((type) => unitDef(this.data, type).name).join(' → ');
    if (facility.nextSpawnTurn === null) {
      // 中立のまま。占領すればこの順で出てくる
      parts.push(`占領すると ${queue}（${facility.interval}ターンごと）`);
    } else {
      const remaining = Math.max(0, facility.nextSpawnTurn - this.state.turn);
      const when = remaining === 0 ? '次の自軍ターン' : `あと${remaining}ターン`;
      parts.push(`次の増援 ${queue.split(' → ')[0] ?? ''}（${when}）`);
      if (facility.queue.length > 1) parts.push(`残り ${queue}`);
    }
    return parts;
  }

  private factionName(faction: FactionId): string {
    if (faction === 'red') return '赤軍';
    if (faction === 'blue') return '青軍';
    return faction;
  }

  private reasonName(reason: string): string {
    switch (reason) {
      case 'annihilation':
        return '敵の全滅';
      case 'hq':
        return '司令部の占領';
      case 'turnLimit':
        return 'ターン制限';
      default:
        return '引き分け';
    }
  }

  private requestRender(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    const now = performance.now();
    this.flashes = this.flashes.filter((flash) => now - flash.born < FLASH_MS);
    const flashes: RenderFlash[] = this.flashes.map((flash) => ({
      hex: flash.hex,
      text: flash.text,
      color: flash.color,
      progress: (now - flash.born) / FLASH_MS,
    }));

    const units: RenderUnit[] = this.state.units
      .filter((unit) => unit.carriedBy === null)
      .map((unit) => ({
        hex: unit.hex,
        type: unit.type,
        owner: unit.owner,
        strength: unit.strength,
        acted: unit.hasActed,
      }));

    const selection = this.selection;
    const selected =
      selection === null
        ? null
        : (this.state.units.find((unit) => unit.id === selection.unitId)?.hex ?? null);

    const targetHexes = new Set<HexKey>();
    for (const id of selection?.targets ?? []) {
      const target = this.state.units.find((unit) => unit.id === id);
      if (target !== undefined) targetHexes.add(hexKey(target.hex));
    }

    // 施設の現況。所有者と「あと何ターンで増援か」を盤面に出す（第4.6章）
    const facilityOwners = new Map<HexKey, FactionId | null>();
    const spawnCountdown = new Map<HexKey, number>();
    for (const facility of this.state.facilities) {
      const key = hexKey(facility.hex);
      facilityOwners.set(key, facility.owner);
      if (facility.nextSpawnTurn !== null && facility.queue.length > 0) {
        spawnCountdown.set(key, Math.max(0, facility.nextSpawnTurn - this.state.turn));
      }
    }

    const preview = selection?.preview ?? null;
    const focus =
      preview?.kind === 'attack'
        ? (this.state.units.find((unit) => unit.id === preview.targetId)?.hex ?? null)
        : null;

    const scene: RenderScene = {
      units,
      hovered: this.hovered,
      selected,
      reachable: selection?.stoppable ?? null,
      targets: targetHexes.size > 0 ? targetHexes : null,
      path: preview?.kind === 'move' ? preview.path : null,
      focus,
      facilityOwners,
      spawnCountdown,
      flashes,
    };
    drawBoard(
      this.surface.ctx,
      this.data,
      this.camera,
      scene,
      this.surface.logicalSize,
      // 盤面には短縮名を出す。正式名は読み上げ欄に出るので重複させない
      unitLabel,
    );

    // 表示が残っている間は描き続ける
    if (this.flashes.length > 0) this.requestRender();
  }
}

/** 表示用の熟練度レベル。 */
function expLevelOf(data: GameData, exp: number): number {
  let level = 0;
  for (const threshold of data.rules.expThresholds) {
    if (exp >= threshold) level += 1;
  }
  return level;
}
