import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarErroPg } from '../../comum/erros-pg.js';

const porCodigo = (code) => Object.assign(new Error('x'), { code });

for (const [code, esperado] of [
  ['ECONNREFUSED', 'disponibilidade'],
  ['ENOTFOUND', 'disponibilidade'],
  ['57P01', 'disponibilidade'],
  ['57P03', 'disponibilidade'],
  // queda do banco vista por um encaminhamento de porta (Docker no WSL/Desktop): reset em vez de recusa
  ['ECONNRESET', 'disponibilidade'],
  ['ETIMEDOUT', 'disponibilidade'],
  ['EPIPE', 'disponibilidade'],
  ['57P02', 'disponibilidade'],
  ['28P01', 'credenciais'],
  ['42501', 'integridade'],
  ['42P01', 'integridade'],
  ['23505', 'outro'],
]) {
  test(`código ${code} -> ${esperado}`, () => assert.equal(classificarErroPg(porCodigo(code)), esperado));
}

for (const [msg, esperado] of [
  ['Connection terminated unexpectedly', 'disponibilidade'],
  ['timeout exceeded when trying to connect', 'disponibilidade'],
  ['Connection terminated due to connection timeout', 'disponibilidade'],
  ['régua do banco difere da fase em uso: rode npm run carregar-v2', 'integridade'],
  ['treino do banco difere da fase em uso: rode npm run carregar-v2', 'integridade'],
  ['banco sem filmes_fc: rode npm run carregar-v2', 'integridade'],
  ['Cannot use a pool after calling end on the pool', 'disponibilidade'],
  ['qualquer outra coisa', 'outro'],
]) {
  test(`mensagem "${msg}" -> ${esperado}`, () => assert.equal(classificarErroPg(new Error(msg)), esperado));
}

test('entradas inválidas viram outro', () => {
  assert.equal(classificarErroPg(null), 'outro');
  assert.equal(classificarErroPg(undefined), 'outro');
});
