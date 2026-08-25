// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerGestures, type GesturePoint } from '@/input/pointer';

/**
 * ジェスチャ層の検証（実装計画書 第7.1章）。
 * マウスと指の違いを上位に漏らさないことが目的なので、
 * **同じ操作を pointerType だけ変えて流し、同じジェスチャになる**ことを確かめる。
 */

let element: HTMLElement;
let gestures: PointerGestures | null = null;
let time = 0;

interface Recorded {
  taps: GesturePoint[];
  doubleTaps: GesturePoint[];
  longPresses: GesturePoint[];
  drags: { dx: number; dy: number }[];
  dragStarts: number;
  dragEnds: number;
  pinches: { factor: number; dx: number; dy: number }[];
  hovers: (GesturePoint | null)[];
  wheels: number[];
}

function setup(): Recorded {
  const recorded: Recorded = {
    taps: [],
    doubleTaps: [],
    longPresses: [],
    drags: [],
    dragStarts: 0,
    dragEnds: 0,
    pinches: [],
    hovers: [],
    wheels: [],
  };
  gestures = new PointerGestures(element, {
    onTap: (point) => recorded.taps.push(point),
    onDoubleTap: (point) => recorded.doubleTaps.push(point),
    onLongPress: (point) => recorded.longPresses.push(point),
    onDragStart: () => {
      recorded.dragStarts += 1;
    },
    onDrag: ({ dx, dy }) => recorded.drags.push({ dx, dy }),
    onDragEnd: () => {
      recorded.dragEnds += 1;
    },
    onPinch: ({ factor, dx, dy }) => recorded.pinches.push({ factor, dx, dy }),
    onHover: (point) => recorded.hovers.push(point),
    onWheel: (delta) => recorded.wheels.push(delta),
  });
  return recorded;
}

/** jsdom には PointerEvent がないので、必要な属性だけ持つ Event で代用する。 */
function pointer(
  type: string,
  init: { id?: number; x: number; y: number; pointerType?: string; dt?: number },
): void {
  time += init.dt ?? 10;
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.defineProperty(event, 'timeStamp', { value: time });
  event['pointerId'] = init.id ?? 1;
  event['pointerType'] = init.pointerType ?? 'touch';
  event['clientX'] = init.x;
  event['clientY'] = init.y;
  element.dispatchEvent(event);
}

beforeEach(() => {
  time = 0;
  element = document.createElement('div');
  element.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 400, 400);
  document.body.append(element);
});

afterEach(() => {
  gestures?.dispose();
  gestures = null;
  element.remove();
  vi.useRealTimers();
});

describe('タップ', () => {
  it('押してすぐ離すとタップになる', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 120 });
    pointer('pointerup', { x: 101, y: 121 });
    expect(recorded.taps).toEqual([{ x: 101, y: 121 }]);
    expect(recorded.dragStarts).toBe(0);
  });

  it('マウスでも指でも同じタップになる（第7.1章）', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 50, y: 50, pointerType: 'mouse' });
    pointer('pointerup', { x: 50, y: 50, pointerType: 'mouse' });
    pointer('pointerdown', { x: 200, y: 200, id: 2, pointerType: 'touch', dt: 1000 });
    pointer('pointerup', { x: 200, y: 200, id: 2, pointerType: 'touch' });
    expect(recorded.taps).toEqual([
      { x: 50, y: 50 },
      { x: 200, y: 200 },
    ]);
  });

  it('大きく動かして離した場合はタップにならない', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 100 });
    pointer('pointermove', { x: 160, y: 100 });
    pointer('pointerup', { x: 160, y: 100 });
    expect(recorded.taps).toEqual([]);
  });

  it('近い場所を続けて叩くとダブルタップになる', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 100 });
    pointer('pointerup', { x: 100, y: 100 });
    pointer('pointerdown', { x: 104, y: 102, dt: 50 });
    pointer('pointerup', { x: 104, y: 102 });
    expect(recorded.doubleTaps).toEqual([{ x: 104, y: 102 }]);
    expect(recorded.taps).toHaveLength(1);
  });

  it('間が空けばダブルタップにならない', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 100 });
    pointer('pointerup', { x: 100, y: 100 });
    pointer('pointerdown', { x: 100, y: 100, dt: 800 });
    pointer('pointerup', { x: 100, y: 100 });
    expect(recorded.doubleTaps).toEqual([]);
    expect(recorded.taps).toHaveLength(2);
  });
});

