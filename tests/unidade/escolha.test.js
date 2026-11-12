// Testes da regra de escolha de configuração e das projeções de métricas por usuário.
// Só dados sintéticos, com expectativas calculadas à mão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetar, mediaEntreSementes, escolherConfiguracao } from '../../src/avaliacao/escolha.js';

const mapa = (v) => new Map(v.map((x, i) => [i + 1, x]));
const perto = (a, b) => Math.abs(a - b) < 1e-9;

test('projetar extrai uma métrica por usuário', () => {
  const por = new Map([[1, { ndcg: 0.5, precisao: 0.1, recall: 0.2 }], [2, { ndcg: 0.25, precisao: 0, recall: 1 }]]);
  assert.deepEqual([...projetar(por, 'recall')], [[1, 0.2], [2, 1]]);
  assert.deepEqual([...projetar(por, 'ndcg')], [[1, 0.5], [2, 0.25]]);
});

test('mediaEntreSementes tira a média por usuário', () => {
  const m = mediaEntreSementes([mapa([0.2, 0.4]), mapa([0.4, 0.4]), mapa([0.6, 0.1])]);
  assert.ok(perto(m.get(1), 0.4));
  assert.ok(perto(m.get(2), 0.3));
});

test('mediaEntreSementes com usuários diferentes dá erro', () => {
  assert.throws(() => mediaEntreSementes([mapa([1, 2]), mapa([1, 2, 3])]), /usuários/);
  assert.throws(() => mediaEntreSementes([]), /semente/);
});

// A é a melhor; B (mais simples) difere de A por [.01, -.01, .01, 0]: média .0025, erro padrão ≈ .00479.
const A = { nome: 'A', porUsuario: mapa([0.5, 0.6, 0.4, 0.5]), porSemente: [0.5, 0.51], simplicidade: [2] };
const B = { nome: 'B', porUsuario: mapa([0.49, 0.61, 0.39, 0.5]), porSemente: [0.49, 0.5], simplicidade: [1] };
const C = { nome: 'C', porUsuario: mapa([0.3, 0.4, 0.2, 0.3]), porSemente: [0.29, 0.31], simplicidade: [0] };

test('empate dentro do erro padrão escolhe a mais simples', () => {
  const r = escolherConfiguracao([A, B]);
  assert.equal(r.melhor, 'A');
  assert.equal(r.escolhida, 'B');
  const tb = r.tabela.find((t) => t.nome === 'B');
  assert.ok(perto(tb.diferenca, 0.0025));
  assert.ok(Math.abs(tb.erroPadrao - 0.0047871) < 1e-6);
  assert.equal(tb.empata, true);
  assert.equal(r.tabela.find((t) => t.nome === 'A').empata, true);
});

test('diferença maior que o erro padrão escolhe a melhor, mesmo sendo mais complexa', () => {
  const r = escolherConfiguracao([A, B, C]);
  assert.equal(r.escolhida, 'B');
  assert.equal(r.tabela.find((t) => t.nome === 'C').empata, false);
  const r2 = escolherConfiguracao([A, C]);
  assert.equal(r2.escolhida, 'A');
  assert.equal(r2.melhor, 'A');
});

test('desempate pelo segundo elemento da simplicidade', () => {
  const B1 = { ...B, nome: 'B1', simplicidade: [1, 5] };
  const B2 = { ...B, nome: 'B2', simplicidade: [1, 3] };
  assert.equal(escolherConfiguracao([A, B1, B2]).escolhida, 'B2');
});

test('simplicidade totalmente igual mantém a de maior média', () => {
  const A2 = { ...A, simplicidade: [1] };
  assert.equal(escolherConfiguracao([B, A2]).escolhida, 'A');
});

test('fragil quando as faixas por semente da melhor e da escolhida se sobrepõem', () => {
  // A [.5,.51] e B [.49,.5] se sobrepõem em .5.
  assert.equal(escolherConfiguracao([A, B]).fragil, true);
  const Bsep = { ...B, porSemente: [0.40, 0.45] };
  assert.equal(escolherConfiguracao([A, Bsep]).fragil, false);
});

test('fragil com escolhida = melhor olha as demais configurações', () => {
  assert.equal(escolherConfiguracao([A, C]).fragil, false);
  const Cperto = { ...C, porSemente: [0.505, 0.55] };
  assert.equal(escolherConfiguracao([A, Cperto]).fragil, true);
});

test('conjuntos de usuários diferentes dão erro', () => {
  const D = { ...B, porUsuario: new Map([[1, 0.1], [2, 0.1], [3, 0.1], [9, 0.1]]) };
  assert.throws(() => escolherConfiguracao([A, D]), /usuários/);
});
