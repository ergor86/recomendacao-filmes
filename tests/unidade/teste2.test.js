// Testes do teste-2 (notas escondidas dos usuários 1–462 dentro do u1.base) e do hash de avaliações.
// Usa uma base sintética; os dados reais nunca entram nos testes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividirTeste2, hashAvaliacoes } from '../../src/dados/teste2.js';
import { criarAleatorio, embaralhar } from '../../src/util/aleatorio.js';

// Gera n notas (filmes 1..n) para o usuário, com notas e timestamps determinísticos.
function notasDe(usuario, n) {
  return Array.from({ length: n }, (_, i) => ({
    usuario, filme: i + 1, nota: (i % 5) + 1, timestamp: 100 + i,
  }));
}

const base = [
  ...notasDe(1, 10), ...notasDe(2, 2), ...notasDe(462, 5), ...notasDe(463, 10), ...notasDe(500, 10),
];
const par = (a) => `${a.usuario}:${a.filme}`;

test('dividirTeste2 esconde round(0,2·n) notas só dos usuários 1–462', () => {
  const { teste2, semTeste2 } = dividirTeste2(base);
  const por = (u) => teste2.filter((a) => a.usuario === u).length;
  assert.equal(por(1), 2);
  assert.equal(por(2), 0); // Math.round(0,4) = 0
  assert.equal(por(462), 1);
  assert.equal(por(463), 0);
  assert.equal(por(500), 0);
  assert.equal(teste2.length + semTeste2.length, base.length);
});

test('teste2 e semTeste2 particionam a base (união = base, interseção vazia)', () => {
  const { teste2, semTeste2 } = dividirTeste2(base);
  const a = new Set(teste2.map(par));
  const b = new Set(semTeste2.map(par));
  for (const p of a) assert.ok(!b.has(p), `par repetido: ${p}`);
  assert.deepEqual([...a, ...b].sort(), base.map(par).sort());
});

test('dividirTeste2 é determinístico', () => {
  assert.deepEqual(dividirTeste2(base), dividirTeste2(base));
});

test('a escolha do usuário 1 usa embaralhar sobre as notas ordenadas por filme, semente 20_000_001', () => {
  const ordenadas = base.filter((a) => a.usuario === 1).sort((x, y) => x.filme - y.filme);
  const esperado = embaralhar(ordenadas, criarAleatorio(20_000_001)).slice(0, 2).map(par);
  const { teste2 } = dividirTeste2(base);
  assert.deepEqual(teste2.filter((a) => a.usuario === 1).map(par), esperado);
});

test('hashAvaliacoes não depende da ordem e muda se uma nota mudar', () => {
  const h = hashAvaliacoes(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashAvaliacoes([...base].reverse()), h);
  const alterada = base.map((a, i) => (i === 3 ? { ...a, nota: a.nota === 5 ? 4 : 5 } : a));
  assert.notEqual(hashAvaliacoes(alterada), h);
});
