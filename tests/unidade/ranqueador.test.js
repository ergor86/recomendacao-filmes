// Testes do ranqueador: candidatos por prefixo (R6), top-10 determinístico e pontuação com a rede.
// Só dados sintéticos; a rede é minúscula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRegua } from '../../src/features/regua.js';
import { criarRede } from '../../src/modelo/rede.js';
import { candidatosDe, pontuarCandidatos, top10PorScore } from '../../src/modelo/ranqueador.js';
import { contribuicaoExclusiva, contribuicaoExclusivaAgregada } from '../../src/candidatos/hibrido.js';

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
  { usuario: 2, filme: 1, nota: 4, ts: 1 },
];
const regua = calcularRegua({
  treino, filmes, usuarios,
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
});

test('candidatosDe usa prefixos das listas gravadas (R6)', () => {
  const entrada = { populares: [10, 11, 12, 13], vizinhos: [12, 20, 21] };
  const r = candidatosDe(entrada, 3, 2);
  assert.deepEqual(r.ids, [10, 11, 12, 20]);
  assert.equal(r.fonte.get(12), 'ambas');
  assert.equal(r.fonte.get(20), 'vet');
  assert.deepEqual(candidatosDe(entrada, 2, 0).ids, [10, 11]);
});

test('top10PorScore desempata pelo id crescente', () => {
  const m = new Map();
  for (let id = 20; id >= 1; id--) m.set(id, id <= 12 ? 0.5 : 0.1);
  m.set(30, 0.9);
  assert.deepEqual(top10PorScore(m), [30, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('top10PorScore com menos de 10 candidatos dá erro', () => {
  assert.throws(() => top10PorScore(new Map([[1, 0.5]])), /10/);
});

test('pontuarCandidatos devolve um score finito por candidato, inclusive sem curtidas', () => {
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: 70, semente: 1 });
  const base = { modelo, regua, semPop: false, candidatos: [1, 2, 3], filmesPorId };
  const com = pontuarCandidatos({ ...base, usuario: usuarios[0], curtidos: [A, B] });
  const sem = pontuarCandidatos({ ...base, usuario: usuarios[1], curtidos: [] });
  for (const m of [com, sem]) {
    assert.deepEqual([...m.keys()], [1, 2, 3]);
    for (const s of m.values()) assert.ok(Number.isFinite(s) && s >= 0 && s <= 1);
  }
});

test('pontuarCandidatos no controle sem popularidade usa 68 colunas', () => {
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: 68, semente: 1 });
  const m = pontuarCandidatos({ modelo, regua, semPop: true, usuario: usuarios[0], curtidos: [A], candidatos: [2, 3], filmesPorId });
  assert.equal(m.size, 2);
  // Modelo de 70 colunas com semPop = true: erro de dimensão.
  const errado = criarRede({ arquitetura: '64-32', dimEntrada: 70, semente: 1 });
  assert.throws(() => pontuarCandidatos({ modelo: errado, regua, semPop: true, usuario: usuarios[0], curtidos: [A], candidatos: [2], filmesPorId }), /dim/);
});

test('pontuarCandidatos com filme fora do catálogo dá erro acionável', () => {
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: 70, semente: 1 });
  assert.throws(() => pontuarCandidatos({ modelo, regua, semPop: false, usuario: usuarios[0], curtidos: [A], candidatos: [99], filmesPorId }), /99/);
});

test('contribuicaoExclusiva aceita origem pop e mantém o padrão vet', () => {
  const fonte = new Map([[1, 'pop'], [2, 'vet'], [3, 'ambas'], [4, 'pop']]);
  assert.equal(contribuicaoExclusiva([1, 2, 3, 4], fonte), 0.25);
  assert.equal(contribuicaoExclusiva([1, 2, 3, 4], fonte, 'pop'), 0.5);
  assert.equal(contribuicaoExclusivaAgregada([{ acertos: [1, 2], fonte }, { acertos: [4, 3], fonte }], 'pop'), 0.5);
  assert.equal(contribuicaoExclusivaAgregada([{ acertos: [1, 2], fonte }]), 0.5);
});
