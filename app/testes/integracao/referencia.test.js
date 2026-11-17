// Tarefa 6: tabelas de referencia (spec 4.2 passo 6, 5.1, 5.3). Banco `app_teste`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { N_FC, N_FILMES } from '../../integridade.js';
import { carregarContextoV2Final } from '../../preparar/contexto.js';
import { aplicarMigracoes } from '../../preparar/papeis.js';
import { preencherReferencia } from '../../preparar/referencia.js';
import { rodarScript16 } from '../../preparar/script16.js';
import { copiarArquivosML, garantirBancoTeste } from './apoio.js';

describe('tabelas de referencia', { timeout: 600_000 }, () => {
  let cfg, pool, tmp, ctx, resumo;

  async function rodarCom(c2, { commit = true } = {}) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await preencherReferencia(c, c2);
      await c.query(commit ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  const rodar = () => rodarCom(ctx);
  const q = async (sql, p) => (await pool.query(sql, p)).rows;

  before(async () => {
    cfg = await garantirBancoTeste();
    pool = new pg.Pool({ ...cfg, max: 3 });
    assert.equal((await q('SELECT current_database() AS db'))[0].db, 'app_teste');
    await pool.query('DROP SCHEMA IF EXISTS v2_final CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'referencia-'));
    const dirDados = copiarArquivosML(path.join(tmp, 'ml-100k'));
    await rodarScript16({ pg: cfg, dirDados: tmp, dirTrabalho: path.join(tmp, 'trabalho') });
    await aplicarMigracoes(pool);
    ctx = carregarContextoV2Final(dirDados);
    resumo = await rodar();
    console.log('resumo:', JSON.stringify(resumo));
  });
  after(async () => {
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('1682 filmes e 1682 estatisticas', async () => {
    assert.equal((await q('SELECT count(*)::int n FROM app.filme'))[0].n, N_FILMES);
    assert.equal((await q('SELECT count(*)::int n FROM app.estatistica_historica'))[0].n, N_FILMES);
    assert.deepEqual(resumo, { nFilmes: N_FILMES, nFc: N_FC, nGemeos: 38 });
  });

  it('SUM(n_notas) = ctx.treino.length', async () => {
    const r = (await q('SELECT sum(n_notas)::int s FROM app.estatistica_historica'))[0].s;
    console.log('SUM(n_notas):', r);
    assert.equal(r, ctx.treino.length);
  });

  it('ordem de populares = rankingPopularidade(regua.contagens)', async () => {
    const ids = (await q('SELECT filme_id FROM app.estatistica_historica ORDER BY n_notas DESC, filme_id'))
      .map((r) => r.filme_id);
    // o teste nao importa da raiz: reimplementa a regra de rankingPopularidade (n_notas desc, id asc)
    const c = ctx.regua.contagens;
    const esperado = Object.keys(c).map(Number).sort((x, y) => c[y] - c[x] || x - y);
    assert.deepEqual(ids, esperado);
  });

  it('somas conferem com o treino', async () => {
    const soma = new Map();
    const apr = new Map();
    for (const a of ctx.treino) {
      soma.set(a.filme, (soma.get(a.filme) ?? 0) + a.nota);
      if (a.nota >= 4) apr.set(a.filme, (apr.get(a.filme) ?? 0) + 1);
    }
    for (const r of await q('SELECT * FROM app.estatistica_historica')) {
      assert.equal(r.n_notas, ctx.regua.contagens[r.filme_id]);
      assert.equal(r.soma_notas, soma.get(r.filme_id) ?? 0);
      assert.equal(r.n_aprovacao, apr.get(r.filme_id) ?? 0);
    }
  });

  it('filmes de 0 notas estao presentes', async () => {
    const r = await q('SELECT count(*)::int n FROM app.estatistica_historica WHERE n_notas = 0');
    const esperado = Object.values(ctx.regua.contagens).filter((n) => n === 0).length;
    console.log('filmes de 0 notas:', r[0].n);
    assert.ok(esperado > 0);
    assert.equal(r[0].n, esperado);
  });

  it('tem_vetor em exatamente 1385, os mesmos de filmes_fc', async () => {
    assert.equal((await q('SELECT count(*)::int n FROM app.filme WHERE tem_vetor'))[0].n, N_FC);
    const dif = await q(`SELECT f.id FROM app.filme f
      WHERE f.tem_vetor <> EXISTS (SELECT 1 FROM v2_final.filmes_fc v WHERE v.id = f.id)`);
    assert.equal(dif.length, 0);
  });

  it('visivel = false exatamente nos 20 ocultos', async () => {
    const ocultos = (await q('SELECT id FROM app.filme WHERE NOT visivel ORDER BY id')).map((r) => r.id);
    console.log('ocultos:', ocultos.length, JSON.stringify(ocultos));
    assert.equal(ocultos.length, 20);
    assert.ok(ocultos.includes(267) && ocultos.includes(1504));
  });

  it('generos sem unknown e titulos preenchidos', async () => {
    const rows = await q('SELECT * FROM app.filme');
    const todos = new Set(rows.flatMap((r) => r.generos));
    assert.ok(!todos.has('unknown'));
    assert.ok(todos.has('Action') && todos.has('Drama'));
    const f1 = rows.find((r) => r.id === 1);
    assert.equal(f1.titulo_original, 'Toy Story (1995)');
    assert.equal(f1.titulo_exibicao, 'Toy Story');
    assert.equal(f1.ano, 1995);
    assert.ok(f1.generos.includes('Animation'));
    assert.equal(rows.find((r) => r.id === 267).ano, null);
  });

  it('gemeos simetricos (38 linhas)', async () => {
    const rows = await q('SELECT filme_id, gemeo_id, evidencia FROM app.filme_gemeo');
    assert.equal(rows.length, 38);
    const chaves = new Set(rows.map((r) => `${r.filme_id}-${r.gemeo_id}`));
    for (const r of rows) assert.ok(chaves.has(`${r.gemeo_id}-${r.filme_id}`));
    assert.ok(chaves.has('1202-1504'));
    assert.equal(rows.filter((r) => r.evidencia === 'titulo_identico').length, 36);
  });

  it('idempotente', async () => {
    const snap = async () => ({
      f: await q('SELECT * FROM app.filme ORDER BY id'),
      e: await q('SELECT * FROM app.estatistica_historica ORDER BY filme_id'),
      g: await q('SELECT * FROM app.filme_gemeo ORDER BY filme_id, gemeo_id'),
    });
    const a = await snap();
    await rodar();
    assert.deepEqual(await snap(), a);
  });

  it('nao toca dados de usuarios', async () => {
    const [{ id }] = await q(`INSERT INTO app.perfil (nome) VALUES ('Teste Ref') RETURNING id`);
    await pool.query(
      `INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES
        ($1, 1, 'nota', 5), ($1, 2, 'nota', 3), ($1, 50, 'gostei', NULL),
        ($1, 100, 'quero_assistir', NULL), ($1, 181, 'nota', 4)`, [id]);
    const snap = async () => ({
      p: await q('SELECT * FROM app.perfil ORDER BY id'),
      i: await q('SELECT * FROM app.interacao ORDER BY perfil_id, filme_id'),
    });
    const a = await snap();
    assert.equal(a.i.length, 5);
    await rodar();
    assert.deepEqual(await snap(), a);
  });

  it('id fora do dataset em app.filme falha sem alterar nada', async () => {
    await pool.query(`INSERT INTO app.filme VALUES (9999, 'x', 'x', NULL, '{}', false, true, 'x')`);
    try {
      const antes = await q('SELECT * FROM app.filme ORDER BY id');
      await assert.rejects(rodar(), /9999/);
      assert.deepEqual(await q('SELECT * FROM app.filme ORDER BY id'), antes);
    } finally {
      await pool.query('DELETE FROM app.filme WHERE id = 9999');
    }
  });

  it('recusa ctx com alvos', async () => {
    await assert.rejects(rodarCom({ ...ctx, alvos: [] }), /alvos/);
  });
});
