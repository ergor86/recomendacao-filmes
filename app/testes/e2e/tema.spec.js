// Seletor de tema (decisão do usuário, 2026-11-25): Automático, Claro e Escuro, guardado neste navegador.
import { expect, test } from './apoio.js';

const CLARO = 'rgb(246, 245, 249)';
const ESCURO = 'rgb(23, 21, 31)';
const botao = (page, nome) => page.getByRole('button', { name: `Tema: ${nome}` });
const fundo = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('com o sistema em modo escuro', () => {
  test.use({ colorScheme: 'dark' });

  test('Claro vale ao recarregar e Automático volta ao escuro', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
    expect(await fundo(page)).toBe(ESCURO);
    await botao(page, 'Automático').click(); // Automático -> Claro
    await expect.poll(() => fundo(page)).toBe(CLARO);
    await page.reload();
    await expect(botao(page, 'Claro')).toBeVisible();
    expect(await fundo(page)).toBe(CLARO);
    await botao(page, 'Claro').click(); // Claro -> Escuro
    await botao(page, 'Escuro').click(); // Escuro -> Automático
    await expect.poll(() => fundo(page)).toBe(ESCURO);
  });
});

test('pelo teclado (Enter e Espaço) o nome muda e o foco fica no botão', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
  await botao(page, 'Automático').focus();
  await page.keyboard.press('Enter'); // Automático -> Claro
  await expect(botao(page, 'Claro')).toBeFocused();
  await page.keyboard.press('Space'); // Claro -> Escuro
  await expect(botao(page, 'Escuro')).toBeFocused();
});

test.describe('com o sistema em modo claro', () => {
  test.use({ colorScheme: 'light' });

  test('Escuro força o fundo escuro', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
    expect(await fundo(page)).toBe(CLARO);
    await botao(page, 'Automático').click(); // -> Claro
    await botao(page, 'Claro').click(); // -> Escuro
    await expect.poll(() => fundo(page)).toBe(ESCURO);
  });
});
