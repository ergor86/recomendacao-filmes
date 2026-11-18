// Tarefa 9: ciclo de estados e vigia de integridade contra o banco real (spec 4.3).
// Banco próprio `app_teste_ciclo`, preparado com prepararTudo; servidor real (construirApp + criarCiclo)
// com a vigia a cada 1 s e o conteúdo conferido em todo ciclo.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { HASHES } from '../../integridade.js';
import { prepararTudo } from '../../preparar/preparar.js';
import { rodarScript16 } from '../../preparar/script16.js';
import { construirApp } from '../../servidor/app.js';
import { criarCiclo } from '../../servidor/ciclo.js';
import { criarBuscarBanco } from '../../servidor/recomendacao/s1.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const semDados = !process.env.ML100K_DIR;
const PORTA = 3000;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperar(fn, { ms = 10_000, passo = 100, msg = 'condição' } = {}) {
  const fim = Date.now() + ms;
  let ultimo;
  for (;;) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) { ultimo = e; }
    if (Date.now() > fim) assert.fail(`${msg} não aconteceu em ${ms} ms (último: ${ultimo?.message ?? JSON.stringify(ultimo)})`);
    await dormir(passo);
  }
}

// docker direto no PATH; senão, pelo WSL (ambiente de desenvolvimento); senão, ignorado
function comandoCompose() {
  const arq = '-f compose.yml -f compose.dev.yml';
  if (!spawnSync('docker', ['version'], { stdio: 'ignore' }).error) {
    return (acao) => spawnSync('docker', ['compose', ...arq.split(' '), acao, 'db'], { cwd: APP_DIR, encoding: 'utf8' });
  }
  if (process.platform === 'win32' && !spawnSync('wsl', ['--status'], { stdio: 'ignore' }).error) {
    const dirWsl = APP_DIR.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, l) => `/mnt/${l.toLowerCase()}`);
    return (acao) => spawnSync('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', `cd ${dirWsl} && docker compose ${arq} ${acao} db`], { encoding: 'utf8' });
  }
  return null;
}

