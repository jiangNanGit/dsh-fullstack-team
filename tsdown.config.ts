import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: true,
  fixedExtension: false,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//, 'yaml'] },
})
