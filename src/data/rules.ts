/**
 * `data/rules.json` の読み込みと検証（実装計画書 第4章の前提）。
 *
 * > 本章の数値はすべて JSON の定数として外に出し、
 * > コード変更なしで調整できるようにする。
 *
 * バランス調整（第9章 Phase 10）でここだけを触れば済むよう、
 * 戦闘とダメージのテンポを決める値は1か所に集めてある。
 */

import type { RulesDef } from '@/core/types';
import { Validator } from './schema';

const RULES_KEYS = [
  'supportRate',
  'encircleMul',
  'damageScale',
  'counterCoef',
  'expStep',
  'expThresholds',
  'expOnAttack',
  'expOnKill',
  'expOnCounter',
] as const;

export function parseRules(raw: unknown, source = 'rules.json'): RulesDef {
  const v = new Validator(source);
  const record = v.record('rules', raw);
  if (record === undefined) {
    v.throwIfFailed();
    throw new Error('到達しない');
  }
  v.noExtraKeys('rules', record, RULES_KEYS);

  const supportRate = v.number('rules.supportRate', record['supportRate'], 0, 1);
  const encircleMul = v.number('rules.encircleMul', record['encircleMul'], 0.1, 1);
  const damageScale = v.number('rules.damageScale', record['damageScale'], 0.1, 5);
  const counterCoef = v.number('rules.counterCoef', record['counterCoef'], 0, 2);
  const expStep = v.number('rules.expStep', record['expStep'], 0, 1);
  const expOnAttack = v.integer('rules.expOnAttack', record['expOnAttack'], 0, 10);
  const expOnKill = v.integer('rules.expOnKill', record['expOnKill'], 0, 10);
  const expOnCounter = v.integer('rules.expOnCounter', record['expOnCounter'], 0, 10);
  const expThresholds = parseThresholds(v, record['expThresholds']);

  v.throwIfFailed();

  return {
    supportRate: supportRate!,
    encircleMul: encircleMul!,
    damageScale: damageScale!,
    counterCoef: counterCoef!,
    expStep: expStep!,
    expThresholds: expThresholds!,
    expOnAttack: expOnAttack!,
    expOnKill: expOnKill!,
    expOnCounter: expOnCounter!,
  };
}

/** レベルアップに必要な経験値。昇順で、レベル1から順に並べる。 */
function parseThresholds(v: Validator, raw: unknown): number[] | undefined {
  const list = v.array('rules.expThresholds', raw);
  if (list === undefined) return undefined;

  const thresholds: number[] = [];
  let previous = 0;
  for (const [index, entry] of list.entries()) {
    const value = v.integer(`rules.expThresholds[${index}]`, entry, 1, 99);
    if (value === undefined) continue;
    if (value <= previous) {
      v.fail(`rules.expThresholds[${index}]`, '必要経験値は昇順である必要があります');
      continue;
    }
    previous = value;
    thresholds.push(value);
  }
  return thresholds;
}
