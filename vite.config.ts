import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