describe('ciclo e vigia (banco app_teste_ciclo)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, dirDados, dirTrabalho, dirEstado, su, ciclo, app;
  const saude = async () => (await app.inject({ url: '/api/saude', headers: { host: `localhost:${PORTA}` } })).json();
  const operante = (msg) => esperar(async () => (await saude()).estado === 'operante', { ms: 20_000, msg: msg ?? 'operante' });
  const VETOR = Array.from({ length: 943 }, (_, i) => (i === 0 ? 1 : 0));

  before(async () => {
    cfg = await recriarBancoTeste('app_teste_ciclo');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'ciclo-'));
    dirDados = path.join(tmp, 'dados');
    dirTrabalho = path.join(tmp, 'trabalho');
    dirEstado = path.join(tmp, 'estado');
    copiarArquivosML(path.join(dirDados, 'ml-100k'));
    const r = await prepararTudo({
      pg: cfg, dirDados, dirTrabalho, dirEstado, versaoApp: '0.1.0', porta: PORTA, log: () => {},
    });
    assert.equal(r, 'pronto');
    su = new pg.Pool({ ...cfg, max: 2 });
    su.on('error', () => {}); // queda do banco no último caso
    ciclo = criarCiclo({
      dirEstado, pg: { host: cfg.host, port: cfg.port, database: cfg.database },
      intervalos: { vigiaSegundos: 1, conteudoACada: 1 },
    });
    app = construirApp({ ciclo, porta: PORTA });
    // rota só deste teste, para ver o mapeamento de erros do banco (a rota real nasce na Tarefa 12)
    app.get('/api/teste-busca', async () => {
      const op = ciclo.operante();
      const r = await criarBuscarBanco(op.pools.leitura)(VETOR, [], 10, 'hnsw');
      return { n: r.lista.length };
    });
    await app.ready();
    await ciclo.iniciar();
    await operante('operante inicial');
  });
  after(async () => {
    await app?.close();
    await ciclo?.parar();
    await su?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('operante: pools, fc, ocultos, ranking e saude com perfis disponíveis', async () => {
    const op = ciclo.operante();
    assert.ok(op);
    assert.equal(op.fc.fasPorFilme.size, 1385);
    assert.ok(op.ocultos.has(267));
    assert.equal(op.rankingPopulares.length, 1682);
    assert.equal(op.temVetor.size, 1385);
    const s = await saude();
    assert.deepEqual(s, { estado: 'operante', perfis: { disponivel: true } });
    assert.ok(ciclo.poolEscrita());
    const { rows: [r] } = await op.pools.leitura.query('SELECT current_schema() AS s, current_user AS u');
    assert.deepEqual(r, { s: 'v2_final', u: 'app_leitura' });
    const { rows: [w] } = await ciclo.poolEscrita().query('SELECT current_schema() AS s, current_user AS u');
    assert.deepEqual(w, { s: 'public', u: 'app_escrita' });
  });

  it('(a) hash_treino adulterado: a busca leva a bloqueado com causa "treino"; restaurar volta a operante', async () => {
    await operante();
    const buscar = criarBuscarBanco(ciclo.operante().pools.leitura);
    await su.query(`UPDATE v2_final.metadados SET valor = 'x' WHERE chave = 'hash_treino'`);
    try {
      let erro;
      try { await buscar(VETOR, [], 10, 'hnsw'); } catch (e) { erro = e; }
      assert.ok(erro, 'a busca deveria recusar');
      assert.equal(ciclo.registrarErro(erro), 'integridade');
      const s = await saude();
      assert.equal(s.estado, 'bloqueado');
      assert.match(s.causa, /treino/);
      assert.equal(s.comando, 'docker compose run --rm preparar');
      assert.equal(ciclo.operante(), null);
      // a rota de dados recebe 503 BLOQUEADO pelo tratador de erros
    } finally {
      await su.query(`UPDATE v2_final.metadados SET valor = $1 WHERE chave = 'hash_treino'`, [HASHES.treino]);
    }
    await operante('volta a operante depois de restaurar o hash');
  });

  it('(a) pela rota: erro de integridade vira 503 BLOQUEADO', async () => {
    await operante();
    await su.query(`UPDATE v2_final.metadados SET valor = 'x' WHERE chave = 'hash_treino'`);
    try {
      const r = await app.inject({ url: '/api/teste-busca', headers: { host: `localhost:${PORTA}` } });
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().codigo, 'BLOQUEADO');
      assert.equal(ciclo.estado().estado, 'bloqueado');
    } finally {
      await su.query(`UPDATE v2_final.metadados SET valor = $1 WHERE chave = 'hash_treino'`, [HASHES.treino]);
    }
    await operante();
  });

  it('(b) valor de vetor adulterado: /api/saude mostra bloqueado com "valores dos vetores" em até 10 s', async () => {
    await operante();
    const { rows: [orig] } = await su.query('SELECT embedding::text AS t, embedding::real[] AS v FROM v2_final.filmes_fc WHERE id = 1');
    const v = orig.v.slice();
    const k = v.findIndex((x) => x !== 0);
    v[k] = v[k] * 1.5;
    await su.query('UPDATE v2_final.filmes_fc SET embedding = $1::real[]::vector WHERE id = 1', [v]);
    try {
      const s = await esperar(async () => {
        const x = await saude();
        return x.estado === 'bloqueado' ? x : null;
      }, { ms: 10_000, msg: 'bloqueio pela vigia' });
      assert.match(s.causa, /valores dos vetores/);
    } finally {
      await su.query('UPDATE v2_final.filmes_fc SET embedding = $1::vector WHERE id = 1', [orig.t]);
    }
    await operante('volta a operante depois de restaurar o vetor');
  });

  it('(c) rodarScript16 de novo mantém o servidor operante, com o fc recarregado (o retrato muda)', async () => {
    await operante();
    const antes = ciclo.retrato();
    const fcAntes = ciclo.operante().fc;
    const estados = new Set();
    let amostrando = true;
    const amostra = (async () => {
      while (amostrando) { estados.add(ciclo.estado().estado); await dormir(20); }
    })();
    try {
      await rodarScript16({ pg: cfg, dirDados, dirTrabalho });
      await esperar(() => {
        const r = ciclo.retrato();
        return r && r.oids[1] !== antes.oids[1] && ciclo.operante()?.fc !== fcAntes;
      }, { ms: 20_000, msg: 'retrato novo' });
    } finally {
      amostrando = false;
      await amostra;
    }
    assert.deepEqual([...estados], ['operante'], `estados vistos: ${[...estados]}`);
    assert.notDeepEqual(ciclo.retrato().oids, antes.oids);
    assert.equal(ciclo.operante().fc.fasPorFilme.size, 1385);
    assert.equal((await saude()).estado, 'operante');
  });

  it('nova preparação (selo e estado.json mudam) mantém o servidor operante e tira um retrato novo', async () => {
    await operante();
    const antes = ciclo.retrato();
    const estados = new Set();
    let amostrando = true;
    const amostra = (async () => {
      while (amostrando) { estados.add(ciclo.estado().estado); await dormir(20); }
    })();
    try {
      assert.equal(await prepararTudo({
        pg: cfg, dirDados, dirTrabalho, dirEstado, versaoApp: '0.1.0', porta: PORTA, log: () => {},
      }), 'pronto');
      await esperar(() => ciclo.retrato()?.concluidaEm?.getTime() !== antes.concluidaEm.getTime(), { msg: 'retrato com selo novo' });
    } finally {
      amostrando = false;
      await amostra;
    }
    assert.deepEqual([...estados], ['operante']);
    assert.notEqual(ciclo.retrato().atualizadoEm, antes.atualizadoEm);
  });

  it('banco parado → BANCO_INDISPONIVEL e volta sozinho', async (t) => {
    const compose = comandoCompose();
    if (!compose) return t.skip('nem docker nem wsl no PATH');
    await operante();
    const pedir = () => app.inject({ url: '/api/teste-busca', headers: { host: `localhost:${PORTA}` } });
    assert.equal((await pedir()).statusCode, 200);
    const parou = compose('stop');
    assert.equal(parou.status, 0, `stop db: ${parou.stderr}`);
    try {
      const r = await pedir();
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().codigo, 'BANCO_INDISPONIVEL');
      assert.equal(ciclo.estado().estado, 'operante', 'disponibilidade não bloqueia');
      await dormir(2100);
      const s = await saude();
      assert.equal(s.estado, 'operante');
      assert.deepEqual(s.perfis, { disponivel: false, motivo: 'banco_indisponivel' });
      await dormir(1500); // a vigia roda com o banco fora do ar e não bloqueia
      assert.equal(ciclo.estado().estado, 'operante');
    } finally {
      const subiu = compose('start');
      assert.equal(subiu.status, 0, `start db: ${subiu.stderr}`);
      // espera o banco aceitar conexões (o mesmo banco das outras suítes)
      await esperar(async () => { await su.query('SELECT 1'); return true; }, { ms: 90_000, passo: 500, msg: 'banco de volta' });
      await esperar(() => /\(healthy\)/.test(compose('ps').stdout ?? ''), { ms: 90_000, passo: 1000, msg: 'healthcheck do db' });
    }
    await esperar(async () => (await pedir()).statusCode === 200, { ms: 30_000, passo: 500, msg: 'busca de volta' });
    await esperar(async () => (await saude()).perfis.disponivel === true, { ms: 10_000, msg: 'perfis de volta' });
    assert.equal(ciclo.estado().estado, 'operante');
  });
});
