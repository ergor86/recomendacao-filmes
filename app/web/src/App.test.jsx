import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import { simularFetch, perfilExemplo } from './apoio-testes.js';

const operante = { estado: 'operante', perfis: { disponivel: true } };

describe('App', () => {
  test('localStorage que lança não quebra e mostra TelaPerfis', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado'); });
    simularFetch([['GET', '/api/saude', operante], ['GET', '/api/perfis', []]]);
    render(<App />);
    expect(await screen.findByText('Quem está usando?')).toBeTruthy();
  });

  test('perfil-perdido volta à TelaPerfis', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    simularFetch([['GET', '/api/saude', operante], ['GET', '/api/perfis', [p]]]);
    render(<App />);
    expect(await screen.findByText(/Perfil: Ana/)).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('perfil-perdido')); });
    expect(await screen.findByText('Quem está usando?')).toBeTruthy();
    expect(window.localStorage.getItem('perfilAtivo')).toBeNull();
  });

  test('fora do estado operante mostra a TelaPreparando', async () => {
    simularFetch([['GET', '/api/saude', { estado: 'preparando', etapa: 2, total: 8, mensagem: 'Importando', perfis: { disponivel: false, motivo: 'sem_dados' } }]]);
    render(<App />);
    expect(await screen.findByText(/Etapa 2 de 8/)).toBeTruthy();
  });

  test('servidor fora do ar mostra a mensagem e o botão Tentar de novo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x'); }));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Não consegui falar com o servidor local. Ele está rodando?')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  test('falha ao resolver o nome do perfil guardado mostra a mensagem e Tentar de novo refaz', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    let n = 0;
    simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', () => (n++ === 0 ? new Response('x', { status: 500 }) : [p])],
    ]);
    render(<App />);
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(botao);
    expect(await screen.findByText(/Perfil: Ana/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });
});
