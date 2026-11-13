// Testes da entrada da rede (70 posições): demografia, perfil sem o filme do par,
// popularidade do par e montagem do vetor. Usa só dados sintéticos criados aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRegua, popZ, popEscalada } from '../../src/features/regua.js';
import {
  historicoDoTreino, demografia, popZReferencia, resumoCurtidos,
  perfilRede, popZDoPar, filmeRede, montarEntrada,
} from '../../src/features/entrada.js';

const multi = (...idx) => Array.from({ length: 19 }, (_, i) => (idx.includes(i) ? 1 : 0));
const A = { id: 1, titulo: 'A', ano: 1975, generos: multi(1, 2) };
const B = { id: 2, titulo: 'B', ano: 1995, generos: multi(3) };
const C = { id: 3, titulo: 'C', ano: null, generos: multi(4) };
const filmes = [A, B, C];
const filmesPorId = new Map(filmes.map((f) => [f.id, f]));
const usuarios = [
  { id: 1, idade: 20, genero: 'M', ocupacao: 'o0' },
  { id: 2, idade: 40, genero: 'F', ocupacao: 'o1' },
];
const treino = [
  { usuario: 1, filme: 1, nota: 5, ts: 1 },
  { usuario: 1, filme: 2, nota: 4, ts: 2 },
  { usuario: 1, filme: 3, nota: 2, ts: 3 },
  { usuario: 2, filme: 1, nota: 4, ts: 1 },
  { usuario: 2, filme: 2, nota: 3, ts: 2 },
];
const regua = calcularRegua({
  treino, filmes, usuarios,
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
});
const proximo = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);

test('historicoDoTreino guarda notas e curtidos (nota >= 4) na ordem do treino', () => {
  const h = historicoDoTreino(treino, filmesPorId);
  assert.equal(h.get(1).notas.get(3), 2);
  assert.deepEqual(h.get(1).curtidos.map((f) => f.id), [1, 2]);
  assert.deepEqual(h.get(2).curtidos.map((f) => f.id), [1]);
});

test('demografia: z-score da idade, gênero e ocupação one-hot', () => {
  const d = demografia(usuarios[0], regua);
  assert.equal(d.length, 24);
  assert.ok(Math.abs(d[0] - (20 - regua.idade.media) / regua.idade.desvio) < 1e-12);
  assert.deepEqual(d.slice(1, 3), [1, 0]);
  assert.equal(d[3], 1);
  assert.equal(d.slice(3).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(demografia(usuarios[1], regua).slice(1, 3), [0, 1]);
  assert.throws(() => demografia({ ...usuarios[0], ocupacao: 'xyz' }, regua), /ocupa/);
  assert.throws(() => demografia({ ...usuarios[0], genero: 'X' }, regua), /gênero/);
});

test('perfil sem o filme do par é igual ao perfil só dos outros curtidos', () => {
  const completo = resumoCurtidos([A, B], regua);
  const soB = perfilRede(resumoCurtidos([B], regua), regua);
  assert.ok(proximo(perfilRede(completo, regua, A), soB));
  assert.equal(perfilRede(completo, regua).length, 23);
});

test('usuário sem curtidas (ou com só o curtido removido): referência, sem NaN', () => {
  const ref = [...regua.referencias.generosMedia, ...regua.referencias.epocaMedia, popZReferencia(regua)];
  assert.deepEqual(perfilRede(resumoCurtidos([], regua), regua), ref);
  assert.deepEqual(perfilRede(resumoCurtidos([A], regua), regua, A), ref);
  assert.ok(ref.every(Number.isFinite));
});

test('R11: curtidos {sem ano, 1995} dão época [0, 0, 0,5]', () => {
  const p = perfilRede(resumoCurtidos([C, B], regua), regua);
  assert.deepEqual(p.slice(19, 22), [0, 0, 0.5]);
});

test('R3: popularidade do perfil usa a contagem sem desconto', () => {
  const p = perfilRede(resumoCurtidos([A, B], regua), regua);
  const esperado = (popZ(regua.contagens[1], regua) + popZ(regua.contagens[2], regua)) / 2;
  assert.ok(Math.abs(p[22] - esperado) < 1e-12);
});

test('popZReferencia bate com popZ de uma contagem cujo popEscalada é a média', () => {
  const p = regua.referencias.popularidadeMedia;
  const logN = regua.logPop.min + p * (regua.logPop.max - regua.logPop.min);
  const n = Math.expm1(logN);
  assert.ok(Math.abs(popEscalada(n, regua) - p) < 1e-12);
  assert.ok(Math.abs(popZReferencia(regua) - popZ(n, regua)) < 1e-12);
});

test('popZDoPar: com nota no treino da régua usa contagem - 1; senão a cheia', () => {
  assert.equal(popZDoPar(1, true, regua), popZ(regua.contagens[1] - 1, regua));
  assert.equal(popZDoPar(1, false, regua), popZ(regua.contagens[1], regua));
});

test('filmeRede: gêneros, época one-hot (sem ano = zeros) e popularidade', () => {
  const f = filmeRede(B, 0.7);
  assert.equal(f.length, 23);
  assert.deepEqual(f.slice(0, 19), B.generos);
  assert.deepEqual(f.slice(19, 22), [0, 0, 1]);
  assert.equal(f[22], 0.7);
  assert.deepEqual(filmeRede(C, 0).slice(19, 22), [0, 0, 0]);
});

test('montarEntrada: 70 posições; semPop dá 68 sem as posições 46 e 69', () => {
  const demo = demografia(usuarios[0], regua);
  const perfil = perfilRede(resumoCurtidos([A, B], regua), regua);
  const filme = filmeRede(B, 0.3);
  const v = montarEntrada(demo, perfil, filme);
  assert.equal(v.length, 70);
  assert.equal(v[46], perfil[22]);
  assert.equal(v[69], 0.3);
  assert.equal(v[47], B.generos[0]);
  const s = montarEntrada(demo, perfil, filme, { semPop: true });
  assert.equal(s.length, 68);
  assert.deepEqual(s, v.filter((_, i) => i !== 46 && i !== 69));
});

test('montarEntrada lança erro com NaN ou dimensão errada', () => {
  const demo = demografia(usuarios[0], regua);
  const perfil = perfilRede(resumoCurtidos([A], regua), regua);
  const filme = filmeRede(B, NaN);
  assert.throws(() => montarEntrada(demo, perfil, filme), /NaN|finit/i);
  assert.throws(() => montarEntrada(demo.slice(1), perfil, filmeRede(B, 0)), /dimens/i);
});
