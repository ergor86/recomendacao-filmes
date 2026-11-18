// Auditoria do fecho de imports em tempo de execução (spec 10.2): um gancho module.register grava
// toda URL resolvida por um processo filho, e o teste confere o fecho transitivo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const REGISTRAR = path.join(AQUI, 'apoio', 'fecho-registrar.js');
const SERVIDOR = path.join(AQUI, '..', 'servidor', 'index.js');
const PREPARAR = pathToFileURL(path.join(AQUI, '..', 'preparar', 'preparar.js')).href;
const SCRIPT_16 = path.join(RAIZ, 'scripts', '16-carregar-v2.js');

// Fecho do script 16 em src/ (16 arquivos), derivado pelo próprio gancho a partir de scripts/16-carregar-v2.js
// (o script 16 não importa src/candidatos/populares.js nem src/dados/download.js).
const FECHO_SCRIPT_16 = Object.freeze([
  'src/banco/carga-fc.js',
  'src/banco/carga.js',
  'src/banco/conexao.js',
  'src/config.js',
  'src/contexto.js',
  'src/dados/carregar.js',
  'src/dados/divisoes.js',
  'src/dados/estatisticas.js',
  'src/dados/leitura.js',
  'src/dados/teste2.js',
  'src/fc/referencia.js',
  'src/features/codificacao.js',
  'src/features/regua.js',
  'src/util/aleatorio.js',
  'src/util/hash-avaliacoes.js',
  'src/util/json-estavel.js',
]);
// Lista permitida da preparação: o fecho do script 16 mais o que a spec 10.1 deixa a `app/preparar/` importar
// direto da raiz fora dele (rankingPopularidade) e o download.
const PERMITIDOS_PREPARAR = Object.freeze([
  ...FECHO_SCRIPT_16,
  'src/candidatos/populares.js',
  'src/dados/download.js',
]);

const PROIBIDOS_SERVIDOR = ['src/contexto.js', 'src/dados/', 'src/avaliacao/', 'src/modelo/', '@tensorflow'];

const RAIZ_URL = pathToFileURL(RAIZ).href.toLowerCase() + '/';

/** URLs gravadas pelo gancho, sem repetição; `src/...` relativo à raiz do repositório quando for dela. */
function lerFecho(arquivo) {
  const urls = [...new Set(readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean))];
  const srcs = urls
    .filter((u) => u.toLowerCase().startsWith(RAIZ_URL + 'src/'))
    .map((u) => decodeURIComponent(u.slice(RAIZ_URL.length)));
  return { urls, srcs: [...new Set(srcs)].sort() };
}

function novoTemp() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fecho-'));
  return { tmp, saida: path.join(tmp, 'urls.txt') };
}

function executar(args, env) {
  return spawnSync(process.execPath, ['--import', pathToFileURL(REGISTRAR).href, ...args], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000,
  });
}

describe('fecho de imports em tempo de execução (spec 10.2)', { timeout: 120_000 }, () => {
  it('servidor (sem banco, estado preparando): o fecho não contém contexto, dados, avaliacao, modelo nem TensorFlow', async () => {
    const { tmp, saida } = novoTemp();
    const filho = spawn(process.execPath, ['--import', pathToFileURL(REGISTRAR).href, SERVIDOR], {
      env: { ...process.env, FECHO_SAIDA: saida, APP_DIR_ESTADO: path.join(tmp, 'estado'), APP_PORTA: '3000', PGHOST: '127.0.0.1', PGPORT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      let log = '';
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`servidor não escutou em 30 s; saída: ${log}`)), 30_000);
        const ler = (b) => {
          log += b.toString();
          if (log.includes('servidor ouvindo')) { clearTimeout(t); resolve(); }
        };
        filho.stdout.on('data', ler);
        filho.stderr.on('data', (b) => { log += b.toString(); });
        filho.on('exit', (c) => { clearTimeout(t); reject(new Error(`servidor saiu (${c}) antes de escutar: ${log}`)); });
      });
    } finally {
      filho.kill();
      await new Promise((r) => setTimeout(r, 200));
    }
    const { urls, srcs } = lerFecho(saida);
    try {
      assert.ok(urls.some((u) => u.endsWith('/app/servidor/app.js')), 'o gancho viu o app.js do servidor');
      assert.ok(srcs.includes('src/banco/busca-fc.js'), `o servidor usa src/banco/busca-fc.js; fecho: ${srcs.join(', ')}`);
      for (const proibido of PROIBIDOS_SERVIDOR) {
        const achadas = urls.filter((u) => decodeURIComponent(u).toLowerCase().includes(proibido.toLowerCase()));
        assert.deepEqual(achadas, [], `o fecho do servidor não pode conter ${proibido}`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preparar.js importado (sem executar): o fecho em src/ está dentro da lista permitida (script 16 + populares + download)', () => {
    const { tmp, saida } = novoTemp();
    try {
      const r = executar(['--input-type=module', '-e', `await import(${JSON.stringify(PREPARAR)})`], { FECHO_SAIDA: saida });
      assert.equal(r.status, 0, r.stderr);
      const { urls, srcs } = lerFecho(saida);
      assert.ok(srcs.length > 0, 'o preparar alcança src/');
      const fora = srcs.filter((s) => !PERMITIDOS_PREPARAR.includes(s));
      assert.deepEqual(fora, [], 'arquivos de src/ fora da lista permitida');
      assert.equal(urls.filter((u) => u.includes('@tensorflow')).length, 0, 'sem TensorFlow');
      assert.equal(PERMITIDOS_PREPARAR.length, 18);
      assert.equal(new Set(PERMITIDOS_PREPARAR).size, 18);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('a lista do script 16 confere com o fecho real de scripts/16-carregar-v2.js (16 arquivos de src/)', () => {
    const { tmp, saida } = novoTemp();
    try {
      // sem --fase o script recusa e sai com 1, depois de resolver todos os imports estáticos
      const r = executar([SCRIPT_16], { FECHO_SAIDA: saida });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /fase inválida/);
      assert.deepEqual(lerFecho(saida).srcs, [...FECHO_SCRIPT_16].sort());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
