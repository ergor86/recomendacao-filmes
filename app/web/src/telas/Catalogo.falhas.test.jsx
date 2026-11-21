import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Catalogo from './Catalogo.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, json } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const montar = () => render(<MemoryRouter><ProvedorAviso><Catalogo perfilId={PERFIL} /></ProvedorAviso></MemoryRouter>);

describe('Catalogo: falhas e buscas', () => {
  test('falha em "Carregar mais" mantém a grade e oferece nova tentativa', async () => {
    const pagina1 = Array.from({ length: 24 }, (_, i) => filmeExemplo({ id: i + 1, titulo: `Filme ${i + 1}` }));
    let falhar = true;
    simularFetch([
      ['GET', '/api/generos', []],
      ['GET', /^\/api\/filmes\?/, (_i, url) => {
        if (!url.includes('pagina=2')) return { itens: pagina1, total: 25, pagina: 1 };
        if (falhar) return json({ codigo: 'X', mensagem: 'Deu ruim' }, 500);
        return { itens: [filmeExemplo({ id: 99, titulo: 'Filme 99' })], total: 25, pagina: 2 };
      }],
    ]);
    montar();
    await screen.findByText('Filme 1', { selector: '.cartao-titulo' });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Deu ruim')).toBeTruthy();
    expect(screen.getByText('Filme 1', { selector: '.cartao-titulo' })).toBeTruthy();
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Filme 99', { selector: '.cartao-titulo' })).toBeTruthy();
    expect(screen.getByText('Filme 1', { selector: '.cartao-titulo' })).toBeTruthy();
  });

  test('Enter na busca não dispara a consulta duas vezes', async () => {
    const { chamadas } = simularFetch([['GET', '/api/generos', []], ['GET', /^\/api\/filmes\?/, { itens: [], total: 0, pagina: 1 }]]);
    montar();
    await screen.findByText(/Nada encontrado/);
    const campo = screen.getByLabelText('Buscar por título');
    fireEvent.change(campo, { target: { value: 'toy' } });
    fireEvent.submit(campo.closest('form'));
    await waitFor(() => expect(chamadas.filter((c) => c.url.includes('q=toy'))).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 450));
    expect(chamadas.filter((c) => c.url.includes('q=toy'))).toHaveLength(1);
  });

  test('uma resposta velha do catálogo é descartada', async () => {
    let soltar;
    const lenta = new Promise((r) => { soltar = r; });
    simularFetch([
      ['GET', '/api/generos', []],
      ['GET', /^\/api\/filmes\?/, async (_i, url) => {
        if (url.includes('ordem=mais_avaliados')) { await lenta; return { itens: [filmeExemplo({ id: 1, titulo: 'Velho' })], total: 1, pagina: 1 }; }
        return { itens: [filmeExemplo({ id: 2, titulo: 'Novo' })], total: 1, pagina: 1 };
      }],
    ]);
    montar();
    fireEvent.change(screen.getByLabelText('Ordem'), { target: { value: 'titulo' } });
    await screen.findByText('Novo', { selector: '.cartao-titulo' });
    soltar();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Velho', { selector: '.cartao-titulo' })).toBeNull();
  });
});
