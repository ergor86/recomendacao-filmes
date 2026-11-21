// Tarefa 12: GET /perfis/:id/recomendacoes e GET /diagnostico/busca contra o banco real (spec 4.4, 6.2 e 6.3).
// Banco próprio `app_teste_recomendacoes`, preparado com prepararTudo; servidor real (construirApp + criarCiclo).
import '../apoio/dados-exigidos.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { prepararTudo } from '../../preparar/preparar.js';
import { construirApp } from '../../servidor/app.js';
import { criarCiclo } from '../../servidor/ciclo.js';
import { HASHES } from '../../integridade.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const semDados = !process.env.ML100K_DIR;
const PORTA = 3000;
const HOST = { host: `localhost:${PORTA}` };
const PERFIL_FANTASMA = '00000000-0000-4000-8000-000000000000';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperar(fn, { ms = 20_000, passo = 100, msg = 'condição' } = {}) {
  const fim = Date.now() + ms;
  for (;;) {
    let ultimo;
    try { ultimo = await fn(); if (ultimo) return ultimo; } catch (e) { ultimo = e; }
    if (Date.now() > fim) assert.fail(`${msg} não aconteceu em ${ms} ms (último: ${ultimo?.message ?? JSON.stringify(ultimo)})`);
    await dormir(passo);
  }
}

