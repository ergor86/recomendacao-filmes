// Testes da lógica pura da avaliação final (src/avaliacao/experimentos.js): orçamento do Exp. 5,
// catálogo do Exp. 6, as 7 recusas das pré-condições, a regra de N = 0 e a montagem das métricas.
// Só dados sintéticos, criados aqui; nenhum arquivo do MovieLens é lido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  popularesMesmoOrcamento, todosNaoVistos, verificarPreCondicoes, modelosEsperados, regraNZero,
  recallDosCandidatos, acertosComFonte, contribuicoesDasFontes, top10DoSubconjunto, resumirSemRede,
  resumirComRede, diferencaDescritiva, hipotesePrincipal, valoresMainstream, metricasPorGrupo, mediana,
  listasIguais,
} from '../../src/avaliacao/experimentos.js';
import { candidatosDe } from '../../src/modelo/ranqueador.js';
import { popularesNaoVistos } from '../../src/candidatos/populares.js';

const perto = (a, b) => Math.abs(a - b) < 1e-9;

// ---- Exp. 5 e Exp. 6 ----------------------------------------------------------------------

test('popularesMesmoOrcamento devolve exatamente `tamanho` não vistos, na ordem do ranking', () => {
  const ranking = [10, 20, 30, 40, 50, 60, 70];
  assert.deepEqual(popularesMesmoOrcamento(ranking, new Set([20, 50]), 4), [10, 30, 40, 60]);
  assert.deepEqual(popularesMesmoOrcamento(ranking, new Set(), 0), []);
});

test('popularesMesmoOrcamento tem o tamanho da lista do Exp. 4 do mesmo usuário (N > 0, com sobreposição)', () => {
  const ranking = Array.from({ length: 30 }, (_, i) => i + 1); // 1 é o mais popular
  const vistos = new Set([2, 5, 7]);
  // populares não vistos (como no arquivo de candidatos) e vizinhos com 2 repetidos dos populares
  const entrada = { populares: popularesNaoVistos(ranking, vistos, 20), vizinhos: [3, 25, 4, 28, 29] };
  const exp4 = candidatosDe(entrada, 6, 5).ids; // 6 populares + 3 vizinhos novos (3 e 4 repetem)
  assert.equal(exp4.length, 9);
  const exp5 = popularesMesmoOrcamento(ranking, vistos, exp4.length);
  assert.equal(exp5.length, exp4.length);
  assert.ok(exp5.every((id) => !vistos.has(id)));
  assert.equal(new Set(exp5).size, exp5.length);
});

test('popularesMesmoOrcamento com N = 0: a lista é idêntica à do Exp. 4', () => {
  const ranking = Array.from({ length: 30 }, (_, i) => i + 1);
  const vistos = new Set([1, 4]);
  const entrada = { populares: popularesNaoVistos(ranking, vistos, 20), vizinhos: [] };
  const exp4 = candidatosDe(entrada, 15, 0).ids;
  assert.deepEqual(popularesMesmoOrcamento(ranking, vistos, exp4.length), exp4);
  assert.ok(listasIguais(exp4, popularesMesmoOrcamento(ranking, vistos, exp4.length)));
});

test('popularesMesmoOrcamento falha alto se o ranking não tiver não vistos suficientes', () => {
  assert.throws(() => popularesMesmoOrcamento([1, 2, 3], new Set([1]), 3), /só 2/);
});

test('todosNaoVistos: catálogo inteiro menos os vistos, em ordem crescente de id', () => {
  assert.deepEqual(todosNaoVistos([5, 1, 3, 2, 4], new Set([2, 4])), [1, 3, 5]);
  assert.deepEqual(todosNaoVistos([{ id: 3 }, { id: 1 }, { id: 2 }], new Set([1])), [2, 3]);
  assert.deepEqual(todosNaoVistos([1, 2], new Set([1, 2])), []);
});

// ---- Pré-condições -----------------------------------------------------------------------

