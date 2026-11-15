// Testes da lógica de corte de buscarColaborativos com um banco falso (sem Postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarColaborativos } from '../../src/banco/busca-fc.js';

const hashes = { regua: 'r', treino: 't' };
const vetor = [1, 0, 0];

// Pool falso: responde como o Postgres à consulta de busca (primeiras LIMIT = params[2] linhas de
// `total` filmes, ids 1..total já em ordem de distância) e registra cada SQL.
function poolFalso(total, distanciaDe, ordenar = (rows) => rows) {
  const registro = [];
  const client = {
    query: async (sql, params) => {
      registro.push({ sql, params });
      if (sql.includes('current_schema() AS s, to_regclass')) return { rows: [{ s: 'public', existe: true }] };
      if (sql.includes("chave IN ('hash_regua', 'hash_treino')")) {
        return { rows: [{ chave: 'hash_regua', valor: 'r' }, { chave: 'hash_treino', valor: 't' }] };
      }
      if (sql.includes('embedding <=>')) {
        const rows = [];
        for (let id = 1; id <= Math.min(params[2], total); id++) rows.push({ id, distancia: String(distanciaDe(id)) });
        return { rows: ordenar(rows) };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { registro, connect: async () => client };
}

test('empate na posição m até 1.000 linhas: empateNaoResolvido e linhasPedidas = 1000', async () => {
  const pool = poolFalso(2000, () => 0.1);
  const r = await buscarColaborativos(pool, { vetor, excluir: [], m: 10, hashes });
  assert.equal(r.empateNaoResolvido, true);
  assert.equal(r.linhasPedidas, 1000);
  assert.deepEqual(r.lista.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.lista[0].escore, 0.9);
  const limites = pool.registro.filter((x) => x.sql.includes('embedding <=>')).map((x) => x.params[2]);
  assert.deepEqual(limites, [60, 120, 240, 480, 960, 1000]);
});

test('empate resolvido ao dobrar: não marca empateNaoResolvido', async () => {
  const pool = poolFalso(200, (id) => (id <= 60 ? 0.1 : 0.5));
  const r = await buscarColaborativos(pool, { vetor, excluir: [], m: 10, hashes });
  assert.equal(r.empateNaoResolvido, false);
  assert.equal(r.linhasPedidas, 120);
});

test('corte por escore <= 0: devolve só os positivos, sem dobrar', async () => {
  const pool = poolFalso(500, (id) => (id <= 5 ? 0.5 : 1)); // distância 1 = escore 0
  const r = await buscarColaborativos(pool, { vetor, excluir: [], m: 10, hashes });
  assert.deepEqual(r.lista.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.equal(r.linhasPedidas, 60);
});

test('m = 301: erro antes de abrir conexão', async () => {
  const pool = poolFalso(10, () => 0.1);
  await assert.rejects(buscarColaborativos(pool, { vetor, excluir: [], m: 301, hashes }), /excede o máximo de 300/);
  assert.equal(pool.registro.length, 0);
});

test('hash de treino diferente: erro e nenhuma consulta de busca', async () => {
  const pool = poolFalso(10, () => 0.1);
  await assert.rejects(
    buscarColaborativos(pool, { vetor, excluir: [], m: 3, hashes: { regua: 'r', treino: 'outro' } }),
    /treino do banco difere/,
  );
  assert.ok(!pool.registro.some((x) => x.sql.includes('embedding <=>')));
});

test('desempate pelo id no código: linhas empatadas vindas em ordem decrescente de id', async () => {
  const pool = poolFalso(20, () => 0.1, (rows) => [...rows].reverse());
  const r = await buscarColaborativos(pool, { vetor, excluir: [], m: 5, hashes });
  assert.deepEqual(r.lista.map((x) => x.id), [1, 2, 3, 4, 5]);
});

test('excluir ausente ou inválido: erro antes de abrir conexão', async () => {
  const pool = poolFalso(10, () => 0.1);
  for (const excluir of [undefined, null, [1, 'a'], 5]) {
    await assert.rejects(buscarColaborativos(pool, { vetor, excluir, m: 3, hashes }), /excluir inválido/);
  }
  assert.equal(pool.registro.length, 0);
});

test('o empate é medido pelo escore oficial, não pela distância bruta', async () => {
  const pool = poolFalso(200, (id) => (id <= 59 ? 0.1 : id === 60 ? 0.1 + 1e-9 : 0.5));
  const r = await buscarColaborativos(pool, { vetor, excluir: [], m: 10, hashes });
  assert.equal(r.linhasPedidas, 120);
  assert.equal(r.empateNaoResolvido, false);
});
