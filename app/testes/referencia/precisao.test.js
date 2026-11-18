// Tarefa 8, camada (b) da spec 10.5: os 30 perfis contra o banco em modo exato, pelas regras de
// conferirExataUsuario (τ = 1e-5), e as invariantes da busca HNSW. Banco próprio `app_teste_s1`.
// Divergência além de τ é falha: este teste nunca é ajustado para aceitá-la.
// Ruling 14: um gancho de carregamento troca o TensorFlow, alcançado por fidelidade.js → … →
// src/modelo/rede.js, por um módulo vazio. fidelidade.js só é importado depois do gancho.
import { register } from 'node:module';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {
  construirFC, escoreOficial, hashVetoresFC, perfilFC, rankingReferencia, vetorDeBusca,
} from '../../../src/fc/referencia.js';
import { rankingPopularidade } from '../../../src/candidatos/populares.js';
import { prepararTudo } from '../../preparar/preparar.js';
import { carregarContextoV2Final } from '../../preparar/contexto.js';
import { calcularOcultos, carregarGemeosManuais, detectarGemeos } from '../../comum/gemeos.js';
import { HASHES } from '../../integridade.js';
import { criarBuscarBanco, K, recomendar } from '../../servidor/recomendacao/s1.js';
import { copiarArquivosML, recriarBancoTeste } from '../integracao/apoio.js';
import { curtidosDe, gerarPerfis, N_PERFIS } from './perfis-sinteticos.js';

register(new URL('./ganchos-sem-tf.js', import.meta.url));
const { conferirExataUsuario, TAU } = await import('../../../src/avaliacao/fidelidade.js');

const semDados = !process.env.ML100K_DIR;

it('o TensorFlow real não é carregado: o gancho o substituiu pelo módulo vazio', () => {
  assert.equal(globalThis.__tfSubstituido, true);
});
const BANCO = 'app_teste_s1';
const M_TESTE = 300;
const TOL_ESCORE = 1e-6 + 1e-12;

