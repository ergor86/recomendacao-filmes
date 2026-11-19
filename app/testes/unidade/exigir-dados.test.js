// O teste de determinismo (hashes.test.js) só pode ser ignorado localmente: com APP_EXIGIR_DADOS=1
// (o CI sempre define) a falta de ML100K_DIR ou de qualquer um dos 5 arquivos o faz FALHAR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const alvo = path.resolve(aqui, '..', 'determinismo', 'hashes.test.js');

function rodar(extra) {
  const env = { ...process.env, ...extra };
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  delete env.NODE_TEST_CONTEXT; // sem isso o subprocesso se acha dentro do executor do pai e não roda
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', alvo], { env, encoding: 'utf8' });
}

test('APP_EXIGIR_DADOS=1 sem ML100K_DIR faz o teste de hashes falhar', () => {
  const r = rodar({ APP_EXIGIR_DADOS: '1', ML100K_DIR: undefined });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /ML100K_DIR ausente: o CI precisa baixar os dados/);
});

test('APP_EXIGIR_DADOS=1 com pasta sem os 5 arquivos também falha', () => {
  const vazia = mkdtempSync(path.join(os.tmpdir(), 'ml-vazio-'));
  try {
    const r = rodar({ APP_EXIGIR_DADOS: '1', ML100K_DIR: vazia });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /arquivos ausentes em ML100K_DIR/);
  } finally {
    rmSync(vazia, { recursive: true, force: true });
  }
});

test('sem a variável, o teste de hashes é ignorado (saída 0, 1 ignorado)', () => {
  const r = rodar({ APP_EXIGIR_DADOS: undefined, ML100K_DIR: undefined });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# skipped 1\b/);
  assert.match(r.stdout, /# fail 0\b/);
});
