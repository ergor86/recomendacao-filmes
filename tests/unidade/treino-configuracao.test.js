// Testes do treino por configuração (v2): catálogo sintético mínimo, poucas épocas, pasta temporária.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calcularRegua } from '../../src/features/regua.js';
import { treinarConfiguracao } from '../../src/treino/configuracao.js';

const multi = (...idx) => Array.from({ length: 19 }, (_, i) => (idx.includes(i) ? 1 : 0));
const anos = [1970, 1985, 1995, null];
const filmes = Array.from({ length: 20 }, (_, k) => ({
  id: k + 1, titulo: `F${k + 1}`, ano: anos[k % 4], generos: k < 19 ? multi(k) : multi(0, 1),
}));
const usuarios = [1, 2, 3, 4, 5].map((id) => ({ id, idade: 18 + 7 * id, genero: id % 2 ? 'M' : 'F', ocupacao: `o${id}` }));
const treino = [
  { usuario: 1, filme: 1, nota: 5 }, { usuario: 1, filme: 2, nota: 4 }, { usuario: 1, filme: 3, nota: 5 },
  { usuario: 1, filme: 4, nota: 2 }, { usuario: 1, filme: 5, nota: 3 },
  { usuario: 2, filme: 1, nota: 4 }, { usuario: 2, filme: 6, nota: 1 },
  { usuario: 3, filme: 2, nota: 5 }, { usuario: 3, filme: 7, nota: 4 }, { usuario: 3, filme: 8, nota: 2 },
  { usuario: 4, filme: 3, nota: 1 },
  { usuario: 5, filme: 9, nota: 4 }, { usuario: 5, filme: 10, nota: 5 },
  { usuario: 5, filme: 1, nota: 3 }, { usuario: 5, filme: 2, nota: 3 },
];
const alvos = [
  { usuario: 1, filme: 6, nota: 5 }, { usuario: 1, filme: 7, nota: 2 },
  { usuario: 3, filme: 9, nota: 4 }, { usuario: 4, filme: 11, nota: 5 }, { usuario: 5, filme: 12, nota: 2 },
];
const regua = calcularRegua({
  treino, filmes, usuarios,
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
});
const candidatos = () => new Map([
  [1, [6, 7, 8, 9, 10, 11, 12, 13]], [2, [2, 3, 4, 5, 7]], [3, [1, 3, 9, 11, 13, 15]],
  [4, [1, 2, 11, 12, 14]], [5, [3, 4, 12, 13, 14, 16]],
]);
const ctx = (fase) => ({ fase, dataset: { filmes, usuarios }, treino, alvos: fase === 'v2-exp' ? alvos : null, regua });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'treino-conf-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('v2-exp devolve 3 sementes, salva os modelos e é determinístico nos pares', async () => {
  const exec = (d) => treinarConfiguracao({
    ctx: ctx('v2-exp'), candidatosPorUsuario: candidatos(), nome: 'v2-5-5', fase: 'v2-exp',
    dirModelos: path.join(tmp, d), maxEpocas: 2,
  });
  const a = await exec('a');
  const b = await exec('b');
  assert.equal(a.nome, 'v2-5-5');
  assert.deepEqual(a.sementes.map((s) => s.semente), [1, 2, 3]);
  for (const s of a.sementes) {
    assert.ok(s.melhorEpoca >= 1 && s.epocasTreinadas <= 2);
    assert.equal(typeof s.atingiuTeto, 'boolean');
    assert.match(s.sha256Pares, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(tmp, 'a', `v2-5-5-v2-exp-s${s.semente}`)));
  }
  assert.deepEqual(a.sementes.map((s) => s.sha256Pares), b.sementes.map((s) => s.sha256Pares));
});

test('v2-final sem epocasPorSemente lança erro; com Map ou objeto treina as épocas pedidas', async () => {
  const base = {
    ctx: ctx('v2-final'), candidatosPorUsuario: candidatos(), nome: 'v2-5-5', fase: 'v2-final',
    dirModelos: path.join(tmp, 'f'),
  };
  await assert.rejects(() => treinarConfiguracao(base), /epocasPorSemente/);
  const m = await treinarConfiguracao({ ...base, epocasPorSemente: new Map([[1, 1], [2, 2], [3, 1]]) });
  assert.deepEqual(m.sementes.map((s) => s.epocasTreinadas), [1, 2, 1]);
  const o = await treinarConfiguracao({ ...base, epocasPorSemente: { 1: 2, 2: 1, 3: 1 } });
  assert.deepEqual(o.sementes.map((s) => s.epocasTreinadas), [2, 1, 1]);
});

test('usuário de treino sem candidatos lança erro', async () => {
  const c = candidatos();
  c.delete(3);
  await assert.rejects(() => treinarConfiguracao({
    ctx: ctx('v2-exp'), candidatosPorUsuario: c, nome: 'x', fase: 'v2-exp',
    dirModelos: path.join(tmp, 'x'), maxEpocas: 2,
  }), /usuário 3 sem candidatos/);
});
