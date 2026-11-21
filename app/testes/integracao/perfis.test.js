// Tarefa 11: perfis, perfil de exemplo e interações contra o banco real (spec 6.2).
// Banco próprio `app_teste_perfis`, preparado com prepararTudo; servidor real (construirApp + criarCiclo).
import '../apoio/dados-exigidos.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { HASHES } from '../../integridade.js';
import { prepararTudo } from '../../preparar/preparar.js';
import { construirApp } from '../../servidor/app.js';
import { criarCiclo } from '../../servidor/ciclo.js';
import { copiarArquivosML, recriarBancoTeste } from './apoio.js';

const semDados = !process.env.ML100K_DIR;
const PORTA = 3000;
const HOST = { host: `localhost:${PORTA}` };
const JSON_H = { ...HOST, 'content-type': 'application/json' };
const PERFIL_FANTASMA = '00000000-0000-4000-8000-000000000000';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const EXEMPLO = JSON.parse(readFileSync(path.join(AQUI, '..', '..', 'servidor', 'exemplo.json'), 'utf8'));
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

describe('perfis e interações (banco app_teste_perfis)', { timeout: 900_000, skip: semDados && 'ML100K_DIR nao definido' }, () => {
  let cfg, tmp, su, ciclo, app, dirEstado;
  let comVetor, semVetor; // ids visíveis, com e sem vetor

  // `comCabecalho` força Content-Type: application/json mesmo sem corpo (como um cliente que sempre o manda, §6.1)
  const pedir = async (metodo, url, corpo, { comCabecalho = false } = {}) => {
    const r = await app.inject({
      method: metodo, url, headers: corpo === undefined && !comCabecalho ? HOST : JSON_H, payload: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.statusCode, corpo: r.body ? r.json() : null };
  };
  const criar = async (nome) => (await pedir('POST', '/api/perfis', { nome })).corpo;
  const put = (perfil, filme, corpo) => pedir('PUT', `/api/perfis/${perfil}/interacoes/${filme}`, corpo);
  const saude = async () => (await app.inject({ url: '/api/saude', headers: HOST })).json();
  const operante = (msg) => esperar(async () => (await saude()).estado === 'operante', { msg: msg ?? 'operante' });
  const contagem = async () => Number((await su.query('SELECT count(*) AS n FROM app.perfil')).rows[0].n);

  before(async () => {
    cfg = await recriarBancoTeste('app_teste_perfis');
    tmp = mkdtempSync(path.join(os.tmpdir(), 'perfis-'));
    dirEstado = path.join(tmp, 'estado');
    copiarArquivosML(path.join(tmp, 'dados', 'ml-100k'));
    const r = await prepararTudo({
      pg: cfg, dirDados: path.join(tmp, 'dados'), dirTrabalho: path.join(tmp, 'trabalho'), dirEstado,
      versaoApp: '0.1.0', porta: PORTA, log: () => {},
    });
    assert.equal(r, 'pronto');
    su = new pg.Pool({ ...cfg, max: 4 });
    su.on('error', () => {});
    ciclo = criarCiclo({
      dirEstado, pg: { host: cfg.host, port: cfg.port, database: cfg.database },
      intervalos: { vigiaSegundos: 1, conteudoACada: 1 },
    });
    app = construirApp({ ciclo, porta: PORTA });
    await app.ready();
    await ciclo.iniciar();
    await operante('operante inicial');
    const { rows } = await su.query('SELECT id, tem_vetor FROM app.filme WHERE visivel ORDER BY id');
    comVetor = rows.filter((x) => x.tem_vetor).map((x) => x.id);
    semVetor = rows.filter((x) => !x.tem_vetor).map((x) => x.id);
    assert.ok(comVetor.length > 100 && semVetor.length > 0);
  });
  after(async () => {
    await app?.close();
    await ciclo?.parar();
    await su?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => su.query('TRUNCATE app.perfil CASCADE'));

  describe('POST /perfis', () => {
    it('cria o perfil (201) com btrim e formato do GET', async () => {
      const r = await pedir('POST', '/api/perfis', { nome: '  Ana  ' });
      assert.equal(r.status, 201);
      assert.equal(r.corpo.nome, 'Ana');
      assert.equal(r.corpo.exemplo, false);
      assert.equal(r.corpo.onboardingConcluido, false);
      assert.deepEqual(r.corpo.contagens, { notas: 0, gostei: 0, queroAssistir: 0, curtidos: 0, curtidosComVetor: 0 });
      assert.match(r.corpo.id, /^[0-9a-f-]{36}$/);
      const { rows } = await su.query('SELECT nome FROM app.perfil');
      assert.deepEqual(rows, [{ nome: 'Ana' }]);
    });

    it('nome só com espaços → 400; vazio e ausente → 400', async () => {
      for (const corpo of [{ nome: '     ' }, { nome: '' }, {}, { nome: 3 }, { nome: 'a', extra: 1 }]) {
        const r = await pedir('POST', '/api/perfis', corpo);
        assert.equal(r.status, 400, JSON.stringify(corpo));
        assert.equal(r.corpo.codigo, 'VALIDACAO');
      }
      assert.equal(await contagem(), 0);
    });

    it('41 caracteres → 400; 40 → 201 (o limite vale depois do btrim)', async () => {
      assert.equal((await pedir('POST', '/api/perfis', { nome: 'a'.repeat(41) })).status, 400);
      assert.equal((await pedir('POST', '/api/perfis', { nome: 'a'.repeat(40) })).status, 201);
      assert.equal((await pedir('POST', '/api/perfis', { nome: `  ${'b'.repeat(40)}  ` })).status, 201);
      assert.equal((await pedir('POST', '/api/perfis', { nome: ` ${'c'.repeat(41)} ` })).status, 400);
    });

    it('emoji dentro de 40 → 201 (conta caracteres, não unidades UTF-16); 41 emojis → 400', async () => {
      const quarenta = '😀'.repeat(40); // 80 unidades UTF-16
      const r = await pedir('POST', '/api/perfis', { nome: quarenta });
      assert.equal(r.status, 201);
      assert.equal(r.corpo.nome, quarenta);
      assert.equal((await pedir('POST', '/api/perfis', { nome: '😀'.repeat(41) })).status, 400);
    });

    it('21º perfil → 409 LIMITE_PERFIS', async () => {
      for (let i = 0; i < 20; i += 1) assert.equal((await pedir('POST', '/api/perfis', { nome: `p${i}` })).status, 201);
      const r = await pedir('POST', '/api/perfis', { nome: 'p20' });
      assert.equal(r.status, 409);
      assert.equal(r.corpo.codigo, 'LIMITE_PERFIS');
      assert.equal(await contagem(), 20);
    });

    it('5 POSTs concorrentes partindo de 18: 2 criados, 3 recusados, total 20', async () => {
      for (let i = 0; i < 18; i += 1) await su.query('INSERT INTO app.perfil (nome) VALUES ($1)', [`p${i}`]);
      const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => pedir('POST', '/api/perfis', { nome: `c${i}` })));
      assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 409, 409, 409]);
      assert.ok(rs.filter((r) => r.status === 409).every((r) => r.corpo.codigo === 'LIMITE_PERFIS'));
      assert.equal(await contagem(), 20);
    });

    it('exige Content-Type application/json (415)', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/perfis', headers: { ...HOST, 'content-type': 'text/plain' }, payload: '{"nome":"x"}' });
      assert.equal(r.statusCode, 415);
    });
  });

  describe('nomes únicos (decisão do usuário, 2026-11-21)', () => {
    const MSG = 'Já existe um perfil com esse nome.';
    const recusado = (r) => {
      assert.equal(r.status, 409);
      assert.equal(r.corpo.codigo, 'NOME_EM_USO');
      assert.equal(r.corpo.mensagem, MSG);
    };

    it('criar nome repetido → 409; sem diferenciar caixa nem espaços; acento conta', async () => {
      assert.equal((await pedir('POST', '/api/perfis', { nome: 'Ana' })).status, 201);
      recusado(await pedir('POST', '/api/perfis', { nome: 'Ana' }));
      recusado(await pedir('POST', '/api/perfis', { nome: 'ana' }));
      recusado(await pedir('POST', '/api/perfis', { nome: '  ANA  ' }));
      assert.equal((await pedir('POST', '/api/perfis', { nome: 'Anã' })).status, 201);
      assert.equal(await contagem(), 2);
    });

    it('renomear para o nome de outro → 409; para o próprio nome em outra caixa → 200', async () => {
      const a = await criar('Ana');
      const b = await criar('Beto');
      recusado(await pedir('PATCH', `/api/perfis/${b.id}`, { nome: 'ana' }));
      const r = await pedir('PATCH', `/api/perfis/${a.id}`, { nome: 'ANA' });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.nome, 'ANA');
      assert.equal((await pedir('PATCH', `/api/perfis/${a.id}`, { nome: 'ANA' })).status, 200);
      const { rows } = await su.query('SELECT nome FROM app.perfil WHERE id = $1', [b.id]);
      assert.equal(rows[0].nome, 'Beto');
    });

    it('"Perfil de exemplo" é reservado, com e sem o exemplo criado', async () => {
      recusado(await pedir('POST', '/api/perfis', { nome: 'Perfil de exemplo' }));
      recusado(await pedir('POST', '/api/perfis', { nome: 'perfil de EXEMPLO' }));
      const ex = await pedir('POST', '/api/perfis/exemplo');
      assert.equal(ex.status, 201);
      assert.equal(ex.corpo.exemplo, true);
      recusado(await pedir('POST', '/api/perfis', { nome: 'Perfil de exemplo' }));
      recusado(await pedir('POST', '/api/perfis', { nome: 'perfil de EXEMPLO' }));
      const c = await criar('Carla');
      recusado(await pedir('PATCH', `/api/perfis/${c.id}`, { nome: 'PERFIL DE EXEMPLO' }));
      const de = await pedir('POST', '/api/perfis/exemplo');
      assert.equal(de.status, 200);
      assert.equal(de.corpo.id, ex.corpo.id);
    });

    it('dois POSTs concorrentes com o mesmo nome: um 201 e um 409', async () => {
      const antes = await contagem();
      const rs = await Promise.all([pedir('POST', '/api/perfis', { nome: 'Duda' }), pedir('POST', '/api/perfis', { nome: 'duda' })]);
      assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
      recusado(rs.find((r) => r.status === 409));
      assert.equal(await contagem(), antes + 1);
    });

    it('duplicatas antigas: PATCH sem nome passa; renomear para o nome do outro → 409; nome novo → 200', async () => {
      const { rows } = await su.query(`INSERT INTO app.perfil (nome) VALUES ('Bia'), ('Bia') RETURNING id`);
      const [x] = rows;
      const r = await pedir('PATCH', `/api/perfis/${x.id}`, { onboardingConcluido: true });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.onboardingConcluido, true);
      recusado(await pedir('PATCH', `/api/perfis/${x.id}`, { nome: 'Bia' }));
      const ok = await pedir('PATCH', `/api/perfis/${x.id}`, { nome: 'Bia 2' });
      assert.equal(ok.status, 200);
      assert.equal(ok.corpo.nome, 'Bia 2');
    });

    it('o 409 NOME_EM_USO não derruba o estado do app', async () => {
      await criar('Eva');
      recusado(await pedir('POST', '/api/perfis', { nome: 'eva' }));
      assert.equal((await saude()).estado, 'operante');
    });
  });

  describe('GET, PATCH e DELETE /perfis', () => {
    it('GET lista por criação com o formato da spec', async () => {
      const a = await criar('Ana');
      const b = await criar('Beto');
      const r = await pedir('GET', '/api/perfis');
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo.map((p) => p.id), [a.id, b.id]);
      assert.deepEqual(Object.keys(r.corpo[0]).sort(), ['contagens', 'exemplo', 'id', 'nome', 'onboardingConcluido']);
    });

    it('contagens: notas, gostei, queroAssistir, curtidos e curtidosComVetor', async () => {
      const p = await criar('Contagens');
      const [v1, v2, v3, v4, v5] = comVetor;
      const [s1, s2] = semVetor;
      await put(p.id, v1, { tipo: 'gostei' });
      await put(p.id, v2, { tipo: 'nota', nota: 5 });
      await put(p.id, v3, { tipo: 'nota', nota: 3 });
      await put(p.id, v4, { tipo: 'quero_assistir' });
      await put(p.id, s1, { tipo: 'gostei' });
      await put(p.id, s2, { tipo: 'nota', nota: 4 });
      await put(p.id, v5, { tipo: 'nota', nota: 1 });
      const r = await pedir('GET', '/api/perfis');
      assert.deepEqual(r.corpo[0].contagens, { notas: 4, gostei: 2, queroAssistir: 1, curtidos: 4, curtidosComVetor: 2 });
    });

    it('PATCH renomeia (btrim) e marca onboardingConcluido', async () => {
      const p = await criar('Velho');
      const r = await pedir('PATCH', `/api/perfis/${p.id}`, { nome: ' Novo ', onboardingConcluido: true });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.nome, 'Novo');
      assert.equal(r.corpo.onboardingConcluido, true);
      const so = await pedir('PATCH', `/api/perfis/${p.id}`, { onboardingConcluido: false });
      assert.equal(so.corpo.nome, 'Novo');
      assert.equal(so.corpo.onboardingConcluido, false);
    });

    it('PATCH inválido → 400 (nome vazio, 41 caracteres, corpo vazio, campo extra)', async () => {
      const p = await criar('X');
      for (const corpo of [{ nome: '   ' }, { nome: 'a'.repeat(41) }, {}, { exemplo: true }, { onboardingConcluido: 'sim' }]) {
        assert.equal((await pedir('PATCH', `/api/perfis/${p.id}`, corpo)).status, 400, JSON.stringify(corpo));
      }
    });

    it('perfil inexistente → 404 PERFIL_NAO_ENCONTRADO (PATCH, DELETE, interações)', async () => {
      const casos = [
        ['PATCH', `/api/perfis/${PERFIL_FANTASMA}`, { nome: 'x' }],
        ['DELETE', `/api/perfis/${PERFIL_FANTASMA}`],
        ['PUT', `/api/perfis/${PERFIL_FANTASMA}/interacoes/${comVetor[0]}`, { tipo: 'gostei' }],
        ['DELETE', `/api/perfis/${PERFIL_FANTASMA}/interacoes/${comVetor[0]}`],
        ['GET', `/api/perfis/${PERFIL_FANTASMA}/interacoes`],
      ];
      for (const [m, u, c] of casos) {
        const r = await pedir(m, u, c);
        assert.equal(r.status, 404, `${m} ${u}`);
        assert.equal(r.corpo.codigo, 'PERFIL_NAO_ENCONTRADO');
      }
    });

    it('id que não é UUID → 400', async () => {
      assert.equal((await pedir('DELETE', '/api/perfis/abc')).status, 400);
    });

    it('DELETE perfil: 204 e cascata nas interações (os outros perfis ficam)', async () => {
      const a = await criar('Apagar');
      const b = await criar('Ficar');
      for (const p of [a, b]) {
        await put(p.id, comVetor[0], { tipo: 'gostei' });
        await put(p.id, comVetor[1], { tipo: 'nota', nota: 2 });
      }
      const r = await app.inject({ method: 'DELETE', url: `/api/perfis/${a.id}`, headers: HOST });
      assert.equal(r.statusCode, 204);
      assert.equal(r.body, '');
      const { rows } = await su.query('SELECT perfil_id, count(*)::int AS n FROM app.interacao GROUP BY 1');
      assert.deepEqual(rows, [{ perfil_id: b.id, n: 2 }]);
      assert.equal(await contagem(), 1);
    });
  });

  describe('escritas sem corpo, com e sem Content-Type: application/json (I-1)', () => {
    for (const comCabecalho of [false, true]) {
      const rot = comCabecalho ? 'com' : 'sem';
      it(`DELETE /perfis/:id ${rot} o cabeçalho → 204; DELETE de interação ${rot} o cabeçalho → 200`, async () => {
        const p = await criar(`SemCorpo-${rot}`);
        await put(p.id, comVetor[3], { tipo: 'gostei' });
        const di = await pedir('DELETE', `/api/perfis/${p.id}/interacoes/${comVetor[3]}`, undefined, { comCabecalho });
        assert.equal(di.status, 200, JSON.stringify(di.corpo));
        assert.equal(di.corpo.anterior.tipo, 'gostei');
        const dp = await pedir('DELETE', `/api/perfis/${p.id}`, undefined, { comCabecalho });
        assert.equal(dp.status, 204, JSON.stringify(dp.corpo));
        assert.equal((await pedir('DELETE', `/api/perfis/${p.id}`, undefined, { comCabecalho })).status, 404);
      });

      it(`POST /perfis/exemplo ${rot} o cabeçalho → 201 e depois 200`, async () => {
        await su.query('DELETE FROM app.perfil WHERE exemplo');
        const a = await pedir('POST', '/api/perfis/exemplo', undefined, { comCabecalho });
        assert.equal(a.status, 201, JSON.stringify(a.corpo));
        const b = await pedir('POST', '/api/perfis/exemplo', undefined, { comCabecalho });
        assert.equal(b.status, 200);
        await su.query('DELETE FROM app.perfil WHERE exemplo');
      });
    }

    it('corpo não vazio inválido continua 400 e outro tipo continua 415', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/perfis', headers: JSON_H, payload: '{nome' });
      assert.equal(r.statusCode, 400);
      const v = await app.inject({ method: 'POST', url: '/api/perfis', headers: JSON_H });
      assert.equal(v.statusCode, 400, 'POST /perfis sem corpo continua exigindo o corpo');
    });
  });

  describe('POST /perfis/exemplo', () => {
    it('exemplo.json: 6 ids distintos, todos com vetor e visíveis', async () => {
      assert.equal(EXEMPLO.length, 6);
      assert.equal(new Set(EXEMPLO).size, 6);
      const { rows } = await su.query('SELECT id FROM app.filme WHERE id = ANY($1) AND visivel AND tem_vetor', [EXEMPLO]);
      assert.equal(rows.length, 6);
    });

    it('idempotente: cria uma vez, devolve a mesma depois, com 6 gostei, todos com vetor e visíveis', async () => {
      const a = await pedir('POST', '/api/perfis/exemplo');
      assert.equal(a.status, 201);
      assert.equal(a.corpo.exemplo, true);
      assert.deepEqual(a.corpo.contagens, { notas: 0, gostei: 6, queroAssistir: 0, curtidos: 6, curtidosComVetor: 6 });
      const b = await pedir('POST', '/api/perfis/exemplo');
      assert.equal(b.status, 200);
      assert.equal(b.corpo.id, a.corpo.id);
      const c = await Promise.all([pedir('POST', '/api/perfis/exemplo'), pedir('POST', '/api/perfis/exemplo')]);
      assert.ok(c.every((x) => x.corpo.id === a.corpo.id));
      const { rows: perfis } = await su.query('SELECT id FROM app.perfil WHERE exemplo');
      assert.equal(perfis.length, 1);
      const { rows } = await su.query(
        `SELECT i.filme_id, i.tipo, f.tem_vetor, f.visivel FROM app.interacao i JOIN app.filme f ON f.id = i.filme_id
         WHERE i.perfil_id = $1 ORDER BY i.filme_id`, [a.corpo.id],
      );
      assert.equal(rows.length, 6);
      assert.deepEqual(rows.map((x) => x.filme_id), [...EXEMPLO].sort((x, y) => x - y));
      assert.ok(rows.every((x) => x.tipo === 'gostei' && x.tem_vetor && x.visivel));
    });

    it('o exemplo conta no limite de 20 perfis', async () => {
      for (let i = 0; i < 20; i += 1) await su.query('INSERT INTO app.perfil (nome) VALUES ($1)', [`p${i}`]);
      const r = await pedir('POST', '/api/perfis/exemplo');
      assert.equal(r.status, 409);
      assert.equal(r.corpo.codigo, 'LIMITE_PERFIS');
    });
  });

  describe('interações', () => {
    it('PUT gostei → nota 2 devolve anterior gostei e perfilMudou true', async () => {
      const p = await criar('Interage');
      const f = comVetor[0];
      const um = await put(p.id, f, { tipo: 'gostei' });
      assert.equal(um.status, 200);
      assert.equal(um.corpo.anterior, null);
      assert.deepEqual(um.corpo.efeitos, { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true });
      assert.deepEqual(um.corpo.filme, { temVetor: true });
      assert.equal(um.corpo.interacao.filmeId, f);
      assert.equal(um.corpo.interacao.tipo, 'gostei');
      assert.equal(um.corpo.interacao.nota, null);
      const dois = await put(p.id, f, { tipo: 'nota', nota: 2 });
      assert.equal(dois.status, 200);
      assert.deepEqual(dois.corpo.anterior, { tipo: 'gostei', nota: null });
      assert.deepEqual(dois.corpo.efeitos, { contribuiParaPerfil: false, excluidoDasRecomendacoes: true, perfilMudou: true });
      assert.deepEqual({ tipo: dois.corpo.interacao.tipo, nota: dois.corpo.interacao.nota }, { tipo: 'nota', nota: 2 });
      const { rows } = await su.query('SELECT tipo, nota FROM app.interacao WHERE perfil_id = $1', [p.id]);
      assert.deepEqual(rows, [{ tipo: 'nota', nota: 2 }]);
    });

    it('PUT: a última ação vence e atualizado_em avança', async () => {
      const p = await criar('Upsert');
      const f = comVetor[1];
      await put(p.id, f, { tipo: 'quero_assistir' });
      const { rows: [a] } = await su.query('SELECT atualizado_em FROM app.interacao WHERE perfil_id = $1', [p.id]);
      await dormir(20);
      const r = await put(p.id, f, { tipo: 'nota', nota: 4 });
      assert.deepEqual(r.corpo.anterior, { tipo: 'quero_assistir', nota: null });
      assert.deepEqual(r.corpo.efeitos, { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true });
      const { rows } = await su.query('SELECT tipo, nota, atualizado_em FROM app.interacao WHERE perfil_id = $1', [p.id]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].atualizado_em > a.atualizado_em);
    });

    it('PUT repetido não muda o perfil; nota 1–3 não contribui; filme sem vetor não contribui', async () => {
      const p = await criar('Efeitos');
      await put(p.id, comVetor[0], { tipo: 'nota', nota: 5 });
      const rep = await put(p.id, comVetor[0], { tipo: 'nota', nota: 4 });
      assert.deepEqual(rep.corpo.efeitos, { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: false });
      const baixa = await put(p.id, comVetor[1], { tipo: 'nota', nota: 3 });
      assert.deepEqual(baixa.corpo.efeitos, { contribuiParaPerfil: false, excluidoDasRecomendacoes: true, perfilMudou: false });
      const raro = await put(p.id, semVetor[0], { tipo: 'gostei' });
      assert.deepEqual(raro.corpo.filme, { temVetor: false });
      assert.deepEqual(raro.corpo.efeitos, { contribuiParaPerfil: false, excluidoDasRecomendacoes: true, perfilMudou: false });
    });

    it('PUT com corpo inválido → 400 (nota fora de 1..5, nota sem tipo nota, tipo desconhecido, campo extra)', async () => {
      const p = await criar('Valida');
      const f = comVetor[0];
      for (const corpo of [
        { tipo: 'nota' }, { tipo: 'nota', nota: 0 }, { tipo: 'nota', nota: 6 }, { tipo: 'nota', nota: 2.5 },
        { tipo: 'gostei', nota: 3 }, { tipo: 'quero_assistir', nota: 1 }, { tipo: 'odiei' }, {}, { tipo: 'gostei', x: 1 },
      ]) {
        const r = await put(p.id, f, corpo);
        assert.equal(r.status, 400, JSON.stringify(corpo));
        assert.equal(r.corpo.codigo, 'VALIDACAO');
      }
      assert.equal((await su.query('SELECT 1 FROM app.interacao')).rowCount, 0);
    });

    it('PUT em 267 (filme oculto) → 404 FILME_NAO_ENCONTRADO e nada gravado; inexistente também', async () => {
      const p = await criar('Oculto');
      const r = await put(p.id, 267, { tipo: 'gostei' });
      assert.equal(r.status, 404);
      assert.equal(r.corpo.codigo, 'FILME_NAO_ENCONTRADO');
      assert.equal((await put(p.id, 5000, { tipo: 'gostei' })).status, 404);
      assert.equal((await pedir('DELETE', `/api/perfis/${p.id}/interacoes/267`)).status, 404);
      assert.equal((await su.query('SELECT 1 FROM app.interacao')).rowCount, 0);
    });

    it('filmeId que não é inteiro → 400', async () => {
      const p = await criar('Id');
      assert.equal((await put(p.id, 'abc', { tipo: 'gostei' })).status, 400);
    });

    it('DELETE devolve anterior e excluidoDasRecomendacoes false', async () => {
      const p = await criar('Remove');
      const f = comVetor[2];
      await put(p.id, f, { tipo: 'nota', nota: 5 });
      const r = await pedir('DELETE', `/api/perfis/${p.id}/interacoes/${f}`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo, {
        anterior: { tipo: 'nota', nota: 5 },
        efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: true },
      });
      assert.equal((await su.query('SELECT 1 FROM app.interacao')).rowCount, 0);
    });

    it('DELETE de nota 2 ou de interação inexistente: perfilMudou false e anterior coerente', async () => {
      const p = await criar('Remove2');
      await put(p.id, comVetor[3], { tipo: 'nota', nota: 2 });
      const a = await pedir('DELETE', `/api/perfis/${p.id}/interacoes/${comVetor[3]}`);
      assert.deepEqual(a.corpo, {
        anterior: { tipo: 'nota', nota: 2 },
        efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: false },
      });
      const b = await pedir('DELETE', `/api/perfis/${p.id}/interacoes/${comVetor[3]}`);
      assert.equal(b.status, 200);
      assert.deepEqual(b.corpo, {
        anterior: null,
        efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: false },
      });
    });

    it('DELETE de gostei em filme sem vetor: perfilMudou false', async () => {
      const p = await criar('SemVetor');
      await put(p.id, semVetor[0], { tipo: 'gostei' });
      const r = await pedir('DELETE', `/api/perfis/${p.id}/interacoes/${semVetor[0]}`);
      assert.equal(r.corpo.efeitos.perfilMudou, false);
      assert.deepEqual(r.corpo.anterior, { tipo: 'gostei', nota: null });
    });

    it('GET interações: tipos=nota,gostei filtra; sem filtro traz tudo; do mais recente ao mais antigo', async () => {
      const p = await criar('Lista');
      const [a, b, c, d] = comVetor;
      await put(p.id, a, { tipo: 'nota', nota: 3 });
      await dormir(15);
      await put(p.id, b, { tipo: 'gostei' });
      await dormir(15);
      await put(p.id, c, { tipo: 'quero_assistir' });
      await dormir(15);
      await put(p.id, d, { tipo: 'nota', nota: 5 });
      const todas = await pedir('GET', `/api/perfis/${p.id}/interacoes`);
      assert.equal(todas.status, 200);
      assert.deepEqual(todas.corpo.itens.map((i) => i.filme.id), [d, c, b, a]);
      const filtrada = await pedir('GET', `/api/perfis/${p.id}/interacoes?tipos=nota,gostei`);
      assert.deepEqual(filtrada.corpo.itens.map((i) => i.filme.id), [d, b, a]);
      assert.ok(filtrada.corpo.itens.every((i) => ['nota', 'gostei'].includes(i.filme.estadoPerfil.tipo)));
      const so = await pedir('GET', `/api/perfis/${p.id}/interacoes?tipos=quero_assistir`);
      assert.deepEqual(so.corpo.itens.map((i) => i.filme.id), [c]);
      const item = filtrada.corpo.itens[0];
      assert.ok(item.atualizadoEm && !Number.isNaN(Date.parse(item.atualizadoEm)));
      assert.deepEqual(item.filme.estadoPerfil, { tipo: 'nota', nota: 5 });
      for (const k of ['id', 'titulo', 'tituloOriginal', 'ano', 'generos', 'temVetor', 'midia', 'estadoPerfil']) assert.ok(k in item.filme, k);
      assert.equal(filtrada.corpo.pagina, 1);
      assert.equal(filtrada.corpo.total, 3);
    });

    it('GET interações: tipos inválido → 400; paginação de 24', async () => {
      const p = await criar('Pagina');
      assert.equal((await pedir('GET', `/api/perfis/${p.id}/interacoes?tipos=nota,odio`)).status, 400);
      assert.equal((await pedir('GET', `/api/perfis/${p.id}/interacoes?tipos=`)).status, 400);
      assert.equal((await pedir('GET', `/api/perfis/${p.id}/interacoes?pagina=0`)).status, 400);
      for (const f of comVetor.slice(0, 30)) {
        await su.query("INSERT INTO app.interacao (perfil_id, filme_id, tipo) VALUES ($1, $2, 'gostei')", [p.id, f]);
      }
      const p1 = await pedir('GET', `/api/perfis/${p.id}/interacoes`);
      const p2 = await pedir('GET', `/api/perfis/${p.id}/interacoes?pagina=2`);
      assert.equal(p1.corpo.itens.length, 24);
      assert.equal(p2.corpo.itens.length, 6);
      assert.equal(p2.corpo.pagina, 2);
      assert.equal(p1.corpo.total, 30);
      assert.equal(new Set([...p1.corpo.itens, ...p2.corpo.itens].map((i) => i.filme.id)).size, 30);
    });
  });

  describe('fora do estado operante', () => {
    it('modo bloqueado: GET /perfis 200, DELETE /perfis/:id apaga as interações, o resto 503 BLOQUEADO', async () => {
      const a = await criar('Bloqueado');
      const b = await criar('Outro');
      await put(a.id, comVetor[0], { tipo: 'gostei' });
      await put(b.id, comVetor[0], { tipo: 'gostei' });
      await su.query(`UPDATE v2_final.metadados SET valor = 'x' WHERE chave = 'hash_treino'`);
      try {
        await esperar(async () => ciclo.estado().estado === 'bloqueado', { msg: 'bloqueio pela vigia' });
        const lista = await pedir('GET', '/api/perfis');
        assert.equal(lista.status, 200);
        assert.deepEqual(lista.corpo.map((p) => p.id).sort(), [a.id, b.id].sort());
        assert.equal(lista.corpo.find((p) => p.id === a.id).contagens.gostei, 1);
        for (const [m, u, c] of [
          ['POST', '/api/perfis', { nome: 'x' }],
          ['POST', '/api/perfis/exemplo'],
          ['PATCH', `/api/perfis/${a.id}`, { nome: 'y' }],
          ['PUT', `/api/perfis/${a.id}/interacoes/${comVetor[1]}`, { tipo: 'gostei' }],
          ['DELETE', `/api/perfis/${a.id}/interacoes/${comVetor[0]}`],
          ['GET', `/api/perfis/${a.id}/interacoes`],
        ]) {
          const r = await pedir(m, u, c);
          assert.equal(r.status, 503, `${m} ${u}`);
          assert.equal(r.corpo.codigo, 'BLOQUEADO', `${m} ${u}`);
        }
        const apagou = await app.inject({ method: 'DELETE', url: `/api/perfis/${a.id}`, headers: HOST });
        assert.equal(apagou.statusCode, 204);
        const { rows } = await su.query('SELECT perfil_id FROM app.interacao');
        assert.deepEqual(rows, [{ perfil_id: b.id }], 'as interações do perfil apagado sumiram');
        assert.equal((await pedir('DELETE', `/api/perfis/${PERFIL_FANTASMA}`)).status, 404);
        const b2 = await pedir('DELETE', `/api/perfis/${b.id}`, undefined, { comCabecalho: true });
        assert.equal(b2.status, 204, 'bloqueado, com Content-Type e sem corpo: a exclusão (LGPD) funciona');
      } finally {
        await su.query(`UPDATE v2_final.metadados SET valor = $1 WHERE chave = 'hash_treino'`, [HASHES.treino]);
      }
      await operante('volta a operante depois de restaurar o hash');
    });

    it('credenciais adulteradas: /saude.perfis = { disponivel: false, motivo: credenciais }', async () => {
      await operante();
      // adultera só o credenciais.json do dirEstado temporário (nada do cluster: sem ALTER ROLE nem terminate)
      const arquivo = path.join(dirEstado, 'credenciais.json');
      const original = readFileSync(arquivo, 'utf8');
      writeFileSync(arquivo, '{"app_leitura": 1}\n');
      try {
        const s = await esperar(async () => {
          const x = await saude();
          return x.perfis.disponivel === false && x.perfis.motivo === 'credenciais' ? x : null;
        }, { ms: 15_000, passo: 500, msg: 'perfis indisponíveis por credenciais' });
        assert.deepEqual(s.perfis, { disponivel: false, motivo: 'credenciais' });
      } finally {
        writeFileSync(arquivo, original);
      }
      await esperar(async () => (await saude()).perfis.disponivel === true, { ms: 15_000, passo: 500, msg: 'perfis de volta' });
      await operante();
    });
  });
});
