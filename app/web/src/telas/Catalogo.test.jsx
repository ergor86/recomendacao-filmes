import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Catalogo from './Catalogo.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const generos = [{ id: 'Action', rotulo: 'Ação' }, { id: 'unknown', rotulo: 'Desconhecido' }];
const montar = () => render(<MemoryRouter><ProvedorAviso><Catalogo perfilId={PERFIL} /></ProvedorAviso></MemoryRouter>);

describe('Catalogo', () => {
  test('busca vazia mostra o aviso de 1998', async () => {
    simularFetch([['GET', '/api/generos', generos], ['GET', /^\/api\/filmes\?/, { itens: [], total: 0, pagina: 1 }]]);
    montar();
    expect(await screen.findByText('Nada encontrado. O MovieLens 100K só tem filmes até 1998.')).toBeTruthy();
  });

  test('lista e carrega mais', async () => {
    const pagina1 = Array.from({ length: 24 }, (_, i) => filmeExemplo({ id: i + 1, titulo: `Filme ${i + 1}` }));
    const { chamadas } = simularFetch([
      ['GET', '/api/generos', generos],
      ['GET', /^\/api\/filmes\?/, (_i, url) => (url.includes('pagina=2')
        ? { itens: [filmeExemplo({ id: 99, titulo: 'Filme 99' })], total: 25, pagina: 2 }
        : { itens: pagina1, total: 25, pagina: 1 })],
    ]);
    montar();
    expect(await screen.findByText('Filme 1', { selector: '.cartao-titulo' })).toBeTruthy();
    expect(chamadas.find((c) => c.url.startsWith('/api/filmes?')).url).toContain(`perfilId=${PERFIL}`);
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Filme 99', { selector: '.cartao-titulo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  test('os controles de busca vão para a consulta', async () => {
    const { chamadas } = simularFetch([['GET', '/api/generos', generos], ['GET', /^\/api\/filmes\?/, { itens: [], total: 0, pagina: 1 }]]);
    montar();
    await screen.findByText(/Nada encontrado/);
    fireEvent.click(screen.getByLabelText('Só filmes que ajudam a recomendar'));
    fireEvent.change(screen.getByLabelText('Ordem'), { target: { value: 'titulo' } });
    await waitFor(() => {
      const u = chamadas.at(-1).url;
      expect(u).toContain('soInfluenciam=true');
      expect(u).toContain('ordem=titulo');
    });
  });
});
