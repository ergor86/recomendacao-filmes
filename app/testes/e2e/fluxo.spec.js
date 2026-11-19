// Ponta a ponta (spec 12), em Chromium e WebKit, contra o Compose rodando.
import { contextoApi, expect, limparPerfisDeTeste, nomeUnico, psql, resumirPedidos, test } from './apoio.js';

const LISTA = 'ol.lista-recomendacoes > li';
const porId = (page, id) => page.locator(`ol.lista-recomendacoes > li[data-filme-id="${id}"]`);
const aviso = (page) => page.locator('.aviso-acao');

test.afterAll(async ({}, testInfo) => {
  await limparPerfisDeTeste(testInfo.project.use.baseURL);
});

async function darNota(page, li, n) {
  await li.getByRole('button', { name: /^Mais ações para / }).click();
  await li.getByRole('button', { name: 'Dar nota' }).click();
  await li.getByRole('radio', { name: `${n} de 5 estrelas` }).click();
}
const idsDaLista = (page) => page.locator(LISTA).evaluateAll((els) => els.map((e) => e.dataset.filmeId));
const tituloDe = async (li) => (await li.locator('.cartao-titulo').textContent()).trim();

async function criarPerfil(page, nome) {
  await page.getByLabel('Apelido').fill(nome);
  await page.getByRole('button', { name: 'Criar perfil' }).click();
}

