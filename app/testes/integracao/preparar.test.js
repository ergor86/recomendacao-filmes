// Tarefa 7: orquestracao da preparacao (spec 4.2). Banco proprio `app_teste_prep`, recriado no `before`.
// Precisa de ML100K_DIR (so os 5 arquivos permitidos sao copiados).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { HASHES } from '../../integridade.js';
import { CHAVE_TRAVA, prepararTudo } from '../../preparar/preparar.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const VERSAO = '0.1.0';
const semDados = !process.env.ML100K_DIR;

describe('preparacao (banco app_teste_prep)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, dirDados, dirTrabalho, dirEstado, pool;
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const logs = [];
  const log = (m) => logs.push(m);
  const preparar = (extra = {}) => prepararTudo({
    pg: cfg, dirDados, dirTrabalho, dirEstado, versaoApp: VERSAO, porta: 3000, log, ...extra,
  });
  const estado = () => JSON.parse(readFileSync(path.join(dirEstado, 'estado.json'), 'utf8'));
  const baixarProibido = async () => { throw new Error('nao deveria baixar'); };
  const tempo = {};

  before(async () => {
    cfg = await recriarBancoTeste('app_teste_prep');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    dirDados = path.join(tmp, 'dados');
    dirTrabalho = path.join(tmp, 'trabalho');
    dirEstado = path.join(tmp, 'estado');
    copiarArquivosML(path.join(dirDados, 'ml-100k'));
    pool = new pg.Pool({ ...cfg, max: 3 });
  });
  after(async () => {
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('recusa o banco da pesquisa sem conectar', async () => {
    await assert.rejects(preparar({ pg: { ...cfg, port: 5433 } }), /pesquisa/);
    await assert.rejects(preparar({ pg: { ...cfg, database: 'recomendacao' } }), /pesquisa/);
  });

  it('primeira preparacao termina pronta', async () => {
    const t0 = Date.now();
    assert.equal(await preparar({ baixar: baixarProibido }), 'pronto');
    tempo.completa = Date.now() - t0;
    const e = estado();
    assert.equal(e.estado, 'pronto');
    assert.equal(e.total, 8);
    const [selo] = await q('SELECT * FROM app.preparacao');
    assert.equal(selo.id, 1);
    assert.equal(selo.versao_app, VERSAO);
    assert.equal(selo.hash_regua, HASHES.regua);
    assert.equal(selo.hash_treino, HASHES.treino);
    assert.equal(selo.hash_vetores_fc, HASHES.vetoresFC);
    assert.ok(readFileSync(path.join(dirEstado, 'credenciais.json'), 'utf8').length > 0);
    assert.ok(logs.some((l) => l.startsWith('3/8: carregando filmes no banco')));
  });

  it('linha Pronto usa a porta', async () => {
    const saida = [];
    await preparar({ porta: 3317, log: (m) => saida.push(m) });
    assert.ok(saida.some((l) => l.includes('Pronto: abra http://localhost:3317')));
  });

  it('segunda preparacao pula download e script 16', async () => {
    const antes = await q(`SELECT ('v2_final.filmes'::regclass::oid)::text AS a, ('v2_final.filmes_fc'::regclass::oid)::text AS b,
                                  ('v2_final.metadados'::regclass::oid)::text AS c`);
    const saida = [];
    const t0 = Date.now();
    assert.equal(await preparar({ baixar: baixarProibido, log: (m) => saida.push(m) }), 'pronto');
    tempo.repetida = Date.now() - t0;
    const depois = await q(`SELECT ('v2_final.filmes'::regclass::oid)::text AS a, ('v2_final.filmes_fc'::regclass::oid)::text AS b,
                                   ('v2_final.metadados'::regclass::oid)::text AS c`);
    assert.deepEqual(depois, antes);
    assert.ok(!saida.some((l) => l.includes('carregando filmes no banco')));
    assert.equal(estado().estado, 'pronto');
  });

  it('estado.json nunca contem senhas', () => {
    const cred = JSON.parse(readFileSync(path.join(dirEstado, 'credenciais.json'), 'utf8'));
    const texto = readFileSync(path.join(dirEstado, 'estado.json'), 'utf8');
    for (const v of Object.values(cred)) assert.ok(!texto.includes(v));
  });

  it('duas preparacoes simultaneas: a segunda lanca e nao grava falhou', async () => {
    const outra = new pg.Client(cfg);
    await outra.connect();
    try {
      await outra.query('SELECT pg_advisory_lock($1)', [CHAVE_TRAVA]);
      const antes = readFileSync(path.join(dirEstado, 'estado.json'), 'utf8');
      await assert.rejects(preparar(), /outra preparação em andamento/);
      assert.equal(readFileSync(path.join(dirEstado, 'estado.json'), 'utf8'), antes);
    } finally {
      await outra.end();
    }
    assert.equal(await preparar(), 'pronto'); // trava liberada
  });

  it('preparacao interrompida nao passa como pronta', async () => {
    await pool.query('DELETE FROM app.preparacao');
    await assert.rejects(
      preparar({ ganchos: { antesDoSelo: async () => { throw new Error('queda simulada'); } } }),
      /queda simulada/,
    );
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 0);
    const e = estado();
    assert.equal(e.estado, 'falhou');
    assert.match(e.causa, /queda simulada/);
    assert.equal(e.comando, 'docker compose run --rm preparar');
    assert.equal(await preparar(), 'pronto');
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 1);
  });

  describe('nova preparacao preserva os dados dos usuarios', () => {
    async function criarUsuarios() {
      await pool.query('DELETE FROM app.perfil');
      const ids = (await q(`INSERT INTO app.perfil (nome, onboarding_concluido) VALUES ('Ana', true), ('Bruno', true) RETURNING id`)).map((r) => r.id);
      const filmes = (await q('SELECT id FROM app.filme ORDER BY id LIMIT 12')).map((r) => r.id);
      const linhas = [];
      ids.forEach((p, k) => {
        filmes.slice(0, 6).forEach((f, i) => linhas.push([p, f, 'nota', ((i + k) % 5) + 1]));
        linhas.push([p, filmes[6], 'gostei', null], [p, filmes[7 + k], 'quero_assistir', null]);
      });
      for (const [p, f, t, n] of linhas) {
        await pool.query('INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, $3, $4)', [p, f, t, n]);
      }
    }
    async function retrato() {
      return {
        perfil: await q('SELECT * FROM app.perfil ORDER BY id'),
        interacao: await q('SELECT * FROM app.interacao ORDER BY perfil_id, filme_id'),
        estatisticas: await q(
          `SELECT i.filme_id, count(*)::int AS n, avg(i.nota)::float AS media
             FROM app.interacao i JOIN app.perfil p ON p.id = i.perfil_id
            WHERE i.tipo = 'nota' AND NOT p.exemplo GROUP BY i.filme_id ORDER BY i.filme_id`),
        historica: await q('SELECT * FROM app.estatistica_historica ORDER BY filme_id'),
      };
    }

    it('sem o selo (passo 6 roda de novo)', async () => {
      await criarUsuarios();
      const antes = await retrato();
      assert.ok(antes.perfil.length === 2 && antes.interacao.length === 16 && antes.estatisticas.length > 0);
      await pool.query('DELETE FROM app.preparacao');
      await preparar();
      assert.deepEqual(await retrato(), antes);
    });

    it('com o script 16 forcado (hashes invalidados)', async () => {
      const antes = await retrato();
      await pool.query('DELETE FROM app.preparacao');
      await pool.query(`UPDATE v2_final.metadados SET valor = 'invalido' WHERE chave IN ('hash_regua', 'hash_treino')`);
      const saida = [];
      await preparar({ log: (m) => saida.push(m) });
      assert.ok(saida.some((l) => l.includes('carregando filmes no banco')));
      const [m] = await q(`SELECT valor FROM v2_final.metadados WHERE chave = 'hash_regua'`);
      assert.equal(m.valor, HASHES.regua);
      assert.deepEqual(await retrato(), antes);
    });
  });

  it('modo dev recusa v2_final sem o schema app', async () => {
    await pool.query('DROP SCHEMA app CASCADE');
    await assert.rejects(preparar({ modoDev: true }), /v2_final/);
    assert.equal(estado().estado, 'falhou');
  });

  it('tempos', () => {
    console.log(`tempo preparacao completa: ${tempo.completa} ms; repetida: ${tempo.repetida} ms`);
  });
});
