import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rodarScript16 } from '../../preparar/script16.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = execFileSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const pg = { host: '127.0.0.1', port: 1, user: 'u', password: 'p', database: 'app_teste' };

test('rodarScript16 recusa dirTrabalho dentro da raiz do repositório', async () => {
  for (const dentro of [raiz, path.join(raiz, 'artefatos'), path.join(raiz, 'app', 'trabalho-x')]) {
    await assert.rejects(
      async () => rodarScript16({ pg, dirDados: path.join(raiz, 'nada'), dirTrabalho: dentro }),
      /dentro do repositório/,
    );
  }
  assert.equal(existsSync(path.join(raiz, 'artefatos-recusado')), false);
});
