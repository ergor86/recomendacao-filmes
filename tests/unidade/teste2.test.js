// Testes do teste-2 (notas escondidas dos usuários 1–462 dentro do u1.base) e do hash de avaliações.
// Usa uma base sintética; os dados reais nunca entram nos testes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividirTeste2, hashAvaliacoes } from '../../src/dados/teste2.js';
import { criarAleatorio, embaralhar } from '../../src/util/aleatorio.js';

// Gera n notas (filmes 1..n) para o usuário, com notas e timestamps determinísticos.
function notasDe(usuario, n) {
  return Array.from({ length: n }, (_, i) => ({
    usuario, filme: i + 1, nota: (i % 5) + 1, timestamp: 100 + i,
  }));
}

const base = [
  ...notasDe(1, 10), ...notasDe(2, 2), ...notasDe(462, 5), ...notasDe(463, 10), ...notasDe(500, 10),
];
const par = (a) => `${a.usuario}:${a.filme}`;

test('dividirTeste2 esconde round(0,2·n) notas só dos usuários 1–462', () => {
  const { teste2, semTeste2 } = dividirTeste2(base);
  const por = (u) => teste2.filter((a) => a.usuario === u).length;
  assert.equal(por(1), 2);
  assert.equal(por(2), 0); // Math.round(0,4) = 0
  assert.equal(por(462), 1);
  assert.equal(por(463), 0);
  assert.equal(por(500), 0);
  assert.equal(teste2.length + semTeste2.length, base.length);
});

test('teste2 e semTeste2 particionam a base (união = base, interseção vazia)', () => {
  const { teste2, semTeste2 } = dividirTeste2(base);
  const a = new Set(teste2.map(par));
  const b = new Set(semTeste2.map(par));
  for (const p of a) assert.ok(!b.has(p), `par repetido: ${p}`);
  assert.deepEqual([...a, ...b].sort(), base.map(par).sort());
});

test('dividirTeste2 é determinístico', () => {
  assert.deepEqual(dividirTeste2(base), dividirTeste2(base));
});

test('a escolha do usuário 1 usa embaralhar sobre as notas ordenadas por filme, semente 20_000_001', () => {
  const ordenadas = base.filter((a) => a.usuario === 1).sort((x, y) => x.filme - y.filme);
  const esperado = embaralhar(ordenadas, criarAleatorio(20_000_001)).slice(0, 2).map(par);
  const { teste2 } = dividirTeste2(base);
  assert.deepEqual(teste2.filter((a) => a.usuario === 1).map(par), esperado);
});

test('hashAvaliacoes não depende da ordem e muda se uma nota mudar', () => {
  const h = hashAvaliacoes(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashAvaliacoes([...base].reverse()), h);
  const alterada = base.map((a, i) => (i === 3 ? { ...a, nota: a.nota === 5 ? 4 : 5 } : a));
  assert.notEqual(hashAvaliacoes(alterada), h);
});

// ---- Passo 0: resumoDivisoesV2 (agregados, sem listas por usuário) ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumoDivisoesV2, calcularEst } from '../../src/dados/teste2.js';

const zeros = Array(19).fill(0);
const usuariosResumo = [1, 2, 3, 462, 463, 464, 465];
// usuário 2 tem 2 notas (0 escondidas); os demais têm 10
const linhas = usuariosResumo.flatMap((u) => Array.from({ length: u === 2 ? 2 : 10 }, (_, i) => `${u}\t${i + 1}\t${((i + u) % 5) + 1}\t${100 + i}`));
const dirResumo = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-div-'));
fs.writeFileSync(path.join(dirResumo, 'u1.base'), linhas.join('\n') + '\n');
fs.writeFileSync(path.join(dirResumo, 'u.item'),
  Array.from({ length: 10 }, (_, i) => `${i + 1}|F${i + 1}|01-Jan-1990||u|${zeros.join('|')}`).join('\n') + '\n');
fs.writeFileSync(path.join(dirResumo, 'u.user'), usuariosResumo.map((u) => `${u}|24|M|admin|1`).join('\n') + '\n');
fs.writeFileSync(path.join(dirResumo, 'u.genre'), 'g|0\n');
fs.writeFileSync(path.join(dirResumo, 'u.occupation'), 'admin\n');

const CHAVES_EST = ['media', 'mediana', 'p10', 'p25', 'p75', 'p90'];
const CHAVES_RESUMO = ['avaliaveis', 'curtidasEscondidas', 'notasDisponiveis', 'notasEscondidas', 'semCurtidas'];

test('resumoDivisoesV2 devolve só as chaves do formato e nenhuma lista por usuário', () => {
  const r = resumoDivisoesV2(dirResumo);
  assert.deepEqual(Object.keys(r).sort(), ['hashes', 'teste2', 'validacao']);
  assert.deepEqual(Object.keys(r.hashes).sort(), ['teste2', 'treinoV2Exp', 'treinoV2Final', 'validacao']);
  for (const h of Object.values(r.hashes)) assert.match(h, /^[0-9a-f]{64}$/);
  for (const c of ['teste2', 'validacao']) {
    assert.deepEqual(Object.keys(r[c]).sort(), CHAVES_RESUMO);
    for (const e of ['notasDisponiveis', 'notasEscondidas', 'curtidasEscondidas']) {
      assert.deepEqual(Object.keys(r[c][e]).sort(), CHAVES_EST);
    }
    assert.ok(Number.isInteger(r[c].semCurtidas) && Number.isInteger(r[c].avaliaveis));
  }
  const grandes = JSON.stringify(r).match(/\[[^\]]*\]/g)?.filter((a) => a.split(',').length > 4) ?? [];
  assert.deepEqual(grandes, []);
});

test('teste2.avaliaveis confere com a contagem manual e os zeros entram no denominador', () => {
  const r = resumoDivisoesV2(dirResumo);
  const { teste2 } = dividirTeste2(lerBase());
  const curt = new Map([1, 2, 3, 462].map((u) => [u, 0]));
  for (const a of teste2) if (a.nota >= 4) curt.set(a.usuario, curt.get(a.usuario) + 1);
  const manual = [...curt.values()];
  assert.equal(r.teste2.avaliaveis, manual.filter((c) => c > 0).length);
  assert.equal(r.teste2.semCurtidas, manual.filter((c) => c === 0).length);
  assert.equal(r.teste2.avaliaveis + r.teste2.semCurtidas, 4); // o usuário 2 (0 escondidas) conta
  assert.equal(r.teste2.curtidasEscondidas.media, manual.reduce((s, x) => s + x, 0) / 4);
  assert.equal(r.teste2.notasEscondidas.media, (2 + 0 + 2 + 2) / 4);
});

function lerBase() {
  return linhas.map((l) => {
    const [usuario, filme, nota, timestamp] = l.split('\t').map(Number);
    return { usuario, filme, nota, timestamp };
  });
}

test('calcularEst: média, mediana e percentis pelo posto mais próximo', () => {
  assert.deepEqual(calcularEst([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    { media: 5.5, mediana: 5.5, p10: 1, p25: 3, p75: 8, p90: 9 });
});
