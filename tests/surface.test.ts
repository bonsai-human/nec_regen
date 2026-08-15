// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { backingStoreSize, clampPixelRatio, CanvasSurface } from '@/render/surface';

describe('clampPixelRatio', () => {
  it('1 未満は 1 に、上限超えは上限に丸める', () => {
    expect(clampPixelRatio(0.5)).toBe(1);
    expect(clampPixelRatio(1.5)).toBe(1.5);
    expect(clampPixelRatio(3)).toBe(2);
    expect(clampPixelRatio(3, 3)).toBe(3);
  });

  it('異常値は 1 として扱う', () => {
    expect(clampPixelRatio(Number.NaN)).toBe(1);
    expect(clampPixelRatio(0)).toBe(1);
    expect(clampPixelRatio(-2)).toBe(1);
    expect(clampPixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('backingStoreSize', () => {
  it('論理サイズ × DPR を整数で返す', () => {
    expect(backingStoreSize({ width: 320, height: 180 }, 2)).toEqual({ width: 640, height: 360 });
    expect(backingStoreSize({ width: 100.4, height: 50.6 }, 1.5)).toEqual({
      width: 151,
      height: 76,
    });
  });

  it('0 以下にはならない', () => {
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('CanvasSurface', () => {
  it('DPR を反映したバックバッファに合わせ、描画は CSS ピクセル座標で行える', () => {
    const canvas = document.createElement('canvas');
    const setTransform = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      setTransform,
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    const surface = new CanvasSurface(canvas, { devicePixelRatio: 2 });
    expect(surface.resize({ width: 400, height: 300 })).toBe(true);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(surface.logicalSize).toEqual({ width: 400, height: 300 });
    expect(surface.currentPixelRatio).toBe(2);
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it('同じサイズで呼ばれても再確保しない', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    const surface = new CanvasSurface(canvas, { devicePixelRatio: 1 });
    expect(surface.resize({ width: 200, height: 100 })).toBe(true);
    expect(surface.resize({ width: 200, height: 100 })).toBe(false);
    expect(surface.resize({ width: 200, height: 101 })).toBe(true);
  });

  it('2D コンテキストを取れない場合は例外を投げる', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(() => new CanvasSurface(canvas)).toThrow();
  });
});
