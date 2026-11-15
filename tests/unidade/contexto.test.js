// Testes de criarContexto: o u1.test só pode ser lido quando pedido explicitamente.
// Usa uma pasta temporária sintética SEM u1.test (os dados reais nunca são copiados).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarContexto } from '../../src/contexto.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-'));
const zeros = Array(19).fill(0);
// 2 filmes; usuários 1 e 463 a 466 (os de 463 em diante entram na validação)
const notas = [];
for (const u of [1, 463, 464, 465, 466]) {
  for (let f = 1; f <= 5; f++) notas.push(`${u}\t${f}\t${(f % 5) + 1}\t${100 + f}`);
}
fs.writeFileSync(path.join(dir, 'u1.base'), notas.join('\n') + '\n');
const filmes = [];
for (let f = 1; f <= 5; f++) filmes.push(`${f}|Filme ${f}|01-Jan-1990||u|${zeros.join('|')}`);
fs.writeFileSync(path.join(dir, 'u.item'), filmes.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'u.user'),
  [1, 463, 464, 465, 466].map((u) => `${u}|24|M|admin|1`).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'u.genre'), 'g|0\n');
fs.writeFileSync(path.join(dir, 'u.occupation'), 'admin\n');

test('fase exp funciona sem u1.test e os alvos são a validação', () => {
  const c = criarContexto({ fase: 'exp', dirDados: dir });
  assert.equal(c.dataset.teste, null);
  assert.equal(c.divisoes.teste, null);
  assert.equal(c.alvos, c.divisoes.validacao);
  assert.ok(c.alvos.length > 0);
});

test('fase final sem incluirTeste funciona e alvos é null', () => {
  const c = criarContexto({ fase: 'final', dirDados: dir });
  assert.equal(c.alvos, null);
  assert.equal(c.treino, c.divisoes.treinoFinal);
});

test('fase final com incluirTeste lança erro de arquivo ausente', () => {
  assert.throws(() => criarContexto({ fase: 'final', dirDados: dir, incluirTeste: true }), /u1\.test|ENOENT/);
});

// ---- Fases v2 (teste-2 isolado dentro do u1.base) ----
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-v2-'));
const usuariosV2 = [1, 2, 462, 463, 464, 465];
const notasV2 = [];
for (const u of usuariosV2) {
  const n = u === 2 ? 2 : 10;
  for (let f = 1; f <= n; f++) notasV2.push(`${u}\t${f}\t${((f + u) % 5) + 1}\t${100 + f}`);
}
function gravarV2(linhas) {
  fs.writeFileSync(path.join(dir2, 'u1.base'), linhas.join('\n') + '\n');
}
gravarV2(notasV2);
fs.copyFileSync(path.join(dir, 'u.item'), path.join(dir2, 'u.item'));
fs.writeFileSync(path.join(dir2, 'u.user'), usuariosV2.map((u) => `${u}|24|M|admin|1`).join('\n') + '\n');
fs.copyFileSync(path.join(dir, 'u.genre'), path.join(dir2, 'u.genre'));
fs.copyFileSync(path.join(dir, 'u.occupation'), path.join(dir2, 'u.occupation'));

const pares = (lista) => lista.map((a) => `${a.usuario}:${a.filme}`).sort();

test('fases v2: chaves do contexto e do dataset', () => {
  for (const fase of ['v2-exp', 'v2-final']) {
    const c = criarContexto({ fase, dirDados: dir2 });
    assert.deepEqual(Object.keys(c).sort(), ['alvos', 'dataset', 'fase', 'regua', 'treino']);
    assert.deepEqual(Object.keys(c.dataset).sort(), ['filmes', 'generos', 'ocupacoes', 'usuarios']);
    assert.equal(c.fase, fase);
  }
});

test('v2-final: alvos null sem a opção; com incluirTeste2 são o teste-2 e treino/régua não mudam', () => {
  const sem = criarContexto({ fase: 'v2-final', dirDados: dir2 });
  const com = criarContexto({ fase: 'v2-final', dirDados: dir2, incluirTeste2: true });
  assert.equal(sem.alvos, null);
  assert.ok(com.alvos.length > 0);
  assert.deepEqual(pares(com.treino), pares(sem.treino));
  assert.equal(com.regua.hash, sem.regua.hash);
  assert.equal(com.alvos.length + com.treino.length, notasV2.length);
});

test('nenhum par do teste-2 está no treino de v2-exp nem de v2-final', () => {
  const t2 = new Set(pares(criarContexto({ fase: 'v2-final', dirDados: dir2, incluirTeste2: true }).alvos));
  for (const fase of ['v2-exp', 'v2-final']) {
    const { treino } = criarContexto({ fase, dirDados: dir2 });
    for (const p of pares(treino)) assert.ok(!t2.has(p), `${fase} contém ${p} do teste-2`);
  }
});

test('a validação de v2-exp é igual à da fase exp', () => {
  const v2 = criarContexto({ fase: 'v2-exp', dirDados: dir2 });
  const exp = criarContexto({ fase: 'exp', dirDados: dir2 });
  assert.ok(v2.alvos.length > 0);
  assert.deepEqual(pares(v2.alvos), pares(exp.alvos));
});

test('mudar uma nota do teste-2 não muda hash nem popularidade da régua nas fases v2', () => {
  const t2 = criarContexto({ fase: 'v2-final', dirDados: dir2, incluirTeste2: true }).alvos[0];
  const antes = {};
  for (const fase of ['v2-exp', 'v2-final']) antes[fase] = criarContexto({ fase, dirDados: dir2 }).regua;
  try {
    gravarV2(notasV2.map((l) => {
      const [u, f, n, t] = l.split('\t');
      if (Number(u) !== t2.usuario || Number(f) !== t2.filme) return l;
      return `${u}\t${f}\t${Number(n) === 5 ? 4 : 5}\t${t}`;
    }));
    for (const fase of ['v2-exp', 'v2-final']) {
      const depois = criarContexto({ fase, dirDados: dir2 }).regua;
      assert.equal(depois.hash, antes[fase].hash);
      assert.deepEqual(depois.contagens, antes[fase].contagens);
    }
  } finally {
    gravarV2(notasV2);
  }
});

test('combinações inválidas de opções lançam erro', () => {
  assert.throws(() => criarContexto({ fase: 'v2-exp', dirDados: dir2, incluirTeste: true }), /incluirTeste/);
  assert.throws(() => criarContexto({ fase: 'exp', dirDados: dir2, incluirTeste2: true }), /incluirTeste2/);
  assert.throws(() => criarContexto({ fase: 'v2-exp', dirDados: dir2, incluirTeste2: true }), /incluirTeste2/);
});
