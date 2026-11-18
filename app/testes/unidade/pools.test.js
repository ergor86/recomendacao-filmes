// Tarefa 9: pools do servidor (spec 5.2). Sem banco: os pools do pg só conectam no primeiro uso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { criarPools, encerrarPools } from '../../servidor/pools.js';

const CRED = { app_leitura: 'l', app_escrita: 'e' };

test('leitura com search_path=v2_final,public; escrita sem; papéis certos', async () => {
  const p = criarPools({ host: '127.0.0.1', port: 1, database: 'd', credenciais: CRED });
  try {
    assert.equal(p.leitura.options.user, 'app_leitura');
    assert.equal(p.leitura.options.password, 'l');
    assert.equal(p.leitura.options.options, '-c search_path=v2_final,public');
    assert.equal(p.escrita.options.user, 'app_escrita');
    assert.equal(p.escrita.options.password, 'e');
    assert.equal(p.escrita.options.options, undefined);
  } finally {
    await encerrarPools(p);
  }
});

test('erros dos pools e de qualquer cliente vão para aoErro (nunca ficam sem ouvinte)', async () => {
  const erros = [];
  const p = criarPools({ host: '127.0.0.1', port: 1, database: 'd', credenciais: CRED, aoErro: (e) => erros.push(e.code) });
  try {
    for (const pool of [p.leitura, p.escrita]) {
      assert.ok(pool.listenerCount('error') >= 1);
      pool.emit('error', Object.assign(new Error('x'), { code: 'POOL' }));
      // um cliente encerrado pelo pool (ex.: descartado depois de um erro) ainda pode emitir
      // ECONNRESET quando o banco cai; sem ouvinte, isso derrubaria o processo
      const cliente = new EventEmitter();
      pool.emit('connect', cliente);
      cliente.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    }
    assert.deepEqual(erros, ['POOL', 'ECONNRESET', 'POOL', 'ECONNRESET']);
  } finally {
    await encerrarPools(p);
  }
});
