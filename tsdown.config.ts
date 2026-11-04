import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', roles: 'src/roles.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  fixedExtension: false,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//, 'yaml'] },
})
