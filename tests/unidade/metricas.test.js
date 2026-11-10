import test from 'node:test';
import assert from 'node:assert/strict';
import {
  precisaoEm10, recallEm10, ndcgEm10, cobertura, popularidadeMedia,
  relevantesPorUsuario, avaliarSistema,
} from '../../src/avaliacao/metricas.js';
import { erroPadraoPareado, bootstrapPareado, grupoMainstream } from '../../src/avaliacao/estatistica.js';

test('caso feito à mão: 3 acertos em 10, 8 relevantes', () => {
  const top10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rel = new Set([1, 4, 10, 20, 21, 22, 23, 24]);
  assert.equal(precisaoEm10(top10, rel), 0.3);
  assert.equal(recallEm10(top10, rel), 0.375);
  const dcg = 1 / Math.log2(2) + 1 / Math.log2(5) + 1 / Math.log2(11);
  const idcg = [...Array(8).keys()].reduce((s, i) => s + 1 / Math.log2(i + 2), 0);
  assert.ok(Math.abs(ndcgEm10(top10, rel) - dcg / idcg) < 1e-12);
});
test('NDCG com só 2 relevantes usa IDCG de 2 posições', () => {
  assert.equal(ndcgEm10([5, 6, 1, 2, 7, 8, 9, 10, 11, 12], new Set([5, 6])), 1);
});
test('NDCG lança erro com conjunto de relevantes vazio', () => {
  assert.throws(() => ndcgEm10([1, 2], new Set()), /relevante/);
});
test('relevantesPorUsuario ignora quem não tem nota ≥ 4', () => {
  const m = relevantesPorUsuario([{ usuario: 1, filme: 1, nota: 5 }, { usuario: 2, filme: 1, nota: 3 }]);
  assert.deepEqual([...m.keys()], [1]);
});
test('cobertura e popularidadeMedia', () => {
  assert.equal(cobertura([[1, 2], [2, 3]]), 3 / 1682);
  assert.equal(popularidadeMedia([[1, 2], [2, 9]], { 1: 10, 2: 20 }), (10 + 20 + 20 + 0) / 4);
});
test('avaliarSistema média só sobre usuários de relevantesMap', () => {
  const top = new Map([[1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], [2, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]], [99, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]]);
  const rel = new Map([[1, new Set([1, 2])], [2, new Set([500])]]);
  const r = avaliarSistema(top, rel, { 1: 4 });
  assert.equal(r.nUsuarios, 2);
  assert.equal(r.precisao, (0.2 + 0) / 2);
  assert.equal(r.recall, (1 + 0) / 2);
  assert.equal(r.cobertura, 20 / 1682);
  assert.equal(r.popularidadeMedia, 4 / 20);
  assert.deepEqual([...r.porUsuario.keys()], [1, 2]);
  assert.equal(r.porUsuario.get(1).recall, 1);
});
test('avaliarSistema lança erro se faltar lista de um usuário', () => {
  assert.throws(() => avaliarSistema(new Map(), new Map([[1, new Set([1])]]), {}), /usuário 1/);
});
test('bootstrap determinístico e IC contém a média', () => {
  const difs = [0.1, 0.0, 0.2, -0.1, 0.05, 0.15];
  const a = bootstrapPareado(difs, { semente: 1 });
  assert.deepEqual(a, bootstrapPareado(difs, { semente: 1 }));
  assert.ok(a.ic95[0] <= a.media && a.media <= a.ic95[1]);
});
test('erroPadraoPareado', () => {
  assert.ok(Math.abs(erroPadraoPareado([1, 2, 3, 4]) - Math.sqrt(5 / 3) / 2) < 1e-12);
  assert.throws(() => erroPadraoPareado([1]), /2/);
});
test('grupoMainstream: empate na mediana vai para mainstream', () => {
  const g = grupoMainstream(new Map([[1, 0.5], [2, 0.7], [3, 0.9]]));
  assert.deepEqual([g.get(1), g.get(2), g.get(3)], ['nicho', 'mainstream', 'mainstream']);
});
test('grupoMainstream com quantidade par usa média dos dois centrais', () => {
  const g = grupoMainstream(new Map([[1, 1], [2, 2], [3, 3], [4, 4]]));
  assert.deepEqual([1, 2, 3, 4].map((u) => g.get(u)), ['nicho', 'nicho', 'mainstream', 'mainstream']);
});