test('fluxo principal: perfil, onboarding, Top 10 que se atualiza sozinho, notas, Quero assistir, Gostei e Desfazer', async ({ page, trafego }) => {
  test.setTimeout(180_000);
  const nome = nomeUnico('fluxo');

  await test.step('criar perfil e marcar 3 "Gostei" no onboarding', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
    await criarPerfil(page, nome);
    await expect(page.getByRole('heading', { name: 'Comece pelos filmes que você conhece' })).toBeVisible();
    const gostei = page.locator('ul.grade-filmes button.gostei'); // o nome acessível muda quando marcado
    await expect(gostei.first()).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await gostei.nth(i).click();
      await expect(gostei.nth(i)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('button', { name: 'Ver minhas recomendações' }).click();
  });

  let ids;
  await test.step('Top 10 com 10 itens da S1 e "Porque você curtiu"', async () => {
    await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
    await expect(page.locator(LISTA)).toHaveCount(10);
    await expect(page.locator(`${LISTA} .porque`)).toHaveCount(10);
    await expect(page.getByText('Porque você curtiu').first()).toBeVisible();
    await expect(page.locator('.explicacao-motivo')).toContainText('Filmes curtidos por pessoas que curtiram os mesmos filmes que você.');
    ids = await idsDaLista(page);
    expect(new Set(ids).size).toBe(10);
  });

  await test.step('5 estrelas num item: ele sai, sem nenhum clique a lista volta a 10, há "Novo" e o foco fica na lista', async () => {
    const alvo = ids[0];
    await darNota(page, porId(page, alvo), 5);
    // nenhum clique daqui em diante: a lista se atualiza sozinha
    await expect(porId(page, alvo)).toHaveCount(0);
    await expect(page.locator(LISTA)).toHaveCount(10);
    // a nota 5 muda o perfil: entram filmes que não estavam na lista da abertura (pelo menos um, com o selo "Novo")
    await expect(page.locator(`${LISTA} .selo-novo`).first()).toHaveText('Novo');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('ol.lista-recomendacoes')?.contains(document.activeElement) ?? false))
      .toBe(true);
    await expect(aviso(page)).toContainText('Salvo.');
    ids = await idsDaLista(page);
  });

  await test.step('duas notas seguidas, sem esperar: a lista final não tem nenhum dos dois e tem 10 itens', async () => {
    const [a, b] = [ids[1], ids[2]];
    await darNota(page, porId(page, a), 4);
    await darNota(page, porId(page, b), 5); // sem esperar a primeira voltar
    await expect(porId(page, a)).toHaveCount(0);
    await expect(porId(page, b)).toHaveCount(0);
    await expect(page.locator(LISTA)).toHaveCount(10);
    ids = await idsDaLista(page);
  });

  let idNota2;
  await test.step('nota 2 tira o item do Top 10', async () => {
    idNota2 = ids[3];
    await darNota(page, porId(page, idNota2), 2);
    await expect(porId(page, idNota2)).toHaveCount(0);
    await expect(page.locator(LISTA)).toHaveCount(10);
    await expect(aviso(page)).toContainText('Notas 1–3 tiram este filme das recomendações');
    ids = await idsDaLista(page);
  });

  await test.step('"Quero assistir" leva o filme para a Minha lista e ele não volta ao Top 10', async () => {
    const idQuero = ids[4];
    const titulo = await tituloDe(porId(page, idQuero));
    const li = porId(page, idQuero);
    await li.getByRole('button', { name: /^Mais ações para / }).click();
    await li.getByRole('button', { name: 'Quero assistir' }).click();
    await expect(porId(page, idQuero)).toHaveCount(0);
    await expect(page.locator(LISTA)).toHaveCount(10);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await nav.getByRole('link', { name: 'Minha lista' }).click();
    await expect(page.getByRole('heading', { name: 'Minha lista' })).toBeVisible();
    await expect(page.locator('.cartao-titulo', { hasText: titulo })).toBeVisible();
    await nav.getByRole('link', { name: 'Top 10' }).click();
    await expect(page.locator(LISTA)).toHaveCount(10);
    await expect(porId(page, idQuero)).toHaveCount(0);
  });

  await test.step('trocar a nota 2 por "Gostei", usar o Desfazer e excluir a nota (estado volta a "nenhum")', async () => {
    await page.goto(`/filmes/${idNota2}`);
    const estado = page.locator('.estado-atual');
    await expect(estado).toContainText('Nota 2');
    await page.getByRole('button', { name: 'Gostei', exact: true }).click();
    await expect(estado).toContainText('Gostei');
    await expect(aviso(page)).toContainText('Sua nota 2 foi substituída por Gostei.');
    await aviso(page).getByRole('button', { name: 'Desfazer' }).click();
    await expect(estado).toContainText('Nota 2');
    await page.getByRole('button', { name: 'Remover', exact: true }).click();
    await expect(estado).toContainText('nenhum');
    await expect(page.locator('.estatistica-sua')).toContainText('Você ainda não marcou este filme.');
  });

  await test.step('excluir o perfil pela interface (DELETE sem corpo e sem Content-Type)', async () => {
    await page.getByRole('button', { name: 'Trocar de perfil' }).click();
    await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
    await page.getByRole('button', { name: `Excluir o perfil ${nome}` }).click();
    await page.getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(page.getByRole('button', { name: nome, exact: true })).toHaveCount(0);
  });

  // Requisições sem corpo saem sem Content-Type; as escritas com corpo saem com application/json
  const pedidos = await resumirPedidos(trafego.api);
  const de = (metodo, re) => pedidos.filter((p) => p.metodo === metodo && re.test(p.caminho));
  const delPerfil = de('DELETE', /^\/api\/perfis\/[^/]+$/);
  const delInteracao = de('DELETE', /^\/api\/perfis\/[^/]+\/interacoes\/\d+$/);
  expect(delPerfil.length).toBeGreaterThanOrEqual(1);
  expect(delInteracao.length).toBeGreaterThanOrEqual(1);
  for (const p of [...delPerfil, ...delInteracao]) {
    expect(p.corpo, `${p.metodo} ${p.caminho}: corpo`).toBeNull();
    expect(p.contentType, `${p.metodo} ${p.caminho}: Content-Type`).toBeNull();
  }
  const comCorpo = [
    ...de('POST', /^\/api\/perfis$/),
    ...de('PATCH', /^\/api\/perfis\/[^/]+$/),
    ...de('PUT', /^\/api\/perfis\/[^/]+\/interacoes\/\d+$/),
  ];
  expect(comCorpo.length).toBeGreaterThanOrEqual(5);
  for (const p of comCorpo) {
    expect(p.corpo, `${p.metodo} ${p.caminho}: corpo`).not.toBeNull();
    expect(p.contentType, `${p.metodo} ${p.caminho}: Content-Type`).toMatch(/^application\/json/);
  }
});

test('"Ver um exemplo" mostra o Top 10; POST /perfis/exemplo sai sem corpo e sem Content-Type', async ({ page, trafego }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver um exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await expect(page.locator(LISTA)).toHaveCount(10);
  await expect(page.locator('.moldura-perfil')).toContainText('Perfil de exemplo');
  const exemplo = (await resumirPedidos(trafego.api)).filter((p) => p.metodo === 'POST' && p.caminho === '/api/perfis/exemplo');
  expect(exemplo).toHaveLength(1);
  expect(exemplo[0].corpo).toBeNull();
  expect(exemplo[0].contentType).toBeNull();
});

