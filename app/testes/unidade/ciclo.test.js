// Tarefa 9: ciclo de estados do servidor (spec 4.3) com relógio, estado e banco falsos.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarCiclo } from '../../servidor/ciclo.js';

const CRED = { app_leitura: 'senha-l', app_escrita: 'senha-e' };

function relogioFalso(t0 = 1_000_000) {
  let t = t0;
  return { now: () => t, avancar: (ms) => { t += ms; } };
}

function poolFalso({ perfilExiste = true, erro = null } = {}) {
  return {
    query: async () => { if (erro) throw erro; return { rows: [{ existe: perfilExiste }] }; },
    end: async () => {},
    on: () => {},
  };
}

function erroPg(code, message = `erro ${code}`) {
  return Object.assign(new Error(message), { code });
}

const RETRATO = { oids: [1, 2, 3], nFc: 1385, hashRegua: 'r', hashTreino: 't', concluidaEm: new Date(0), md5Conteudo: 'm' };

describe('ciclo de estados (unidade)', () => {
  let dir, rel;
  const gravar = (e) => writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(e));
  const gravarCred = (c = CRED) => writeFileSync(path.join(dir, 'credenciais.json'), JSON.stringify(c));
  const conf = { chamadas: 0, resultado: null, erro: null };
  const pools = { criados: 0, ultimo: null, escritaErro: null, perfilExiste: true };
  const fcFalso = { nUsuarios: 943, fasPorFilme: new Map([[1, [1, 2]]]) };
  const ok = () => ({ ok: true, fc: fcFalso, ocultos: new Set([267]), rankingPopulares: [50, 100], temVetor: new Set([1]), retrato: { ...RETRATO } });

  const novo = (extra = {}) => criarCiclo({
    dirEstado: dir,
    pg: { host: 'h', port: 1, database: 'd' },
    intervalos: { vigiaSegundos: 60, conteudoACada: 10 },
    relogio: rel,
    dependencias: {
      criarPools: ({ credenciais }) => {
        pools.criados += 1;
        pools.ultimo = { credenciais, leitura: poolFalso(), escrita: poolFalso({ perfilExiste: pools.perfilExiste, erro: pools.escritaErro }) };
        return { leitura: pools.ultimo.leitura, escrita: pools.ultimo.escrita };
      },
      conferirIntegral: async () => {
        conf.chamadas += 1;
        if (conf.erro) throw conf.erro;
        return conf.resultado ?? ok();
      },
      ...extra,
    },
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ciclo-'));
    rel = relogioFalso();
    Object.assign(conf, { chamadas: 0, resultado: null, erro: null });
    Object.assign(pools, { criados: 0, ultimo: null, escritaErro: null, perfilExiste: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sem estado.json: preparando', async () => {
    const c = novo();
    const s = await c.saude();
    assert.equal(s.estado, 'preparando');
    assert.equal(c.operante(), null);
    assert.deepEqual(s.perfis, { disponivel: false, motivo: 'sem_dados' });
  });

  it('preparando → operante quando estado.json vira pronto e a conferência passa', async () => {
    gravar({ estado: 'preparando', etapa: 3, total: 8, mensagem: 'carregando filmes no banco', atualizadoEm: 'a' });
    const c = novo();
    let s = await c.saude();
    assert.equal(s.estado, 'preparando');
    assert.equal(s.etapa, 3);
    assert.equal(s.total, 8);
    assert.equal(s.mensagem, 'carregando filmes no banco');
    assert.equal(conf.chamadas, 0, 'não confere enquanto prepara');
    assert.equal(c.operante(), null);

    gravarCred();
    gravar({ estado: 'pronto', etapa: 8, total: 8, mensagem: 'pronto', atualizadoEm: 'b' });
    rel.avancar(2000);
    s = await c.saude();
    assert.equal(s.estado, 'operante');
    assert.equal(conf.chamadas, 1);
    const op = c.operante();
    assert.equal(op.fc, fcFalso);
    assert.deepEqual([...op.ocultos], [267]);
    assert.deepEqual(op.rankingPopulares, [50, 100]);
    assert.deepEqual([...op.temVetor], [1]);
    assert.ok(op.pools.leitura && op.pools.escrita);
    assert.deepEqual(pools.ultimo.credenciais, CRED);
    assert.equal(c.poolEscrita(), pools.ultimo.escrita);
    assert.deepEqual(s.perfis, { disponivel: true });
    // o retrato inclui o atualizadoEm do estado.json
    assert.equal(c.retrato().atualizadoEm, 'b');
  });

  it('falhou: repassa só causa e comando', async () => {
    gravar({ estado: 'falhou', etapa: 2, total: 8, causa: 'sem internet', comando: 'docker compose run --rm preparar', senha: 'x', atualizadoEm: 'a' });
    const c = novo();
    const s = await c.saude();
    assert.equal(s.estado, 'falhou');
    assert.equal(s.causa, 'sem internet');
    assert.equal(s.comando, 'docker compose run --rm preparar');
    assert.ok(!('senha' in s));
    assert.ok(!('senha' in c.estado()));
  });

  it('reconferência limitada a 1 por 2 s', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    conf.resultado = { ok: false, causa: 'régua do banco difere da congelada' };
    const c = novo();
    await Promise.all([c.saude(), c.saude()]);
    await c.saude();
    assert.equal(conf.chamadas, 1);
    assert.equal(c.estado().estado, 'bloqueado');
    rel.avancar(1999);
    await c.saude();
    assert.equal(conf.chamadas, 1);
    rel.avancar(1);
    await c.saude();
    assert.equal(conf.chamadas, 2);
    // operante não reconfere no /saude
    conf.resultado = null;
    rel.avancar(2000);
    assert.equal((await c.saude()).estado, 'operante');
    rel.avancar(2000);
    await c.saude();
    rel.avancar(2000);
    await c.saude();
    assert.equal(conf.chamadas, 3);
  });

  it('bloqueado se recupera sozinho quando a conferência volta a passar', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    conf.resultado = { ok: false, causa: 'selo de preparação ausente' };
    const c = novo();
    const s = await c.saude();
    assert.equal(s.estado, 'bloqueado');
    assert.equal(s.causa, 'selo de preparação ausente');
    assert.equal(s.comando, 'docker compose run --rm preparar');
    conf.resultado = null;
    rel.avancar(2000);
    assert.equal((await c.saude()).estado, 'operante');
  });

  it('erro de disponibilidade não bloqueia', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    const c = novo();
    assert.equal((await c.saude()).estado, 'operante');
    for (const e of [erroPg('ECONNREFUSED'), erroPg('57P01'), erroPg('57P03'), new Error('Connection terminated unexpectedly')]) {
      assert.equal(c.registrarErro(e), 'disponibilidade');
      assert.equal(c.estado().estado, 'operante');
      assert.ok(c.operante());
    }
    // na conferência inicial, banco fora do ar também não bloqueia
    const d = novo();
    conf.erro = erroPg('ECONNREFUSED');
    const s = await d.saude();
    assert.equal(s.estado, 'preparando');
    assert.match(s.mensagem, /banco/);
    conf.erro = null;
    rel.avancar(2000);
    assert.equal((await d.saude()).estado, 'operante');
  });

  it('erro de integridade bloqueia', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    const c = novo();
    await c.saude();
    const tipo = c.registrarErro(new Error('treino do banco difere da fase em uso: rode npm run carregar-v2'));
    assert.equal(tipo, 'integridade');
    const e = c.estado();
    assert.equal(e.estado, 'bloqueado');
    assert.match(e.causa, /treino/);
    assert.equal(e.comando, 'docker compose run --rm preparar');
    assert.equal(c.operante(), null);
    // 42501 também
    const d = novo();
    await d.saude();
    assert.equal(d.registrarErro(erroPg('42501', 'permission denied for table filmes_fc')), 'integridade');
    assert.equal(d.estado().estado, 'bloqueado');
    // erro "outro" não bloqueia
    const f = novo();
    await f.saude();
    assert.equal(f.registrarErro(new Error('qualquer coisa')), 'outro');
    assert.equal(f.estado().estado, 'operante');
  });

  it('28P01 bloqueia com causa credenciais', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    const c = novo();
    await c.saude();
    assert.equal(c.registrarErro(erroPg('28P01', 'password authentication failed for user "app_leitura"')), 'credenciais');
    const e = c.estado();
    assert.equal(e.estado, 'bloqueado');
    assert.equal(e.causa, 'credenciais do banco não conferem; rode `docker compose run --rm preparar`');
    // na conferência também
    const d = novo();
    conf.erro = erroPg('28P01');
    assert.equal((await d.saude()).causa, 'credenciais do banco não conferem; rode `docker compose run --rm preparar`');
  });

  it('credenciais.json inválido ou ausente com estado pronto: bloqueado por credenciais', async () => {
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    const c = novo();
    let s = await c.saude();
    assert.equal(s.estado, 'bloqueado');
    assert.match(s.causa, /credenciais/);
    assert.equal(conf.chamadas, 0);
    writeFileSync(path.join(dir, 'credenciais.json'), JSON.stringify({ app_leitura: '' }));
    rel.avancar(2000);
    s = await c.saude();
    assert.equal(s.estado, 'bloqueado');
    assert.match(s.causa, /credenciais/);
    assert.ok(!JSON.stringify(s).includes('senha-'));
  });

  it('credenciais novas recriam os pools', async () => {
    gravarCred();
    gravar({ estado: 'pronto', atualizadoEm: 'a' });
    conf.resultado = { ok: false, causa: 'x' };
    const c = novo();
    await c.saude();
    assert.equal(pools.criados, 1);
    rel.avancar(2000);
    await c.saude();
    assert.equal(pools.criados, 1, 'mesmas senhas: mesmos pools');
    gravarCred({ app_leitura: 'outra', app_escrita: 'outra2' });
    rel.avancar(2000);
    await c.saude();
    assert.equal(pools.criados, 2);
    assert.deepEqual(pools.ultimo.credenciais, { app_leitura: 'outra', app_escrita: 'outra2' });
  });

  it('perfis: motivos da gestão restrita', async () => {
    gravar({ estado: 'preparando', etapa: 1, total: 8, atualizadoEm: 'a' });
    let c = novo();
    assert.deepEqual((await c.saude()).perfis, { disponivel: false, motivo: 'sem_dados' }, 'sem credenciais.json');
    gravarCred();
    pools.perfilExiste = false;
    c = novo();
    assert.deepEqual((await c.saude()).perfis, { disponivel: false, motivo: 'sem_dados' }, 'sem app.perfil');
    assert.ok(c.poolEscrita(), 'pool de escrita aberto mesmo fora do operante');
    pools.perfilExiste = true;
    c = novo();
    assert.deepEqual((await c.saude()).perfis, { disponivel: true });
    pools.escritaErro = erroPg('28P01');
    c = novo();
    assert.deepEqual((await c.saude()).perfis, { disponivel: false, motivo: 'credenciais' });
    pools.escritaErro = erroPg('ECONNREFUSED');
    c = novo();
    assert.deepEqual((await c.saude()).perfis, { disponivel: false, motivo: 'banco_indisponivel' });
    assert.equal(c.estado().estado, 'preparando', 'perfis nunca mudam o estado');
  });

  describe('vigia', () => {
    it('retrato igual: não reconfere; retrato diferente e conferência ok: continua operante com fc novo', async () => {
      gravarCred();
      gravar({ estado: 'pronto', atualizadoEm: 'a' });
      let impressao = { ...RETRATO };
      const pedidos = [];
      const c = novo({ impressaoDigital: async (_p, { comConteudo }) => { pedidos.push(comConteudo); return { ...impressao }; } });
      await c.saude();
      assert.equal(conf.chamadas, 1);
      await c.vigiar();
      assert.equal(conf.chamadas, 1);
      const fcAntes = c.operante().fc;
      impressao = { ...RETRATO, oids: [4, 5, 6] };
      const fcNovo = { nUsuarios: 943, fasPorFilme: new Map() };
      conf.resultado = { ...ok(), fc: fcNovo, retrato: { ...impressao } };
      await c.vigiar();
      assert.equal(conf.chamadas, 2);
      assert.equal(c.estado().estado, 'operante');
      assert.notEqual(c.operante().fc, fcAntes);
      assert.equal(c.operante().fc, fcNovo);
      assert.deepEqual(c.retrato().oids, [4, 5, 6]);
    });

    it('conteúdo só a cada N ciclos e md5 diferente leva à reconferência', async () => {
      gravarCred();
      gravar({ estado: 'pronto', atualizadoEm: 'a' });
      const pedidos = [];
      let md5 = 'm';
      const c = criarCicloCom(3);
      function criarCicloCom(n) {
        return criarCiclo({
          dirEstado: dir, pg: {}, intervalos: { vigiaSegundos: 60, conteudoACada: n }, relogio: rel,
          dependencias: {
            criarPools: () => ({ leitura: poolFalso(), escrita: poolFalso() }),
            conferirIntegral: async () => { conf.chamadas += 1; return conf.resultado ?? ok(); },
            impressaoDigital: async (_p, { comConteudo }) => {
              pedidos.push(comConteudo);
              const r = { ...RETRATO };
              if (comConteudo) r.md5Conteudo = md5; else delete r.md5Conteudo;
              return r;
            },
          },
        });
      }
      await c.saude();
      await c.vigiar(); await c.vigiar(); await c.vigiar();
      assert.deepEqual(pedidos, [false, false, true]);
      assert.equal(conf.chamadas, 1);
      md5 = 'adulterado';
      conf.resultado = { ok: false, causa: 'conferência dos vetores falhou: valores dos vetores' };
      await c.vigiar(); await c.vigiar();
      assert.equal(conf.chamadas, 1, 'sem ciclo de conteúdo a edição dos valores não é vista (limite declarado)');
      await c.vigiar();
      assert.equal(conf.chamadas, 2);
      assert.equal(c.estado().estado, 'bloqueado');
      assert.match(c.estado().causa, /valores dos vetores/);
    });

    it('estado.json em preparando não derruba o operante; falhou derruba (Ruling 15)', async () => {
      gravarCred();
      gravar({ estado: 'pronto', atualizadoEm: 'a' });
      const c = novo({ impressaoDigital: async () => ({ ...RETRATO }) });
      await c.saude();
      gravar({ estado: 'preparando', etapa: 1, total: 8, atualizadoEm: 'b' });
      await c.vigiar();
      assert.equal(c.estado().estado, 'operante');
      assert.equal(conf.chamadas, 2, 'atualizadoEm mudou: reconferência integral');
      gravar({ estado: 'pronto', etapa: 8, total: 8, atualizadoEm: 'c' });
      await c.vigiar();
      assert.equal(c.estado().estado, 'operante');
      assert.equal(c.retrato().atualizadoEm, 'c');
      gravar({ estado: 'falhou', causa: 'queda', comando: 'docker compose run --rm preparar', atualizadoEm: 'd' });
      await c.vigiar();
      assert.equal(c.estado().estado, 'falhou');
      assert.equal(c.estado().causa, 'queda');
      assert.equal(c.operante(), null);
    });

    it('reconferência que falha por disponibilidade mantém o operante', async () => {
      gravarCred();
      gravar({ estado: 'pronto', atualizadoEm: 'a' });
      let impressao = { ...RETRATO };
      const c = novo({ impressaoDigital: async () => ({ ...impressao }) });
      await c.saude();
      impressao = { ...RETRATO, nFc: 0 };
      conf.erro = erroPg('57P01');
      await c.vigiar();
      assert.equal(c.estado().estado, 'operante');
      // impressão que falha por disponibilidade: nada muda
      const d = novo({ impressaoDigital: async () => { throw erroPg('ECONNREFUSED'); } });
      conf.erro = null;
      await d.saude();
      const n = conf.chamadas;
      await d.vigiar();
      assert.equal(d.estado().estado, 'operante');
      assert.equal(conf.chamadas, n);
    });

    it('bloqueio durante uma reconferência em curso não é desfeito por ela', async () => {
      gravarCred();
      gravar({ estado: 'pronto', atualizadoEm: 'a' });
      let impressao = { ...RETRATO };
      let liberar;
      const portao = new Promise((r) => { liberar = r; });
      let n = 0;
      const c = novo({
        impressaoDigital: async () => ({ ...impressao }),
        conferirIntegral: async () => { n += 1; if (n > 1) await portao; return ok(); },
      });
      await c.saude();
      assert.equal(c.estado().estado, 'operante');
      impressao = { ...RETRATO, oids: [7, 7, 7] };
      const v = c.vigiar();
      await new Promise((r) => setImmediate(r));
      assert.equal(n, 2, 'reconferência em curso');
      c.registrarErro(new Error('régua do banco difere da fase em uso'));
      liberar();
      await v;
      assert.equal(c.estado().estado, 'bloqueado');
      assert.match(c.estado().causa, /régua/);
    });
  });

  it('padrões da vigia são 60 s e 10 ciclos (§10.6 d)', () => {
    const antes = { s: process.env.APP_VIGIA_SEGUNDOS, n: process.env.APP_VIGIA_CONTEUDO_A_CADA };
    delete process.env.APP_VIGIA_SEGUNDOS;
    delete process.env.APP_VIGIA_CONTEUDO_A_CADA;
    try {
      const c = criarCiclo({ dirEstado: dir, pg: {} });
      assert.deepEqual(c.intervalos, { vigiaSegundos: 60, conteudoACada: 10 });
      process.env.APP_VIGIA_SEGUNDOS = '5';
      process.env.APP_VIGIA_CONTEUDO_A_CADA = '2';
      assert.deepEqual(criarCiclo({ dirEstado: dir, pg: {} }).intervalos, { vigiaSegundos: 5, conteudoACada: 2 });
    } finally {
      for (const [k, v] of [['APP_VIGIA_SEGUNDOS', antes.s], ['APP_VIGIA_CONTEUDO_A_CADA', antes.n]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
