// Testes com um banco falso: registram a ordem das consultas sem precisar do Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarVizinhos } from '../../src/banco/busca.js';
import { carregarFilmes } from '../../src/banco/carga.js';

// Pool falso: guarda cada SQL enviado (em `consultas`) e também SQL e parâmetros (em `registro`),
// e responde conforme `responder(sql, params)`.
function poolFalso(responder) {
  const consultas = [];
  const registro = [];
  const soltas = [];
  const client = {
    query: async (sql, params) => {
      consultas.push(sql);
      registro.push({ sql, params });
      return responder(sql, params) ?? { rows: [] };
    },
    release: (erro) => soltas.push(erro ?? null),
  };
  return {
    consultas,
    registro,
    soltas,
    connect: async () => client,
    query: async () => { throw new Error('a consulta deveria passar pela conexão da transação, não pelo pool'); },
  };
}

const vetor = Array(23).fill(0).map((_, i) => (i === 0 ? 1 : 0));
const regua = { hash: 'certo', fase: 'exp', dimensoes: { busca: 23 } };

function respostasDaBusca(hashGravado) {
  return (sql) => {
    if (sql.includes('current_schema() AS s, to_regclass')) return { rows: [{ s: 'public', existe: true }] };
    if (sql.includes("chave = 'hash_regua'")) return { rows: [{ valor: hashGravado }] };
    if (sql.includes('embedding <=>')) return { rows: [{ id: 7, distancia: '0.1' }, { id: 3, distancia: '0.2' }] };
    return null;
  };
}

test('buscarVizinhos confere o hash dentro da transação REPEATABLE READ, na mesma conexão', async () => {
  const pool = poolFalso(respostasDaBusca('certo'));
  const r = await buscarVizinhos(pool, { vetor, excluir: [], n: 1, regua });
  assert.deepEqual(r, [{ id: 7, distancia: 0.1 }]);
  const iBegin = pool.consultas.findIndex((s) => s === 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  const iHash = pool.consultas.findIndex((s) => s.includes("chave = 'hash_regua'"));
  const iBusca = pool.consultas.findIndex((s) => s.includes('embedding <=>'));
  assert.equal(iBegin, 0);
  assert.ok(iBegin < iHash && iHash < iBusca);
  assert.deepEqual(pool.soltas, [null]);
});

test('buscarVizinhos com hash diferente: desfaz a transação e não busca', async () => {
  const pool = poolFalso(respostasDaBusca('outro'));
  await assert.rejects(buscarVizinhos(pool, { vetor, excluir: [], n: 1, regua }), /régua do banco difere/);
  assert.ok(pool.consultas.includes('ROLLBACK'));
  assert.ok(!pool.consultas.some((s) => s.includes('embedding <=>')));
  assert.equal(pool.soltas.length, 1);
});

// Responde como o Postgres à consulta de busca: as primeiras LIMIT linhas (LIMIT = params[2]) de
// `total` filmes, já em ordem de distância (ids 1..total, distância dada por `distanciaDe(id)`).
function respostasDaBuscaComTotal(total, distanciaDe) {
  return (sql, params) => {
    if (sql.includes('current_schema() AS s, to_regclass')) return { rows: [{ s: 'public', existe: true }] };
    if (sql.includes("chave = 'hash_regua'")) return { rows: [{ valor: 'certo' }] };
    if (sql.includes('embedding <=>')) {
      const linhas = [];
      for (let id = 1; id <= Math.min(params[2], total); id++) linhas.push({ id, distancia: String(distanciaDe(id)) });
      return { rows: linhas };
    }
    return null;
  };
}

// LIMIT pedido em cada consulta de busca, na ordem em que foram enviadas.
const limitesPedidos = (pool) => pool.registro.filter((x) => x.sql.includes('embedding <=>')).map((x) => x.params[2]);

test('empate no corte: pede o dobro de linhas e devolve os n primeiros por (distância, id)', async () => {
  // total = 200: ids 1..60 com distância 0.1, ids 61..200 com 0.5; n = 10
  const pool = poolFalso(respostasDaBuscaComTotal(200, (id) => (id <= 60 ? 0.1 : 0.5)));
  const r = await buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua });
  assert.deepEqual(r.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(limitesPedidos(pool), [60, 120]);
});

test('empate que não cabe em 1000 linhas: erro acionável', async () => {
  // total = 2000, todas com distância 0.1
  const pool = poolFalso(respostasDaBuscaComTotal(2000, () => 0.1));
  await assert.rejects(buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua }), /não cabe em 1000 linhas; reduza N/);
  assert.deepEqual(limitesPedidos(pool), [60, 120, 240, 480, 960, 1000]);
});

test('menos linhas que n: erro acionável', async () => {
  // total = 5, n = 10
  const pool = poolFalso(respostasDaBuscaComTotal(5, () => 0.1));
  await assert.rejects(buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua }), /menos que as 10 pedidas/);
});

test('carregarFilmes garante a extensão pgvector antes de criar a tabela', async () => {
  const pool = poolFalso((sql) => (sql.includes('current_schema()') ? { rows: [{ s: 'public' }] } : null));
  await carregarFilmes(pool, [{ id: 1, titulo: 'A', ano: 1995 }], [vetor], regua);
  const iExt = pool.consultas.indexOf('CREATE EXTENSION IF NOT EXISTS vector SCHEMA public');
  const iTabela = pool.consultas.findIndex((s) => s.startsWith('CREATE TABLE'));
  assert.ok(iExt > 0 && iExt < iTabela);
});

test('carregarFilmes sem permissão para criar a extensão: mensagem acionável', async () => {
  const pool = poolFalso((sql) => {
    if (sql.startsWith('CREATE EXTENSION')) throw new Error('permission denied to create extension "vector"');
    return null;
  });
  await assert.rejects(
    carregarFilmes(pool, [{ id: 1, titulo: 'A', ano: 1995 }], [vetor], regua),
    /não consegui criar a extensão pgvector .*rode npm run ambiente/,
  );
  assert.ok(pool.consultas.includes('ROLLBACK'));
});
