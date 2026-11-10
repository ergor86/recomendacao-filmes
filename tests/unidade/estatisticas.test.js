import test from 'node:test';
import assert from 'node:assert/strict';
import { resumoPopulacao, distribuicaoNotas } from '../../src/dados/estatisticas.js';

test('resumoPopulacao calcula média e mediana de notas e curtidas', () => {
  const av = [[1,1,5],[1,2,4],[1,3,2],[2,1,1]].map(([usuario, filme, nota]) => ({ usuario, filme, nota }));
  const usuarios = [{ id: 1, idade: 20, genero: 'F' }, { id: 2, idade: 40, genero: 'M' }];
  const r = resumoPopulacao(av, [1, 2], usuarios);
  assert.equal(r.notasMedia, 2);
  assert.equal(r.curtidasMedia, 1);
  assert.equal(r.idadeMedia, 30);
  assert.equal(r.fracaoMulheres, 0.5);
});

test('mediana de quantidade par é a média dos dois centrais', () => {
  const av = [[1,1,5],[1,2,5],[1,3,5],[2,1,5]].map(([usuario, filme, nota]) => ({ usuario, filme, nota }));
  const usuarios = [{ id: 1, idade: 20, genero: 'F' }, { id: 2, idade: 40, genero: 'M' }];
  const r = resumoPopulacao(av, [1, 2], usuarios);
  assert.equal(r.notasMediana, 2);
});

test('distribuicaoNotas conta notas de 1 a 5', () => {
  const av = [1, 5, 5, 3].map((nota) => ({ nota }));
  assert.deepEqual(distribuicaoNotas(av), { 1: 1, 2: 0, 3: 1, 4: 0, 5: 2 });
});
