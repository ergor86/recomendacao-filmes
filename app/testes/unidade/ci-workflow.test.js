// O workflow do CI (.github/workflows/app.yml) não roda localmente; estas conferências de texto travam os
// pontos que a revisão de integração 3 corrigiu (M-2, M-3, M-6, I-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const yml = readFileSync(path.join(RAIZ, '.github', 'workflows', 'app.yml'), 'utf8');

function passo(nome) {
  const ini = yml.indexOf(`- name: ${nome}`);
  assert.ok(ini >= 0, `passo "${nome}" não existe`);
  const prox = yml.indexOf('\n      - ', ini + 1);
  return yml.slice(ini, prox < 0 ? undefined : prox);
}

test('integração e equivalência rodam com APP_EXIGIR_DADOS=1 (M-2)', () => {
  assert.match(passo('Integração'), /APP_EXIGIR_DADOS:\s*"?1"?/);
  assert.match(passo('Equivalência com a referência (camada a, sem banco)'), /APP_EXIGIR_DADOS:\s*"?1"?/);
});

test('a espera por operante também sai em bloqueado (M-3)', () => {
  assert.match(passo('Esperar /api/saude operante (até 15 minutos)'), /"estado":"bloqueado"'\*\) break/);
});

test('o CI confere [::1] aceito e localhost:3000 recusado com 421 contra o contêiner (M-6)', () => {
  const t = yml;
  assert.match(t, /"\[::1\]:\$\{APP_PORTA\}"/);
  assert.match(t, /Host: localhost:3000/);
  assert.match(t, /421/);
});

test('o banco de teste do CI vem do projeto recomendacao-dev (I-2)', () => {
  assert.match(passo('Banco de teste (db do Compose, publicado só no loopback)'), /-p recomendacao-dev|compose\.dev\.yml/);
});

test('todo job que roda npm test ou o congelamento faz checkout com fetch-depth: 0 (I-1 da revisão final)', () => {
  const inicio = yml.indexOf('\njobs:\n');
  assert.ok(inicio >= 0, 'bloco jobs ausente');
  const jobs = yml.slice(inicio).split(/\n(?=  [a-z0-9-]+:\n)/).slice(1);
  assert.ok(jobs.length >= 2, 'jobs não encontrados');
  let conferidos = 0;
  for (const job of jobs) {
    const nome = job.trim().split('\n')[0];
    if (!/\bnpm test\b|congelamento\.test\.js/.test(job)) continue;
    conferidos += 1;
    const checkout = job.match(/uses: actions\/checkout@v\d+\n(\s+with:\n(?:\s+(?:#.*|[a-z-]+:.*)\n?)+)?/);
    assert.ok(checkout, `job ${nome}: sem checkout`);
    assert.match(checkout[1] ?? '', /fetch-depth:\s*0\b/, `job ${nome}: checkout raso, mas roda o congelamento`);
  }
  assert.ok(conferidos >= 2, 'esperava ao menos os jobs testes e congelamento');
});
