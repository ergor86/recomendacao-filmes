// Tarefa 10: catálogo, detalhe, gêneros e onboarding contra o banco real (spec 6.2 e 6.3).
// Banco próprio `app_teste_filmes`, preparado com prepararTudo; servidor real (construirApp + criarCiclo).
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
import { GENEROS_REAIS } from '../../servidor/rotas/comum.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const semDados = !process.env.ML100K_DIR;
const PORTA = 3000;
const HOST = { host: `localhost:${PORTA}` };
const PERFIL_FANTASMA = '00000000-0000-4000-8000-000000000000';

describe('filmes, detalhe, gêneros e onboarding (banco app_teste_filmes)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, su, ciclo, app, dirEstado;
  const get = async (url) => {
    const r = await app.inject({ url, headers: HOST });
    return { status: r.statusCode, corpo: r.json() };
  };
  const novoPerfil = async (nome, exemplo = false) => {
    const { rows: [p] } = await su.query('INSERT INTO app.perfil (nome, exemplo) VALUES ($1, $2) RETURNING id', [nome, exemplo]);
    return p.id;
  };
  const interagir = (perfil, filme, tipo, nota = null) => su.query(
    'INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, $3, $4)', [perfil, filme, tipo, nota],
  );
  const limpar = () => su.query('TRUNCATE app.perfil CASCADE');

  before(async () => {
    cfg = await recriarBancoTeste('app_teste_filmes');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'filmes-'));
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
    app = construirApp({ ciclo, porta: PORTA });
    await app.ready();
    await ciclo.iniciar();
    assert.ok(ciclo.operante(), 'operante');
  });
  after(async () => {
    await app?.close();
    await ciclo?.parar();
    await su?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  describe('GET /filmes', () => {
    it('ocultos ausentes: total = 1682 - 20', async () => {
      const { status, corpo } = await get('/api/filmes');
      assert.equal(status, 200);
      assert.equal(corpo.total, 1682 - 20);
      assert.equal(corpo.pagina, 1);
      assert.equal(corpo.itens.length, 24);
      const { rows } = await su.query('SELECT id FROM app.filme WHERE NOT visivel');
      assert.equal(rows.length, 20);
      const ocultos = new Set(rows.map((r) => r.id));
      assert.ok(ocultos.has(267) && ocultos.has(1504));
      for (let p = 1; p <= 3; p += 1) {
        const r = await get(`/api/filmes?pagina=${p}`);
        assert.ok(r.corpo.itens.every((i) => !ocultos.has(i.id)));
      }
    });

    it('formato do cartão e padrão mais_avaliados (n_notas desc, id)', async () => {
      const { corpo } = await get('/api/filmes');
      const { rows } = await su.query(
        `SELECT f.id FROM app.filme f JOIN app.estatistica_historica e ON e.filme_id = f.id
         WHERE f.visivel ORDER BY e.n_notas DESC, f.id LIMIT 24`,
      );
      assert.deepEqual(corpo.itens.map((i) => i.id), rows.map((r) => r.id));
      const c = corpo.itens[0];
      assert.deepEqual(Object.keys(c).sort(), ['ano', 'estadoPerfil', 'generos', 'id', 'midia', 'temVetor', 'titulo', 'tituloOriginal'].sort());
      assert.deepEqual(c.midia, { cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null });
      assert.equal(c.estadoPerfil, null);
      assert.ok(!/\(\d{4}\)/.test(c.titulo), c.titulo);
    });

    it('q sem acento acha o título com acento', async () => {
      const { rows: [f] } = await su.query(
        `SELECT id, titulo_exibicao FROM app.filme WHERE visivel AND titulo_original ~ '[À-ÿ]' ORDER BY id LIMIT 1`,
      );
      assert.ok(f, 'há título com acento no catálogo');
      const semAcento = f.titulo_exibicao.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      assert.notEqual(semAcento, f.titulo_exibicao);
      const { corpo } = await get(`/api/filmes?q=${encodeURIComponent(semAcento)}`);
      assert.ok(corpo.itens.some((i) => i.id === f.id), `${semAcento} deveria achar o filme ${f.id}`);
      const comAcento = await get(`/api/filmes?q=${encodeURIComponent(f.titulo_exibicao.toUpperCase())}`);
      assert.ok(comAcento.corpo.itens.some((i) => i.id === f.id));
    });

    it('"shawshank" acha "Shawshank Redemption, The" (e "the shawshank" também)', async () => {
      for (const q of ['shawshank', 'Shawshank Redemption', 'the shawshank']) {
        const { corpo } = await get(`/api/filmes?q=${encodeURIComponent(q)}`);
        assert.equal(corpo.total, 1, q);
        assert.equal(corpo.itens[0].titulo, 'The Shawshank Redemption');
        assert.equal(corpo.itens[0].tituloOriginal, 'Shawshank Redemption, The (1994)');
      }
    });

    it('"(V)" não aparece no título de exibição', async () => {
      const { corpo } = await get('/api/filmes?q=great%20giving');
      assert.equal(corpo.total, 1);
      assert.ok(!/\(V\)/.test(corpo.itens[0].titulo), corpo.itens[0].titulo);
      assert.ok(!/\d{4}/.test(corpo.itens[0].titulo));
    });

    it('soInfluenciam devolve só temVetor', async () => {
      const todos = await get('/api/filmes');
      const so = await get('/api/filmes?soInfluenciam=true');
      assert.ok(so.corpo.total < todos.corpo.total);
      assert.ok(so.corpo.itens.every((i) => i.temVetor));
      const { rows: [{ n }] } = await su.query('SELECT COUNT(*)::int AS n FROM app.filme WHERE visivel AND tem_vetor');
      assert.equal(so.corpo.total, n);
      assert.ok(todos.corpo.itens.some((i) => !i.temVetor) || (await get('/api/filmes?pagina=70')).corpo.itens.some((i) => !i.temVetor));
    });

    it('genero filtra; ordem=titulo e ordem=ano ordenam; pagina 2 não repete a 1', async () => {
      const g = await get('/api/filmes?genero=Documentary');
      assert.ok(g.corpo.total > 0 && g.corpo.itens.every((i) => i.generos.includes('Documentary')));
      const t = await get('/api/filmes?ordem=titulo');
      const titulos = t.corpo.itens.map((i) => i.titulo);
      const { rows } = await su.query('SELECT titulo_exibicao FROM app.filme WHERE visivel ORDER BY titulo_exibicao, id LIMIT 24');
      assert.deepEqual(titulos, rows.map((r) => r.titulo_exibicao));
      const a = await get('/api/filmes?ordem=ano');
      const anos = a.corpo.itens.map((i) => i.ano);
      assert.deepEqual(anos, [...anos].sort((x, y) => y - x));
      const p1 = await get('/api/filmes');
      const p2 = await get('/api/filmes?pagina=2');
      assert.equal(p2.corpo.pagina, 2);
      assert.equal(new Set([...p1.corpo.itens, ...p2.corpo.itens].map((i) => i.id)).size, 48);
    });

    it('mais_bem_avaliados: média bayesiana (C=10, m global), sem expor o escore', async () => {
      const { corpo } = await get('/api/filmes?ordem=mais_bem_avaliados');
      const { rows: [{ m }] } = await su.query('SELECT SUM(soma_notas)::float8 / SUM(n_notas) AS m FROM app.estatistica_historica');
      const { rows } = await su.query(
        `SELECT f.id, (10 * $1::float8 + e.soma_notas) / (10 + e.n_notas) AS s
         FROM app.filme f JOIN app.estatistica_historica e ON e.filme_id = f.id WHERE f.visivel ORDER BY s DESC, f.id LIMIT 24`, [m],
      );
      assert.deepEqual(corpo.itens.map((i) => i.id), rows.map((r) => r.id));
      assert.ok(!JSON.stringify(corpo).match(/escore|bayes|score/i));
    });

    it('perfilId traz estadoPerfil; perfil inexistente dá 404', async () => {
      await limpar();
      const p = await novoPerfil('Ana');
      const { corpo: base } = await get('/api/filmes');
      await interagir(p, base.itens[0].id, 'nota', 3);
      await interagir(p, base.itens[1].id, 'gostei');
      const { corpo } = await get(`/api/filmes?perfilId=${p}`);
      assert.deepEqual(corpo.itens[0].estadoPerfil, { tipo: 'nota', nota: 3 });
      assert.deepEqual(corpo.itens[1].estadoPerfil, { tipo: 'gostei', nota: null });
      assert.equal(corpo.itens[2].estadoPerfil, null);
      const r = await get(`/api/filmes?perfilId=${PERFIL_FANTASMA}`);
      assert.equal(r.status, 404);
      assert.equal(r.corpo.codigo, 'PERFIL_NAO_ENCONTRADO');
      await limpar();
    });

    it('parâmetros inválidos dão 400 VALIDACAO', async () => {
      for (const url of ['/api/filmes?pagina=0', '/api/filmes?pagina=abc', '/api/filmes?pagina=-1', '/api/filmes?ordem=x',
        '/api/filmes?genero=Nada', '/api/filmes?perfilId=nao-e-uuid', '/api/filmes?soInfluenciam=talvez']) {
        const r = await get(url);
        assert.equal(r.status, 400, url);
        assert.equal(r.corpo.codigo, 'VALIDACAO', url);
      }
    });
  });

  describe('GET /generos', () => {
    it('os 18 gêneros traduzidos, na ordem, mais Desconhecido', async () => {
      const { status, corpo } = await get('/api/generos');
      assert.equal(status, 200);
      assert.equal(corpo.length, 19);
      assert.deepEqual(corpo[0], { id: 'Action', rotulo: 'Ação' });
      assert.deepEqual(corpo[3], { id: "Children's", rotulo: 'Infantil' });
      assert.deepEqual(corpo[9], { id: 'Film-Noir', rotulo: 'Noir' });
      assert.deepEqual(corpo[14], { id: 'Sci-Fi', rotulo: 'Ficção científica' });
      assert.deepEqual(corpo[17], { id: 'Western', rotulo: 'Faroeste' });
      assert.deepEqual(corpo[18], { id: 'unknown', rotulo: 'Desconhecido' });
      assert.deepEqual(corpo.slice(0, 18).map((g) => g.id), GENEROS_REAIS);
    });
  });

  describe('GET /filmes/:id', () => {
    it('filmes/267 e filmes/1504 (ocultos) e inexistentes → 404 FILME_NAO_ENCONTRADO', async () => {
      for (const id of [267, 1504, 9999]) {
        const r = await get(`/api/filmes/${id}`);
        assert.equal(r.status, 404, String(id));
        assert.equal(r.corpo.codigo, 'FILME_NAO_ENCONTRADO');
      }
      assert.equal((await get('/api/filmes/abc')).status, 400);
    });

    it('detalhe: computador com 4 notas → media null e poucasNotas; 5 notas → media', async () => {
      await limpar();
      const filme = 50;
      for (let i = 0; i < 4; i += 1) await interagir(await novoPerfil(`P${i}`), filme, 'nota', [5, 4, 3, 4][i]);
      let d = (await get(`/api/filmes/${filme}`)).corpo;
      assert.deepEqual(d.estatisticas.computador, { nNotas: 4, media: null, poucasNotas: true });
      await interagir(await novoPerfil('P4'), filme, 'nota', 4);
      d = (await get(`/api/filmes/${filme}`)).corpo;
      assert.deepEqual(d.estatisticas.computador, { nNotas: 5, media: 4, poucasNotas: false });
      await limpar();
    });

    it('detalhe: perfil exemplo não conta em computador; "gostei" também não', async () => {
      await limpar();
      const filme = 50;
      for (let i = 0; i < 4; i += 1) await interagir(await novoPerfil(`P${i}`), filme, 'nota', 4);
      await interagir(await novoPerfil('Exemplo', true), filme, 'nota', 5);
      await interagir(await novoPerfil('G'), filme, 'gostei');
      const d = (await get(`/api/filmes/${filme}`)).corpo;
      assert.deepEqual(d.estatisticas.computador, { nNotas: 4, media: null, poucasNotas: true });
      await limpar();
    });

    it('detalhe: MovieLens separado, com poucasNotas, e "sua" por perfilId', async () => {
      const { rows: [grande] } = await su.query('SELECT filme_id, n_notas, soma_notas, n_aprovacao FROM app.estatistica_historica WHERE n_notas >= 5 AND filme_id IN (SELECT id FROM app.filme WHERE visivel) ORDER BY n_notas DESC LIMIT 1');
      const { rows: [pequeno] } = await su.query('SELECT filme_id, n_notas FROM app.estatistica_historica WHERE n_notas < 5 AND filme_id IN (SELECT id FROM app.filme WHERE visivel) ORDER BY n_notas, filme_id LIMIT 1');
      const d = (await get(`/api/filmes/${grande.filme_id}`)).corpo;
      assert.equal(d.estatisticas.movielens.nNotas, grande.n_notas);
      assert.equal(d.estatisticas.movielens.media, Math.round((grande.soma_notas / grande.n_notas) * 100) / 100);
      assert.equal(d.estatisticas.movielens.pctAprovacao, Math.round((1000 * grande.n_aprovacao) / grande.n_notas) / 10);
      assert.equal(d.estatisticas.movielens.poucasNotas, false);
      assert.equal(d.estatisticas.sua, null);
      assert.equal(d.estadoPerfil, null);
      if (pequeno) {
        const p = (await get(`/api/filmes/${pequeno.filme_id}`)).corpo.estatisticas.movielens;
        assert.deepEqual([p.nNotas, p.media, p.pctAprovacao, p.poucasNotas], [pequeno.n_notas, null, null, true]);
      }
      await limpar();
      const perfil = await novoPerfil('Bia');
      await interagir(perfil, grande.filme_id, 'nota', 2);
      const c = (await get(`/api/filmes/${grande.filme_id}?perfilId=${perfil}`)).corpo;
      assert.deepEqual(c.estatisticas.sua, { tipo: 'nota', nota: 2 });
      assert.deepEqual(c.estadoPerfil, { tipo: 'nota', nota: 2 });
      assert.equal((await get(`/api/filmes/${grande.filme_id}?perfilId=${PERFIL_FANTASMA}`)).status, 404);
      await limpar();
    });

    it('detalhe: temGemeoOculto true para 246 e false para um filme sem gêmeo', async () => {
      const d = (await get('/api/filmes/246')).corpo;
      assert.equal(d.temGemeoOculto, true);
      assert.equal((await get('/api/filmes/1')).corpo.temGemeoOculto, false);
    });
  });

  describe('GET /perfis/:id/onboarding', () => {
    let perfil;
    before(async () => { await limpar(); perfil = await novoPerfil('Caio'); });
    after(limpar);
    const onb = (qs = '') => get(`/api/perfis/${perfil}/onboarding${qs}`);

    it('primeira página tem 2 por gênero real sem repetir, todos com vetor e visíveis', async () => {
      const { status, corpo } = await onb();
      assert.equal(status, 200);
      const ids = corpo.itens.map((i) => i.id);
      assert.equal(new Set(ids).size, ids.length, 'sem repetir');
      assert.equal(ids.length, 2 * GENEROS_REAIS.length);
      assert.ok(corpo.itens.every((i) => i.temVetor));
      const { rows } = await su.query('SELECT id FROM app.filme WHERE visivel AND tem_vetor');
      const validos = new Set(rows.map((r) => r.id));
      assert.ok(ids.every((id) => validos.has(id)));
      // cada gênero real tem pelo menos 2 itens (sem 'unknown' como critério)
      for (const g of GENEROS_REAIS) assert.ok(corpo.itens.filter((i) => i.generos.includes(g)).length >= 2, g);
      // ordenada por n_notas decrescente e id
      const { rows: ord } = await su.query(
        'SELECT filme_id FROM app.estatistica_historica WHERE filme_id = ANY($1) ORDER BY n_notas DESC, filme_id', [ids],
      );
      assert.deepEqual(ids, ord.map((r) => r.filme_id));
      assert.ok(corpo.proximoCursor);
    });

    it('onboarding: interagidos continuam com estadoPerfil', async () => {
      const antes = (await onb()).corpo.itens;
      await interagir(perfil, antes[0].id, 'gostei');
      await interagir(perfil, antes[1].id, 'nota', 5);
      try {
        const depois = (await onb()).corpo.itens;
        assert.deepEqual(depois.map((i) => i.id), antes.map((i) => i.id), 'a grade não muda');
        assert.deepEqual(depois[0].estadoPerfil, { tipo: 'gostei', nota: null });
        assert.deepEqual(depois[1].estadoPerfil, { tipo: 'nota', nota: 5 });
        assert.equal(depois[2].estadoPerfil, null);
      } finally {
        await su.query('DELETE FROM app.interacao WHERE perfil_id = $1', [perfil]);
      }
    });

    it('onboarding: cursor sem duplicar nem pular', async () => {
      const vistos = [];
      let cursor = null;
      let paginas = 0;
      do {
        const { status, corpo } = await onb(cursor ? `?cursor=${cursor}` : '');
        assert.equal(status, 200);
        vistos.push(...corpo.itens.map((i) => i.id));
        cursor = corpo.proximoCursor;
        paginas += 1;
        if (paginas > 1 && cursor) assert.equal(corpo.itens.length, 24);
        assert.ok(paginas < 100);
      } while (cursor);
      assert.equal(new Set(vistos).size, vistos.length, 'sem duplicar');
      const { rows } = await su.query('SELECT id FROM app.filme WHERE visivel AND tem_vetor');
      assert.deepEqual([...vistos].sort((a, b) => a - b), rows.map((r) => r.id).sort((a, b) => a - b), 'sem pular');
      // as páginas depois da curada seguem n_notas decrescente e id
      const { rows: ordem } = await su.query(
        `SELECT filme_id FROM app.estatistica_historica WHERE filme_id = ANY($1) ORDER BY n_notas DESC, filme_id`, [vistos.slice(36)],
      );
      assert.deepEqual(vistos.slice(36), ordem.map((r) => r.filme_id));
    });

    it('onboarding: q e genero filtram o mesmo conjunto, também com cursor', async () => {
      const q = await onb('?q=star%20wars');
      assert.ok(q.corpo.itens.length > 0);
      assert.ok(q.corpo.itens.every((i) => i.temVetor && /star wars/i.test(i.titulo + i.tituloOriginal)));
      const g = [];
      let cursor = null;
      do {
        const r = await onb(`?genero=Western${cursor ? `&cursor=${cursor}` : ''}`);
        g.push(...r.corpo.itens);
        cursor = r.corpo.proximoCursor;
      } while (cursor);
      const { rows: [{ n }] } = await su.query("SELECT COUNT(*)::int AS n FROM app.filme WHERE visivel AND tem_vetor AND 'Western' = ANY(generos)");
      assert.equal(g.length, n);
      assert.ok(g.every((i) => i.generos.includes('Western') && i.temVetor));
    });

    it('perfil inexistente → 404; cursor ou id malformado → 400', async () => {
      const r = await get(`/api/perfis/${PERFIL_FANTASMA}/onboarding`);
      assert.equal(r.status, 404);
      assert.equal(r.corpo.codigo, 'PERFIL_NAO_ENCONTRADO');
      assert.equal((await onb('?cursor=abc')).status, 400);
      assert.equal((await get('/api/perfis/xyz/onboarding')).status, 400);
    });
  });

  describe('fora do operante', () => {
    it('503 PREPARANDO fora do operante, em todas as rotas', async () => {
      const apertado = construirApp({
        porta: PORTA,
        ciclo: { operante: () => null, estado: () => ({ estado: 'preparando' }), registrarErro: () => 'outro' },
      });
      for (const url of ['/api/filmes', '/api/filmes/1', '/api/generos', `/api/perfis/${PERFIL_FANTASMA}/onboarding`]) {
        const r = await apertado.inject({ url, headers: HOST });
        assert.equal(r.statusCode, 503, url);
        assert.equal(r.json().codigo, 'PREPARANDO', url);
      }
      await apertado.close();
    });

    it('503 BLOQUEADO quando o ciclo está bloqueado', async () => {
      const bloqueado = construirApp({
        porta: PORTA,
        ciclo: { operante: () => null, estado: () => ({ estado: 'bloqueado' }), registrarErro: () => 'outro' },
      });
      const r = await bloqueado.inject({ url: '/api/filmes', headers: HOST });
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().codigo, 'BLOQUEADO');
      await bloqueado.close();
    });
  });
});