// gerador pseudoaleatório com semente fixa (mulberry32)
function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('recomendações e diagnóstico (banco app_teste_recomendacoes)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, su, ciclo, app, appDiag, dirEstado;
  let comVetor, semVetor, ocultos; // ids

  const get = async (url, instancia = app) => {
    const r = await instancia.inject({ url, headers: HOST });
    return { status: r.statusCode, corpo: r.json() };
  };
  const novoPerfil = async (nome = 'Teste') => (await su.query('INSERT INTO app.perfil (nome) VALUES ($1) RETURNING id', [nome])).rows[0].id;
  const interagir = (perfil, filme, tipo, nota = null) => su.query(
    `INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, $3, $4)
     ON CONFLICT (perfil_id, filme_id) DO UPDATE SET tipo = EXCLUDED.tipo, nota = EXCLUDED.nota`, [perfil, filme, tipo, nota],
  );
  const recs = async (perfil, sufixo = '') => get(`/api/perfis/${perfil}/recomendacoes${sufixo}`);
  const limpar = () => su.query('TRUNCATE app.perfil CASCADE');
  const saude = async () => (await app.inject({ url: '/api/saude', headers: HOST })).json();
  const operante = (msg) => esperar(async () => (await saude()).estado === 'operante', { msg: msg ?? 'operante' });

  before(async () => {
    cfg = await recriarBancoTeste('app_teste_recomendacoes');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'recs-'));
    dirEstado = path.join(tmp, 'estado');
    copiarArquivosML(path.join(tmp, 'dados', 'ml-100k'));
    const r = await prepararTudo({
      pg: cfg, dirDados: path.join(tmp, 'dados'), dirTrabalho: path.join(tmp, 'trabalho'), dirEstado,
      versaoApp: '0.1.0', porta: PORTA, log: () => {},
    });
    assert.equal(r, 'pronto');
    su = new pg.Pool({ ...cfg, max: 2 });
    ciclo = criarCiclo({
      dirEstado, pg: { host: cfg.host, port: cfg.port, database: cfg.database },
      intervalos: { vigiaSegundos: 3600, conteudoACada: 1000 },
    });
    app = construirApp({ ciclo, porta: PORTA, diagnostico: false });
    appDiag = construirApp({ ciclo, porta: PORTA, diagnostico: true });
    await app.ready();
    await appDiag.ready();
    await ciclo.iniciar();
    assert.ok(ciclo.operante(), 'operante');
    const lista = async (cond) => (await su.query(
      `SELECT f.id FROM app.filme f JOIN app.estatistica_historica e ON e.filme_id = f.id WHERE ${cond} ORDER BY e.n_notas DESC, f.id`,
    )).rows.map((x) => x.id);
    comVetor = await lista('f.visivel AND f.tem_vetor');
    semVetor = await lista('f.visivel AND NOT f.tem_vetor');
    ocultos = new Set((await su.query('SELECT id FROM app.filme WHERE NOT visivel')).rows.map((x) => x.id));
    assert.ok(comVetor.length > 100 && semVetor.length > 0 && ocultos.size === 20);
  });
  after(async () => {
    await app?.close();
    await appDiag?.close();
    await ciclo?.parar();
    await su?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  describe('GET /perfis/:id/recomendacoes', () => {
    it('perfil vazio → sem_curtidas com 10 populares sem porque', async () => {
      await limpar();
      const p = await novoPerfil();
      const { status, corpo } = await recs(p);
      assert.equal(status, 200);
      assert.equal(corpo.perfilId, p);
      assert.ok(!Number.isNaN(Date.parse(corpo.geradoEm)));
      assert.equal(corpo.motivo, 'sem_curtidas');
      assert.deepEqual(corpo.perfil, { curtidos: 0, curtidosComVetor: 0, baseadoEm: [] });
      assert.equal(corpo.itens.length, 10);
      assert.deepEqual(corpo.itens.map((i) => i.posicao), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const i of corpo.itens) {
        assert.equal(i.fonte, 'populares');
        assert.equal(i.escore, null);
        assert.deepEqual(i.porque, []);
        assert.ok(i.filme.titulo && Array.isArray(i.filme.generos));
        assert.equal(i.filme.estadoPerfil, null);
      }
      assert.equal(corpo.busca, null);
      // os 10 mais avaliados visíveis, na ordem (n_notas decrescente, id)
      const { rows } = await su.query(
        `SELECT f.id FROM app.filme f JOIN app.estatistica_historica e ON e.filme_id = f.id WHERE f.visivel
         ORDER BY e.n_notas DESC, f.id LIMIT 10`,
      );
      assert.deepEqual(corpo.itens.map((i) => i.filme.id), rows.map((r) => r.id));
    });

    it('3 gostei com vetor → 10 itens, motivo personalizado ou parcial, todo item S1 com porque', async () => {
      await limpar();
      const p = await novoPerfil();
      const curtidos = comVetor.slice(0, 3);
      for (const f of curtidos) await interagir(p, f, 'gostei');
      const { status, corpo } = await recs(p);
      assert.equal(status, 200);
      assert.equal(corpo.itens.length, 10);
      assert.ok(['personalizado', 'parcial'].includes(corpo.motivo), corpo.motivo);
      assert.equal(corpo.perfil.curtidos, 3);
      assert.equal(corpo.perfil.curtidosComVetor, 3);
      assert.equal(corpo.perfil.baseadoEm.length, 3);
      assert.deepEqual(corpo.perfil.baseadoEm.map((b) => b.id).sort((a, b) => a - b), [...curtidos].sort((a, b) => a - b));
      for (const b of corpo.perfil.baseadoEm) {
        assert.deepEqual(Object.keys(b).sort(), ['ano', 'generos', 'id', 'titulo']);
        assert.ok(Array.isArray(b.generos));
      }
      const s1 = corpo.itens.filter((i) => i.fonte === 'S1');
      assert.ok(s1.length >= 1);
      let anterior = Infinity;
      for (const i of s1) {
        assert.ok(i.escore > 0 && i.escore <= anterior);
        anterior = i.escore;
        assert.ok(i.porque.length >= 1 && i.porque.length <= 2, `item ${i.filme.id}`);
        for (const q of i.porque) {
          assert.deepEqual(Object.keys(q).sort(), ['id', 'titulo']);
          assert.ok(curtidos.includes(q.id));
          assert.ok(q.titulo.length > 0);
        }
      }
      // S1 antes dos populares
      const fontes = corpo.itens.map((i) => i.fonte);
      assert.deepEqual(fontes, [...fontes].sort((a, b) => (a === b ? 0 : a === 'S1' ? -1 : 1)));
      for (const i of corpo.itens.filter((x) => x.fonte === 'populares')) assert.deepEqual(i.porque, []);
      assert.equal(corpo.busca.mecanismo, 'S1/HNSW');
      assert.equal(corpo.busca.m, 300);
      assert.equal(corpo.busca.nFc, 150);
      assert.equal(typeof corpo.busca.linhasPedidas, 'number');
      assert.equal(typeof corpo.busca.empateNaoResolvido, 'boolean');
      assert.ok(corpo.busca.candidatosS1 >= s1.length);
      assert.equal(corpo.busca.nExcluidos, 3 + ocultos.size);
      const ids = corpo.itens.map((i) => i.filme.id);
      assert.equal(new Set(ids).size, 10);
      for (const c of curtidos) assert.ok(!ids.includes(c));
    });

    it('baseadoEm traz no máximo 5 curtidos com vetor', async () => {
      await limpar();
      const p = await novoPerfil();
      for (const f of comVetor.slice(0, 8)) await interagir(p, f, 'gostei');
      const { corpo } = await recs(p);
      assert.equal(corpo.perfil.curtidos, 8);
      assert.equal(corpo.perfil.curtidosComVetor, 8);
      assert.equal(corpo.perfil.baseadoEm.length, 5);
    });

    it('curtida só em filme sem vetor → curtidas_sem_vetor', async () => {
      await limpar();
      const p = await novoPerfil();
      await interagir(p, semVetor[0], 'gostei');
      const { corpo } = await recs(p);
      assert.equal(corpo.motivo, 'curtidas_sem_vetor');
      assert.deepEqual(corpo.perfil, { curtidos: 1, curtidosComVetor: 0, baseadoEm: [] });
      assert.equal(corpo.itens.length, 10);
      assert.ok(corpo.itens.every((i) => i.fonte === 'populares' && i.escore === null && i.porque.length === 0));
      assert.ok(!corpo.itens.some((i) => i.filme.id === semVetor[0]));
      assert.equal(corpo.busca, null);
    });

    it('nota 2 num item do top 10 → ele sai', async () => {
      await limpar();
      const p = await novoPerfil();
      for (const f of comVetor.slice(0, 3)) await interagir(p, f, 'gostei');
      const antes = (await recs(p)).corpo.itens.map((i) => i.filme.id);
      const alvo = antes[0];
      await interagir(p, alvo, 'nota', 2);
      const depois = await recs(p);
      const ids = depois.corpo.itens.map((i) => i.filme.id);
      assert.ok(!ids.includes(alvo), `${alvo} deveria sair`);
      assert.equal(ids.length, 10);
      assert.equal(depois.corpo.perfil.curtidos, 3, 'nota 2 não curte');
    });

    it('quero_assistir → sai e aparece em interacoes?tipos=quero_assistir', async () => {
      await limpar();
      const p = await novoPerfil();
      for (const f of comVetor.slice(0, 3)) await interagir(p, f, 'gostei');
      const alvo = (await recs(p)).corpo.itens[0].filme.id;
      await interagir(p, alvo, 'quero_assistir');
      const ids = (await recs(p)).corpo.itens.map((i) => i.filme.id);
      assert.ok(!ids.includes(alvo));
      const lista = await get(`/api/perfis/${p}/interacoes?tipos=quero_assistir`);
      assert.equal(lista.status, 200);
      assert.deepEqual(lista.corpo.itens.map((i) => i.filme.id), [alvo]);
    });

    it('?modo=exata&m=5 ignorados (busca.m = 300)', async () => {
      await limpar();
      const p = await novoPerfil();
      for (const f of comVetor.slice(0, 3)) await interagir(p, f, 'gostei');
      const base = (await recs(p)).corpo;
      const com = await recs(p, '?modo=exata&m=5&k=2&foo=bar');
      assert.equal(com.status, 200);
      assert.equal(com.corpo.busca.m, 300);
      assert.equal(com.corpo.busca.mecanismo, 'S1/HNSW');
      assert.deepEqual(com.corpo.itens.map((i) => i.filme.id), base.itens.map((i) => i.filme.id));
      assert.equal(com.corpo.busca.linhasPedidas, base.busca.linhasPedidas);
    });

    it('perfil inexistente 404; id que não é UUID 400', async () => {
      const a = await recs(PERFIL_FANTASMA);
      assert.equal(a.status, 404);
      assert.equal(a.corpo.codigo, 'PERFIL_NAO_ENCONTRADO');
      const b = await recs('abc');
      assert.equal(b.status, 400);
      assert.equal(b.corpo.codigo, 'VALIDACAO');
    });

    it('ocultos nunca aparecem (30 perfis aleatórios) e nenhum item é interagido', async () => {
      await limpar();
      const sorteio = prng(12345);
      const escolher = (arr) => arr[Math.floor(sorteio() * arr.length)];
      const todosVisiveis = [...comVetor, ...semVetor];
      for (let n = 0; n < 30; n += 1) {
        const p = await novoPerfil(`aleatorio-${n}`);
        const k = Math.floor(sorteio() * 16);
        const usados = new Set();
        for (let j = 0; j < k; j += 1) {
          const f = escolher(sorteio() < 0.8 ? comVetor : todosVisiveis);
          if (usados.has(f)) continue;
          usados.add(f);
          const t = sorteio();
          if (t < 0.5) await interagir(p, f, 'gostei');
          else if (t < 0.7) await interagir(p, f, 'quero_assistir');
          else await interagir(p, f, 'nota', 1 + Math.floor(sorteio() * 5));
        }
        const { status, corpo } = await recs(p);
        assert.equal(status, 200, `perfil ${n}`);
        assert.equal(corpo.itens.length, 10, `perfil ${n}`);
        const ids = corpo.itens.map((i) => i.filme.id);
        assert.equal(new Set(ids).size, 10, `perfil ${n}`);
        for (const id of ids) {
          assert.ok(!ocultos.has(id), `perfil ${n}: oculto ${id}`);
          assert.ok(!usados.has(id), `perfil ${n}: interagido ${id}`);
        }
        for (const i of corpo.itens) {
          assert.equal(i.fonte === 'S1' ? i.porque.length >= 1 : i.porque.length === 0, true, `perfil ${n}: porque do item ${i.filme.id}`);
        }
      }
    });
  });

  describe('GET /diagnostico/busca', () => {
    it('diagnostico 404 sem APP_DIAGNOSTICO', async () => {
      const p = await novoPerfil('diag');
      const r = await get(`/api/diagnostico/busca?perfilId=${p}`);
      assert.equal(r.status, 404);
      assert.equal(r.corpo.codigo, 'ROTA_NAO_ENCONTRADA');
    });

    it('diagnostico 200 com APP_DIAGNOSTICO=1: { hnsw, exata, sobreposicao }', async () => {
      await limpar();
      const p = await novoPerfil('diag');
      for (const f of comVetor.slice(0, 3)) await interagir(p, f, 'gostei');
      const r = await get(`/api/diagnostico/busca?perfilId=${p}`, appDiag);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.corpo).sort(), ['exata', 'hnsw', 'sobreposicao']);
      assert.ok(Array.isArray(r.corpo.hnsw) && r.corpo.hnsw.length > 0);
      assert.ok(Array.isArray(r.corpo.exata) && r.corpo.exata.length > 0);
      assert.ok(r.corpo.hnsw.every(Number.isInteger) && r.corpo.exata.every(Number.isInteger));
      const exata = new Set(r.corpo.exata);
      const comuns = r.corpo.hnsw.filter((id) => exata.has(id)).length;
      assert.equal(r.corpo.sobreposicao, comuns / r.corpo.exata.length);
      assert.ok(r.corpo.sobreposicao > 0 && r.corpo.sobreposicao <= 1);
    });

    it('com APP_DIAGNOSTICO=1: perfilId ausente 400, inexistente 404, perfil sem vetor devolve listas vazias', async () => {
      assert.equal((await get('/api/diagnostico/busca', appDiag)).status, 400);
      assert.equal((await get(`/api/diagnostico/busca?perfilId=${PERFIL_FANTASMA}`, appDiag)).status, 404);
      const p = await novoPerfil('vazio');
      const r = await get(`/api/diagnostico/busca?perfilId=${p}`, appDiag);
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo, { hnsw: [], exata: [], sobreposicao: null });
    });
  });

  describe('integridade', () => {
    it('hash adulterado durante operante → 503 BLOQUEADO', async () => {
      await limpar();
      await operante();
      const p = await novoPerfil('integridade');
      for (const f of comVetor.slice(0, 3)) await interagir(p, f, 'gostei');
      assert.equal((await recs(p)).status, 200);
      await su.query(`UPDATE v2_final.metadados SET valor = 'x' WHERE chave = 'hash_treino'`);
      try {
        const r = await recs(p);
        assert.equal(r.status, 503);
        assert.equal(r.corpo.codigo, 'BLOQUEADO');
        assert.equal((await saude()).estado, 'bloqueado');
        const depois = await recs(p);
        assert.equal(depois.status, 503);
        assert.equal(depois.corpo.codigo, 'BLOQUEADO');
      } finally {
        await su.query(`UPDATE v2_final.metadados SET valor = $1 WHERE chave = 'hash_treino'`, [HASHES.treino]);
      }
      await operante('volta a operante depois de restaurar o hash');
      assert.equal((await recs(p)).status, 200);
    });
  });
});
