import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../../src/config.js';

test('carregarConfig lê as variáveis PG*', () => {
  const c = carregarConfig({ PGHOST: 'localhost', PGPORT: '5433', PGUSER: 'u', PGPASSWORD: 'p', PGDATABASE: 'd', DIR_DADOS: 'data/ml-100k' });
  assert.deepEqual(c.pg, { host: 'localhost', port: 5433, user: 'u', password: 'p', database: 'd' });
  assert.equal(c.dirDados, 'data/ml-100k');
});
test('carregarConfig sem variáveis explica o que fazer', () => {
  assert.throws(() => carregarConfig({}), /copie .env.example para .env/);
});
