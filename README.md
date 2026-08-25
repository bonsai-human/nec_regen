# nec_regen

ターン制ヘクス戦術シミュレーションゲーム（開発中）。

六角形マスのマップ上で2陣営が交互にユニットを動かして戦う戦術シミュレーション。
「敵を囲むほど攻撃が強くなるサポート補正」「ZOC による戦線」「工場占領による増援」を核に、
現代を舞台として海上戦力・沿岸戦を加えた設計になっている。

盤面を読んで最適解を組み立てる**詰将棋のような手応え**を最優先の設計指針とし、
乱数を一切使わず、AI の思考も決定的にしている。

- 実行環境: ブラウザ（TypeScript + HTML5 Canvas）
- 対応デバイス: PC / タブレット / スマートフォン（マウス・タッチ両対応）
- 対戦形式: 1人用（vs CPU）
- 索敵なし・乱数なし。盤面はすべて公開され、戦闘結果は完全に予測できる
- 生産なし。戦力はマップ初期配置と占領施設からの増援のみ
- 素材: 自作 / CC0 のみ

## ドキュメント

- [実装計画書](docs/implementation-plan.md) — 仕様・アーキテクチャ・開発フェーズ
- [仕様の食い違いと暫定の解釈](docs/spec-questions.md) — 実装で判断が必要だった点の記録
- [使用素材とライセンス](docs/CREDITS.md)

## 現在のステータス

**Phase 2（描画・カメラ・入力）完了。** 次は Phase 3（移動）。

| Phase | 内容                                                        | 状態     |
| ----- | ----------------------------------------------------------- | -------- |
| 0     | 基盤構築（Vite / TS strict / Vitest / ESLint / CI / Pages） | 完了     |
| 1     | ヘクス座標系、型定義、JSON ローダとスキーマ検証             | 完了     |
| 2     | 描画・カメラ・入力                                          | 完了     |
| 3     | 移動（移動コスト・ZOC・経路探索）                           | これから |

Phase 1 で入ったもの:

- `src/core/hex.ts` — odd-q オフセット ⇔ 軸座標、距離、近隣、範囲、射程帯
- `src/core/types.ts` — `GameState` / `Unit` / `UnitDef` / `TerrainDef` などの型定義
- `src/core/map.ts` — 盤面（タイル配列）とルール解決用の静的データ
- `src/data/` — JSON ローダとスキーマ検証（問題は1件目で止めずまとめて報告する）
- `data/units.json` — 全28種の能力値（実装計画書 第5.1.1章の較正済みデータ）
- `data/terrain.json` — 全17種の地形コストと地形効果
- `data/maps/map01_crossroads.json` — 21×14 の陸戦マップ

Phase 2 で入ったもの:

- `src/render/hex-layout.ts` — フラットトップ六角形の幾何（外接円=1 のワールド座標）
- `src/render/camera.ts` — パン・ズーム・可視範囲の切り出し。回転しても注視点を維持する
- `src/render/board-renderer.ts` — 地形 → グリッド → 施設 → ハイライト → ユニットの描画
- `src/input/pointer.ts` — Pointer Events を tap / doubleTap / longPress / drag / pinch / hover に解釈
- `src/ui/app.ts` — 上記を繋ぐ層。ルールは知らない

操作: ドラッグ / 方向キーでスクロール、ホイール・ピンチ・ダブルタップ・ボタンでズーム、
タップまたは長押しでヘクスの内容表示、Esc で選択解除。

## 開発

必要環境: Node.js 22 以上。

```bash
npm install
npm run dev        # 開発サーバ（http://localhost:5173）
```

| コマンド            | 内容                                         |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Vite 開発サーバを起動                        |
| `npm run build`     | 型チェック＋本番ビルド（`dist/`）            |
| `npm run preview`   | ビルド成果物をローカルで確認                 |
| `npm run typecheck` | `tsc --noEmit`                               |
| `npm run lint`      | ESLint                                       |
| `npm run format`    | Prettier で整形（`format:check` は検査のみ） |
| `npm test`          | Vitest（`test:watch` は監視実行）            |
| `npm run ci`        | CI と同じ一連の検証をローカルで実行          |

### 決定性の担保

本作は乱数を一切使わない（実装計画書 第1.1章）。これを規約ではなく仕組みで守るため、
ESLint で次を禁止している。破ると CI が落ちる。

- `Math.random` — プロジェクト全体で禁止
- `Date.now` / `performance.now` / `new Date()` / `crypto.getRandomValues` — `src/core` と `src/ai` で禁止
- レイヤをまたぐ import — `core` は他レイヤを参照不可、`ai` は `core` のみ、`render`/`input` は `ui` を参照不可

### 配信

`main` への push で GitHub Actions が GitHub Pages へ自動デプロイする
（リポジトリ設定の Pages → Source を「GitHub Actions」にしておく必要がある）。
