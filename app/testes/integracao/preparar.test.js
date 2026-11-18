// Tarefa 7: orquestracao da preparacao (spec 4.2). Banco proprio `app_teste_prep`, recriado no `before`.
// Precisa de ML100K_DIR (so os 5 arquivos permitidos sao copiados).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { HASHES } from '../../integridade.js';
import { CHAVE_TRAVA, prepararTudo } from '../../preparar/preparar.js';
import { conferirIntegridade } from '../../comum/conferencia.js';
import { ErroPreparacao } from '../../preparar/dados.js';
import { impressaoDigital } from '../../comum/fc-banco.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const VERSAO = '0.1.0';
const semDados = !process.env.ML100K_DIR;

describe('preparacao (banco app_teste_prep)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, dirDados, dirTrabalho, dirEstado, pool;
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const logs = [];
  const log = (m) => logs.push(m);
  const preparar = (extra = {}) => prepararTudo({
    pg: cfg, dirDados, dirTrabalho, dirEstado, versaoApp: VERSAO, porta: 3000, log, ...extra,
  });
  const estado = () => JSON.parse(readFileSync(path.join(dirEstado, 'estado.json'), 'utf8'));
  const baixarProibido = async () => { throw new Error('nao deveria baixar'); };
  const tempo = {};
  const alvoAntes = process.env.PREPARAR_ALVO_APP;
  const semSenhas = () => {
    const cred = JSON.parse(readFileSync(path.join(dirEstado, 'credenciais.json'), 'utf8'));
    const texto = readFileSync(path.join(dirEstado, 'estado.json'), 'utf8');
    for (const v of Object.values(cred)) assert.ok(!texto.includes(v));
  };
  const oidFc = async () => (await q(`SELECT ('v2_final.filmes_fc'::regclass::oid)::text AS o`))[0].o;

  before(async () => {
    delete process.env.PREPARAR_ALVO_APP;
    cfg = await recriarBancoTeste('app_teste_prep');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    dirDados = path.join(tmp, 'dados');
    dirTrabalho = path.join(tmp, 'trabalho');
    dirEstado = path.join(tmp, 'estado');
    copiarArquivosML(path.join(dirDados, 'ml-100k'));
    pool = new pg.Pool({ ...cfg, max: 3 });
  });
  after(async () => {
    if (alvoAntes === undefined) delete process.env.PREPARAR_ALVO_APP;
    else process.env.PREPARAR_ALVO_APP = alvoAntes;
    await pool?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('recusa o banco da pesquisa sem conectar', async () => {
    const arquivoEstado = path.join(dirEstado, 'estado.json');
    assert.equal(existsSync(arquivoEstado), false, 'ainda sem estado');
    const saida = [];
    await assert.rejects(preparar({ pg: { ...cfg, port: 5433 }, log: (m) => saida.push(m) }), /pesquisa/);
    await assert.rejects(preparar({ pg: { ...cfg, database: 'recomendacao' } }), /pesquisa/);
    assert.equal(existsSync(arquivoEstado), false, 'recusa sem trava nao grava estado');
    assert.ok(saida.some((l) => /pesquisa/.test(l)), 'a recusa fica no log');
  });

  it('banco inalcancavel: nao grava estado, so registra no log', async () => {
    const saida = [];
    await assert.rejects(
      preparar({ pg: { ...cfg, port: 1 }, log: (m) => saida.push(m), espera: async () => {} }),
      /Não consegui conectar/,
    );
    assert.equal(existsSync(path.join(dirEstado, 'estado.json')), false);
    assert.ok(saida.some((l) => /Não consegui conectar/.test(l)));
  });

  it('primeira preparacao termina pronta', async () => {
    const t0 = Date.now();
    assert.equal(await preparar({ baixar: baixarProibido }), 'pronto');
    tempo.completa = Date.now() - t0;
    const e = estado();
    assert.equal(e.estado, 'pronto');
    assert.equal(e.total, 8);
    const [selo] = await q('SELECT * FROM app.preparacao');
    assert.equal(selo.id, 1);
    assert.equal(selo.versao_app, VERSAO);
    assert.equal(selo.hash_regua, HASHES.regua);
    assert.equal(selo.hash_treino, HASHES.treino);
    assert.equal(selo.hash_vetores_fc, HASHES.vetoresFC);
    assert.ok(readFileSync(path.join(dirEstado, 'credenciais.json'), 'utf8').length > 0);
    assert.ok(logs.some((l) => l.startsWith('3/8: carregando filmes no banco')));
    for (const [k, v] of [['hash_regua', HASHES.regua], ['hash_treino', HASHES.treino], ['hash_vetores_fc', HASHES.vetoresFC]]) {
      assert.ok(logs.includes(`${k}=${v}`), `log sem ${k}`);
    }
  });

  it('conferirIntegridade: pronto devolve fc e hashes; selo adulterado e acusado', async () => {
    const r = await conferirIntegridade(pool);
    assert.equal(r.ok, true);
    assert.deepEqual(r.hashes, { regua: HASHES.regua, treino: HASHES.treino, vetoresFC: HASHES.vetoresFC });
    assert.ok(r.fc.fasPorFilme.size > 0);
    await pool.query(`UPDATE app.preparacao SET n_fc = n_fc + 1`);
    const ruim = await conferirIntegridade(pool);
    assert.equal(ruim.ok, false);
    assert.match(ruim.causa, /selo/);
    assert.equal((await conferirIntegridade(pool, { comSelo: false })).ok, true);
    await pool.query('UPDATE app.preparacao SET n_fc = n_fc - 1');
    await pool.query("UPDATE app.preparacao SET hash_regua = 'x'");
    assert.match((await conferirIntegridade(pool)).causa, /selo/);
    await pool.query('UPDATE app.preparacao SET hash_regua = $1', [HASHES.regua]);
    await pool.query('DELETE FROM app.preparacao');
    assert.match((await conferirIntegridade(pool)).causa, /selo/);
    await preparar();
    assert.equal((await conferirIntegridade(pool)).ok, true);
  });

  it('linha Pronto usa a porta', async () => {
    const saida = [];
    await preparar({ porta: 3317, log: (m) => saida.push(m) });
    assert.ok(saida.some((l) => l.includes('Pronto: abra http://localhost:3317')));
  });

  it('segunda preparacao pula download e script 16', async () => {
    const antes = await q(`SELECT ('v2_final.filmes'::regclass::oid)::text AS a, ('v2_final.filmes_fc'::regclass::oid)::text AS b,
                                  ('v2_final.metadados'::regclass::oid)::text AS c`);
    const saida = [];
    const t0 = Date.now();
    assert.equal(await preparar({ baixar: baixarProibido, log: (m) => saida.push(m) }), 'pronto');
    tempo.repetida = Date.now() - t0;
    const depois = await q(`SELECT ('v2_final.filmes'::regclass::oid)::text AS a, ('v2_final.filmes_fc'::regclass::oid)::text AS b,
                                   ('v2_final.metadados'::regclass::oid)::text AS c`);
    assert.deepEqual(depois, antes);
    assert.ok(!saida.some((l) => l.includes('carregando filmes no banco')));
    assert.equal(estado().estado, 'pronto');
  });

  it('estado.json nunca contem senhas', () => { semSenhas(); });

  it('duas preparacoes simultaneas: a segunda lanca e nao grava falhou', async () => {
    const outra = new pg.Client(cfg);
    await outra.connect();
    try {
      await outra.query('SELECT pg_advisory_lock($1)', [CHAVE_TRAVA]);
      const antes = readFileSync(path.join(dirEstado, 'estado.json'), 'utf8');
      await assert.rejects(preparar(), /outra preparação em andamento/);
      assert.equal(readFileSync(path.join(dirEstado, 'estado.json'), 'utf8'), antes);
    } finally {
      await outra.end();
    }
    assert.equal(await preparar(), 'pronto'); // trava liberada
  });

  it('preparacao interrompida nao passa como pronta', async () => {
    await pool.query('DELETE FROM app.preparacao');
    await assert.rejects(
      preparar({ ganchos: { antesDoSelo: async () => { throw new Error('queda simulada'); } } }),
      /queda simulada/,
    );
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 0);
    const e = estado();
    assert.equal(e.estado, 'falhou');
    assert.match(e.causa, /queda simulada/);
    assert.equal(e.comando, 'docker compose run --rm preparar');
    semSenhas();
    assert.equal(await preparar(), 'pronto');
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 1);
  });

  it('selo antigo nao sobrevive a carga que falhou depois do script 16', async () => {
    await preparar(); // selo presente
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 1);
    await pool.query(`UPDATE v2_final.metadados SET valor = 'invalido' WHERE chave IN ('hash_regua', 'hash_treino')`);
    await assert.rejects(
      preparar({ ganchos: { antesDoSelo: async () => { throw new Error('queda apos o script 16'); } } }),
      /queda apos o script 16/,
    );
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 0, 'selo antigo foi invalidado');
    const saida = [];
    assert.equal(await preparar({ log: (m) => saida.push(m) }), 'pronto');
    assert.ok(saida.some((l) => l.includes('3/8: carregando filmes no banco')));
    assert.ok(saida.some((l) => l.includes('6/8: preenchendo as tabelas de referência')));
    assert.equal((await q('SELECT 1 FROM app.preparacao')).length, 1);
  });

  describe('nova preparacao preserva os dados dos usuarios', () => {
    let exemploFilmes;
    async function criarUsuarios() {
      assert.equal((await q('SELECT 1 FROM app.perfil')).length, 0, 'banco recriado: sem perfis');
      const ids = (await q(`INSERT INTO app.perfil (nome, onboarding_concluido) VALUES ('Ana', true), ('Bruno', true) RETURNING id`)).map((r) => r.id);
      const filmes = (await q('SELECT id FROM app.filme ORDER BY id LIMIT 12')).map((r) => r.id);
      const linhas = [];
      const [ex] = await q(`INSERT INTO app.perfil (nome, exemplo, onboarding_concluido) VALUES ('Exemplo', true, true) RETURNING id`);
      const exFilmes = (await q('SELECT id FROM app.filme ORDER BY id DESC LIMIT 5')).map((r) => r.id);
      assert.ok(exFilmes.every((f) => !filmes.includes(f)));
      for (const [i, f] of exFilmes.entries()) {
        await pool.query(`INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, 'nota', $3)`, [ex.id, f, (i % 5) + 1]);
      }
      exemploFilmes = exFilmes;
      ids.forEach((p, k) => {
        filmes.slice(0, 6).forEach((f, i) => linhas.push([p, f, 'nota', ((i + k) % 5) + 1]));
        linhas.push([p, filmes[6], 'gostei', null], [p, filmes[7 + k], 'quero_assistir', null]);
      });
      for (const [p, f, t, n] of linhas) {
        await pool.query('INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, $3, $4)', [p, f, t, n]);
      }
    }
    async function retrato() {
      return {
        perfil: await q('SELECT * FROM app.perfil ORDER BY id'),
        interacao: await q('SELECT * FROM app.interacao ORDER BY perfil_id, filme_id'),
        estatisticas: await q(
          `SELECT i.filme_id, count(*)::int AS n, avg(i.nota)::float AS media
             FROM app.interacao i JOIN app.perfil p ON p.id = i.perfil_id
            WHERE i.tipo = 'nota' AND NOT p.exemplo GROUP BY i.filme_id ORDER BY i.filme_id`),
        historica: await q('SELECT * FROM app.estatistica_historica ORDER BY filme_id'),
      };
    }

    it('sem o selo (passo 6 roda de novo)', async () => {
      await criarUsuarios();
      const antes = await retrato();
      assert.ok(antes.perfil.some((p) => p.exemplo), 'perfil de exemplo presente');
      assert.ok(antes.estatisticas.every((e) => !exemploFilmes.includes(e.filme_id)), 'exemplo fora das estatisticas');
      assert.ok(antes.perfil.length === 3 && antes.interacao.length === 21 && antes.estatisticas.length > 0);
      await pool.query('DELETE FROM app.preparacao');
      const saida = [];
      await preparar({ log: (m) => saida.push(m) });
      assert.ok(saida.some((l) => l.includes('6/8: preenchendo as tabelas de referência')));
      assert.deepEqual(await retrato(), antes);
    });

    it('com o script 16 forcado (hashes invalidados)', async () => {
      const antes = await retrato();
      await pool.query('DELETE FROM app.preparacao');
      await pool.query(`UPDATE v2_final.metadados SET valor = 'invalido' WHERE chave IN ('hash_regua', 'hash_treino')`);
      const oidAntes = await oidFc();
      const saida = [];
      await preparar({ log: (m) => saida.push(m) });
      assert.ok(saida.some((l) => l.includes('carregando filmes no banco')));
      assert.ok(saida.some((l) => l.includes('6/8: preenchendo as tabelas de referência')));
      assert.notEqual(await oidFc(), oidAntes, 'script 16 recriou filmes_fc');
      const [m] = await q(`SELECT valor FROM v2_final.metadados WHERE chave = 'hash_regua'`);
      assert.equal(m.valor, HASHES.regua);
      assert.deepEqual(await retrato(), antes);
    });

    it('autocura: banco pronto com vetor adulterado e consertado, usuarios preservados', async () => {
      const antes = await retrato();
      const dig = await impressaoDigital(pool, { comConteudo: true });
      const [a, b] = (await q('SELECT id FROM v2_final.filmes_fc ORDER BY id LIMIT 2')).map((r) => r.id);
      await pool.query('UPDATE v2_final.filmes_fc SET embedding = (SELECT embedding FROM v2_final.filmes_fc WHERE id = $2) WHERE id = $1', [a, b]);
      assert.notEqual((await impressaoDigital(pool, { comConteudo: true })).md5Conteudo, dig.md5Conteudo);
      const saida = [];
      assert.equal(await preparar({ log: (m) => saida.push(m) }), 'pronto');
      assert.ok(saida.includes('integridade divergente: recarregando os dados congelados'));
      assert.equal(saida.filter((l) => l.includes('carregando filmes no banco')).length, 1);
      assert.equal(saida.filter((l) => l.includes('6/8: preenchendo as tabelas de referência')).length, 1);
      assert.equal((await impressaoDigital(pool, { comConteudo: true })).md5Conteudo, dig.md5Conteudo);
      assert.deepEqual(await retrato(), antes);
    });
  });

  it('banco pronto nao obtem os dados: dirDados vazio e baixar que lanca', async () => {
    const vazio = mkdtempSync(path.join(os.tmpdir(), 'prep-vazio-'));
    try {
      const saida = [];
      assert.equal(await preparar({ dirDados: vazio, baixar: baixarProibido, log: (m) => saida.push(m) }), 'pronto');
      assert.ok(!saida.some((l) => l.startsWith('2/8: conferindo os arquivos')));
    } finally {
      rmSync(vazio, { recursive: true, force: true });
    }
  });

  it('credenciais.json de formato invalido: ErroPreparacao com causa e comando', async () => {
    const estadoRuim = mkdtempSync(path.join(os.tmpdir(), 'prep-cred-'));
    try {
      writeFileSync(path.join(estadoRuim, 'credenciais.json'), JSON.stringify({ app_leitura: 1 }));
      await assert.rejects(preparar({ dirEstado: estadoRuim }), (e) => {
        assert.ok(e instanceof ErroPreparacao);
        assert.equal(e.causa, 'O arquivo de credenciais está corrompido.');
        assert.equal(
          e.comando,
          'apague credenciais.json no volume de estado (docker compose down -v apaga tudo) e rode docker compose run --rm preparar',
        );
        return true;
      });
      const e = JSON.parse(readFileSync(path.join(estadoRuim, 'estado.json'), 'utf8'));
      assert.equal(e.estado, 'falhou');
      assert.equal(e.causa, 'O arquivo de credenciais está corrompido.');
    } finally {
      rmSync(estadoRuim, { recursive: true, force: true });
    }
  });

  it('modo dev recusa v2_final sem o schema app', async () => {
    await pool.query('DROP SCHEMA app CASCADE');
    await assert.rejects(preparar({ modoDev: true }), /v2_final/);
    assert.equal(estado().estado, 'falhou');
    semSenhas();
  });

  it('modo dev: 1a preparacao interrompida depois do script 16 nao trava a 2a', async () => {
    const cfgDev = await recriarBancoTeste('app_teste_prep_dev');
    const tmpDev = mkdtempSync(path.join(os.tmpdir(), 'prep-dev-'));
    try {
      const comum = {
        pg: cfgDev, dirDados, dirTrabalho: path.join(tmpDev, 'trabalho'), dirEstado: path.join(tmpDev, 'estado'),
        versaoApp: VERSAO, porta: 3000, log, modoDev: true,
      };
      await assert.rejects(
        prepararTudo({ ...comum, ganchos: { antesDoSelo: async () => { throw new Error('queda no modo dev'); } } }),
        /queda no modo dev/,
      );
      assert.equal(await prepararTudo(comum), 'pronto');
    } finally {
      rmSync(tmpDev, { recursive: true, force: true });
    }
  });

  it('tempos', (t) => {
    t.diagnostic(`tempo preparacao completa: ${tempo.completa} ms; repetida: ${tempo.repetida} ms`);
  });
});
