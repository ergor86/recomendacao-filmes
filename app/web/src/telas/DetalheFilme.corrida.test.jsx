import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import DetalheFilme from './DetalheFilme.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, json } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const detalhe = (id, titulo) => ({
  ...filmeExemplo({ id, titulo, tituloOriginal: titulo }),
  temGemeoOculto: false,
  estatisticas: {
    movielens: { nNotas: 400, media: 4.3, pctAprovacao: 88.5, poucasNotas: false },
    computador: { nNotas: 0, media: null, poucasNotas: true },
    sua: null,
  },
});
const adiado = () => { let resolver; const p = new Promise((r) => { resolver = r; }); return { p, resolver }; };
const montar = () => render(
  <MemoryRouter initialEntries={['/filmes/1']}>
    <ProvedorAviso>
      <Link to="/filmes/2">ir para o 2</Link>
      <Routes><Route path="/filmes/:id" element={<DetalheFilme perfilId={PERFIL} />} /></Routes>
    </ProvedorAviso>
  </MemoryRouter>,
);

describe('DetalheFilme: respostas tardias', () => {
  test('um PUT tardio do filme A não grava o estado no filme B', async () => {
    const put = adiado();
    simularFetch([
      ['GET', `/api/filmes/1?perfilId=${PERFIL}`, detalhe(1, 'Filme A')],
      ['GET', `/api/filmes/2?perfilId=${PERFIL}`, detalhe(2, 'Filme B')],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, async () => { await put.p; return { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos: { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true } }; }],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme A' });
    fireEvent.click(screen.getByRole('button', { name: 'Gostei' }));
    fireEvent.click(screen.getByText('ir para o 2'));
    await screen.findByRole('heading', { name: 'Filme B' });
    await act(async () => { put.resolver(); await put.p; });
    expect(screen.getByRole('heading', { name: 'Filme B' })).toBeTruthy();
    expect(screen.getByText('Estado atual:').textContent).toContain('nenhum');
    expect(screen.getByText('Você ainda não marcou este filme.')).toBeTruthy();
  });

  test('um retry em voo do filme A é descartado depois de trocar para o B', async () => {
    const lento = adiado();
    let n = 0;
    simularFetch([
      ['GET', `/api/filmes/1?perfilId=${PERFIL}`, async () => {
        n += 1;
        if (n === 1) return json({ codigo: 'X', mensagem: 'falhou' }, 500);
        await lento.p;
        return detalhe(1, 'Filme A');
      }],
      ['GET', `/api/filmes/2?perfilId=${PERFIL}`, detalhe(2, 'Filme B')],
    ]);
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    fireEvent.click(screen.getByText('ir para o 2'));
    await screen.findByRole('heading', { name: 'Filme B' });
    await act(async () => { lento.resolver(); await lento.p; });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Filme B' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Filme A' })).toBeNull();
  });
});