const configuracao = {
  negativos: 'candidatos', arquitetura: '64-32', k: 150, n: 0,
  modelo: 'candidatos-64-32', controle: 'candidatos-64-32-sempop',
  epocasPorSemente: { modelo: { 1: 11, 2: 15, 3: 15 }, controle: { 1: 15, 2: 15, 3: 16 } },
  seed_api: 1, sementeBootstrap: 2026,
};
const reguaFinal = { hash: 'rf', fase: 'final' };
const candidatosFinal = { hashRegua: 'rf', sha256: 'cf' };

function modelosValidos() {
  return modelosEsperados(configuracao).map(({ nome, papel, semente, semPop }) => ({
    nome, semente,
    metadados: {
      nome, fase: 'final', semPop, semente, hashRegua: 'rf', sha256Candidatos: 'cf',
      epocas: configuracao.epocasPorSemente[papel][String(semente)],
    },
  }));
}
const valido = () => ({
  configuracao, avaliacaoExiste: false, reguaFinal, hashBanco: 'rf', candidatosFinal, modelos: modelosValidos(),
});

test('modelosEsperados: modelo e controle × sementes 1–3', () => {
  const m = modelosEsperados(configuracao);
  assert.equal(m.length, 6);
  assert.deepEqual(m.map((x) => `${x.nome}-s${x.semente}`), [
    'candidatos-64-32-s1', 'candidatos-64-32-s2', 'candidatos-64-32-s3',
    'candidatos-64-32-sempop-s1', 'candidatos-64-32-sempop-s2', 'candidatos-64-32-sempop-s3',
  ]);
  assert.deepEqual(m.map((x) => x.semPop), [false, false, false, true, true, true]);
});

test('verificarPreCondicoes aceita o caso completo', () => {
  assert.doesNotThrow(() => verificarPreCondicoes(valido()));
});

test('recusa 1: sem configuracao-final.json', () => {
  assert.throws(() => verificarPreCondicoes({ ...valido(), configuracao: null }), /configuracao-final\.json.*npm run congelar/s);
});

test('recusa 2: avaliação final já existe', () => {
  assert.throws(() => verificarPreCondicoes({ ...valido(), avaliacaoExiste: true }), /avaliacao-final\.json já existe/);
});

test('recusa 3: sem artefatos/regua-final.json', () => {
  assert.throws(() => verificarPreCondicoes({ ...valido(), reguaFinal: null }), /regua-final\.json.*npm run carregar-filmes -- --fase final/s);
});

test('recusa 4: banco em outra régua (ou nunca carregado)', () => {
  assert.throws(() => verificarPreCondicoes({ ...valido(), hashBanco: 'outra' }), /banco.*outra régua.*npm run carregar-filmes -- --fase final/s);
  assert.throws(() => verificarPreCondicoes({ ...valido(), hashBanco: null }), /banco.*npm run carregar-filmes -- --fase final/s);
});

test('recusa 5: candidatos finais ausentes ou de outra régua', () => {
  assert.throws(() => verificarPreCondicoes({ ...valido(), candidatosFinal: null }), /candidatos-final\.json.*npm run gerar-candidatos -- --fase final/s);
  assert.throws(() => verificarPreCondicoes({ ...valido(), candidatosFinal: { hashRegua: 'exp', sha256: 'cf' } }),
    /outra régua.*npm run gerar-candidatos -- --fase final/s);
});

test('recusa 6: modelo final ausente, de outra régua ou com outros candidatos', () => {
  const ausente = valido();
  ausente.modelos[4].metadados = null;
  assert.throws(() => verificarPreCondicoes(ausente),
    /candidatos-64-32-sempop-final-s2.*ausente.*npm run treinar -- --fase final --negativos candidatos --arquitetura 64-32 --sem-pop --epocas-de resultados\/treino-candidatos-64-32-sempop-exp\.json/s);

  const faltaNaLista = valido();
  faltaNaLista.modelos = faltaNaLista.modelos.filter((m) => !(m.nome === 'candidatos-64-32' && m.semente === 1));
  assert.throws(() => verificarPreCondicoes(faltaNaLista), /candidatos-64-32-final-s1.*ausente/s);

  const outraRegua = valido();
  outraRegua.modelos[0].metadados.hashRegua = 'exp';
  assert.throws(() => verificarPreCondicoes(outraRegua), /candidatos-64-32-final-s1.*outra régua.*npm run treinar -- --fase final/s);

  const outraFase = valido();
  outraFase.modelos[1].metadados.fase = 'exp';
  assert.throws(() => verificarPreCondicoes(outraFase), /candidatos-64-32-final-s2.*fase exp/s);

  const outrosCandidatos = valido();
  outrosCandidatos.modelos[2].metadados.sha256Candidatos = 'velho';
  assert.throws(() => verificarPreCondicoes(outrosCandidatos), /candidatos-64-32-final-s3.*sha256Candidatos.*npm run treinar -- --fase final/s);
});

