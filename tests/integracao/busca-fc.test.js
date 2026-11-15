import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { carregarConfig } from '../../src/config.js';
import { criarPool, verificarConexao } from '../../src/banco/conexao.js';
import { carregarFilmesFC } from '../../src/banco/carga-fc.js';
import { buscarColaborativos, planoDaBuscaFC } from '../../src/banco/busca-fc.js';
import { escoreOficial } from '../../src/fc/referencia.js';

const SCHEMA = 'teste_busca_fc';
const DIM = 8;
const { pg: configPg } = carregarConfig();
const hashes = { regua: 'regua-fc', treino: 'treino-fc' };
let pool;
let antes;

const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
const carregar = (mapa) => carregarFilmesFC(pool, { vetores: new Map(mapa), dim: DIM, hashRegua: hashes.regua, hashTreino: hashes.treino });

// Retrato do que existe em public.filmes e nos schemas v2_*: contagens de linhas de cada tabela.
async function retrato(p) {
  const r = {};
  const { rows: tabelas } = await p.query(
    "SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'filmes' OR table_schema LIKE 'v2\\_%' ORDER BY 1, 2",
  );
  for (const { s, t } of tabelas) r[`${s}.${t}`] = (await p.query(`SELECT count(*)::int AS n FROM "${s}"."${t}"`)).rows[0].n;
  return r;
}

before(async () => {
  const admin = new pg.Pool(configPg);
  antes = await retrato(admin);
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.end();
  pool = criarPool(configPg, { searchPath: `${SCHEMA},public` });
  await verificarConexao(pool);
});
after(async () => {
  await pool?.end();
  const admin = new pg.Pool(configPg);
  const depois = await retrato(admin);
  await admin.query(`DROP TABLE IF EXISTS ${SCHEMA}.filmes_fc, ${SCHEMA}.metadados`);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
  await admin.end();
  assert.deepEqual(depois, antes, 'public.filmes ou schemas v2_* foram alterados pelos testes');
});

test('empate na posição m: o menor id entra e vem antes quando os dois entram', async () => {
  const q = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  await carregar([[7, q], [3, q], // 7 antes de 3: a ordem do heap não ajuda o desempate
     [10, unit([1, 1, 0, 0, 0, 0, 0, 0])]]);
  for (const modo of ['hnsw', 'exata']) {
    const um = await buscarColaborativos(pool, { vetor: q, excluir: [], m: 1, hashes, modo });
    assert.deepEqual(um.lista.map((x) => x.id), [3]);
    const dois = await buscarColaborativos(pool, { vetor: q, excluir: [], m: 2, hashes, modo });
    assert.ok(dois.lista.map((x) => x.id).indexOf(3) < dois.lista.map((x) => x.id).indexOf(7));
  }
});

test('catálogo de 30 filmes: ordem por (escore oficial desc, id asc) e HNSW = exata', async () => {
  const vet = (id) => unit(Array.from({ length: DIM }, (_, k) => 1 + ((id * (k + 3) * 7919) % 97) / 10));
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const q = unit([3, 1, 2, 5, 1, 1, 4, 2]);
  await carregar(ids.map((id) => [id, vet(id)]));
  const esperado = ids
    .map((id) => ({ id, escore: escoreOficial(cos(q, vet(id))) }))
    .sort((a, b) => b.escore - a.escore || a.id - b.id);
  const hnsw = await buscarColaborativos(pool, { vetor: q, excluir: [], m: 30, hashes });
  const exata = await buscarColaborativos(pool, { vetor: q, excluir: [], m: 30, hashes, modo: 'exata' });
  assert.deepEqual(hnsw.lista.map((x) => x.id), esperado.map((x) => x.id));
  assert.deepEqual(exata.lista.map((x) => x.id), esperado.map((x) => x.id));
  for (const lista of [hnsw.lista, exata.lista]) {
    lista.forEach((x, i) => assert.ok(Math.abs(x.escore - esperado[i].escore) <= 1e-6, `escore do filme ${x.id}`));
  }
});

test('m maior que os elegíveis devolve menos, e o filme ortogonal (escore 0) nunca aparece', async () => {
  const q = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  await carregar([[1, q], [2, unit([1, 1, 0, 0, 0, 0, 0, 0])], [3, unit([0, 0, 1, 0, 0, 0, 0, 0])], [4, q]]);
  const r = await buscarColaborativos(pool, { vetor: q, excluir: [4], m: 300, hashes });
  assert.deepEqual(r.lista.map((x) => x.id), [1, 2]);
  assert.equal(r.empateNaoResolvido, false);
});

test('dobra com SQL real: 500 filmes, 400 idênticos à consulta, m = 300', async () => {
  const q = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  const mapa = [];
  const identicos = [];
  for (let k = 0; k < 500; k++) {
    const id = ((k * 37) % 500) + 1; // permutação de 1..500: ids embaralhados
    if (k < 400) { mapa.push([id, q]); identicos.push(id); } else mapa.push([id, unit([1, 0.1 + 0.01 * (k - 400), 0, 0, 0, 0, 0, 0])]);
  }
  await carregar(mapa);
  const excluir = identicos.slice(0, 50);
  const livres = identicos.filter((id) => !excluir.includes(id)).sort((a, b) => a - b);

  const exata = await buscarColaborativos(pool, { vetor: q, excluir, m: 300, hashes, modo: 'exata' });
  assert.equal(exata.linhasPedidas, 700);
  assert.equal(exata.empateNaoResolvido, false);
  assert.deepEqual(exata.lista.map((x) => x.id), livres.slice(0, 300));

  const hnsw = await buscarColaborativos(pool, { vetor: q, excluir, m: 300, hashes, modo: 'hnsw' });
  assert.ok(hnsw.lista.length <= 300);
  assert.ok(!hnsw.lista.some((x) => excluir.includes(x.id)));
});

test('plano: hnsw usa o índice; exata faz Seq Scan', async () => {
  const q = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  await carregar([[1, q], [2, unit([1, 1, 0, 0, 0, 0, 0, 0])]]);
  const h = await planoDaBuscaFC(pool, 'hnsw');
  assert.match(h, /Index Scan/);
  assert.match(h, /filmes_fc_embedding_idx/);
  const e = await planoDaBuscaFC(pool, 'exata');
  assert.match(e, /Seq Scan/);
  assert.doesNotMatch(e, /filmes_fc_embedding_idx/);
});

test('hash de treino diferente: erro antes da consulta', async () => {
  const q = unit([1, 0, 0, 0, 0, 0, 0, 0]);
  await carregar([[1, q]]);
  await assert.rejects(
    buscarColaborativos(pool, { vetor: q, excluir: [], m: 1, hashes: { regua: hashes.regua, treino: 'outro' } }),
    /treino do banco difere/,
  );
  await assert.rejects(
    buscarColaborativos(pool, { vetor: q, excluir: [], m: 1, hashes: { regua: 'outra', treino: hashes.treino } }),
    /régua do banco difere/,
  );
});
