import '../apoio/dados-exigidos.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarContexto } from '../../../src/contexto.js';
import { detectarGemeos, carregarGemeosManuais, calcularOcultos } from '../../comum/gemeos.js';

const dirDados = process.env.ML100K_DIR;

test('gêmeos nos dados reais (v2-final)', { skip: !dirDados && 'ML100K_DIR não definido' }, () => {
  const { filmes } = criarContexto({ fase: 'v2-final', dirDados }).dataset;
  const pares = detectarGemeos(filmes);
  assert.equal(pares.length, 18);
  const titulo = (id) => filmes.find((f) => f.id === id).titulo;
  for (const id of [1202, 1504]) {
    assert.ok(titulo(id).includes('Bewegte Mann, Der'), titulo(id));
    assert.ok(titulo(id).includes('1994'), titulo(id));
  }
  const ocultos = calcularOcultos([...pares, ...carregarGemeosManuais()]);
  assert.ok(ocultos.has(267));
  for (const p of pares) assert.ok(ocultos.has(p.maior));
  assert.ok(ocultos.has(1504));
  assert.ok(!ocultos.has(1202));
});