test('recusa 7: modelo final com épocas diferentes das congeladas', () => {
  const e = valido();
  e.modelos[5].metadados.epocas = 12;
  assert.throws(() => verificarPreCondicoes(e), /candidatos-64-32-sempop-final-s3.*12 épocas.*16.*npm run treinar -- --fase final/s);
});

test('recusa 7: épocas ausentes não passam em silêncio (undefined === undefined)', () => {
  const semEpocasNoModelo = valido();
  delete semEpocasNoModelo.modelos[0].metadados.epocas;
  assert.throws(() => verificarPreCondicoes(semEpocasNoModelo), /candidatos-64-32-final-s1.*undefined épocas/s);
  const semEpocasCongeladas = valido();
  semEpocasCongeladas.configuracao = { ...configuracao, epocasPorSemente: { modelo: { 1: 11, 2: 15 }, controle: configuracao.epocasPorSemente.controle } };
  delete semEpocasCongeladas.modelos[2].metadados.epocas;
  assert.throws(() => verificarPreCondicoes(semEpocasCongeladas), /sem épocas válidas para modelo semente 3.*npm run congelar/s);
});

test('as recusas seguem a ordem: configuração antes de tudo', () => {
  const tudoErrado = { configuracao: null, avaliacaoExiste: true, reguaFinal: null, hashBanco: null, candidatosFinal: null, modelos: [] };
  assert.throws(() => verificarPreCondicoes(tudoErrado), /configuracao-final\.json/);
  assert.throws(() => verificarPreCondicoes({ ...tudoErrado, configuracao }), /avaliacao-final\.json já existe/);
});

// ---- Regra de N = 0 e candidatos -----------------------------------------------------------

test('regraNZero: com N = 0 o Exp. 2 usa N = 100 e a regra fica registrada; com N > 0, usa o próprio N', () => {
  assert.deepEqual(regraNZero(0), { aplicada: true, nRecallExp2: 100, contribuicaoVetorialPorConstrucao: true, exp5IdenticoAoExp4: true });
  assert.deepEqual(regraNZero(50), { aplicada: false, nRecallExp2: 50, contribuicaoVetorialPorConstrucao: false, exp5IdenticoAoExp4: false });
});

test('recallDosCandidatos: média por usuário de |lista ∩ R| / |R|', () => {
  const listas = new Map([[1, [1, 2, 3]], [2, [9]]]);
  const relevantes = new Map([[1, new Set([2, 3, 4, 5])], [2, new Set([7])]]);
  const r = recallDosCandidatos(listas, relevantes);
  assert.ok(perto(r.media, (0.5 + 0) / 2));
  assert.equal(r.porUsuario.get(1), 0.5);
  assert.throws(() => recallDosCandidatos(new Map(), relevantes), /usuário 1/);
});

test('contribuições das fontes com N = 0: vetorial é zero por construção, populares é 1', () => {
  const ranking = Array.from({ length: 20 }, (_, i) => i + 1);
  const relevantes = new Map([[1, new Set([2, 3, 18])], [2, new Set([1])]]);
  const listas = new Map([
    [1, candidatosDe({ populares: popularesNaoVistos(ranking, new Set(), 20), vizinhos: [] }, 5, 0)],
    [2, candidatosDe({ populares: popularesNaoVistos(ranking, new Set([1]), 20), vizinhos: [] }, 5, 0)],
  ]);
  const c = contribuicoesDasFontes(acertosComFonte(listas, relevantes));
  assert.deepEqual(c, { vet: 0, pop: 1, ambas: 0, acertos: 2 });
});