describe('長押し', () => {
  it('動かさずに押し続けると長押しになる', () => {
    vi.useFakeTimers();
    const recorded = setup();
    pointer('pointerdown', { x: 80, y: 90 });
    vi.advanceTimersByTime(600);
    expect(recorded.longPresses).toEqual([{ x: 80, y: 90 }]);
  });

  it('動かすと長押しは取り消される', () => {
    vi.useFakeTimers();
    const recorded = setup();
    pointer('pointerdown', { x: 80, y: 90 });
    pointer('pointermove', { x: 140, y: 90 });
    vi.advanceTimersByTime(600);
    expect(recorded.longPresses).toEqual([]);
  });
});

describe('ドラッグ', () => {
  it('しきい値を超えてからドラッグとして報告される', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 100 });
    pointer('pointermove', { x: 103, y: 100 }); // まだ揺れの範囲
    expect(recorded.drags).toHaveLength(0);

    pointer('pointermove', { x: 130, y: 100 });
    pointer('pointermove', { x: 150, y: 110 });
    pointer('pointerup', { x: 150, y: 110 });

    expect(recorded.dragStarts).toBe(1);
    expect(recorded.dragEnds).toBe(1);
    expect(recorded.drags).toEqual([
      { dx: 27, dy: 0 },
      { dx: 20, dy: 10 },
    ]);
  });

  it('pointercancel でもドラッグは必ず終わる', () => {
    const recorded = setup();
    pointer('pointerdown', { x: 100, y: 100 });
    pointer('pointermove', { x: 150, y: 100 });
    pointer('pointercancel', { x: 150, y: 100 });
    expect(recorded.dragEnds).toBe(1);
  });
});

describe('ピンチ', () => {
  it('2本指を広げると拡大方向の倍率が返る', () => {
    const recorded = setup();
    pointer('pointerdown', { id: 1, x: 150, y: 200 });
    pointer('pointerdown', { id: 2, x: 250, y: 200 });
    pointer('pointermove', { id: 2, x: 350, y: 200 });

    expect(recorded.pinches).toHaveLength(1);
    expect(recorded.pinches[0]?.factor).toBeCloseTo(2);
    // 中点も右へ 50 動く
    expect(recorded.pinches[0]?.dx).toBeCloseTo(50);
  });

  it('2本指を狭めると縮小方向の倍率が返る', () => {
    const recorded = setup();
    pointer('pointerdown', { id: 1, x: 100, y: 200 });
    pointer('pointerdown', { id: 2, x: 300, y: 200 });
    pointer('pointermove', { id: 2, x: 200, y: 200 });
    expect(recorded.pinches[0]?.factor).toBeCloseTo(0.5);
  });

  it('2本目が触れた時点でドラッグは打ち切られる', () => {
    const recorded = setup();
    pointer('pointerdown', { id: 1, x: 100, y: 100 });
    pointer('pointermove', { id: 1, x: 160, y: 100 });
    expect(recorded.dragStarts).toBe(1);

    pointer('pointerdown', { id: 2, x: 300, y: 100 });
    expect(recorded.dragEnds).toBe(1);

    pointer('pointermove', { id: 2, x: 340, y: 100 });
    expect(recorded.pinches).toHaveLength(1);
    // ピンチ中に片手ドラッグが混ざらない
    expect(recorded.dragStarts).toBe(1);
  });
});

describe('ホバーとホイール', () => {
  it('マウスの移動はホバーになり、指では発生しない（第7.1章）', () => {
    const recorded = setup();
    pointer('pointermove', { x: 10, y: 20, pointerType: 'mouse' });
    expect(recorded.hovers).toEqual([{ x: 10, y: 20 }]);

    pointer('pointermove', { x: 30, y: 40, pointerType: 'touch' });
    expect(recorded.hovers).toHaveLength(1);
  });

  it('カーソルが外へ出たらホバーは解除される', () => {
    const recorded = setup();
    pointer('pointermove', { x: 10, y: 20, pointerType: 'mouse' });
    pointer('pointerleave', { x: 0, y: 0, pointerType: 'mouse' });
    expect(recorded.hovers.at(-1)).toBeNull();
  });

  it('ホイールは既定動作を止めたうえで通知される', () => {
    const recorded = setup();
    const event = new Event('wheel', { bubbles: true, cancelable: true }) as Event &
      Record<string, unknown>;
    event['deltaY'] = -120;
    event['clientX'] = 100;
    event['clientY'] = 100;
    element.dispatchEvent(event);

    expect(recorded.wheels).toEqual([-120]);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('後始末', () => {
  it('dispose 後はイベントを受け取らない', () => {
    const recorded = setup();
    gestures?.dispose();
    pointer('pointerdown', { x: 10, y: 10 });
    pointer('pointerup', { x: 10, y: 10 });
    expect(recorded.taps).toEqual([]);
  });
});
