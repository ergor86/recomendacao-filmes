// Tarefa 8: explicação dos itens S1 (spec 4.4, passo 9), com regra de inteiros.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explicar } from '../../servidor/recomendacao/explicacao.js';

const faixa = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('explicar', () => {
  it('exclui contribuição zero', () => {
    const fc = { nUsuarios: 10, fasPorFilme: new Map([[1, [1, 2]], [2, [3, 4]], [9, [2, 5]]]) };
    assert.deepEqual(explicar(fc, [1, 2], 9), [1]);
    assert.deepEqual(explicar(fc, [2], 9), []);
  });

  it('ordem normalizada difere da interseção crua', () => {
    // j: fãs 1..55. i₁: |F| = 400, interseção 40 → 40/√400 = 2. i₂: |F| = 25, interseção 15 → 15/√25 = 3.
    const fasJ = faixa(1, 55);
    const fasI1 = [...faixa(1, 40), ...faixa(101, 460)];
    const fasI2 = [...faixa(41, 55), ...faixa(501, 510)];
    assert.equal(fasI1.length, 400);
    assert.equal(fasI2.length, 25);
    const fc = { nUsuarios: 943, fasPorFilme: new Map([[10, fasI1], [20, fasI2], [99, fasJ]]) };
    assert.deepEqual(explicar(fc, [10, 20], 99), [20, 10]);
    assert.deepEqual(explicar(fc, [20, 10], 99), [20, 10]);
  });

  it('desempate por menor id', () => {
    // contribuições iguais: mesma interseção (1) e mesmo |F| (2) para 7, 3 e 5
    const fc = {
      nUsuarios: 20,
      fasPorFilme: new Map([[7, [1, 2]], [3, [1, 3]], [5, [1, 4]], [99, [1, 9]]]),
    };
    assert.deepEqual(explicar(fc, [7, 5, 3], 99), [3, 5]);
  });

  it('desempate por id também com frações iguais e tamanhos diferentes', () => {
    // i=8: a=1, |F|=1 → 1/1; i=4: a=2, |F|=4 → 4/4. Cruzado: 1²·4 = 2²·1.
    const fc = {
      nUsuarios: 20,
      fasPorFilme: new Map([[8, [1]], [4, [2, 3, 10, 11]], [6, [3, 12, 13, 14, 15, 16, 17, 18, 19]], [99, [1, 2, 3]]]),
    };
    assert.deepEqual(explicar(fc, [8, 6, 4], 99), [4, 8]);
  });

  it('no máximo 2 e [] para item sem vetor', () => {
    const fc = { nUsuarios: 5, fasPorFilme: new Map([[1, [1]], [2, [1]], [3, [1]], [9, [1]]]) };
    assert.deepEqual(explicar(fc, [3, 2, 1], 9), [1, 2]);
    assert.deepEqual(explicar(fc, [1, 2], 50), []);
  });
});
