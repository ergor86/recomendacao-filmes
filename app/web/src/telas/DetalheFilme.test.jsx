import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DetalheFilme from './DetalheFilme.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, erroApi } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const detalhe = {
  ...filmeExemplo({ titulo: 'The Usual Suspects', tituloOriginal: 'Usual Suspects, The', ano: 1995 }),
  temGemeoOculto: false,
  estatisticas: {
    movielens: { nNotas: 400, media: 4.3, pctAprovacao: 88.5, poucasNotas: false },
    computador: { nNotas: 0, media: null, poucasNotas: true },
    sua: null,
  },
};
const montar = () => render(
  <MemoryRouter initialEntries={['/filmes/1']}>
    <ProvedorAviso><Routes><Route path="/filmes/:id" element={<DetalheFilme perfilId={PERFIL} />} /></Routes></ProvedorAviso>
  </MemoryRouter>,
);

describe('DetalheFilme', () => {
  test('mostra título, original, ano, controles e estatísticas', async () => {
    const { chamadas } = simularFetch([['GET', `/api/filmes/1?perfilId=${PERFIL}`, detalhe]]);
    montar();
    expect(await screen.findByRole('heading', { name: 'The Usual Suspects' })).toBeTruthy();
    expect(screen.getByText('Usual Suspects, The')).toBeTruthy();
    expect(screen.getByText('1995', { selector: '.detalhe-ano' })).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getByText('MovieLens (1997–98, 943 pessoas)')).toBeTruthy();
    expect(chamadas[0].url).toBe(`/api/filmes/1?perfilId=${PERFIL}`);
  });

  test('404 mostra mensagem de filme não encontrado', async () => {
    simularFetch([['GET', `/api/filmes/1?perfilId=${PERFIL}`, () => erroApi(404, 'FILME_NAO_ENCONTRADO', 'Filme não encontrado.')]]);
    montar();
    expect(await screen.findByText('Filme não encontrado.')).toBeTruthy();
  });
});
