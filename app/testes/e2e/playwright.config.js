// Playwright contra um Compose já rodando (spec 12). A porta vem de APP_PORTA (a publicada); com
// PLAYWRIGHT_BASE_URL (ex.: o clone da instalação limpa) a URL é usada como está.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(aqui, '..', '..');
const APP_PORTA = process.env.APP_PORTA ?? '3000';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${APP_PORTA}`;

export default defineConfig({
  testDir: aqui,
  // Os testes compartilham o mesmo banco e o caminho bloqueado adultera os metadados: nada em paralelo.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // pastas ignoradas pelo git (app/.gitignore)
  outputDir: path.join(app, 'test-results', 'e2e'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(app, 'playwright-report') }]],
  use: { baseURL, reducedMotion: 'reduce', locale: 'pt-BR', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /(capturas|gif)\.spec/, use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' } },
    { name: 'webkit', testIgnore: /(capturas|gif)\.spec/, use: { ...devices['Desktop Safari'], reducedMotion: 'reduce' } },
    // só gera as capturas versionadas (`npx playwright test capturas`); fora do `npm run e2e`
    {
      name: 'capturas',
      testMatch: /capturas\.spec/,
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } },
    },
    // só grava o vídeo do GIF de demonstração (`--project=gif`); fora do `npm run e2e`
    {
      name: 'gif',
      testMatch: /gif\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        video: { mode: 'on', size: { width: 1280, height: 800 } },
      },
    },
  ],
});