test('perfil vazio recebe os mais avaliados, com explicação', async ({ page }) => {
  await page.goto('/');
  await criarPerfil(page, nomeUnico('vazio'));
  await expect(page.getByRole('heading', { name: 'Comece pelos filmes que você conhece' })).toBeVisible();
  await page.getByRole('button', { name: 'Pular por enquanto' }).click();
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await expect(page.locator(LISTA)).toHaveCount(10);
  await expect(page.locator(`${LISTA} .selo-populares`)).toHaveCount(10);
  await expect(page.locator('.explicacao-motivo')).toContainText('Você ainda não marcou filmes de que gostou. Enquanto isso, mostramos os mais avaliados.');
});

test('estrelas pelo teclado (setas, Home e End) no detalhe do filme', async ({ page }) => {
  await page.goto('/');
  await criarPerfil(page, nomeUnico('teclado'));
  await page.getByRole('button', { name: 'Pular por enquanto' }).click();
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await page.goto('/filmes/50');
  const grupo = page.getByRole('radiogroup', { name: 'Sua nota' });
  await expect(grupo).toBeVisible();
  const estado = page.locator('.estado-atual');
  await expect(estado).toContainText('nenhum');
  await grupo.getByRole('radio', { name: '1 de 5 estrelas' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(estado).toContainText('Nota 2');
  await expect(grupo.getByRole('radio', { name: '2 de 5 estrelas' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(estado).toContainText('Nota 3');
  await page.keyboard.press('ArrowLeft');
  await expect(estado).toContainText('Nota 2');
  await page.keyboard.press('End');
  await expect(estado).toContainText('Nota 5');
  await expect(grupo.getByRole('radio', { name: '5 de 5 estrelas' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(estado).toContainText('Nota 1');
});

test('prefers-reduced-motion: a lista troca de itens sem animação de deslocamento', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await criarPerfil(page, nomeUnico('movimento'));
  await page.getByRole('button', { name: 'Pular por enquanto' }).click();
  await expect(page.locator(LISTA)).toHaveCount(10);
  // observa as animações da Web Animations API (as do FLIP) enquanto um item sai
  await page.evaluate(() => {
    window.__animacoes = 0;
    window.__timer = setInterval(() => {
      for (const a of document.getAnimations()) {
        if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) window.__animacoes += 1;
      }
    }, 20);
  });
  const alvo = page.locator(LISTA).nth(0);
  const idAlvo = await alvo.getAttribute('data-filme-id');
  await darNota(page, alvo, 5);
  await expect(porId(page, idAlvo)).toHaveCount(0);
  await expect(page.locator(LISTA)).toHaveCount(10);
  expect(await page.evaluate(() => { clearInterval(window.__timer); return window.__animacoes; })).toBe(0);
});

test('painel "Neste computador" expande com 5 ou mais notas de perfis diferentes no mesmo filme', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const api = await contextoApi(testInfo.project.use.baseURL);
  const FILME = 1;
  const criados = [];
  try {
    for (let i = 0; i < 5; i++) {
      const r = await api.post('/api/perfis', { data: { nome: nomeUnico(`painel${i}`) } });
      expect(r.status()).toBe(201);
      criados.push(await r.json());
    }
    const nota = async (perfil, n) => {
      const r = await api.put(`/api/perfis/${perfil.id}/interacoes/${FILME}`, { data: { tipo: 'nota', nota: n } });
      expect(r.ok()).toBe(true);
    };
    for (let i = 0; i < 4; i++) await nota(criados[i], 3 + (i % 3));
    await page.addInitScript((id) => {
      try { window.localStorage.setItem('perfilAtivo', id); } catch { /* sem armazenamento */ }
    }, criados[4].id);
    await page.goto(`/filmes/${FILME}`);
    const painel = page.locator('.estatistica-computador');
    await expect(painel).toContainText('poucas notas ainda');
    await expect(painel.locator('details')).not.toHaveAttribute('open', '');
    // a quinta nota (de outro perfil) abre o painel
    await nota(criados[4], 5);
    await page.reload();
    await expect(painel.locator('details')).toHaveAttribute('open', '');
    await expect(painel).not.toContainText('poucas notas ainda');
    await expect(painel.getByText('Número de notas')).toBeVisible();
    await expect(painel.locator('dl')).toContainText('Média');
    await expect(painel.locator('div', { hasText: 'Número de notas' }).last().locator('dd')).toHaveText('5');
  } finally {
    for (const p of criados) await api.delete(`/api/perfis/${p.id}`);
    await api.dispose();
  }
});

test('Sobre: topo exato, Detalhes técnicos com 462 e 17, e "Trocar de perfil" a partir de /sobre volta à tela de perfis', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver um exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Top 10' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Sobre' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre', exact: true })).toBeVisible();
  await expect(page.locator('.sobre-resumo p')).toHaveText([
    'O sistema compara seus gostos com avaliações de 943 pessoas feitas em 1997–98.',
    'Para testar a técnica, foram separadas algumas avaliações históricas de 445 dessas pessoas.',
    'Os resultados medidos não garantem a mesma qualidade para novos usuários.',
  ]);
  await page.getByText('Detalhes técnicos').click();
  const detalhes = page.locator('details.sobre-detalhes');
  await expect(detalhes).toContainText('462');
  await expect(detalhes).toContainText('17');
  await page.getByRole('button', { name: 'Trocar de perfil' }).click();
  await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver um exemplo' })).toBeVisible();
});

test.describe('caminho bloqueado: TelaPreparando e GestaoPerfisRestrita', () => {
  const HASH = "chave = 'hash_treino'";
  let original = null;
  let nomePerfil;
  let baseURL;

  const restaurar = () => {
    if (original) psql(`UPDATE v2_final.metadados SET valor = '${original}' WHERE ${HASH};`);
  };

  test.beforeAll(async ({}, testInfo) => {
    baseURL = testInfo.project.use.baseURL;
    const api = await contextoApi(baseURL);
    try {
      nomePerfil = nomeUnico('bloqueio');
      const r = await api.post('/api/perfis', { data: { nome: nomePerfil } });
      expect(r.status()).toBe(201);
      const perfil = await r.json();
      // o perfil ganha uma marcação, para que a exclusão apague algo em cascata
      const m = await api.put(`/api/perfis/${perfil.id}/interacoes/50`, { data: { tipo: 'gostei' } });
      expect(m.ok()).toBe(true);
      original = psql(`SELECT valor FROM v2_final.metadados WHERE ${HASH};`);
      expect(original).toMatch(/^[0-9a-f]{64}$/);
      psql(`UPDATE v2_final.metadados SET valor = 'x' WHERE ${HASH};`);
      // a vigia leva até 60 s; o pedido de recomendações confere os hashes e bloqueia na hora
      const bloqueio = await api.get(`/api/perfis/${perfil.id}/recomendacoes`);
      expect(bloqueio.status()).toBe(503);
      expect((await bloqueio.json()).codigo).toBe('BLOQUEADO');
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    restaurar();
    // volta a operante sem reiniciar o servidor
    const api = await contextoApi(baseURL);
    try {
      await expect
        .poll(async () => (await (await api.get('/api/saude')).json()).estado, { timeout: 30_000, intervals: [2500] })
        .toBe('operante');
    } finally {
      await api.dispose();
    }
  });

  test('bloqueado: a tela explica, a gestão restrita lista e exclui o perfil, e restaurar volta ao app', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'A aplicação está bloqueada' })).toBeVisible();
    await expect(page.locator('.causa')).toContainText('treino');
    await expect(page.getByRole('button', { name: 'Conferir de novo' })).toBeVisible();
    await expect(page.locator('code.comando')).toBeVisible();

    await page.getByRole('link', { name: 'Apagar perfis e avaliações' }).click();
    await expect(page.getByRole('heading', { name: 'Apagar perfis e avaliações' })).toBeVisible();
    await expect(page.locator('.perfil-nome', { hasText: nomePerfil })).toBeVisible();
    await expect(page.locator('li', { hasText: nomePerfil }).locator('.perfil-info')).toContainText('1 marcações');
    await page.getByRole('button', { name: `Excluir o perfil ${nomePerfil}` }).click();
    await page.getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(page.locator('.perfil-nome', { hasText: nomePerfil })).toHaveCount(0);
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByRole('heading', { name: 'A aplicação está bloqueada' })).toBeVisible();

    // enquanto os metadados estão adulterados, "Conferir de novo" continua bloqueado
    await page.getByRole('button', { name: 'Conferir de novo' }).click();
    await expect(page.getByRole('heading', { name: 'A aplicação está bloqueada' })).toBeVisible();

    restaurar();
    await expect(page.getByRole('heading', { name: 'Quem está usando?' })).toBeVisible({ timeout: 30_000 });
  });
});
