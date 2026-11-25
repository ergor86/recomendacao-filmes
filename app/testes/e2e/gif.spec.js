// Grava o vídeo do GIF de demonstração (app/docs/demonstracao.gif) a partir do roteiro do aceite manual.
// Roda só no projeto `gif`:  npx playwright test -c testes/e2e/playwright.config.js --project=gif
// O vídeo sai em test-results/e2e/ (ignorado pelo git). Conversão usada para o GIF versionado (ferramentas fora do
// repositório, sem dependência nova no projeto): o ffmpeg que acompanha o Playwright extrai os quadros
// (`-vf scale=960:-1 -r 8`, PNG) e um script Node com o pacote `gifenc` monta o GIF com paleta global de 127 cores,
// gravando em cada quadro só os pixels que mudaram e fundindo quadros quase iguais.
// Só usa um perfil de demonstração ("Visitante"), apagado no fim, e cartazes gerados localmente.
import { contextoApi, expect, test } from './apoio.js';

const NOME = 'Visitante';
const LISTA = 'ol.lista-recomendacoes > li';
const pausa = (page, ms) => page.waitForTimeout(ms);

// destaca o alvo antes do clique (o vídeo do Playwright não mostra o cursor); CSSOM, permitido pela CSP
async function clicar(page, alvo, ms = 700) {
  await alvo.scrollIntoViewIfNeeded();
  await alvo.evaluate((el) => {
    el.style.outline = '4px solid #E8833A';
    el.style.outlineOffset = '3px';
  });
  await pausa(page, ms);
  await alvo.evaluate((el) => {
    el.style.outline = '';
    el.style.outlineOffset = '';
  });
  await alvo.click();
}

async function apagarPerfisReais(baseURL) {
  const api = await contextoApi(baseURL);
  try {
    for (const p of await (await api.get('/api/perfis')).json()) {
      if (!p.exemplo) await api.delete(`/api/perfis/${p.id}`);
    }
  } finally {
    await api.dispose();
  }
}

test.beforeAll(async ({}, testInfo) => apagarPerfisReais(testInfo.project.use.baseURL));
test.afterAll(async ({}, testInfo) => apagarPerfisReais(testInfo.project.use.baseURL));

test('GIF de demonstração: perfil, primeiros filmes, Top 10, notas, Minha lista, detalhe, catálogo e Sobre', async ({ page }) => {
  test.setTimeout(240_000);

  // 1. Perfis
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
  await pausa(page, 2500);
  await page.getByLabel('Apelido').pressSequentially(NOME, { delay: 120 });
  await clicar(page, page.getByRole('button', { name: 'Criar perfil' }));

  // 2. Primeiros filmes: 3 "Gostei"
  await expect(page.getByRole('heading', { name: 'Comece pelos filmes que você conhece' })).toBeVisible();
  await pausa(page, 3000);
  const gostei = page.locator('ul.grade-filmes').getByRole('button', { name: 'Gostei', exact: true });
  for (let i = 0; i < 3; i++) {
    await clicar(page, gostei.nth(i), 600);
    await expect(gostei.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await pausa(page, 900);
  }
  await pausa(page, 1200);
  await clicar(page, page.getByRole('button', { name: 'Ver minhas recomendações' }));

  // 3. Top 10 com "Porque você curtiu"
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await expect(page.locator(LISTA)).toHaveCount(10);
  await pausa(page, 3500);
  await page.mouse.wheel(0, 420);
  await pausa(page, 3000);

  // 4. 5 estrelas no primeiro item: ele sai e a lista se atualiza sozinha
  const primeiro = page.locator(LISTA).first();
  const idPrimeiro = await primeiro.getAttribute('data-filme-id');
  await clicar(page, primeiro.getByRole('button', { name: /^Mais ações para / }));
  await clicar(page, primeiro.getByRole('button', { name: 'Dar nota' }), 500);
  await clicar(page, primeiro.getByRole('radio', { name: '5 de 5 estrelas' }));
  await expect(page.locator(`${LISTA}[data-filme-id="${idPrimeiro}"]`)).toHaveCount(0);
  await expect(page.locator(LISTA)).toHaveCount(10);
  await pausa(page, 3500);

  // 5. "Quero assistir" e "Desfazer"
  const segundo = page.locator(LISTA).nth(1);
  await clicar(page, segundo.getByRole('button', { name: /^Mais ações para / }));
  await clicar(page, segundo.getByRole('button', { name: 'Quero assistir' }));
  const aviso = page.locator('.aviso-acao');
  await expect(aviso).toContainText('Salvo.');
  await pausa(page, 2500);
  await clicar(page, aviso.getByRole('button', { name: 'Desfazer' }));
  await pausa(page, 2500);

  // 6. Detalhe de um filme: as três fontes de estatística
  await page.mouse.wheel(0, -2000);
  await pausa(page, 800);
  const titulo = page.locator(LISTA).first().locator('a.cartao-link');
  await clicar(page, titulo);
  await expect(page.locator('.painel-estatisticas')).toBeVisible();
  await pausa(page, 3500);
  await page.mouse.wheel(0, 420);
  await pausa(page, 3500);

  // 7. Catálogo ordenado por "Maior média"
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await clicar(page, nav.getByRole('link', { name: 'Catálogo' }));
  await pausa(page, 2000);
  await page.getByLabel('Ordem').selectOption('mais_bem_avaliados');
  await pausa(page, 3500);

  // 8. Sobre
  await clicar(page, nav.getByRole('link', { name: 'Sobre' }));
  await pausa(page, 4500);
  await page.mouse.wheel(0, 600);
  await pausa(page, 4000);

  // 9. Tema: de volta ao Top 10 e troca para o modo escuro (Automático → Claro → Escuro)
  await clicar(page, nav.getByRole('link', { name: 'Top 10' }));
  await expect(page.locator(LISTA)).toHaveCount(10);
  await pausa(page, 1500);
  const tema = page.locator('.botao-tema');
  await clicar(page, tema, 600);
  await expect(tema).toHaveAttribute('aria-label', 'Tema: Claro');
  await pausa(page, 700);
  await clicar(page, tema, 600);
  await expect(tema).toHaveAttribute('aria-label', 'Tema: Escuro');
  await pausa(page, 4000);
});
