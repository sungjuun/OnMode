import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
if (stack.API_URL !== 'http://127.0.0.1:56321' || !stack.PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw Error('Start the isolated ONMODE Supabase stack on 56321 before running connected tests.')
}
export default defineConfig({
  testDir: './tests/connected', outputDir: './test-results/connected',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5182' },
  webServer: {
    command: 'npm run dev -- --mode e2e --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    env: { VITE_SUPABASE_URL: stack.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY },
  },
})
