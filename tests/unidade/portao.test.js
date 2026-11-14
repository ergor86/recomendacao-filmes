// Testes do portão da FC (spec §8.1): composições e critérios (a) e (b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composicoesPortao, avaliarPortao } from '../../src/avaliacao/portao.js';

test('composicoesPortao(150) e (50)', () => {
  assert.deepEqual(composicoesPortao(150), [
    { p: 0, k: 150, n: 0 }, { p: 0.25, k: 112, n: 38 }, { p: 0.5, k: 75, n: 75 },
    { p: 0.75, k: 37, n: 113 }, { p: 1, k: 0, n: 150 },
  ]);
  assert.deepEqual(composicoesPortao(50).map((c) => c.n), [0, 13, 25, 38, 50]);
});

// Constrói recalls: base constante 0.5 + deltas por composição (função do usuário).
function montar(n, deltas, curtidas = (u) => u) {
  const rec = new Map();
  for (const ch of ['150-0', '100-50', '112-38', '75-75', '37-113']) {
    rec.set(ch, new Map(Array.from({ length: n }, (_, i) => [i + 1, 0.5 + (ch === '150-0' ? 0 : deltas[ch](i + 1))])));
  }
  return { recallPorComposicao: rec, curtidasEscondidas: new Map(Array.from({ length: n }, (_, i) => [i + 1, curtidas(i + 1)])) };
}
const alt = (u) => (u % 2 ? 0.1 : 0.12);

test('(b) com 20 usuários retira 2', () => {
  const r = avaliarPortao(montar(20, { '100-50': alt, '112-38': alt, '75-75': alt, '37-113': alt }));
  assert.equal(r.criterioB.nRetirados, 2);
});

test('(a) em empate escolhe o menor n', () => {
  const r = avaliarPortao(montar(20, { '100-50': alt, '112-38': alt, '75-75': alt, '37-113': alt }));
  assert.equal(r.melhorMistura, '112-38');
});

test('aprovado quando (a) e (b) passam', () => {
  const r = avaliarPortao(montar(20, { '100-50': alt, '112-38': alt, '75-75': alt, '37-113': alt }));
  assert.equal(r.cenario, 'aprovado');
});

test('(b) ignora os usuários com mais curtidas; reprovado quando só (a) passa', () => {
  // 100-50 só ganha nos 2 usuários com mais curtidas (retirados) e perde nos demais.
  const d100 = (u) => (u > 18 ? 0.5 : -0.01);
  const r = avaliarPortao(montar(20, { '100-50': d100, '112-38': alt, '75-75': alt, '37-113': alt }));
  assert.equal(r.criterioA.passa, true);
  assert.ok(r.criterioB.valor < 0);
  assert.equal(r.criterioB.passa, false);
  assert.equal(r.cenario, 'reprovado');
});

test('(b) com 25 usuários retira floor(2,5) = 2', () => {
  const r = avaliarPortao(montar(25, { '100-50': alt, '112-38': alt, '75-75': alt, '37-113': alt }));
  assert.equal(r.criterioB.nRetirados, 2);
  assert.ok(Math.abs(r.criterioB.fracaoDoGanhoDosRetirados - 2 / 25 * (0.11 / 0.11)) < 0.05);
});

test('(a) com diferença média positiva porém abaixo do EP não passa', () => {
  // Deltas de sinal alternado e grande, média pequena e positiva.
  const d = (u) => (u % 2 ? 0.2 : -0.18);
  const r = avaliarPortao(montar(20, { '100-50': d, '112-38': d, '75-75': d, '37-113': d }));
  assert.ok(r.criterioA.diferenca > 0);
  assert.ok(r.criterioA.diferenca < r.criterioA.erroPadrao);
  assert.equal(r.criterioA.passa, false);
});

test('composição com usuários diferentes de 150-0 falha alto', () => {
  const entrada = montar(20, { '100-50': alt, '112-38': alt, '75-75': alt, '37-113': alt });
  entrada.recallPorComposicao.get('75-75').delete(3);
  assert.throws(() => avaliarPortao(entrada), /75-75/);
});
