// Testes da composição exata K + N dos candidatos e do déficit (real e de recuperação).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comporLista } from '../../src/candidatos/composicao.js';
import { criarAleatorio } from '../../src/util/aleatorio.js';

const sequencia = (ini, fim) => Array.from({ length: fim - ini + 1 }, (_, i) => ini + i);

test('ordem exata: P_K, depois colab na ordem de colab, depois preenchimento', () => {
  const r = comporLista({
    populares: [3, 1, 2, 4, 5, 6], colab: [9, 3, 7], k: 0, n: 5,
    nElegiveis: 3, elegiveisEntrePopulares: [3],
  });
  assert.deepEqual(r.ids, [9, 3, 7, 1, 2]);
  assert.equal(r.fonte.get(9), 'fc');
  assert.equal(r.fonte.get(1), 'preenchimento');
});

test('(2, 3): P_K primeiro e colab fora de P_K na ordem de colab', () => {
  const r = comporLista({
    populares: [1, 2, 3, 4, 5, 6], colab: [1, 2, 9, 8, 7], k: 2, n: 3,
    nElegiveis: 5, elegiveisEntrePopulares: [1, 2],
  });
  assert.deepEqual(r.ids, [1, 2, 9, 8, 7]);
  assert.equal(r.fonte.get(1), 'pop');
  assert.equal(r.fonte.get(7), 'fc');
  assert.equal(r.ids.length, 5);
});

test('n = 0 devolve populares.slice(0, k)', () => {
  const r = comporLista({
    populares: [5, 4, 3, 2, 1], colab: [9, 8], k: 3, n: 0,
    nElegiveis: 2, elegiveisEntrePopulares: [],
  });
  assert.deepEqual(r.ids, [5, 4, 3]);
  assert.equal(r.completados, 0);
});

test('usuário sem curtidas: 150 de preenchimento, déficit todo real', () => {
  const r = comporLista({
    populares: sequencia(1, 400), colab: [], k: 0, n: 150,
    nElegiveis: 0, elegiveisEntrePopulares: [],
  });
  assert.equal(r.ids.length, 150);
  assert.ok(r.ids.every((id) => r.fonte.get(id) === 'preenchimento'));
  assert.equal(r.completados, 150);
  assert.equal(r.deficitReal, 150);
  assert.equal(r.deficitRecuperacao, 0);
});

test('k = 0, n = 3, colab com 1 item e 3 elegíveis: déficit de recuperação', () => {
  const r = comporLista({
    populares: sequencia(1, 20), colab: [50], k: 0, n: 3,
    nElegiveis: 3, elegiveisEntrePopulares: [],
  });
  assert.equal(r.completados, 2);
  assert.equal(r.deficitReal, 0);
  assert.equal(r.deficitRecuperacao, 2);
  assert.equal(r.devKMaiorQueElegK, false);
});

test('devK > elegK: sinaliza e não gera números negativos', () => {
  const r = comporLista({
    populares: sequencia(1, 20), colab: [50, 51], k: 0, n: 2,
    nElegiveis: 1, elegiveisEntrePopulares: [],
  });
  assert.equal(r.devKMaiorQueElegK, true);
  assert.ok(r.completados >= 0 && r.deficitReal >= 0 && r.deficitRecuperacao >= 0);
});

test('erro acionável quando os populares não bastam para o preenchimento', () => {
  assert.throws(
    () => comporLista({ populares: [1, 2], colab: [], k: 0, n: 5, nElegiveis: 0, elegiveisEntrePopulares: [] }),
    /populares/,
  );
});

test('propriedade: déficits somam completados; tamanho K+N; sem repetição (200 casos)', () => {
  const alea = criarAleatorio(1);
  const inteiro = (a, b) => a + Math.floor(alea() * (b - a + 1));
  for (let caso = 0; caso < 200; caso++) {
    const populares = sequencia(1, 400);
    const k = inteiro(0, 150);
    const n = inteiro(0, 150);
    const colab = [];
    const usados = new Set();
    const tam = inteiro(0, 300);
    while (colab.length < tam) {
      // mistura ids populares (1..150) e ids fora da lista de populares
      const id = alea() < 0.4 ? inteiro(1, 150) : inteiro(1000, 1400);
      if (!usados.has(id)) { usados.add(id); colab.push(id); }
    }
    const entre = sequencia(1, 150).filter(() => alea() < 0.3);
    const nElegiveis = entre.length + inteiro(0, 300);
    const r = comporLista({ populares, colab, k, n, nElegiveis, elegiveisEntrePopulares: entre });
    assert.equal(r.deficitReal + r.deficitRecuperacao, r.completados);
    assert.ok(r.deficitReal >= 0 && r.deficitRecuperacao >= 0);
    assert.equal(r.ids.length, k + n);
    assert.equal(new Set(r.ids).size, k + n);
  }
});
