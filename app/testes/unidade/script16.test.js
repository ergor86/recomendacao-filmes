import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rodarScript16 } from '../../preparar/script16.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = execFileSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const pg = { host: '127.0.0.1', port: 1, user: 'u', password: 'p', database: 'app_teste' };
const recusa = (dirTrabalho) =>
  assert.rejects(async () => rodarScript16({ pg, dirDados: path.join(raiz, 'nada'), dirTrabalho }), /dentro do repositório/);

test('rodarScript16 recusa dirTrabalho dentro da raiz do repositório e não cria a pasta', async () => {
  const novas = [path.join(raiz, 'artefatos-recusado-x'), path.join(raiz, 'app', 'trabalho-recusado-x', 'sub')];
  for (const dentro of [raiz, ...novas]) await recusa(dentro);
  for (const n of novas) assert.equal(existsSync(n), false, `${n} foi criada`);
  assert.equal(existsSync(path.join(raiz, 'app', 'trabalho-recusado-x')), false);
});

test('rodarScript16 recusa um link que aponta para dentro do repositório', async (t) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'link16-'));
  try {
    const link = path.join(tmp, 'link');
    try {
      symlinkSync(raiz, link, 'junction');
    } catch (e) {
      return t.skip(`sem permissão para criar link: ${e.code}`);
    }
    await recusa(path.join(link, 'artefatos-via-link-x'));
    assert.equal(existsSync(path.join(raiz, 'artefatos-via-link-x')), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
