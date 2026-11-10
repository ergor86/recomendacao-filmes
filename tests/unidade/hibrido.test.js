import test from 'node:test';
import assert from 'node:assert/strict';
import { unirCandidatos, gerarCandidatos, contribuicaoExclusiva, contribuicaoExclusivaAgregada } from '../../src/candidatos/hibrido.js';

const regua = { generos: ['a'], contagens: {}, dimensoes: { busca: 23 } };

test('união sem repetição e com a fonte marcada', () => {
  const u = unirCandidatos([1, 2, 3], [3, 4]);
  assert.deepEqual(u.ids, [1, 2, 3, 4]);
  assert.deepEqual([u.fonte.get(1), u.fonte.get(3), u.fonte.get(4)], ['pop', 'ambas', 'vet']);
});
test('usuário sem curtidas recebe só populares e não consulta o banco', async () => {
  const poolQueFalha = { connect: () => { throw new Error('não deveria consultar'); } };
  const r = await gerarCandidatos({ pool: poolQueFalha, regua, usuario: 685, vistos: new Set(), filmesCurtidos: [], ranking: [1, 2, 3], k: 2, n: 50 });
  assert.deepEqual(r.ids, [1, 2]);
  assert.equal(r.vetorUsuario, null);
});
test('n = 0 não consulta o banco', async () => {
  const poolQueFalha = { connect: () => { throw new Error('não deveria consultar'); } };
  const filme = { id: 9, ano: 1995, generos: [1] };
  const r = await gerarCandidatos({ pool: poolQueFalha, regua, usuario: 1, vistos: new Set([1]), filmesCurtidos: [filme], ranking: [1, 2, 3], k: 2, n: 0 });
  assert.deepEqual(r.ids, [2, 3]);
});
test('contribuição exclusiva conta só acertos vindos da fonte vetorial', () => {
  assert.equal(contribuicaoExclusiva([1, 3, 4], new Map([[1, 'pop'], [3, 'ambas'], [4, 'vet']])), 1 / 3);
});
test('contribuição exclusiva agregada soma acertos entre usuários (não é a média das razões)', () => {
  const listas = [
    { acertos: [1], fonte: new Map([[1, 'vet']]) }, // razão 1
    { acertos: [2, 3, 4, 5], fonte: new Map([[2, 'pop'], [3, 'pop'], [4, 'ambas'], [5, 'vet']]) }, // razão 1/4
  ];
  assert.equal(contribuicaoExclusivaAgregada(listas), 2 / 5);
  assert.equal(contribuicaoExclusivaAgregada([]), 0);
});
