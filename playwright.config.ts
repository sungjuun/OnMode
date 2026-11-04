import { defineConfig, devices } from '@playwright/test'

const port = 5181
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true, retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:' + port, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --mode e2e --port ' + port + ' --strictPort',
    url: 'http://127.0.0.1:' + port,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
})
