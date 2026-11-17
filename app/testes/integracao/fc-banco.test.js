// Tarefa 5: fc reconstruido do banco e conferencia dos vetores (spec 4.2 passos 3 e 4, 4.3 vigia).
// Roda o script 16 congelado num subprocesso contra `app_teste`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { HASHES, N_FC } from '../../integridade.js';
import { carregarFcDoBanco, conferirVetores, impressaoDigital } from '../../comum/fc-banco.js';
import { rodarScript16 } from '../../preparar/script16.js';
import { copiarArquivosML, garantirBancoTeste } from './apoio.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function retratoGit() {
  return spawnSync('git', ['status', '--porcelain'], { cwd: RAIZ, encoding: 'utf8' }).stdout;
}

describe('fc do banco e conferencia dos vetores', { timeout: 600_000 }, () => {
  let cfg, pool, tmp, dirDados, dirTrabalho, antes, ms;

  before(async () => {
    cfg = await garantirBancoTeste();
    pool = new pg.Pool({ ...cfg, max: 2 });
    const { rows } = await pool.query('SELECT current_database() AS db');
    assert.equal(rows[0].db, 'app_teste', 'recusa apagar schemas fora do banco app_teste');
    await pool.query('DROP SCHEMA IF EXISTS v2_final CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fc-banco-'));
    dirDados = tmp;
    copiarArquivosML(path.join(tmp, 'ml-100k'));
    dirTrabalho = path.join(tmp, 'trabalho');
    antes = retratoGit();
    const t0 = Date.now();
    await rodarScript16({ pg: cfg, dirDados, dirTrabalho });
    ms = Date.now() - t0;
    console.log(`script 16: ${ms} ms`);
  });
  after(async () => {
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('script 16 grava os hashes congelados', async () => {
    const { rows } = await pool.query('SELECT chave, valor FROM v2_final.metadados');
    const m = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    console.log('hashes no banco:', JSON.stringify(m));
    assert.equal(m.hash_regua, HASHES.regua);
    assert.equal(m.hash_treino, HASHES.treino);
  });

  it('script 16 nao escreve na arvore', () => {
    assert.equal(retratoGit(), antes);
    assert.ok(existsSync(path.join(dirTrabalho, 'artefatos', 'regua-v2-final.json')));
  });

  it('fc reconstruido confere', async () => {
    const r = conferirVetores(await carregarFcDoBanco(pool));
    assert.deepEqual(r, { ok: true });
  });

  it('valor adulterado e detectado', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(
        `SELECT id, embedding::real[] AS v FROM v2_final.filmes_fc
          WHERE id = (SELECT min(id) FROM v2_final.filmes_fc)`);
      const { id, v } = rows[0];
      const i = v.findIndex((x) => x !== 0) + 1; // posicao SQL (1-based) de um componente nao nulo
      const novo = v.map((x, k) => (k === i - 1 ? x * 1.01 : x));
      await c.query('UPDATE v2_final.filmes_fc SET embedding = $1::vector WHERE id = $2',
        [JSON.stringify(novo), id]);
      const r = conferirVetores(await carregarFcDoBanco(c));
      assert.equal(r.ok, false);
      assert.equal(r.causa, 'valores dos vetores');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    assert.deepEqual(conferirVetores(await carregarFcDoBanco(pool)), { ok: true });
  });

  it('conferirVetores recusa contagem e suporte errados', async () => {
    const base = await carregarFcDoBanco(pool);
    assert.equal(conferirVetores({ ...base, linhas: base.linhas - 1 }).causa, 'vetores: contagem');
    assert.equal(conferirVetores({ ...base, dim: 942 }).causa, 'vetores: contagem');
    const fas = new Map(base.fc.fasPorFilme);
    const [id, l] = [...fas][0];
    fas.set(id, l.slice(1));
    const r = conferirVetores({ ...base, fc: { ...base.fc, fasPorFilme: fas } });
    assert.equal(r.causa, 'vetores: suporte (hash)');
  });

  it('rodarScript16 com dados ausentes rejeita com a causa real', async () => {
    const vazio = mkdtempSync(path.join(os.tmpdir(), 'fc-vazio-'));
    try {
      await assert.rejects(
        rodarScript16({ pg: cfg, dirDados: vazio, dirTrabalho: path.join(vazio, 'trabalho') }),
        (e) => {
          console.log('mensagem:', e.message);
          return !e.message.includes('Node.js v') && /ENOENT|no such file|ml-100k|u.|Error/i.test(e.message);
        },
      );
    } finally {
      rmSync(vazio, { recursive: true, force: true });
    }
  });

  it('impressaoDigital le hashes, contagem e selo', async () => {
    const a = await impressaoDigital(pool, { comConteudo: false });
    assert.equal(a.oids.length, 3);
    assert.equal(a.nFc, N_FC);
    assert.equal(a.hashRegua, HASHES.regua);
    assert.equal(a.hashTreino, HASHES.treino);
    assert.equal(a.concluidaEm, null); // sem app.preparacao
    assert.equal('md5Conteudo' in a, false);
    const b = await impressaoDigital(pool, { comConteudo: true });
    assert.match(b.md5Conteudo, /^[0-9a-f]{32}$/);
  });

  it('impressaoDigital muda com DROP/CREATE', async () => {
    const a = await impressaoDigital(pool, { comConteudo: true });
    await rodarScript16({ pg: cfg, dirDados, dirTrabalho });
    const b = await impressaoDigital(pool, { comConteudo: true });
    // O script 16 faz DROP/CREATE de filmes e filmes_fc; metadados usa CREATE IF NOT EXISTS e mantem o OID.
    assert.notEqual(b.oids[0], a.oids[0], 'oid de filmes');
    assert.notEqual(b.oids[1], a.oids[1], 'oid de filmes_fc');
    assert.equal(b.oids[2], a.oids[2], 'oid de metadados (nao e recriada)');
    assert.equal(b.md5Conteudo, a.md5Conteudo);
  });
});
