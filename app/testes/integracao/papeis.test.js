// Tarefa 3: migracao do schema `app` e papeis do banco (spec 4.2 passo 5 e 5.2).
// Roda no banco `app_teste` (dev: compose.dev.yml, 127.0.0.1:5434), nunca no da pesquisa.
//
// Teste "senha nao vai ao log": usa `docker compose logs db`. Se `docker` estiver no PATH, chama
// direto; senao, se `wsl` existir, chama `wsl -d Ubuntu -- docker compose ...` (Docker roda no WSL
// neste ambiente). Se nenhum existir, o teste e ignorado (o CI da Tarefa 16 o roda).
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { aplicarMigracoes, aplicarPapeis, PAPEL_ESCRITA, PAPEL_LEITURA } from '../../preparar/papeis.js';
import { configSuperusuario, garantirBancoTeste, poolComo } from './apoio.js';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENHA_A = `a'b\\c"d$1 ;--é \`x\``;
const SENHA_B = `z'y\\w"v$2 ;/*é*/ \`k\` %s`;

let cfg;
let su; // cliente superusuario no banco de teste

async function reiniciarSchemas() {
  const { rows } = await su.query('SELECT current_database() AS db');
  assert.equal(rows[0].db, 'app_teste', 'recusa apagar schemas fora do banco app_teste');
  await su.query('DROP SCHEMA IF EXISTS v2_final CASCADE');
  await su.query('DROP SCHEMA IF EXISTS app CASCADE');
  await su.query('CREATE SCHEMA v2_final; CREATE TABLE v2_final.filmes_fc(id int)');
}

async function prepararTudo(senhas = { [PAPEL_LEITURA]: SENHA_A, [PAPEL_ESCRITA]: SENHA_A }) {
  await aplicarMigracoes(su);
  await aplicarPapeis(su, { senhas, superusuario: cfg.user });
}

async function codigoDoErro(fn) {
  try { await fn(); } catch (e) { return e.code; }
  return null;
}

