import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gravarEstado, lerEstado, garantirCredenciais, lerCredenciais } from '../../comum/estado.js';

const exec = promisify(execFile);
const MODULO = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../comum/estado.js')).href;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'estado-'));
const limpar = (dir) => rmSync(dir, { recursive: true, force: true });

test('lerEstado devolve null sem arquivo e lê o que foi gravado', () => {
  const dir = tmp();
  try {
    assert.equal(lerEstado(dir), null);
    gravarEstado(dir, { fase: 'v2-final', n: 3 });
    assert.deepEqual(lerEstado(dir), { fase: 'v2-final', n: 3 });
  } finally { limpar(dir); }
});

test('gravarEstado não deixa temporário ao regravar', () => {
  const dir = tmp();
  try {
    gravarEstado(dir, { fase: 'x' });
    gravarEstado(dir, { fase: 'y' });
    assert.equal(readdirSync(dir).length, 1);
    assert.equal(lerEstado(dir).fase, 'y');
  } finally { limpar(dir); }
});

test('gravarEstado lança citando o caminho da chave de segredo', () => {
  const dir = tmp();
  try {
    assert.throws(() => gravarEstado(dir, { senha: 'a' }), /estado\.senha/);
    assert.throws(() => gravarEstado(dir, { aninhado: { senha: 'a' } }), /estado\.aninhado\.senha/);
    assert.throws(() => gravarEstado(dir, { l: [{ password: 'a' }] }), /estado\.l\[0\]\.password/);
    assert.throws(() => gravarEstado(dir, { x: { app_leitura: 'a' } }), /estado\.x\.app_leitura/);
    assert.throws(() => gravarEstado(dir, { x: { app_escrita: 'a' } }), /estado\.x\.app_escrita/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { limpar(dir); }
});

test('gravarEstado grava Date em ISO', () => {
  const dir = tmp();
  try {
    gravarEstado(dir, { em: new Date(0) });
    assert.deepEqual(lerEstado(dir), { em: '1970-01-01T00:00:00.000Z' });
  } finally { limpar(dir); }
});

test('garantirCredenciais é idempotente e lerCredenciais lê', () => {
  const dir = tmp();
  try {
    assert.equal(lerCredenciais(dir), null);
    const a = garantirCredenciais(dir);
    assert.ok(a.app_leitura && a.app_escrita && a.app_leitura !== a.app_escrita);
    assert.match(a.app_leitura, /^[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(garantirCredenciais(dir), a);
    assert.deepEqual(lerCredenciais(dir), a);
    assert.deepEqual(readdirSync(dir), ['credenciais.json']);
  } finally { limpar(dir); }
});

test('credenciais vazias ou incompletas lançam erro com o caminho, sem regenerar', () => {
  for (const conteudo of ['', '{}', '{"app_leitura":"a","app_escrita":""}']) {
    const dir = tmp();
    try {
      const arq = path.join(dir, 'credenciais.json');
      writeFileSync(arq, conteudo);
      assert.throws(() => garantirCredenciais(dir), (e) => e.message.includes(arq));
      assert.throws(() => lerCredenciais(dir), (e) => e.message.includes(arq));
    } finally { limpar(dir); }
  }
});

test('chamadas concorrentes (subprocessos) devolvem as mesmas senhas', async () => {
  const dir = tmp();
  try {
    const codigo = `import(${JSON.stringify(MODULO)}).then(m => console.log(JSON.stringify(m.garantirCredenciais(${JSON.stringify(dir)}))))`;
    const saidas = await Promise.all(Array.from({ length: 6 }, () => exec(process.execPath, ['-e', codigo])));
    const todas = saidas.map((s) => JSON.parse(s.stdout));
    for (const c of todas) assert.deepEqual(c, todas[0]);
    assert.deepEqual(lerCredenciais(dir), todas[0]);
    assert.deepEqual(readdirSync(dir), ['credenciais.json']);
  } finally { limpar(dir); }
});

test('credenciais.json tem modo 0o600', { skip: process.platform === 'win32' }, () => {
  const dir = tmp();
  try {
    garantirCredenciais(dir);
    assert.equal(statSync(path.join(dir, 'credenciais.json')).mode & 0o777, 0o600);
  } finally { limpar(dir); }
});
