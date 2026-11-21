import { describe, test, expect, vi } from 'vitest';
import { chamar, ErroApi } from './api.js';
import { simularFetch, erroApi, cabecalho } from './apoio-testes.js';

describe('api.chamar', () => {
  test('com corpo: Content-Type application/json, corpo JSON e cache no-store', async () => {
    const { chamadas } = simularFetch([['POST', '/api/perfis', { id: 'x' }]]);
    const r = await chamar('POST', '/api/perfis', { nome: 'Ana' });
    expect(r).toEqual({ id: 'x' });
    const { init } = chamadas[0];
    expect(cabecalho(init, 'Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ nome: 'Ana' }));
    expect(init.cache).toBe('no-store');
  });

  test('sem corpo: nenhum Content-Type e nenhum body', async () => {
    const { chamadas } = simularFetch([['DELETE', '/api/perfis/abc', new Response(null, { status: 204 })]]);
    const r = await chamar('DELETE', '/api/perfis/abc');
    expect(r).toBeNull();
    const { init } = chamadas[0];
    expect(cabecalho(init, 'Content-Type')).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe('no-store');
  });

  test('erro da API vira ErroApi com status, codigo e mensagem', async () => {
    simularFetch([['GET', '/api/x', () => erroApi(409, 'LIMITE_PERFIS', 'Limite.')]]);
    await expect(chamar('GET', '/api/x')).rejects.toMatchObject({ status: 409, codigo: 'LIMITE_PERFIS', mensagem: 'Limite.' });
    await expect(chamar('GET', '/api/x')).rejects.toBeInstanceOf(ErroApi);
  });

  test('PERFIL_NAO_ENCONTRADO emite perfil-perdido', async () => {
    simularFetch([['GET', '/api/x', () => erroApi(404, 'PERFIL_NAO_ENCONTRADO')]]);
    const ouvinte = vi.fn();
    window.addEventListener('perfil-perdido', ouvinte);
    await expect(chamar('GET', '/api/x')).rejects.toBeInstanceOf(ErroApi);
    window.removeEventListener('perfil-perdido', ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  test('falha de rede vira SEM_SERVIDOR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(chamar('GET', '/api/saude')).rejects.toMatchObject({ codigo: 'SEM_SERVIDOR' });
  });

  test('resposta de erro sem JSON ainda vira ErroApi', async () => {
    simularFetch([['GET', '/api/x', () => new Response('<html>', { status: 502 })]]);
    await expect(chamar('GET', '/api/x')).rejects.toMatchObject({ status: 502 });
  });
});

describe('api.chamar: estado do servidor mudou com a página aberta (spec 4.3 e 7)', () => {
  const emitidos = async (status, codigo) => {
    simularFetch([['GET', '/api/x', () => erroApi(status, codigo)]]);
    const ouvinte = vi.fn();
    window.addEventListener('estado-mudou', ouvinte);
    await expect(chamar('GET', '/api/x')).rejects.toBeInstanceOf(ErroApi);
    window.removeEventListener('estado-mudou', ouvinte);
    return ouvinte.mock.calls.length;
  };

  test('503 BLOQUEADO emite estado-mudou', async () => {
    expect(await emitidos(503, 'BLOQUEADO')).toBe(1);
  });
  test('503 PREPARANDO emite estado-mudou', async () => {
    expect(await emitidos(503, 'PREPARANDO')).toBe(1);
  });
  test('503 BANCO_INDISPONIVEL não bloqueia: não emite (a Falha local com Tentar de novo basta)', async () => {
    expect(await emitidos(503, 'BANCO_INDISPONIVEL')).toBe(0);
  });
  test('outros erros não emitem', async () => {
    expect(await emitidos(409, 'LIMITE_PERFIS')).toBe(0);
  });
});
