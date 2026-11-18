// Tarefa 11: rotas de perfis fora do operante, sem banco (pools simulados). Spec 4.3 e 6.2.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { construirApp } from '../../servidor/app.js';

const HOST = { host: 'localhost:3000' };
const JSON_H = { ...HOST, 'content-type': 'application/json' };
const ID = '11111111-1111-4111-8111-111111111111';

function appCom({ estado, pool, tipoErro = 'outro' }) {
  const ciclo = {
    operante: () => null,
    estado: () => ({ estado }),
    poolEscrita: () => pool,
    registrarErro: () => tipoErro,
  };
  return construirApp({ ciclo, porta: 3000 });
}

describe('perfis fora do operante (sem banco)', () => {
  it('sem pool de escrita: 503 BANCO_INDISPONIVEL em GET e DELETE de perfis', async () => {
    const app = appCom({ estado: 'preparando', pool: null });
    for (const [metodo, url] of [['GET', '/api/perfis'], ['DELETE', `/api/perfis/${ID}`]]) {
      const r = await app.inject({ method: metodo, url, headers: HOST });
      assert.equal(r.statusCode, 503, `${metodo} ${url}`);
      assert.equal(r.json().codigo, 'BANCO_INDISPONIVEL');
    }
    await app.close();
  });

  it('com pool de escrita e sem operante: GET /perfis usa o pool de escrita', async () => {
    const consultas = [];
    const pool = { query: async (sql) => { consultas.push(sql); return { rows: [], rowCount: 0 }; } };
    for (const estado of ['preparando', 'falhou', 'bloqueado']) {
      const app = appCom({ estado, pool });
      const r = await app.inject({ url: '/api/perfis', headers: HOST });
      assert.equal(r.statusCode, 200, estado);
      assert.deepEqual(r.json(), []);
      await app.close();
    }
    assert.ok(consultas.length >= 3);
  });

  it('as demais rotas respondem 503 (PREPARANDO ou BLOQUEADO), mesmo com pool de escrita', async () => {
    const pool = { query: async () => { throw new Error('não deveria consultar'); } };
    const casos = [
      ['POST', '/api/perfis', { nome: 'x' }],
      ['POST', '/api/perfis/exemplo'],
      ['PATCH', `/api/perfis/${ID}`, { nome: 'x' }],
      ['PUT', `/api/perfis/${ID}/interacoes/1`, { tipo: 'gostei' }],
      ['DELETE', `/api/perfis/${ID}/interacoes/1`],
      ['GET', `/api/perfis/${ID}/interacoes`],
    ];
    for (const [estado, codigo] of [['preparando', 'PREPARANDO'], ['falhou', 'PREPARANDO'], ['bloqueado', 'BLOQUEADO']]) {
      const app = appCom({ estado, pool });
      for (const [metodo, url, corpo] of casos) {
        const r = await app.inject({
          method: metodo, url, headers: corpo ? JSON_H : HOST, payload: corpo ? JSON.stringify(corpo) : undefined,
        });
        assert.equal(r.statusCode, 503, `${estado} ${metodo} ${url}`);
        assert.equal(r.json().codigo, codigo, `${estado} ${metodo} ${url}`);
      }
      await app.close();
    }
  });

  it('erro de banco fora do operante responde o código do estado, coerente com /saude (M-1)', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } };
    const casos = [
      ['preparando', 'integridade', 'PREPARANDO'], ['falhou', 'integridade', 'PREPARANDO'], ['falhou', 'credenciais', 'PREPARANDO'],
      ['bloqueado', 'integridade', 'BLOQUEADO'], ['bloqueado', 'credenciais', 'BLOQUEADO'],
      ['preparando', 'disponibilidade', 'BANCO_INDISPONIVEL'], ['bloqueado', 'disponibilidade', 'BANCO_INDISPONIVEL'],
    ];
    for (const [estado, tipoErro, codigo] of casos) {
      const app = appCom({ estado, pool, tipoErro });
      for (const [metodo, url] of [['GET', '/api/perfis'], ['DELETE', `/api/perfis/${ID}`]]) {
        const r = await app.inject({ method: metodo, url, headers: HOST });
        assert.equal(r.statusCode, 503, `${estado}/${tipoErro} ${metodo}`);
        assert.equal(r.json().codigo, codigo, `${estado}/${tipoErro} ${metodo}`);
      }
      await app.close();
    }
  });

  it('operante: erro de integridade continua BLOQUEADO', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } };
    const ciclo = {
      operante: () => ({ pools: {} }), estado: () => ({ estado: 'operante' }), poolEscrita: () => pool, registrarErro: () => 'integridade',
    };
    const app = construirApp({ ciclo, porta: 3000 });
    const r = await app.inject({ url: '/api/perfis', headers: HOST });
    assert.equal(r.json().codigo, 'BLOQUEADO');
    await app.close();
  });
});