describe('migracao e papeis (banco app_teste)', () => {
  before(async () => {
    cfg = await garantirBancoTeste();
    su = new pg.Client(cfg);
    await su.connect();
  });
  after(async () => { await su?.end(); });
  beforeEach(reiniciarSchemas);

  it('pg.escapeLiteral existe', () => {
    assert.equal(typeof pg.escapeLiteral, 'function');
  });

  it('apoio recusa o banco da pesquisa', () => {
    const antes = { p: process.env.TESTE_PGPORT, d: process.env.TESTE_PGDATABASE };
    try {
      process.env.TESTE_PGPORT = '5433';
      assert.throws(() => configSuperusuario(), /pesquisa/);
      delete process.env.TESTE_PGPORT;
      process.env.TESTE_PGDATABASE = 'recomendacao';
      assert.throws(() => configSuperusuario(), /pesquisa/);
    } finally {
      for (const [k, v] of [['TESTE_PGPORT', antes.p], ['TESTE_PGDATABASE', antes.d]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });

  it('migracoes idempotentes', async () => {
    const primeira = await aplicarMigracoes(su);
    assert.deepEqual(primeira, [1]);
    const segunda = await aplicarMigracoes(su);
    assert.deepEqual(segunda, []);
    const { rows } = await su.query('SELECT versao FROM app.migracao ORDER BY versao');
    assert.deepEqual(rows.map((r) => r.versao), [1]);
    const t = await su.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY 1`);
    assert.deepEqual(t.rows.map((r) => r.table_name), [
      'estatistica_historica', 'filme', 'filme_externo', 'filme_gemeo',
      'interacao', 'migracao', 'perfil', 'preparacao']);
  });

  it('app_escrita nao escreve em v2_final', async () => {
    await prepararTudo();
    const pool = poolComo(PAPEL_ESCRITA, SENHA_A);
    try {
      assert.equal(await codigoDoErro(() => pool.query('INSERT INTO v2_final.filmes_fc(id) VALUES (1)')), '42501');
      assert.equal(await codigoDoErro(() => pool.query('SELECT * FROM v2_final.filmes_fc')), '42501');
      // e escreve onde deve
      await pool.query(`INSERT INTO app.perfil(nome) VALUES ('x')`);
    } finally { await pool.end(); }
  });

  it('app_leitura nao escreve em app', async () => {
    await prepararTudo();
    const pool = poolComo(PAPEL_LEITURA, SENHA_A);
    try {
      assert.equal(await codigoDoErro(() => pool.query(`INSERT INTO app.perfil(nome) VALUES ('x')`)), '42501');
      await pool.query('SELECT * FROM app.filme');
    } finally { await pool.end(); }
  });

  it('app_leitura: current_schema() = v2_final com search_path=v2_final,public', async () => {
    await prepararTudo();
    const pool = poolComo(PAPEL_LEITURA, SENHA_A, { options: '-c search_path=v2_final,public' });
    try {
      const { rows } = await pool.query('SELECT current_schema() AS s');
      assert.equal(rows[0].s, 'v2_final');
    } finally { await pool.end(); }
  });

  it('GRANT sobrevive a DROP/CREATE', async () => {
    await prepararTudo();
    await su.query('DROP TABLE v2_final.filmes_fc; CREATE TABLE v2_final.filmes_fc(id int)');
    const pool = poolComo(PAPEL_LEITURA, SENHA_A);
    try {
      await pool.query('SELECT * FROM v2_final.filmes_fc');
    } finally { await pool.end(); }
  });

  it('senha com caracteres especiais funciona', async () => {
    await prepararTudo({ [PAPEL_LEITURA]: SENHA_A, [PAPEL_ESCRITA]: SENHA_A });
    let pool = poolComo(PAPEL_LEITURA, SENHA_A);
    try {
      assert.equal((await pool.query('SELECT 1 AS um')).rows[0].um, 1);
    } finally { await pool.end(); }

    await aplicarPapeis(su, { senhas: { [PAPEL_LEITURA]: SENHA_B, [PAPEL_ESCRITA]: SENHA_B }, superusuario: cfg.user });
    pool = poolComo(PAPEL_LEITURA, SENHA_A);
    try {
      assert.equal(await codigoDoErro(() => pool.query('SELECT 1')), '28P01');
    } finally { await pool.end(); }
    pool = poolComo(PAPEL_LEITURA, SENHA_B);
    try {
      assert.equal((await pool.query('SELECT 1 AS um')).rows[0].um, 1);
    } finally { await pool.end(); }
  });

  it('senha nao vai ao log', async (t) => {
    const comando = comandoCompose();
    if (!comando) return t.skip('docker/wsl indisponivel; o CI da Tarefa 16 roda este teste');

    await prepararTudo({ [PAPEL_LEITURA]: SENHA_A, [PAPEL_ESCRITA]: SENHA_B });
    // execucao forcada a falhar, no mesmo esquema de SET LOCAL
    await su.query('BEGIN');
    try {
      await su.query(`SET LOCAL log_statement = 'none'`);
      await su.query(`SET LOCAL log_min_error_statement = 'panic'`);
      const codigo = await codigoDoErro(() =>
        su.query(`ALTER ROLE papel_que_nao_existe PASSWORD ${pg.escapeLiteral(SENHA_A)}`));
      assert.equal(codigo, '42704');
    } finally { await su.query('ROLLBACK'); }

    const r = spawnSync(comando.bin, [...comando.args, 'logs', 'db'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `compose logs falhou: ${r.stderr}`);
    const log = `${r.stdout}\n${r.stderr}`;
    assert.ok(log.includes('database system is ready'), 'o log do db deveria ser legivel');
    for (const senha of [SENHA_A, SENHA_B, "a''b", 'd$1 ;--']) {
      assert.ok(!log.includes(senha), `senha apareceu no log do db: ${senha}`);
    }
  });
});

function comandoCompose() {
  const base = ['compose', '-f', 'compose.yml', '-f', 'compose.dev.yml'];
  if (spawnSync('docker', ['--version'], { encoding: 'utf8' }).status === 0) {
    return { bin: 'docker', args: base };
  }
  if (process.platform === 'win32'
      && spawnSync('wsl', ['-d', 'Ubuntu', '--', 'docker', '--version'], { encoding: 'utf8' }).status === 0) {
    const wslDir = APP_DIR.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replaceAll('\\', '/');
    return { bin: 'wsl', args: ['-d', 'Ubuntu', '--cd', wslDir, '--', 'docker', ...base] };
  }
  return null;
}
