// Tarefa 8, camada (a) da spec 10.5: o pipeline s1.js com a busca injetada em memória é idêntico a uma
// referência independente escrita aqui (rankingReferencia → 150 → 10, mais populares sem `excluir`).
import '../apoio/dados-exigidos.js';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { construirFC, hashVetoresFC, perfilFC, rankingReferencia, vetorDeBusca } from '../../../src/fc/referencia.js';
import { rankingPopularidade } from '../../../src/candidatos/populares.js';
import { carregarContextoV2Final } from '../../preparar/contexto.js';
import { calcularOcultos, carregarGemeosManuais, detectarGemeos } from '../../comum/gemeos.js';
import { HASHES } from '../../integridade.js';
import { recomendar } from '../../servidor/recomendacao/s1.js';
import { curtidosDe, gerarPerfis, N_PERFIS } from './perfis-sinteticos.js';

const dirDados = process.env.ML100K_DIR;
const REF_M = 300; // escritos aqui de propósito, sem importar as constantes do s1.js
const REF_NFC = 150;
const REF_K = 10;

describe('equivalência S1 × referência (camada a)', { skip: !dirDados && 'ML100K_DIR não definido', timeout: 300_000 }, () => {
  let ctx, fc, OCULTOS, POPULARES, perfis;
  before(() => {
    ctx = carregarContextoV2Final(dirDados);
    fc = construirFC(ctx.treino, 943);
    const pares = [...detectarGemeos(ctx.dataset.filmes), ...carregarGemeosManuais()];
    OCULTOS = calcularOcultos(pares);
    POPULARES = rankingPopularidade(ctx.regua.contagens);
    perfis = gerarPerfis({ fc, nFilmes: ctx.dataset.filmes.length, pares, ocultos: OCULTOS });
  });

  // Referência independente: só usa funções da pesquisa e as regras da spec 4.4, escritas de novo.
  function referencia(interacoes) {
    const excluir = new Set([...interacoes.map((i) => i.filmeId), ...OCULTOS]);
    const curtidos = curtidosDe(interacoes);
    let s1 = [];
    let semS1;
    if (curtidos.length === 0) semS1 = 'sem_curtidas';
    else {
      const perfil = perfilFC(fc, curtidos);
      if (perfil === null) semS1 = 'curtidas_sem_vetor';
      else {
        semS1 = 'sem_semelhantes';
        const h = rankingReferencia(fc, perfil, excluir, REF_M);
        s1 = h.slice(0, REF_NFC).slice(0, REF_K).map(({ id, escore }) => ({ id, fonte: 'S1', escore }));
      }
    }
    const itens = [...s1];
    const naLista = new Set(s1.map((x) => x.id));
    for (const id of POPULARES) {
      if (itens.length >= REF_K) break;
      if (excluir.has(id) || naLista.has(id)) continue;
      itens.push({ id, fonte: 'populares', escore: null });
      naLista.add(id);
    }
    const motivo = s1.length === REF_K ? 'personalizado' : s1.length > 0 ? 'parcial' : semS1;
    return { motivo, itens };
  }

  it('o fc de construirFC tem o hash congelado dos vetores', () => {
    assert.equal(hashVetoresFC(fc), HASHES.vetoresFC);
  });

  it(`${N_PERFIS} perfis: ids, escores, fonte e motivo idênticos; S1 com 1 ou 2 explicações`, async (t) => {
    assert.equal(perfis.length, N_PERFIS);
    const motivos = new Set();
    for (const { nome, interacoes } of perfis) {
      const curtidos = curtidosDe(interacoes);
      const perfilEsperado = curtidos.length > 0 ? perfilFC(fc, curtidos) : null;
      const excluirEsperado = [...new Set([...interacoes.map((i) => i.filmeId), ...OCULTOS])].sort((a, b) => a - b);
      const chamadas = [];
      // busca injetada: rankingReferencia em memória sobre o mesmo perfil (spec 10.5 a); confere
      // que o s1.js montou exatamente o vetor, o excluir, o m e o modo da referência
      const buscar = async (vetor, excluirOrdenado, m, modo) => {
        chamadas.push({ m, modo });
        assert.ok(perfilEsperado !== null, `${nome}: busca sem perfil`);
        assert.deepStrictEqual(vetor, vetorDeBusca(perfilEsperado), `${nome}: vetor`);
        assert.deepStrictEqual(excluirOrdenado, excluirEsperado, `${nome}: excluir`);
        assert.equal(m, REF_M, `${nome}: m`);
        assert.equal(modo, 'hnsw', `${nome}: modo`);
        const lista = rankingReferencia(fc, perfilFC(fc, curtidos), new Set(excluirOrdenado), m)
          .map(({ id, escore }) => ({ id, escore }));
        return { lista, linhasPedidas: null, empateNaoResolvido: false };
      };
      const r = await recomendar({ interacoes, fc, ocultos: OCULTOS, rankingPopulares: POPULARES, buscar });
      const esperado = referencia(interacoes);
      assert.deepStrictEqual(
        { motivo: r.motivo, itens: r.itens.map(({ id, fonte, escore }) => ({ id, fonte, escore })) },
        esperado,
        nome,
      );
      assert.equal(chamadas.length, perfilEsperado === null ? 0 : 1, `${nome}: número de buscas`);
      for (const x of r.itens) {
        if (x.fonte === 'S1') assert.ok(x.porque.length >= 1 && x.porque.length <= 2, `${nome}: ${x.id}`);
        else assert.deepEqual(x.porque, [], `${nome}: ${x.id}`);
      }
      motivos.add(r.motivo);
    }
    // os casos da spec 10.5 (a) cobrem os cinco motivos
    assert.deepEqual([...motivos].sort(), ['curtidas_sem_vetor', 'parcial', 'personalizado', 'sem_curtidas', 'sem_semelhantes']);
    t.diagnostic(`motivos cobertos: ${[...motivos].sort().join(', ')}`);
  });

  it('gêmeos: nenhum oculto aparece', async () => {
    const p = perfis.find((x) => x.nome === 'gêmeos');
    const buscar = async (v, e, m) => ({
      lista: rankingReferencia(fc, perfilFC(fc, curtidosDe(p.interacoes)), new Set(e), m).map(({ id, escore }) => ({ id, escore })),
      linhasPedidas: null, empateNaoResolvido: false,
    });
    const r = await recomendar({ interacoes: p.interacoes, fc, ocultos: OCULTOS, rankingPopulares: POPULARES, buscar });
    assert.ok(p.interacoes.length > 0);
    // o caso não é vazio: sem a exclusão dos OCULTOS, ao menos um deles entraria no top 10
    const semOcultos = rankingReferencia(
      fc, perfilFC(fc, curtidosDe(p.interacoes)), new Set(p.interacoes.map((i) => i.filmeId)), REF_M,
    ).slice(0, REF_K).map((x) => x.id);
    const ocultosNoTop = semOcultos.filter((id) => OCULTOS.has(id));
    assert.ok(ocultosNoTop.length > 0, `nenhum oculto no top 10 sem exclusão: ${semOcultos.join(', ')}`);
    for (const x of r.itens) assert.ok(!OCULTOS.has(x.id), String(x.id));
  });
});
