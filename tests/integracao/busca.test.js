import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { carregarConfig } from '../../src/config.js';
import { criarPool, verificarConexao } from '../../src/banco/conexao.js';
import { carregarFilmes, lerHashCarregado } from '../../src/banco/carga.js';
import { buscarVizinhos, planoDaBusca, parametrosHnsw } from '../../src/banco/busca.js';

const SCHEMA = 'teste_busca';
const { pg: configPg } = carregarConfig();
const regua = { hash: 'hash-busca', dimensoes: { busca: 23 } };
const base = (k) => Array.from({ length: 23 }, (_, i) => (i === k ? 1 : 0.1));
// ids: A=1, B=2 (vetores idênticos), C=3 (mais distante), D=4 (excluído), E=5 (sem data), F=6
const [idA, idB, idC, idD, idE, idF] = [1, 2, 3, 4, 5, 6];
const vA = base(0);
const vE = [...base(5).slice(0, 19), 0, 0, 0, 0]; // bloco de época zerado
const filmes = [
  { id: idA, titulo: 'A', ano: 1990 },
  { id: idB, titulo: 'B', ano: 1990 },
  { id: idC, titulo: 'C', ano: 2000 },
  { id: idD, titulo: 'D', ano: 1990 },
  { id: idE, titulo: 'E', ano: null },
  { id: idF, titulo: 'F', ano: 1980 },
];
const vetores = [vA, vA, base(2), vA, vE, base(9)];
let pool;
let contagemPublicAntes;

async function contagemPublic(p) {
  const { rows } = await p.query("SELECT to_regclass('public.filmes') IS NOT NULL AS existe");
  if (!rows[0].existe) return null;
  return (await p.query('SELECT count(*)::int AS n FROM public.filmes')).rows[0].n;
}

before(async () => {
  const admin = new pg.Pool(configPg);
  contagemPublicAntes = await contagemPublic(admin);
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.end();
  pool = criarPool(configPg, { searchPath: `${SCHEMA},public` });
  await verificarConexao(pool);
  await carregarFilmes(pool, filmes, vetores, regua);
});
after(async () => {
  await pool?.end();
  const admin = new pg.Pool(configPg);
  const contagemDepois = await contagemPublic(admin);
  await admin.query(`DROP TABLE IF EXISTS ${SCHEMA}.filmes, ${SCHEMA}.metadados`);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
  await admin.end();
  assert.equal(contagemDepois, contagemPublicAntes, 'public.filmes foi alterada pelos testes');
});

test('ordem por distância, desempate pelo id, exclusão respeitada', async () => {
  const r = await buscarVizinhos(pool, { vetor: vA, excluir: [idD], n: 3, regua });
  assert.deepEqual(r.map((x) => x.id), [idA, idB, idC]);
});
test('modo exata devolve a mesma ordem', async () => {
  const r = await buscarVizinhos(pool, { vetor: vA, excluir: [idD], n: 3, regua, modo: 'exata' });
  assert.deepEqual(r.map((x) => x.id), [idA, idB, idC]);
});
test('duas execuções devolvem exatamente os mesmos ids', async () => {
  const a = await buscarVizinhos(pool, { vetor: vA, excluir: [], n: 4, regua });
  const b = await buscarVizinhos(pool, { vetor: vA, excluir: [], n: 4, regua });
  assert.deepEqual(a, b);
});
test('filme sem data é recuperável', async () => {
  const r = await buscarVizinhos(pool, { vetor: vE, excluir: [], n: 1, regua });
  assert.equal(r[0].id, idE);
});
test('hash divergente gera erro acionável', async () => {
  await assert.rejects(buscarVizinhos(pool, { vetor: vA, excluir: [], n: 1, regua: { ...regua, hash: 'x' } }), /rode npm run carregar-filmes/);
});
test('menos de N linhas gera erro', async () => {
  await assert.rejects(buscarVizinhos(pool, { vetor: vA, excluir: [], n: 50, regua }), /linhas/);
});
test('n acima de 100 gera erro', async () => {
  await assert.rejects(buscarVizinhos(pool, { vetor: vA, excluir: [], n: 101, regua }), /100/);
});
test('EXPLAIN confirma índice no modo hnsw e seq scan no modo exata', async () => {
  assert.match(await planoDaBusca(pool, 'hnsw'), /Index Scan using filmes_embedding_idx/);
  assert.match(await planoDaBusca(pool, 'exata'), /Seq Scan/);
});
test('parametrosHnsw devolve os quatro parâmetros', async () => {
  const p = await parametrosHnsw(pool);
  assert.deepEqual(Object.keys(p), ['ef_search', 'iterative_scan', 'max_scan_tuples', 'scan_mem_multiplier']);
});

test('sem tabelas: lerHashCarregado devolve null e buscarVizinhos manda carregar os filmes', async () => {
  const SCHEMA_VAZIO = 'teste_busca_vazio';
  const admin = new pg.Pool(configPg);
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_VAZIO}`);
  const vazio = criarPool(configPg, { searchPath: `${SCHEMA_VAZIO},public` });
  try {
    // lerHashCarregado qualifica o schema corrente, então o public.metadados existente não mascara o cenário
    assert.equal(await contagemPublic(admin), contagemPublicAntes);
    assert.equal(await lerHashCarregado(vazio), null);
    await assert.rejects(buscarVizinhos(vazio, { vetor: vA, excluir: [], n: 1, regua }), /carregar-filmes/);
    await assert.rejects(planoDaBusca(vazio, 'hnsw'), /carregar-filmes/);
  } finally {
    await vazio.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA_VAZIO}`);
    await admin.end();
  }
});
