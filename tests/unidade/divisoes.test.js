import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAleatorio, embaralhar } from '../../src/util/aleatorio.js';
import { criarDivisoes } from '../../src/dados/divisoes.js';

const base = [];
for (const usuario of [1, 2, 463, 500, 943, 944]) {
  for (let filme = 1; filme <= 10; filme++) base.push({ usuario, filme, nota: 3 + (filme % 3), ts: filme });
}
const contar = arr => {
  const m = new Map();
  for (const a of arr) m.set(a.usuario, (m.get(a.usuario) ?? 0) + 1);
  return m;
};

test('validação só contém usuários 463–943 e esconde 40% de cada', () => {
  const d = criarDivisoes({ base, teste: [] }, { semente: 42 });
  const porUsuario = contar(d.validacao);
  assert.deepEqual([...porUsuario.keys()].sort((a, b) => a - b), [463, 500, 943]);
  for (const n of porUsuario.values()) assert.equal(n, 4);
});
test('treinoExp + validacao = base, sem sobreposição', () => {
  const d = criarDivisoes({ base, teste: [] });
  assert.equal(d.treinoExp.length + d.validacao.length, base.length);
  const chave = a => `${a.usuario}:${a.filme}`;
  const v = new Set(d.validacao.map(chave));
  assert.ok(d.treinoExp.every(a => !v.has(chave(a))));
});
test('mesma semente → mesma divisão; semente diferente → outra', () => {
  const a = criarDivisoes({ base, teste: [] }, { semente: 42 }).validacao;
  const b = criarDivisoes({ base, teste: [] }, { semente: 42 }).validacao;
  const c = criarDivisoes({ base, teste: [] }, { semente: 7 }).validacao;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
test('criarAleatorio é determinístico', () => {
  const r = criarAleatorio(42);
  const s = criarAleatorio(42);
  assert.deepEqual([r(), r(), r()], [s(), s(), s()]);
});
test('não altera as entradas; treinoFinal é a base e teste é o mesmo', () => {
  const copia = structuredClone(base);
  const teste = [{ usuario: 1, filme: 99, nota: 5, ts: 1 }];
  const d = criarDivisoes({ base, teste });
  assert.deepEqual(base, copia);
  assert.deepEqual(d.treinoFinal, base);
  assert.equal(d.teste, teste);
});
test('embaralhar devolve cópia com os mesmos elementos', () => {
  const x = [1, 2, 3, 4, 5];
  const y = embaralhar(x, criarAleatorio(1));
  assert.deepEqual(x, [1, 2, 3, 4, 5]);
  assert.deepEqual([...y].sort(), x);
});
