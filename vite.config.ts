import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'
import { execSync } from 'node:child_process'

/** wersja do kluczy pamięci policzonych brył w przeglądarce: nowy kod = nowe bryły */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return dirty ? `${sha}+${Date.now()}` : sha
  } catch {
    return String(Date.now())
  }
}

export default defineConfig({
  base: './',
  plugins: [svelte()],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
