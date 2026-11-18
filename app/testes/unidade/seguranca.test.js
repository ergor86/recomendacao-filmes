// Tarefa 9: segurança do servidor (spec 6.1, 7 CSP, 9) com app.inject e um ciclo falso.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { construirApp } from '../../servidor/app.js';

function cicloFalso(saude = { estado: 'operante', perfis: { disponivel: true } }) {
  return {
    estado: () => ({ estado: saude.estado }),
    saude: async () => saude,
    operante: () => null,
    poolEscrita: () => null,
    registrarErro: () => 'outro',
  };
}

// a CSP da spec §7, diretiva por diretiva e na ordem
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
];

async function montar({ porta = 3317, ciclo = cicloFalso() } = {}) {
  const app = construirApp({ ciclo, porta });
  // rota de escrita só deste teste: as rotas reais de escrita nascem nas Tarefas 11 e 12
  app.post('/api/teste-eco', async (req) => ({ recebido: req.body ?? null }));
  await app.ready();
  return app;
}

describe('segurança (spec 6.1)', () => {
  const apps = [];
  after(async () => { for (const a of apps) await a.close(); });
  const novo = async (o) => { const a = await montar(o); apps.push(a); return a; };

  it('Host evil.test → 421 HOST_INVALIDO', async () => {
    const app = await novo();
    const r = await app.inject({ url: '/api/saude', headers: { host: 'evil.test' } });
    assert.equal(r.statusCode, 421);
    assert.deepEqual(Object.keys(r.json()).sort(), ['codigo', 'mensagem']);
    assert.equal(r.json().codigo, 'HOST_INVALIDO');
  });

  it('Host com a porta publicada → 200; com outra porta → 421; [::1] aceito', async () => {
    const app = await novo({ porta: 3317 });
    for (const host of ['localhost:3317', '127.0.0.1:3317', '[::1]:3317']) {
      const r = await app.inject({ url: '/api/saude', headers: { host } });
      assert.equal(r.statusCode, 200, host);
    }
    for (const host of ['localhost:3000', 'localhost', '127.0.0.1', 'localhost:33170', 'evil.test:3317', 'localhost.evil.test:3317']) {
      const r = await app.inject({ url: '/api/saude', headers: { host } });
      assert.equal(r.statusCode, 421, host);
      assert.equal(r.json().codigo, 'HOST_INVALIDO');
    }
  });

  it('Host sem porta só é aceito com porta = 80', async () => {
    const app80 = await novo({ porta: 80 });
    assert.equal((await app80.inject({ url: '/api/saude', headers: { host: 'localhost' } })).statusCode, 200);
    assert.equal((await app80.inject({ url: '/api/saude', headers: { host: 'localhost:80' } })).statusCode, 200);
    const app3000 = await novo({ porta: 3000 });
    assert.equal((await app3000.inject({ url: '/api/saude', headers: { host: 'localhost' } })).statusCode, 421);
    assert.equal((await app3000.inject({ url: '/api/saude', headers: { host: 'localhost:3000' } })).statusCode, 200);
  });

  it('Host inválido também vale fora de /api', async () => {
    const app = await novo();
    const r = await app.inject({ url: '/', headers: { host: 'evil.test' } });
    assert.equal(r.statusCode, 421);
  });

  it('POST com Origin http://evil.test → 403 ORIGEM_INVALIDA; Origin do próprio host passa', async () => {
    const app = await novo();
    const base = { method: 'POST', url: '/api/teste-eco', payload: { a: 1 } };
    const ruim = await app.inject({ ...base, headers: { host: 'localhost:3317', origin: 'http://evil.test' } });
    assert.equal(ruim.statusCode, 403);
    assert.equal(ruim.json().codigo, 'ORIGEM_INVALIDA');
    const outraPorta = await app.inject({ ...base, headers: { host: 'localhost:3317', origin: 'http://localhost:3000' } });
    assert.equal(outraPorta.statusCode, 403);
    const nulo = await app.inject({ ...base, headers: { host: 'localhost:3317', origin: 'null' } });
    assert.equal(nulo.statusCode, 403);
    const bom = await app.inject({ ...base, headers: { host: 'localhost:3317', origin: 'http://localhost:3317' } });
    assert.equal(bom.statusCode, 200);
    assert.deepEqual(bom.json(), { recebido: { a: 1 } });
  });

  it('Sec-Fetch-Site cross-site → 403 ORIGEM_INVALIDA', async () => {
    const app = await novo();
    const r = await app.inject({
      method: 'POST', url: '/api/teste-eco', payload: { a: 1 },
      headers: { host: 'localhost:3317', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().codigo, 'ORIGEM_INVALIDA');
  });

  it('POST text/plain → 415 TIPO_NAO_SUPORTADO', async () => {
    const app = await novo();
    const r = await app.inject({
      method: 'POST', url: '/api/teste-eco', payload: '{"a":1}',
      headers: { host: 'localhost:3317', 'content-type': 'text/plain' },
    });
    assert.equal(r.statusCode, 415);
    assert.equal(r.json().codigo, 'TIPO_NAO_SUPORTADO');
  });

  it('corpo de 5 KB → 413 CORPO_GRANDE', async () => {
    const app = await novo();
    const r = await app.inject({
      method: 'POST', url: '/api/teste-eco', payload: JSON.stringify({ x: 'a'.repeat(5 * 1024) }),
      headers: { host: 'localhost:3317', 'content-type': 'application/json' },
    });
    assert.equal(r.statusCode, 413);
    assert.equal(r.json().codigo, 'CORPO_GRANDE');
  });

  it('JSON malformado → 400 VALIDACAO', async () => {
    const app = await novo();
    const r = await app.inject({
      method: 'POST', url: '/api/teste-eco', payload: '{"a":',
      headers: { host: 'localhost:3317', 'content-type': 'application/json' },
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().codigo, 'VALIDACAO');
  });

  it('cabeçalho CSP exato e sem Strict-Transport-Security', async () => {
    const app = await novo();
    const r = await app.inject({ url: '/api/saude', headers: { host: 'localhost:3317' } });
    const csp = r.headers['content-security-policy'];
    assert.ok(csp, 'sem CSP');
    assert.deepEqual(csp.split(';').map((d) => d.trim()).filter(Boolean), CSP);
    assert.ok(!/upgrade-insecure-requests/.test(csp));
    assert.equal(r.headers['strict-transport-security'], undefined);
    // a CSP vale também nos erros
    const e = await app.inject({ url: '/api/nada', headers: { host: 'localhost:3317' } });
    assert.deepEqual(e.headers['content-security-policy'].split(';').map((d) => d.trim()).filter(Boolean), CSP);
  });

  it('/api desconhecida → 404 ROTA_NAO_ENCONTRADA', async () => {
    const app = await novo();
    const r = await app.inject({ url: '/api/nao-existe', headers: { host: 'localhost:3317' } });
    assert.equal(r.statusCode, 404);
    assert.deepEqual(r.json(), { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: r.json().mensagem });
    assert.equal(typeof r.json().mensagem, 'string');
  });

  it('saude nunca repassa campos desconhecidos', async () => {
    const app = await novo({
      ciclo: cicloFalso({
        estado: 'falhou', etapa: 3, total: 8, mensagem: 'm', causa: 'c', comando: 'docker compose run --rm preparar',
        senha: 'x', password: 'segredo-1', app_leitura: 'segredo-2',
        perfis: { disponivel: false, motivo: 'credenciais', senha: 'segredo-3' },
      }),
    });
    const r = await app.inject({ url: '/api/saude', headers: { host: 'localhost:3317' } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), {
      estado: 'falhou', etapa: 3, total: 8, mensagem: 'm', causa: 'c', comando: 'docker compose run --rm preparar',
      perfis: { disponivel: false, motivo: 'credenciais' },
    });
    assert.ok(!/senha|segredo|password|app_leitura/.test(r.body));
    assert.match(r.headers['cache-control'] ?? '', /no-store/);
  });

  it('saude descarta valores de tipo errado e estados desconhecidos', async () => {
    const app = await novo({
      ciclo: cicloFalso({
        estado: 'hackeado', etapa: '3', mensagem: { senha: 'x' }, causa: 42,
        perfis: { disponivel: 'sim', motivo: 'qualquer' },
      }),
    });
    const r = await app.inject({ url: '/api/saude', headers: { host: 'localhost:3317' } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { estado: 'preparando', perfis: { disponivel: false } });
  });

  it('saude responde 200 mesmo se o ciclo lançar', async () => {
    const ciclo = { ...cicloFalso(), saude: async () => { throw new Error('senha=xyz'); } };
    const app = await novo({ ciclo });
    const r = await app.inject({ url: '/api/saude', headers: { host: 'localhost:3317' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().estado, 'preparando');
    assert.ok(!r.body.includes('xyz'));
  });

  it('sobre: versão, hashes, commit, resultado do Plano 3, licença, citação e avisos', async () => {
    const app = await novo();
    const r = await app.inject({ url: '/api/sobre', headers: { host: 'localhost:3317' } });
    assert.equal(r.statusCode, 200);
    const s = r.json();
    const { HASHES, COMMIT_CODIGO, RESULTADO_PLANO3 } = await import('../../integridade.js');
    assert.match(s.versao, /^\d+\.\d+\.\d+/);
    assert.equal(s.commitCodigo, COMMIT_CODIGO);
    assert.deepEqual(s.hashes, { regua: HASHES.regua, treino: HASHES.treino, vetoresFC: HASHES.vetoresFC });
    assert.deepEqual(s.resultado, { ...RESULTADO_PLANO3, ic95: [...RESULTADO_PLANO3.ic95] });
    assert.match(s.citacao, /Harper/);
    assert.match(s.citacao, /Konstan/);
    assert.match(s.citacao, /2015/);
    assert.ok(Array.isArray(s.licencas) && s.licencas.length > 0);
    assert.ok(s.licencas.some((l) => /MovieLens/.test(l.texto)));
    assert.deepEqual(s.resumo, [
      'Compara seus gostos com os de 943 pessoas que avaliaram filmes em 1997–98.',
      'A técnica foi avaliada com essas pessoas, não com você.',
      'Com poucas curtidas, a lista se apoia em poucos filmes.',
    ]);
    assert.ok(s.avisos.some((a) => /1998/.test(a)));
    // população certa: 445 avaliados entre os usuários 1 a 462; as 943 pessoas são a base dos vetores
    assert.match(r.body, /445/);
    assert.match(r.body, /462/);
    assert.doesNotMatch(r.body, /avaliad[ao]s? (com|n?as) (as )?943/i);
    assert.ok(r.body.includes('A qualidade medida no teste-2 (usuários históricos com ≥ 20 notas, avaliação retrospectiva) não se transfere para perfis novos.'));
    assert.ok(r.body.includes('não entra no cálculo dos seus gostos'));
    assert.doesNotMatch(r.body, /não muda as suas recomendações/);
    assert.match(r.body, /retrospectiva/);
  });
});
