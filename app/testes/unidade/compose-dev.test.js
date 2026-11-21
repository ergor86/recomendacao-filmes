// I-2 (Ruling 29): o ambiente de desenvolvimento e teste usa o projeto Compose `recomendacao-dev`; o nome
// `recomendacao-app` fica para a instalação real. Sem docker: lê os arquivos. Com docker (no PATH ou no WSL),
// confere também o nome que o Compose calcula ao fundir os dois arquivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (rel) => readFileSync(path.join(APP, rel), 'utf8');
const nomeDeclarado = (texto) => /^name:\s*(\S+)\s*$/m.exec(texto)?.[1];

test('compose.yml é a instalação real (recomendacao-app) e compose.dev.yml declara recomendacao-dev', () => {
  assert.equal(nomeDeclarado(ler('compose.yml')), 'recomendacao-app');
  assert.equal(nomeDeclarado(ler('compose.dev.yml')), 'recomendacao-dev');
});

test('as suítes que mexem no db pedem o projeto recomendacao-dev explicitamente', () => {
  for (const rel of ['testes/integracao/ciclo.test.js', 'testes/integracao/papeis.test.js']) {
    assert.match(ler(rel), /recomendacao-dev/, `${rel} não fixa o projeto de desenvolvimento`);
  }
});

function compose(args) {
  const direto = spawnSync('docker', ['compose', ...args], { cwd: APP, encoding: 'utf8' });
  if (!direto.error) return direto;
  if (process.platform === 'win32') {
    const dir = APP.split(path.sep).join('/').replace(/^([A-Za-z]):/, (_, l) => `/mnt/${l.toLowerCase()}`);
    const w = spawnSync('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', `cd ${dir} && docker compose ${args.join(' ')}`], { encoding: 'utf8' });
    if (!w.error) return w;
  }
  return null;
}

test('o nome calculado pelo Compose difere entre a instalação e o desenvolvimento', (t) => {
  const real = compose(['config', '--format', 'json']);
  if (!real || real.status !== 0) return t.skip('docker indisponível');
  const dev = compose(['-f', 'compose.yml', '-f', 'compose.dev.yml', 'config', '--format', 'json']);
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(JSON.parse(real.stdout).name, 'recomendacao-app');
  assert.equal(JSON.parse(dev.stdout).name, 'recomendacao-dev');
});
