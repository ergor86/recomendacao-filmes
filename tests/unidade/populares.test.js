import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingPopularidade, popularesNaoVistos, vistosPorUsuario } from '../../src/candidatos/populares.js';

test('ranking desempata pelo id', () => {
  assert.deepEqual(rankingPopularidade({ 5: 10, 2: 10, 9: 3, 1: 12 }), [1, 2, 5, 9]);
});
test('K conta só filmes não vistos', () => {
  assert.deepEqual(popularesNaoVistos([1, 2, 5, 9], new Set([2]), 2), [1, 5]);
});
test('vistosPorUsuario agrupa filmes de qualquer nota', () => {
  const m = vistosPorUsuario([{ usuario: 1, filme: 3, nota: 1 }, { usuario: 1, filme: 4, nota: 5 }, { usuario: 2, filme: 3, nota: 4 }]);
  assert.deepEqual([...m.get(1)], [3, 4]);
  assert.deepEqual([...m.get(2)], [3]);
});
