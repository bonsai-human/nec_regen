/**
 * Pointer Events のジェスチャ抽象化（実装計画書 第7.1章）。
 *
 * > Pointer Events に統一し、マウス・タッチ・ペンを1つのコードパスで処理する
 * > ジェスチャ層で tap / longPress / drag / pinch / hover を解釈する
 *
 * 上位（`ui`）はここが出すジェスチャだけを見ればよく、
 * 「マウスかタッチか」を分岐する必要がない。
 * **ホバーは対応デバイスでのみ発生する追加情報**であり、
 * ホバーでしか得られない情報を作ってはならない（第7.1章）。
 */

export interface GesturePoint {
  readonly x: number;
  readonly y: number;
}

export interface DragGesture {
  /** 直前のイベントからの移動量（CSS ピクセル）。 */
  readonly dx: number;
  readonly dy: number;
  readonly point: GesturePoint;
}

export interface PinchGesture {
  /** 直前のイベントからの倍率変化。 */
  readonly factor: number;
  /** 2本指の中点。ここを支点に拡大縮小する。 */
  readonly center: GesturePoint;
  /** 中点自体の移動量。ピンチしながらのパンに使う。 */
  readonly dx: number;
  readonly dy: number;
}

export interface GestureHandlers {
  onTap?: (point: GesturePoint) => void;
  onDoubleTap?: (point: GesturePoint) => void;
  onLongPress?: (point: GesturePoint) => void;
  onDragStart?: (point: GesturePoint) => void;
  onDrag?: (gesture: DragGesture) => void;
  onDragEnd?: (point: GesturePoint) => void;
  onPinch?: (gesture: PinchGesture) => void;
  /** マウス・ペンのみ。指では発生しない。 */
  onHover?: (point: GesturePoint | null) => void;
  onWheel?: (delta: number, point: GesturePoint) => void;
}

/** これ以上動いたらタップではなくドラッグとみなす（CSS ピクセル）。 */
const DRAG_THRESHOLD = 8;
/** 長押しと判定するまでの時間（ミリ秒）。 */
const LONG_PRESS_MS = 500;
/** ダブルタップと判定する間隔（ミリ秒）。 */
const DOUBLE_TAP_MS = 300;
/** ダブルタップと判定する距離（CSS ピクセル）。 */
const DOUBLE_TAP_DISTANCE = 32;

interface ActivePointer {
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  moved: boolean;
}

/**
 * 要素に対するジェスチャ認識。
 * 生成すると即座にイベントを購読し、`dispose()` で解除する。
 */
export class PointerGestures {
  private readonly pointers = new Map<number, ActivePointer>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapTime = 0;
  private lastTapPoint: GesturePoint | null = null;
  private pinchDistance = 0;
  private pinchCenter: GesturePoint | null = null;
  private dragging = false;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: GestureHandlers,
  ) {
    this.listen('pointerdown', this.handleDown);
    this.listen('pointermove', this.handleMove);
    this.listen('pointerup', this.handleUp);
    this.listen('pointercancel', this.handleCancel);
    this.listen('pointerleave', this.handleLeave);
    this.listen('wheel', this.handleWheel, { passive: false });
    // 長押しの選択メニューやタッチのダブルタップズームを抑止する
    this.listen('contextmenu', (event: Event) => {
      event.preventDefault();
    });
  }

  dispose(): void {
    this.clearLongPress();
    for (const off of this.disposers) off();
    this.disposers.length = 0;
    this.pointers.clear();
  }

  private listen<E extends Event>(
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    this.element.addEventListener(type, listener, options);
    this.disposers.push(() => {
      this.element.removeEventListener(type, listener, options);
    });
  }

  private localPoint(event: PointerEvent | WheelEvent): GesturePoint {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly handleDown = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    this.element.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, {
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      startTime: event.timeStamp,
      moved: false,
    });

    if (this.pointers.size === 1) {
      this.startLongPress(point);
    } else {
      // 2本目が触れた時点で長押しとドラッグは取り消し、ピンチへ移る
      this.clearLongPress();
      this.endDrag(point);
      this.beginPinch();
    }
  };

  private readonly handleMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const active = this.pointers.get(event.pointerId);

    if (active === undefined) {
      // 押していないマウス移動はホバー
      if (event.pointerType !== 'touch') this.handlers.onHover?.(point);
      return;
    }

    const dx = point.x - active.x;
    const dy = point.y - active.y;
    active.x = point.x;
    active.y = point.y;

    if (!active.moved && distance(point, { x: active.startX, y: active.startY }) > DRAG_THRESHOLD) {
      active.moved = true;
      this.clearLongPress();
    }

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (active.moved) {
      if (!this.dragging) {
        this.dragging = true;
        this.handlers.onDragStart?.({ x: active.startX, y: active.startY });
      }
      this.handlers.onDrag?.({ dx, dy, point });
    }
  };

  private readonly handleUp = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const active = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.clearLongPress();
    this.element.releasePointerCapture?.(event.pointerId);

    if (this.pointers.size >= 2) {
      this.beginPinch();
      return;
    }
    if (this.pointers.size === 1) {
      // ピンチの片方が離れた。残りの指はドラッグとしては扱わず、次の動きを待つ
      this.pinchCenter = null;
      return;
    }

    this.endDrag(point);

    if (active === undefined || active.moved) return;
    if (event.timeStamp - active.startTime >= LONG_PRESS_MS) return; // 長押しとして処理済み

    if (this.isDoubleTap(point, event.timeStamp)) {
      this.lastTapTime = 0;
      this.lastTapPoint = null;
      this.handlers.onDoubleTap?.(point);
      return;
    }
    this.lastTapTime = event.timeStamp;
    this.lastTapPoint = point;
    this.handlers.onTap?.(point);
  };

  private readonly handleCancel = (event: PointerEvent): void => {
    const active = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.clearLongPress();
    if (active !== undefined) this.endDrag({ x: active.x, y: active.y });
  };

  private readonly handleLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' && this.pointers.size === 0) {
      this.handlers.onHover?.(null);
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.handlers.onWheel?.(event.deltaY, this.localPoint(event));
  };

  private isDoubleTap(point: GesturePoint, timeStamp: number): boolean {
    if (this.lastTapPoint === null) return false;
    return (
      timeStamp - this.lastTapTime < DOUBLE_TAP_MS &&
      distance(point, this.lastTapPoint) < DOUBLE_TAP_DISTANCE
    );
  }

  private startLongPress(point: GesturePoint): void {
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.handlers.onLongPress?.(point);
    }, LONG_PRESS_MS);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private endDrag(point: GesturePoint): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.handlers.onDragEnd?.(point);
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (a === undefined || b === undefined) return;
    this.pinchDistance = distance(a, b);
    this.pinchCenter = midpoint(a, b);
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (a === undefined || b === undefined) return;

    const current = distance(a, b);
    const center = midpoint(a, b);
    if (this.pinchDistance <= 0 || this.pinchCenter === null) {
      this.pinchDistance = current;
      this.pinchCenter = center;
      return;
    }

    const factor = current / this.pinchDistance;
    const dx = center.x - this.pinchCenter.x;
    const dy = center.y - this.pinchCenter.y;
    this.pinchDistance = current;
    this.pinchCenter = center;
    this.handlers.onPinch?.({ factor, center, dx, dy });
  }
}

function distance(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: GesturePoint, b: GesturePoint): GesturePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
