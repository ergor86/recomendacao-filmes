import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarGemeos, carregarGemeosManuais, calcularOcultos } from '../../comum/gemeos.js';

test('detectarGemeos acha 2 pares e ignora título único', () => {
  const filmes = [
    { id: 10, titulo: 'A (1990)' },
    { id: 3, titulo: 'A (1990)' },
    { id: 7, titulo: 'B (1991)' },
    { id: 20, titulo: 'C (1992)' },
    { id: 15, titulo: 'C (1992)' },
    { id: 1, titulo: 'Único (1993)' },
  ];
  const pares = detectarGemeos(filmes);
  assert.equal(pares.length, 2);
  for (const p of pares) {
    assert.ok(p.menor < p.maior);
    assert.equal(p.evidencia, 'titulo_identico');
  }
  assert.deepEqual(
    pares.map((p) => [p.menor, p.maior]).sort((a, b) => a[0] - b[0]),
    [[3, 10], [15, 20]],
  );
});

test('carregarGemeosManuais traz o par 1202/1504', () => {
  assert.deepEqual(carregarGemeosManuais(), [{ menor: 1202, maior: 1504, evidencia: 'mesmo_imdb_poc_2026-11-15' }]);
});

test('calcularOcultos = {267} + cada maior', () => {
  const o = calcularOcultos([
    { menor: 1, maior: 5, evidencia: 'x' },
    { menor: 1202, maior: 1504, evidencia: 'y' },
  ]);
  assert.ok(o instanceof Set);
  assert.deepEqual([...o].sort((a, b) => a - b), [5, 267, 1504]);
  assert.ok(!o.has(1202));
  assert.deepEqual([...calcularOcultos([])], [267]);
});
