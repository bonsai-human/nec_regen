import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// GitHub Pages のプロジェクトサイト（/<repo>/ 配下）でも
// ローカルの preview でも同じ成果物が動くよう、相対パスで出力する。
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // core/ai は DOM に依存しないため既定は node 環境。
    // DOM が要るテストはファイル先頭で `// @vitest-environment jsdom` を指定する。
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
