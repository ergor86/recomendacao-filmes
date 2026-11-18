import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirIntegridade } from '../../comum/conferencia.js';
import { classificarErroPg } from '../../comum/erros-pg.js';

const executorQueFalha = (erro) => ({ query: async () => { throw erro; } });

test('erro de conexão durante a conferência é relançado sem alteração', async () => {
  const original = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  await assert.rejects(conferirIntegridade(executorQueFalha(original)), (e) => {
    assert.equal(e, original);
    assert.equal(e.code, 'ECONNREFUSED');
    assert.equal(classificarErroPg(e), 'disponibilidade');
    return true;
  });
});

test('outros erros de consulta também são relançados', async () => {
  const original = Object.assign(new Error('permission denied'), { code: '42501' });
  await assert.rejects(conferirIntegridade(executorQueFalha(original)), (e) => e === original);
});

test('tabela ausente (42P01) vira divergência de integridade', async () => {
  const r = await conferirIntegridade(executorQueFalha(Object.assign(new Error('relation does not exist'), { code: '42P01' })));
  assert.equal(r.ok, false);
  assert.equal(r.tipo, 'integridade');
});

test('hash divergente é ok:false do tipo integridade', async () => {
  const executor = { query: async () => ({ rows: [{ chave: 'hash_regua', valor: 'x' }, { chave: 'hash_treino', valor: 'y' }] }) };
  const r = await conferirIntegridade(executor);
  assert.deepEqual(r, { ok: false, causa: 'régua do banco difere da congelada', tipo: 'integridade' });
});
