/**
 * AI のインターフェース（実装計画書 第6章）。
 *
 * 実装を差し替えられるよう、思考の入口をここに切っておく。
 * v1（貪欲）を v2（評価関数型）へ入れ替えるとき、呼び出し側は変えなくてよい。
 *
 * **AI は完全に決定的でなければならない**（第6章 決定性の要件）。
 * 同じ局面に対して常に同じ手を返すからこそ、マップが「解ける問題」になる。
 */

import type { Command } from '@/core/commands';
import type { GameData } from '@/core/map';
import type { FactionId, GameState } from '@/core/types';

export interface AiPlayer {
  readonly name: string;
  /**
   * 1手番分のコマンド列を返す。末尾は必ず `endTurn`。
   * 返した順にそのまま `reduce` へ流せることを保証する。
   */
  planTurn(data: GameData, state: GameState, faction: FactionId): Command[];
}