test('contribuições das fontes com N > 0: razão agregada por fonte', () => {
  const listas = new Map([[1, candidatosDe({ populares: [1, 2, 3], vizinhos: [3, 7, 8] }, 3, 3)]]);
  const relevantes = new Map([[1, new Set([1, 3, 7, 99])]]); // acertos: 1 (pop), 3 (ambas), 7 (vet)
  const c = contribuicoesDasFontes(acertosComFonte(listas, relevantes));
  assert.ok(perto(c.vet, 1 / 3) && perto(c.pop, 1 / 3) && perto(c.ambas, 1 / 3));
  assert.equal(c.acertos, 3);
});

test('top10DoSubconjunto ordena só os ids pedidos e falha se faltar score', () => {
  const scores = new Map(Array.from({ length: 15 }, (_, i) => [i + 1, (i + 1) / 100]));
  assert.deepEqual(top10DoSubconjunto(scores, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.throws(() => top10DoSubconjunto(scores, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]), /99/);
});

test('listasIguais compara posição a posição', () => {
  assert.ok(listasIguais([1, 2], [1, 2]));
  assert.ok(!listasIguais([1, 2], [2, 1]));
  assert.ok(!listasIguais([1], [1, 2]));
});

// ---- Montagem das métricas ---------------------------------------------------------------

// Resultado sintético no formato de avaliarSistema.
const resultado = (por, cobertura, pop) => {
  const m = new Map(Object.entries(por).map(([u, v]) => [Number(u), v]));
  const med = (c) => [...m.values()].reduce((s, v) => s + v[c], 0) / m.size;
  return { ndcg: med('ndcg'), precisao: med('precisao'), recall: med('recall'), cobertura, popularidadeMediaContagem: pop, nUsuarios: m.size, porUsuario: m };
};
const r1 = resultado({ 1: { ndcg: 0.2, precisao: 0.1, recall: 0.1 }, 2: { ndcg: 0.4, precisao: 0.3, recall: 0.5 } }, 0.1, 300);
const r2 = resultado({ 1: { ndcg: 0.4, precisao: 0.2, recall: 0.3 }, 2: { ndcg: 0.6, precisao: 0.3, recall: 0.5 } }, 0.2, 200);
const r3 = resultado({ 1: { ndcg: 0.0, precisao: 0.0, recall: 0.1 }, 2: { ndcg: 0.2, precisao: 0.3, recall: 0.2 } }, 0.3, 100);

test('resumirSemRede copia as médias e o porUsuario', () => {
  const s = resumirSemRede(r1);
  assert.equal(s.ndcg, r1.ndcg);
  assert.equal(s.cobertura, 0.1);
  assert.equal(s.nUsuarios, 2);
  assert.equal(s.porUsuario.get(2).ndcg, 0.4);
});

test('resumirComRede: média por usuário das sementes, por semente, mínimo/máximo, cobertura e popularidade médias', () => {
  const s = resumirComRede([{ semente: 1, resultado: r1 }, { semente: 2, resultado: r2 }, { semente: 3, resultado: r3 }]);
  assert.ok(perto(s.porUsuario.get(1).ndcg, 0.2));
  assert.ok(perto(s.porUsuario.get(2).ndcg, 0.4));
  assert.ok(perto(s.ndcg, 0.3));
  assert.deepEqual(s.porSemente.map((x) => x.semente), [1, 2, 3]);
  assert.ok(perto(s.porSemente[1].ndcg, 0.5));
  assert.ok(perto(s.minMax.ndcg[0], 0.1) && perto(s.minMax.ndcg[1], 0.5));
  assert.ok(perto(s.cobertura.media, 0.2));
  assert.ok(perto(s.popularidadeMediaContagem.media, 200));
  assert.equal(s.nUsuarios, 2);
});

test('resumirComRede recusa sementes com usuários diferentes', () => {
  const outro = resultado({ 1: { ndcg: 0, precisao: 0, recall: 0 } }, 0, 0);
  assert.throws(() => resumirComRede([{ semente: 1, resultado: r1 }, { semente: 2, resultado: outro }]), /usuários/);
});

test('diferencaDescritiva: média de A − B nos usuários de A', () => {
  const a = new Map([[1, { ndcg: 0.5, precisao: 0.2, recall: 0.1 }]]);
  const b = r1.porUsuario;
  const d = diferencaDescritiva(a, b);
  assert.ok(perto(d.ndcg, 0.3) && perto(d.precisao, 0.1) && perto(d.recall, 0));
  assert.equal(d.nUsuarios, 1);
  assert.throws(() => diferencaDescritiva(new Map([[9, { ndcg: 0, precisao: 0, recall: 0 }]]), b), /usuário 9/);
});

test('hipotesePrincipal: bootstrap pareado de Exp. 4 − Exp. 1; suportada só se o IC exclui zero por cima', () => {
  const exp1 = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, 0.2]));
  const melhor = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, 0.3 + (i % 5) / 100]));
  const h = hipotesePrincipal(melhor, exp1, { reamostragens: 500, semente: 2026 });
  assert.ok(h.ic95[0] > 0 && h.suportada);
  assert.ok(perto(h.media, 0.12));
  const misto = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, i % 2 ? 0.3 : 0.1]));
  const h2 = hipotesePrincipal(misto, exp1, { reamostragens: 500, semente: 2026 });
  assert.ok(h2.ic95[0] <= 0 && !h2.suportada);
  assert.throws(() => hipotesePrincipal(new Map([[99, 1]]), exp1, { reamostragens: 10, semente: 1 }), /usuário 99/);
});

