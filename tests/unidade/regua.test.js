import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calcularRegua, salvarRegua, carregarRegua, faixaEpoca, popEscalada, popZ } from '../../src/features/regua.js';
import { jsonEstavel } from '../../src/util/json-estavel.js';
import { criarContexto } from '../../src/contexto.js';

const multi = (...idx) => Array.from({ length: 19 }, (_, i) => (idx.includes(i) ? 1 : 0));
const fixture = {
  treino: [
    { usuario: 1, filme: 1, nota: 5, ts: 1 },
    { usuario: 2, filme: 1, nota: 4, ts: 1 },
    { usuario: 3, filme: 1, nota: 2, ts: 1 },
  ],
  filmes: [
    { id: 1, titulo: 'A', ano: 1975, generos: multi(1, 2) },
    { id: 2, titulo: 'B', ano: 1985, generos: multi(3) },
    { id: 3, titulo: 'C', ano: null, generos: multi(4) },
  ],
  usuarios: [
    { id: 1, idade: 20, genero: 'M', ocupacao: 'a' },
    { id: 2, idade: 40, genero: 'F', ocupacao: 'b' },
  ],
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
};
const arq = path.join(os.tmpdir(), `regua-teste-${process.pid}.json`);

test('contagens vêm só do treino e logPop cobre todos os filmes', () => {
  const r = calcularRegua(fixture);
  assert.equal(r.contagens[1], 3);
  assert.equal(r.contagens[3], 0);
  assert.equal(r.logPop.min, 0);
  assert.ok(Math.abs(r.logPop.max - Math.log(4)) < 1e-12);
});
test('hash muda quando a régua muda e salvar/carregar preserva', () => {
  const r = calcularRegua(fixture);
  salvarRegua(r, arq);
  assert.deepEqual(carregarRegua(arq), r);
  const r2 = calcularRegua({ ...fixture, treino: fixture.treino.slice(1) });
  assert.notEqual(r.hash, r2.hash);
  fs.rmSync(arq, { force: true });
});
test('hash divergente no arquivo lança erro', () => {
  const r = calcularRegua(fixture);
  salvarRegua({ ...r, pesos: { ...r.pesos, genero: 0.7 } }, arq);
  assert.throws(() => carregarRegua(arq), /hash/);
  fs.rmSync(arq, { force: true });
});
test('régua ausente explica o que fazer', () => {
  assert.throws(() => carregarRegua('nao-existe.json'), /rode npm run carregar-filmes/);
});
test('faixaEpoca', () => assert.deepEqual([1979, 1980, 1989, 1990, null].map(faixaEpoca), [0, 1, 1, 2, null]));
test('campos fixos e estatísticas', () => {
  const r = calcularRegua(fixture);
  assert.deepEqual(r.faixasEpoca, ['antes1980', 'anos80', 'anos90']);
  assert.deepEqual(r.pesos, { genero: 0.6, epoca: 0.2, popularidade: 0.2 });
  assert.deepEqual(r.dimensoes, { busca: 23, rede: 70, redeSemPop: 68 });
  assert.equal(r.idade.media, 30);
  assert.equal(r.idade.desvio, 10);
  assert.equal(r.generos.length, 19);
  assert.equal(r.ocupacoes.length, 21);
});
test('referências: médias sobre as curtidas do treino', () => {
  const r = calcularRegua(fixture); // 2 curtidas, ambas do filme 1
  assert.deepEqual(r.referencias.generosMedia, multi(1, 2));
  assert.deepEqual(r.referencias.epocaMedia, [1, 0, 0]);
  assert.ok(Math.abs(r.referencias.popularidadeMedia - 1) < 1e-12);
});
test('popEscalada corta em 0 e 1; popZ da média é 0', () => {
  const r = calcularRegua(fixture);
  assert.equal(popEscalada(0, r), 0);
  assert.equal(popEscalada(1000, r), 1);
  assert.equal(popEscalada(-0.5, r), 0);
  const nMedia = Math.exp(r.logPopZ.media) - 1;
  assert.ok(Math.abs(popZ(nMedia, r)) < 1e-12);
});
test('jsonEstavel ordena chaves recursivamente', () => {
  assert.equal(jsonEstavel({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 0 } }), '{"a":{"c":0,"d":[{"x":2,"y":1}]},"b":1}');
});
test('criarContexto rejeita fase inválida', () => {
  assert.throws(() => criarContexto({ fase: 'xyz', dirDados: 'x' }), /fase/);
});
