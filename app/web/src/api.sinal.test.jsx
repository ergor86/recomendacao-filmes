import { describe, test, expect, vi } from 'vitest';
import { chamar } from './api.js';

describe('chamar com sinal de aborto', () => {
  test('repassa o signal ao fetch e relança o aborto sem convertê-lo em "sem servidor"', async () => {
    const controlador = new AbortController();
    const fetchFalso = vi.fn((url, init) => new Promise((_, rejeitar) => {
      init.signal.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchFalso);
    const pedido = chamar('GET', '/api/x', undefined, { signal: controlador.signal });
    expect(fetchFalso.mock.calls[0][1].signal).toBe(controlador.signal);
    controlador.abort();
    await expect(pedido).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('sem sinal, nada muda no init', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchFalso);
    await chamar('GET', '/api/x');
    expect('signal' in fetchFalso.mock.calls[0][1]).toBe(false);
  });
});
