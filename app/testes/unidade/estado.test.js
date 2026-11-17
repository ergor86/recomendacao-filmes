import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gravarEstado, lerEstado, garantirCredenciais, lerCredenciais } from '../../comum/estado.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'estado-'));

test('lerEstado devolve null sem arquivo e lê o que foi gravado', () => {
  const dir = tmp();
  try {
    assert.equal(lerEstado(dir), null);
    gravarEstado(dir, { fase: 'v2-final', n: 3 });
    assert.deepEqual(lerEstado(dir), { fase: 'v2-final', n: 3 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gravarEstado não deixa temporário e não grava o campo senha', () => {
  const dir = tmp();
  try {
    gravarEstado(dir, { fase: 'x', senha: 'segredo', aninhado: { senha: 'outra', ok: 1 } });
    const arquivos = readdirSync(dir);
    assert.equal(arquivos.length, 1, arquivos.join(','));
    assert.ok(!arquivos[0].includes('tmp'));
    const bruto = readFileSync(path.join(dir, arquivos[0]), 'utf8');
    assert.ok(!bruto.includes('segredo') && !bruto.includes('outra'));
    assert.ok(!('senha' in lerEstado(dir)));
    assert.equal(lerEstado(dir).aninhado.ok, 1);
    gravarEstado(dir, { fase: 'y' });
    assert.equal(readdirSync(dir).length, 1);
    assert.equal(lerEstado(dir).fase, 'y');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('garantirCredenciais é idempotente e lerCredenciais lê', () => {
  const dir = tmp();
  try {
    assert.equal(lerCredenciais(dir), null);
    const a = garantirCredenciais(dir);
    assert.ok(a.app_leitura && a.app_escrita && a.app_leitura !== a.app_escrita);
    assert.match(a.app_leitura, /^[A-Za-z0-9_-]{32}$/);
    const b = garantirCredenciais(dir);
    assert.deepEqual(b, a);
    assert.deepEqual(lerCredenciais(dir), a);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('credenciais.json tem modo 0o600', { skip: process.platform === 'win32' }, () => {
  const dir = tmp();
  try {
    garantirCredenciais(dir);
    assert.equal(statSync(path.join(dir, 'credenciais.json')).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
