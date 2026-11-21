import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GestaoPerfisRestrita from './GestaoPerfisRestrita.jsx';
import { simularFetch, perfilExemplo, semCorpo, cabecalho } from '../apoio-testes.js';

describe('GestaoPerfisRestrita', () => {
  test('só excluir, sem criar', async () => {
    simularFetch([['GET', '/api/perfis', [perfilExemplo()]]]);
    render(<GestaoPerfisRestrita onVoltar={() => {}} />);
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /criar|renomear|entrar|exemplo/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Excluir/ })).toBeTruthy();
  });

  test('excluir confirma e chama DELETE sem corpo e sem Content-Type', async () => {
    const p = perfilExemplo();
    let lista = [p];
    const { chamadas } = simularFetch([
      ['GET', '/api/perfis', () => lista],
      ['DELETE', `/api/perfis/${p.id}`, () => { lista = []; return semCorpo(); }],
    ]);
    render(<GestaoPerfisRestrita onVoltar={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Excluir/ }));
    expect(screen.getByText(/Apagar remove as avaliações deste perfil/)).toBeTruthy();
    expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(true));
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'Content-Type')).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Ana')).toBeNull());
  });
});
