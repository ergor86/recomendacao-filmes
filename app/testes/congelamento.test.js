import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT_CODIGO, COMMIT_PESQUISA, HASHES, RESULTADO_PLANO3 } from '../integridade.js';
import { conferirCongelamento } from './apoio-congelamento.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(aqui, '..');
const raiz = execFileSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const gitRaiz = (args, opcoes = {}) =>
  spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8', ...opcoes });
const mostrar = (commit, caminho) => JSON.parse(gitRaiz(['show', `${commit}:${caminho}`]).stdout);

const CAMINHOS_CODIGO = ['src', 'scripts', 'package.json', 'package-lock.json'];
const CAMINHOS_PESQUISA = ['resultados', '.env.example'];

// Desvio D1 (registrado em docs/guia/08-registro-completo.md, "Desvios depois do congelamento"):
// o docker-compose.yml da pesquisa passou a publicar a porta do banco só em 127.0.0.1.
// Ele pode diferir de 6077974 exatamente nessa linha, e em nada mais.
const DESVIO_D1 = { arquivo: 'docker-compose.yml', de: '      - "5433:5432"\n', para: '      - "127.0.0.1:5433:5432"\n' };

test('congelamento: código da pesquisa idêntico a c048537', () => {
  assert.equal(COMMIT_CODIGO.slice(0, 7), 'c048537');
  const r = conferirCongelamento(raiz, COMMIT_CODIGO, CAMINHOS_CODIGO);
  assert.deepEqual(r, { ok: true, alterados: [] });
});

test('congelamento: resultados idênticos a 6077974', () => {
  assert.equal(COMMIT_PESQUISA.slice(0, 7), '6077974');
  const r = conferirCongelamento(raiz, COMMIT_PESQUISA, CAMINHOS_PESQUISA);
  assert.deepEqual(r, { ok: true, alterados: [] });
});

test('desvio D1: docker-compose.yml difere de 6077974 só na publicação da porta', () => {
  const original = gitRaiz(['show', `${COMMIT_PESQUISA}:${DESVIO_D1.arquivo}`]).stdout;
  assert.equal(original.split(DESVIO_D1.de).length, 2, 'a linha original da porta deve aparecer uma vez em 6077974');
  const esperado = original.replace(DESVIO_D1.de, DESVIO_D1.para);
  const atual = readFileSync(path.join(raiz, DESVIO_D1.arquivo), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(atual, esperado);
});

test('congelamento: rodar de dentro de app/ não muda o resultado', () => {
  // o mesmo diff, executado com cwd = app/ e pathspecs :/…
  for (const [commit, caminhos] of [[COMMIT_CODIGO, CAMINHOS_CODIGO], [COMMIT_PESQUISA, CAMINHOS_PESQUISA]]) {
    const r = spawnSync('git', ['diff', '--exit-code', commit, '--', ...caminhos.map((c) => `:/${c}`)], {
      cwd: appDir,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const de = conferirCongelamento(appDir, COMMIT_CODIGO, CAMINHOS_CODIGO);
  assert.deepEqual(de, { ok: true, alterados: [] });
});

test('congelamento: os caminhos protegidos existem no commit de referência', () => {
  for (const c of ['src', 'scripts', 'package.json', 'package-lock.json']) {
    assert.equal(gitRaiz(['cat-file', '-e', `${COMMIT_CODIGO}:${c}`]).status, 0, c);
  }
  for (const c of ['resultados/configuracao-v2.json', 'resultados/avaliacao-v2.json']) {
    assert.equal(gitRaiz(['cat-file', '-e', `${COMMIT_PESQUISA}:${c}`]).status, 0, c);
  }
  // o git diff sai com 0 também para um pathspec inexistente; a conferência distingue os dois casos
  assert.notEqual(gitRaiz(['cat-file', '-e', `${COMMIT_CODIGO}:src-inexistente`]).status, 0);
});

test('integridade: HASHES iguais aos de 6077974', () => {
  const h = mostrar(COMMIT_PESQUISA, 'resultados/configuracao-v2.json').hashes;
  assert.equal(HASHES.regua, h.regua);
  assert.equal(HASHES.treino, h.treino);
  assert.equal(HASHES.vetoresFC, h.vetoresFC);
});

test('integridade: RESULTADO_PLANO3 igual a 6077974', () => {
  const j = mostrar(COMMIT_PESQUISA, 'resultados/avaliacao-v2.json').comparacaoPrincipal;
  assert.equal(RESULTADO_PLANO3.metrica, j.metrica);
  assert.equal(RESULTADO_PLANO3.v1, j.v1);
  assert.equal(RESULTADO_PLANO3.v2, j.v2);
  assert.equal(RESULTADO_PLANO3.media, j.media);
  assert.deepEqual(RESULTADO_PLANO3.ic95, j.ic95);
  assert.equal(RESULTADO_PLANO3.nUsuarios, j.nUsuarios);
  assert.equal(RESULTADO_PLANO3.suportada, j.suportada);
});

test('congelamento: a função de conferência detecta uma modificação', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'congelamento-'));
  try {
    const g = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
    g('init', '-q');
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'protegido.js'), 'export const a = 1;\n');
    g('add', '.');
    g('commit', '-q', '-m', 'base');
    const base = g('rev-parse', 'HEAD').trim();

    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: true, alterados: [] });

    writeFileSync(path.join(dir, 'src', 'protegido.js'), 'export const a = 2;\n');
    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: false, alterados: ['src/protegido.js'] });

    g('commit', '-q', '-am', 'modifica');
    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: false, alterados: ['src/protegido.js'] });

    assert.throws(() => conferirCongelamento(dir, base, ['src-inexistente']), /inexistente/);

    // arquivo novo NAO rastreado em caminho protegido tambem e acusado
    g('reset', '-q', '--hard', base);
    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: true, alterados: [] });
    writeFileSync(path.join(dir, 'src', 'intruso.js'), 'export const b = 1;\n');
    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: false, alterados: ['src/intruso.js'] });
    // a conferencia a partir de uma subpasta tambem devolve caminhos a partir da raiz
    mkdirSync(path.join(dir, 'app'));
    assert.deepEqual(conferirCongelamento(path.join(dir, 'app'), base, ['src']), { ok: false, alterados: ['src/intruso.js'] });
    rmSync(path.join(dir, 'app'), { recursive: true });
    rmSync(path.join(dir, 'src', 'intruso.js'));
    writeFileSync(path.join(dir, 'fora.js'), 'x\n'); // fora dos caminhos protegidos: ignorado
    assert.deepEqual(conferirCongelamento(dir, base, ['src']), { ok: true, alterados: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
