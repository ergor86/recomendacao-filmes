// Gera as 5 capturas de app/docs/capturas/ com o "Perfil de exemplo" (só cartazes gerados, sem imagens de terceiros).
// Roda só no projeto `capturas`:  npx playwright test -c testes/e2e/playwright.config.js capturas
import path from 'node:path';
import { DIR_APP, expect, test } from './apoio.js';

const PASTA = path.join(DIR_APP, 'docs', 'capturas');
const LISTA = 'ol.lista-recomendacoes > li';

const salvar = (page, nome) => page.screenshot({ path: path.join(PASTA, nome), animations: 'disabled', caret: 'hide' });

test('capturas: Perfis, Onboarding, Top 10, Detalhe e Sobre', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');

  // 1. Perfis (com o exemplo já criado, para a lista não ficar vazia)
  await page.getByRole('button', { name: 'Ver um exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Trocar de perfil' }).click();
  await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perfil de exemplo', exact: true })).toBeVisible();
  await salvar(page, '01-perfis.png');

  // 2. Onboarding (o exemplo já concluiu o seu; a rota continua acessível)
  await page.getByRole('button', { name: 'Perfil de exemplo', exact: true }).click();
  await expect(page.locator(LISTA)).toHaveCount(10);
  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: 'Comece pelos filmes que você conhece' })).toBeVisible();
  await expect(page.locator('ul.grade-filmes li').first()).toBeVisible();
  await expect(page.locator('ul.grade-filmes').getByRole('button', { name: 'Gostei', exact: true }).first()).toBeVisible();
  await salvar(page, '02-onboarding.png');

  // 3. Top 10
  await page.goto('/');
  await expect(page.locator(LISTA)).toHaveCount(10);
  await expect(page.locator(`${LISTA} .porque`).first()).toBeVisible();
  await salvar(page, '03-top10.png');

  // 4. Detalhe do primeiro filme da lista
  await page.locator(`${LISTA} a.cartao-link`).first().click();
  await expect(page.locator('.detalhe-filme h1')).toBeVisible();
  await expect(page.locator('.painel-estatisticas')).toBeVisible();
  await salvar(page, '04-detalhe.png');

  // 5. Sobre
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Sobre' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre', exact: true })).toBeVisible();
  await expect(page.locator('.sobre-resumo p')).toHaveCount(3);
  await salvar(page, '05-sobre.png');
});
