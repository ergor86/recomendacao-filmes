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
