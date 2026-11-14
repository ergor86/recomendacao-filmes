// Testes do MDE pré-registrado: subamostragem, fórmula, simulação, IC normal e heurística.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subamostrarRelevantes, desvioAmostral, mdeFormula, simularDeltaEstrela, icNormal, top10Heuristica,
} from '../../src/avaliacao/mde.js';
import { criarAleatorio } from '../../src/util/aleatorio.js';

// Gera n normais de desvio sigma por Box-Muller sobre criarAleatorio(7).
function normais(n, sigma) {
  const a = criarAleatorio(7);
  return Array.from({ length: n }, () => {
    const u1 = a();
    const u2 = a();
    return sigma * Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  });
}

test('subamostragem: usuário com 1 relevante sai do mapa quando o sorteio dá >= q', () => {
  const q = 0.5;
  let rSai = null;
  let rFica = null;
  for (let r = 1; r <= 20; r++) {
    const m = subamostrarRelevantes(new Map([[5, new Set([10])]]), q, r);
    if (m.size === 0 && rSai === null) rSai = r;
    if (m.size === 1 && rFica === null) rFica = r;
  }
  assert.notEqual(rSai, null);
  assert.notEqual(rFica, null);
  // confere o sorteio direto
  const esperado = criarAleatorio(30_000_000 + 1000 * rSai + 5)();
  assert.ok(esperado >= q);
});

test('subamostragem: determinística e subconjunto do gabarito', () => {
  const rel = new Map([[1, new Set([5, 3, 9, 1])], [2, new Set([2])]]);
  const a = subamostrarRelevantes(rel, 0.5, 3);
  const b = subamostrarRelevantes(rel, 0.5, 3);
  assert.deepEqual(a, b);
  for (const [u, s] of a) for (const id of s) assert.ok(rel.get(u).has(id));
});

test('mdeFormula(0.029, 400)', () => {
  assert.ok(Math.abs(mdeFormula(0.029, 400) - 0.00406229856755) < 1e-9);
});

test('simularDeltaEstrela: reprodutível e menor com metade do desvio', () => {
  const d = normais(430, 0.03);
  const metade = d.map((x) => x / 2);
  const a = simularDeltaEstrela(d, 400, 1, 2000);
  assert.equal(a, simularDeltaEstrela(d, 400, 1, 2000));
  assert.ok(simularDeltaEstrela(metade, 400, 1, 2000) < a);
});

test('simularDeltaEstrela concorda com a fórmula (±0,0005)', () => {
  const d = normais(430, 0.03);
  const delta = simularDeltaEstrela(d, 400, 1);
  assert.ok(Math.abs(delta - mdeFormula(desvioAmostral(d), 400)) < 0.0005, `delta=${delta}`);
});

test('icNormal([1, 2, 3])', () => {
  const [lo, hi] = icNormal([1, 2, 3]);
  assert.ok(Math.abs(lo - (2 - 1.96 / Math.sqrt(3))) < 1e-12);
  assert.ok(Math.abs(hi - (2 + 1.96 / Math.sqrt(3))) < 1e-12);
});

test('top10Heuristica: escores iguais desempatam por pop; preenchimento vai ao fim', () => {
  const pop = { 1: 100, 2: 400, 3: 400, 4: 900, 5: 50, 6: 70 };
  const escore = new Map([[1, 0.4], [2, 0.2], [3, 0.2]]);
  // chaves: 1 -> 0.4*10 = 4; 2 e 3 -> 0.2*20 = 4 (empate por id); depois preenchimento 4 (pop 900), 6, 5
  const ids = top10Heuristica([4, 5, 6, 3, 2, 1], escore, pop);
  assert.deepEqual(ids, [1, 2, 3, 4, 6, 5]);
  const escore2 = new Map([[1, 0.2], [2, 0.2]]);
  assert.deepEqual(top10Heuristica([1, 2], escore2, { 1: 100, 2: 400 }), [2, 1]);
});