describe('precisão S1 × banco em modo exato (camada b)', { skip: semDados && 'ML100K_DIR não definido', timeout: 900_000 }, () => {
  let tmp, pool, ctx, fc, OCULTOS, POPULARES, perfis, buscar;
  const alvoAntes = process.env.PREPARAR_ALVO_APP;

  before(async () => {
    delete process.env.PREPARAR_ALVO_APP;
    const cfg = await recriarBancoTeste(BANCO);
    tmp = mkdtempSync(path.join(os.tmpdir(), 'precisao-s1-'));
    const dirDados = path.join(tmp, 'dados');
    copiarArquivosML(path.join(dirDados, 'ml-100k'));
    await prepararTudo({
      pg: cfg, dirDados, dirTrabalho: path.join(tmp, 'trabalho'), dirEstado: path.join(tmp, 'estado'),
      versaoApp: '0.1.0', porta: 3000, log: () => {},
    });
    // superusuário no banco de teste; a busca exige search_path=v2_final,public
    pool = new pg.Pool({ ...cfg, max: 2, options: '-c search_path=v2_final,public' });
    assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, BANCO);
    ctx = carregarContextoV2Final(path.join(dirDados, 'ml-100k'));
    fc = construirFC(ctx.treino, 943);
    const pares = [...detectarGemeos(ctx.dataset.filmes), ...carregarGemeosManuais()];
    OCULTOS = calcularOcultos(pares);
    POPULARES = rankingPopularidade(ctx.regua.contagens);
    perfis = gerarPerfis({ fc, nFilmes: ctx.dataset.filmes.length, pares, ocultos: OCULTOS });
    buscar = criarBuscarBanco(pool);
  });
  after(async () => {
    if (alvoAntes === undefined) delete process.env.PREPARAR_ALVO_APP;
    else process.env.PREPARAR_ALVO_APP = alvoAntes;
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('o fc de construirFC tem o hash congelado dos vetores', () => {
    assert.equal(hashVetoresFC(fc), HASHES.vetoresFC);
  });

  it(`${N_PERFIS} perfis: busca exata = referência (τ = ${TAU}) e escores dentro de 1e-6 + 1e-12`, async (t) => {
    assert.equal(perfis.length, N_PERFIS);
    let divergencias = 0;
    let conferidos = 0;
    for (const { nome, interacoes } of perfis) {
      const perfil = perfilFC(fc, curtidosDe(interacoes));
      if (perfil === null) continue; // sem perfil não há busca
      const excluir = new Set([...interacoes.map((i) => i.filmeId), ...OCULTOS]);
      const excluirOrdenado = [...excluir].sort((a, b) => a - b);
      const exata = await buscar(vetorDeBusca(perfil), excluirOrdenado, M_TESTE, 'exata');
      const referencia = rankingReferencia(fc, perfil, excluir, M_TESTE);
      const r = conferirExataUsuario({ fc, perfil, referencia, exata: exata.lista.map((x) => x.id), m: M_TESTE });
      assert.equal(r.ok, true, `${nome}: ${r.erros.join('; ')}`);
      divergencias += r.divergenciasPrecisao;
      conferidos++;
      const ref = new Map(referencia.map((x) => [x.id, x.escore64]));
      for (const { id, escore } of exata.lista) {
        assert.ok(!excluir.has(id), `${nome}: ${id} excluído`);
        if (!ref.has(id)) continue;
        const d = Math.abs(escore - escoreOficial(ref.get(id)));
        assert.ok(d <= TOL_ESCORE, `${nome}: filme ${id} |Δescore| = ${d}`);
      }
    }
    assert.ok(conferidos > 0);
    t.diagnostic(`perfis conferidos: ${conferidos}; divergências de precisão aceitas: ${divergencias}`);
  });

  it('HNSW (modo padrão): no máximo K, sem excluir, escores S1 decrescentes e > 0, fonte e motivo coerentes', async () => {
    for (const { nome, interacoes } of perfis) {
      const modos = [];
      const espiao = (v, e, m, modo) => {
        modos.push(modo);
        return buscar(v, e, m, modo);
      };
      const r = await recomendar({ interacoes, fc, ocultos: OCULTOS, rankingPopulares: POPULARES, buscar: espiao });
      const excluir = new Set([...interacoes.map((i) => i.filmeId), ...OCULTOS]);
      assert.ok(r.itens.length <= K, nome);
      assert.equal(r.itens.length, K, nome); // os populares sempre completam a lista
      assert.ok(modos.every((m) => m === 'hnsw'), nome);
      const ids = r.itens.map((x) => x.id);
      assert.equal(new Set(ids).size, ids.length, `${nome}: repetidos`);
      for (const id of ids) assert.ok(!excluir.has(id), `${nome}: ${id} em excluir`);
      const s1 = r.itens.filter((x) => x.fonte === 'S1');
      assert.deepEqual(r.itens.slice(0, s1.length), s1, `${nome}: S1 antes dos populares`);
      for (let i = 0; i < s1.length; i++) {
        assert.ok(s1[i].escore > 0, nome);
        if (i > 0) assert.ok(s1[i].escore <= s1[i - 1].escore, nome);
        assert.ok(s1[i].porque.length >= 1 && s1[i].porque.length <= 2, nome);
      }
      for (const x of r.itens.slice(s1.length)) {
        assert.equal(x.fonte, 'populares', nome);
        assert.equal(x.escore, null, nome);
      }
      const esperado = s1.length === K ? 'personalizado' : s1.length > 0 ? 'parcial' : null;
      if (esperado) assert.equal(r.motivo, esperado, nome);
      else assert.ok(['sem_semelhantes', 'sem_curtidas', 'curtidas_sem_vetor'].includes(r.motivo), nome);
      if (curtidosDe(interacoes).length === 0) assert.equal(r.motivo, 'sem_curtidas', nome);
    }
  });
});
