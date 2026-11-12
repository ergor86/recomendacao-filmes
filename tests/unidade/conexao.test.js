import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarPool, verificarConexao } from '../../src/banco/conexao.js';

test('banco fora do ar gera mensagem acionável', async () => {
  const pool = criarPool({ host: 'localhost', port: 1, user: 'x', password: 'x', database: 'x' });
  await assert.rejects(verificarConexao(pool), /rode docker compose up -d/);
  await pool.end();
});
