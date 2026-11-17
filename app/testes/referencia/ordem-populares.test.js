// Tarefa 6: a ordem de populares gravada no banco e a de rankingPopularidade real (camada de referencia).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { carregarContextoV2Final } from '../../preparar/contexto.js';
import { aplicarMigracoes } from '../../preparar/papeis.js';
import { preencherReferencia } from '../../preparar/referencia.js';
import { rodarScript16 } from '../../preparar/script16.js';
import { rankingPopularidade } from '../../../src/candidatos/populares.js';
import { copiarArquivosML, garantirBancoTeste } from '../integracao/apoio.js';

describe('ordem de populares no banco', { timeout: 600_000 }, () => {
  let pool, tmp, ctx;
  before(async () => {
    const cfg = await garantirBancoTeste();
    pool = new pg.Pool({ ...cfg, max: 2 });
    assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, 'app_teste');
    await pool.query('DROP SCHEMA IF EXISTS v2_final CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'ordem-pop-'));
    const dirDados = copiarArquivosML(path.join(tmp, 'ml-100k'));
    await rodarScript16({ pg: cfg, dirDados: tmp, dirTrabalho: path.join(tmp, 'trabalho') });
    await aplicarMigracoes(pool);
    ctx = carregarContextoV2Final(dirDados);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await preencherReferencia(c, ctx);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
  after(async () => {
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('n_notas decrescente, depois id = rankingPopularidade(regua.contagens)', async () => {
    const ids = (await pool.query(
      'SELECT filme_id FROM app.estatistica_historica ORDER BY n_notas DESC, filme_id')).rows.map((r) => r.filme_id);
    assert.deepEqual(ids, rankingPopularidade(ctx.regua.contagens));
  });
});