test('valoresMainstream: média da popularidade dos curtidos; sem curtidas fica fora e é contado', () => {
  const curtidos = new Map([[1, [10, 20]], [2, []], [3, [30]]]);
  const pop = { 10: 0.2, 20: 0.6, 30: 0.9 };
  const { valores, semCurtidas } = valoresMainstream([1, 2, 3, 4], curtidos, (id) => pop[id]);
  assert.deepEqual([...valores], [[1, 0.4], [3, 0.9]]);
  assert.equal(semCurtidas, 2); // o 2 (lista vazia) e o 4 (sem histórico)
});

test('mediana e metricasPorGrupo', () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
  const grupos = new Map([[1, 'nicho'], [2, 'mainstream']]);
  const g = metricasPorGrupo(r1.porUsuario, grupos);
  assert.deepEqual(g.nicho, { n: 1, ndcg: 0.2, precisao: 0.1, recall: 0.1 });
  assert.deepEqual(g.mainstream, { n: 1, ndcg: 0.4, precisao: 0.3, recall: 0.5 });
  // usuário do grupo ausente no experimento (Exp. 2 sem curtidas) é ignorado; grupo vazio vira null
  const g2 = metricasPorGrupo(new Map([[2, { ndcg: 1, precisao: 1, recall: 1 }]]), grupos);
  assert.equal(g2.nicho, null);
});

// ---- Ordem no script 13 (leitura estática do código, sem executá-lo) ------------------------

test('script 13: o u1.test só é lido depois de verificarPreCondicoes, num único ponto', async () => {
  const fs = await import('node:fs');
  const codigo = fs.readFileSync(new URL('../../scripts/13-avaliacao-final.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const leituras = [...codigo.matchAll(/incluirTeste:\s*true/g)];
  assert.equal(leituras.length, 1);
  const leitura = leituras[0].index;
  const chamada = codigo.indexOf('verificarPreCondicoes({');
  assert.ok(chamada > 0 && chamada < leitura);
  // Tudo o que não depende do teste vem antes da leitura: modelos, scores e todos os top 10.
  for (const trecho of ['lerCandidatos(', 'carregarModelo(', 'pontuarCandidatos(', 'await pontuarSemente(', 'top10DoSubconjunto(',
    'popularesMesmoOrcamento(', 'todosNaoVistos(']) {
    const i = codigo.indexOf(trecho);
    assert.ok(i > 0 && i < leitura, `${trecho} deveria aparecer antes de incluirTeste: true`);
    assert.equal(codigo.indexOf(trecho, leitura), -1, `${trecho} não deveria aparecer depois de incluirTeste: true`);
  }
  assert.ok(!/u1\.test['"]/.test(codigo)); // nenhum caminho direto para o arquivo
});
