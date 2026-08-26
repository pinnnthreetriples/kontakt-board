import { defineConfig, devices } from '@playwright/test';

// Порт задаётся переменной окружения: 4173 часто занят вручную запущенным приложением,
// а reuseExistingServer молча подцепился бы к чужой сборке вместо dev-сервера тестов.
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 1,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port}`, url: baseURL, reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
