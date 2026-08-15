import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * 「乱数を一切使わない」（実装計画書 第1.1章・第2章）は本作の生命線であり、
 * 規約ではなく仕組みで守る。ここでは ESLint 設定がそのガードを
 * 実際に張れているかを検証する。
 */

const eslint = new ESLint();

interface RestrictedProperty {
  object?: string;
  property?: string;
}

async function restrictedPropertiesFor(filePath: string): Promise<RestrictedProperty[]> {
  const config = (await eslint.calculateConfigForFile(filePath)) as {
    rules?: Record<string, unknown>;
  };
  const entry = config.rules?.['no-restricted-properties'];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1) as RestrictedProperty[];
}

function has(list: RestrictedProperty[], object: string, property: string): boolean {
  return list.some((item) => item.object === object && item.property === property);
}

describe('決定性を守る lint ルール', () => {
  it('Math.random はプロジェクト全体で禁止されている', async () => {
    for (const file of ['src/main.ts', 'src/render/surface.ts', 'src/core/combat.ts']) {
      expect(has(await restrictedPropertiesFor(file), 'Math', 'random'), file).toBe(true);
    }
  });

  it('core / ai では時刻や暗号乱数も禁止されている', async () => {
    for (const file of ['src/core/combat.ts', 'src/ai/greedy.ts']) {
      const restricted = await restrictedPropertiesFor(file);
      expect(has(restricted, 'Date', 'now'), file).toBe(true);
      expect(has(restricted, 'performance', 'now'), file).toBe(true);
      expect(has(restricted, 'crypto', 'getRandomValues'), file).toBe(true);
    }
  });

  it('描画層では時刻の取得までは禁止しない（アニメーションに必要）', async () => {
    const restricted = await restrictedPropertiesFor('src/render/surface.ts');
    expect(has(restricted, 'performance', 'now')).toBe(false);
  });

  it('レイヤ間の依存の向きが import 制限で固定されている', async () => {
    const config = (await eslint.calculateConfigForFile('src/core/combat.ts')) as {
      rules?: Record<string, unknown>;
    };
    expect(config.rules?.['no-restricted-imports']).toBeDefined();
  });
});
