import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { carregarConfig } from '../../src/config.js';
import { criarPool, verificarConexao } from '../../src/banco/conexao.js';
import { carregarFilmes, lerHashCarregado } from '../../src/banco/carga.js';

const SCHEMA = 'teste_integracao';
const { pg: configPg } = carregarConfig();
const regua = { hash: 'hash-teste', dimensoes: { busca: 23 } };
const filmes3 = [
  { id: 1, titulo: 'A', ano: 1990, generos: [] },
  { id: 2, titulo: 'B', ano: 1995, generos: [] },
  { id: 3, titulo: 'C', ano: 2000, generos: [] },
];
const vetor = (i) => Array.from({ length: 23 }, (_, k) => (k === i ? 1 : 0.1));
const vetores3 = [vetor(0), vetor(1), vetor(2)];
let pool;

before(async () => {
  const admin = new pg.Pool(configPg);
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.end();
  pool = criarPool(configPg, { searchPath: `${SCHEMA},public` });
  await verificarConexao(pool);
});
after(async () => {
  await pool?.end();
  const admin = new pg.Pool(configPg);
  await admin.query(`DROP TABLE IF EXISTS ${SCHEMA}.filmes, ${SCHEMA}.metadados`);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
  await admin.end();
});

test('carga grava 3 filmes e o hash da régua', async () => {
  await carregarFilmes(pool, filmes3, vetores3, regua);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM filmes');
  assert.equal(rows[0].n, 3);
  assert.equal(await lerHashCarregado(pool), regua.hash);
});
test('vetor com dimensão errada aborta sem alterar o hash', async () => {
  await assert.rejects(carregarFilmes(pool, filmes3, [[1, 2], ...vetores3.slice(1)], { ...regua, hash: 'outro' }), /dimensão/);
  assert.equal(await lerHashCarregado(pool), regua.hash);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM filmes');
  assert.equal(rows[0].n, 3);
});
