// Testes dos diagnósticos: AUC (Mann-Whitney com posto médio) e correlação de Pearson.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auc, correlacao } from '../../src/avaliacao/diagnosticos.js';

const F = (v) => Float32Array.from(v);

test('auc = 1 na separação perfeita e 0 na invertida', () => {
  assert.equal(auc(F([0.1, 0.2, 0.8, 0.9]), F([0, 0, 1, 1])), 1);
  assert.equal(auc(F([0.9, 0.8, 0.2, 0.1]), F([0, 0, 1, 1])), 0);
});

test('auc = 0,5 com scores constantes', () => {
  assert.equal(auc(F([0.3, 0.3, 0.3, 0.3, 0.3]), F([1, 0, 1, 0, 0])), 0.5);
});

test('auc com empate parcial, calculado à mão', () => {
  // scores [1,2,2,3], rótulos [0,1,0,1]: positivos {2,3}, negativos {1,2}.
  // Pares: 2>1 (1), 2=2 (0,5), 3>1 (1), 3>2 (1) → 3,5 / 4 = 0,875.
  assert.equal(auc(F([1, 2, 2, 3]), F([0, 1, 0, 1])), 0.875);
});

test('auc sem positivos ou sem negativos dá erro acionável', () => {
  assert.throws(() => auc(F([1, 2]), F([0, 0])), /positivo/);
  assert.throws(() => auc(F([1, 2]), F([1, 1])), /negativo/);
  assert.throws(() => auc(F([1, 2]), F([1])), /tamanho/);
});

test('auc lida com muitas linhas', () => {
  const n = 200_000;
  const s = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { s[i] = i; y[i] = i >= n / 2 ? 1 : 0; }
  assert.equal(auc(s, y), 1);
});

test('correlacao de Pearson', () => {
  assert.ok(Math.abs(correlacao([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
  assert.ok(Math.abs(correlacao([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
  // [1,2,3,4] vs [1,3,2,4]: covariância 4, variâncias 5 e 5 → 0,8.
  assert.ok(Math.abs(correlacao([1, 2, 3, 4], [1, 3, 2, 4]) - 0.8) < 1e-12);
});

test('correlacao com vetor constante devolve null, nunca NaN', () => {
  assert.equal(correlacao([1, 1, 1], [1, 2, 3]), null);
  assert.equal(correlacao([1, 2, 3], [5, 5, 5]), null);
});

test('correlacao com tamanhos diferentes dá erro', () => {
  assert.throws(() => correlacao([1, 2], [1, 2, 3]), /tamanho/);
});
