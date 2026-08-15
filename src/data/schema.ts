/**
 * JSON 検証の最小限の道具立て（実装計画書 第5.3章）。
 *
 * 外部ランタイム依存はゼロを目標とする（第2章）ため、バリデータも自前で持つ。
 * 方針は2つ。
 *
 * 1. **最初の1件で止めず、見つかった問題をすべて集めて報告する。**
 *    マップを1つ直すたびに読み込み直すのは開発の妨げになる
 * 2. **どこが悪いのかをパスで示す。** `units[3].power.ground` のように位置を明示する
 */

/** 検証に失敗したときの例外。`issues` に見つかった問題をすべて含む。 */
export class SchemaError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`${source} の検証に失敗しました:\n- ${issues.join('\n- ')}`);
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

/** 検証中の状態。問題を溜め込み、最後にまとめて投げる。 */
export class Validator {
  private readonly issues: string[] = [];

  constructor(private readonly source: string) {}

  /** 問題を1件記録する。 */
  fail(path: string, message: string): void {
    this.issues.push(`${path}: ${message}`);
  }

  get hasIssues(): boolean {
    return this.issues.length > 0;
  }

  /** 問題が1件でもあれば例外を投げる。 */
  throwIfFailed(): void {
    if (this.issues.length > 0) {
      throw new SchemaError(this.source, this.issues);
    }
  }

  record(path: string, value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, `オブジェクトである必要があります（実際: ${describe(value)}）`);
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  array(path: string, value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) {
      this.fail(path, `配列である必要があります（実際: ${describe(value)}）`);
      return undefined;
    }
    return value as unknown[];
  }

  string(path: string, value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      this.fail(path, `空でない文字列である必要があります（実際: ${describe(value)}）`);
      return undefined;
    }
    return value;
  }

  number(path: string, value: unknown, min: number, max: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, `数値である必要があります（実際: ${describe(value)}）`);
      return undefined;
    }
    if (value < min || value > max) {
      this.fail(path, `${min} 以上 ${max} 以下である必要があります（実際: ${value}）`);
      return undefined;
    }
    return value;
  }

  integer(path: string, value: unknown, min: number, max: number): number | undefined {
    const n = this.number(path, value, min, max);
    if (n === undefined) return undefined;
    if (!Number.isInteger(n)) {
      this.fail(path, `整数である必要があります（実際: ${n}）`);
      return undefined;
    }
    return n;
  }

  boolean(path: string, value: unknown): boolean | undefined {
    if (typeof value !== 'boolean') {
      this.fail(path, `真偽値である必要があります（実際: ${describe(value)}）`);
      return undefined;
    }
    return value;
  }

  /** 許可された値のいずれかであることを確認する。 */
  enum<T extends string>(path: string, value: unknown, allowed: readonly T[]): T | undefined {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(
        path,
        `${allowed.join(' / ')} のいずれかである必要があります（実際: ${describe(value)}）`,
      );
      return undefined;
    }
    return value as T;
  }

  /** 定義されていないキーが混じっていないかを調べる。綴り間違いを検出するため。 */
  noExtraKeys(path: string, record: Record<string, unknown>, known: readonly string[]): void {
    for (const key of Object.keys(record)) {
      if (!known.includes(key)) {
        this.fail(`${path}.${key}`, '未知のフィールドです');
      }
    }
  }

  /** ID の重複を調べる。 */
  uniqueIds(path: string, ids: readonly string[]): void {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        this.fail(`${path}[${index}]`, `ID が重複しています: ${id}`);
      }
      seen.add(id);
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '配列';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  if (typeof value === 'undefined') return '未指定';
  return typeof value;
}
