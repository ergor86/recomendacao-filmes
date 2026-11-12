import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRegua } from '../../src/features/regua.js';
import {
  normalizarSeguro, popEscalada, popZ, vetorBuscaFilme, perfilUsuario,
  vetorBuscaUsuario, vetorBuscaUsuarioNovo, validarVetor,
} from '../../src/features/codificacao.js';

const umHot = (idx) => Array.from({ length: 19 }, (_, i) => (idx.includes(i) ? 1 : 0));
const filmes = [
  { id: 1, titulo: 'A', ano: 1995, generos: umHot([1, 8]) },
  { id: 2, titulo: 'B', ano: 1985, generos: umHot([3]) },
  { id: 267, titulo: 'C', ano: null, generos: umHot([0]) },
];
const regua = calcularRegua({
  treino: [
    { usuario: 1, filme: 1, nota: 5, ts: 1 },
    { usuario: 2, filme: 1, nota: 4, ts: 1 },
    { usuario: 3, filme: 1, nota: 2, ts: 1 },
    { usuario: 1, filme: 2, nota: 4, ts: 1 },
  ],
  filmes,
  usuarios: [{ id: 1, idade: 20, genero: 'M', ocupacao: 'a' }, { id: 2, idade: 40, genero: 'F', ocupacao: 'b' }],
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
});

test('vetor do filme: gênero normalizado ×0,6 nas posições certas, época ×0,2, popularidade ×0,2', () => {
  const v = vetorBuscaFilme(filmes[0], regua);
  assert.equal(v.length, 23);
  assert.ok(Math.abs(v[1] - 0.6 / Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(v[8] - 0.6 / Math.SQRT2) < 1e-12);
  assert.deepEqual(v.slice(19, 22), [0, 0, 0.2]);
  assert.ok(Math.abs(v[22] - 0.2) < 1e-12);
});
test('filme sem data: bloco de época zerado e sem NaN', () => {
  const v = vetorBuscaFilme(filmes[2], regua);
  assert.deepEqual(v.slice(19, 22), [0, 0, 0]);
  validarVetor(v, 23);
});
test('popularidade cortada em [0, 1]', () => {
  assert.equal(popEscalada(10 ** 6, regua), 1);
  assert.equal(popEscalada(0, regua), 0);
  assert.ok(Number.isFinite(popZ(2, regua)));
});
test('usuário novo: 1/√3 em cada gênero favorito antes do peso', () => {
  const v = vetorBuscaUsuarioNovo([1, 4, 7], regua);
  assert.equal(v.length, 23);
  for (const g of [1, 4, 7]) assert.ok(Math.abs(v[g] - 0.6 / Math.sqrt(3)) < 1e-12);
  assert.ok(Math.abs(v[22] - 0.2 * regua.referencias.popularidadeMedia) < 1e-12);
});
test('usuário sem curtidas: perfil null e nenhum NaN', () => {
  assert.equal(perfilUsuario([], regua), null);
});
test('perfil e vetor do usuário: médias brutas, depois normaliza e pesa', () => {
  const p = perfilUsuario([filmes[0], filmes[2]], regua);
  assert.equal(p.generos[0], 0.5);
  assert.equal(p.generos[1], 0.5);
  assert.deepEqual(p.epoca, [0, 0, 0.5]);
  assert.ok(Math.abs(p.popularidade - 0.5) < 1e-12);
  const v = vetorBuscaUsuario(p, regua);
  assert.deepEqual(v.slice(19, 22), [0, 0, 0.2]);
  assert.ok(Math.abs(v[22] - 0.1) < 1e-12);
  validarVetor(v, 23);
});
test('normalizarSeguro: vetor zerado continua zerado', () => {
  assert.deepEqual(normalizarSeguro([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(normalizarSeguro([3, 4]), [0.6, 0.8]);
});
test('validarVetor rejeita NaN, dimensão errada e vetor de usuário zerado', () => {
  assert.throws(() => validarVetor([NaN, ...Array(22).fill(0)], 23), /vetor inválido/);
  assert.throws(() => validarVetor([1, 2], 23), /vetor inválido/);
  assert.throws(() => validarVetor(Array(23).fill(0), 23), /zerado/);
});
