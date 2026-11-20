import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import DetalheFilme from './DetalheFilme.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, json, adiavel, acomodar } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const URL_GET = (id) => `/api/filmes/${id}?perfilId=${PERFIL}`;
const detalhe = (id, computador, sua = null, titulo = `Filme ${id}`) => ({
  ...filmeExemplo({ id, titulo, tituloOriginal: titulo, estadoPerfil: sua }),
  temGemeoOculto: false,
  estatisticas: {
    movielens: { nNotas: 400, media: 4.3, pctAprovacao: 88.5, poucasNotas: false },
    computador,
    sua,
  },
});
const comp = (nNotas, media = null, poucasNotas = nNotas < 5) => ({ nNotas, media, poucasNotas });
const putOk = { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos: { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true } };
const delOk = { anterior: { tipo: 'nota', nota: 3 }, efeitos: { perfilMudou: false } };
const montar = () => render(
  <MemoryRouter initialEntries={['/filmes/1']}>
    <ProvedorAviso>
      <Link to="/filmes/2">ir para o 2</Link>
      <Link to="/filmes/1">ir para o 1</Link>
      <Routes><Route path="/filmes/:id" element={<DetalheFilme perfilId={PERFIL} />} /></Routes>
    </ProvedorAviso>
  </MemoryRouter>,
);
const secao = () => document.querySelector('.estatistica-computador');
const nNotas = () => secao().querySelector('dl div:nth-child(2) dd').textContent;
const media = () => secao().querySelector('dl div:nth-child(1) dd').textContent;
const estrela = (n) => screen.getByRole('radio', { name: `${n} de 5 estrelas` });

describe('DetalheFilme: "Neste computador" depois de uma escrita', () => {
  test('inclusão: a contagem nova vem do GET', async () => {
    let gets = 0;
    simularFetch([
      ['GET', URL_GET(1), () => { gets += 1; return detalhe(1, gets === 1 ? comp(0) : comp(1)); }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    expect(nNotas()).toBe('0');
    fireEvent.click(estrela(4));
    await waitFor(() => expect(nNotas()).toBe('1'));
    expect(screen.getByRole('heading', { name: 'Filme 1' })).toBeTruthy();
  });

  test('edição troca a média; exclusão derruba a contagem', async () => {
    const respostas = [comp(6, 3.5), comp(6, 3.83), comp(5, 3.4)];
    let gets = 0;
    simularFetch([
      ['GET', URL_GET(1), () => detalhe(1, respostas[Math.min(gets++, 2)], { tipo: 'nota', nota: 3 })],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
      ['DELETE', `/api/perfis/${PERFIL}/interacoes/1`, delOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    expect(media()).toBe('3,50');
    fireEvent.click(estrela(5));
    await waitFor(() => expect(media()).toBe('3,83'));
    fireEvent.click(estrela(5));
    await waitFor(() => expect(nNotas()).toBe('5'));
  });

  test('de 4 para 5 notas: o painel abre e some "poucas notas ainda"', async () => {
    let gets = 0;
    simularFetch([
      ['GET', URL_GET(1), () => { gets += 1; return detalhe(1, gets === 1 ? comp(4) : comp(5, 3.8, false)); }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    expect(secao().querySelector('details').open).toBe(false);
    expect(secao().textContent).toContain('poucas notas ainda');
    fireEvent.click(estrela(4));
    await waitFor(() => expect(secao().querySelector('details').open).toBe(true));
    expect(media()).toBe('3,80');
    expect(secao().textContent).not.toContain('poucas notas ainda');
  });

  test('corrida: a recarga de A atrasada não sobrescreve a carga nova de A depois de ir a B e voltar', async () => {
    const lenta = adiavel();
    let gets1 = 0;
    simularFetch([
      ['GET', URL_GET(1), async () => {
        gets1 += 1;
        if (gets1 === 1) return detalhe(1, comp(0));
        if (gets1 === 2) { await lenta.promessa; return detalhe(1, comp(9, 4.5, false)); }
        return detalhe(1, comp(1));
      }],
      ['GET', URL_GET(2), detalhe(2, comp(2, null, true))],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    fireEvent.click(estrela(4));
    await waitFor(() => expect(gets1).toBe(2));
    fireEvent.click(screen.getByText('ir para o 2'));
    await screen.findByRole('heading', { name: 'Filme 2' });
    expect(nNotas()).toBe('2');
    fireEvent.click(screen.getByText('ir para o 1'));
    await screen.findByRole('heading', { name: 'Filme 1' });
    expect(nNotas()).toBe('1');
    await act(async () => { lenta.resolver(); await lenta.promessa; });
    await acomodar(act);
    expect(nNotas()).toBe('1');
  });

  test('um PUT tardio de A não descarta a recarga legítima de B', async () => {
    const putA = adiavel();
    const recargaB = adiavel();
    let gets2 = 0;
    let gets1 = 0;
    simularFetch([
      ['GET', URL_GET(1), () => { gets1 += 1; return detalhe(1, comp(0)); }],
      ['GET', URL_GET(2), async () => { gets2 += 1; if (gets2 === 1) return detalhe(2, comp(2)); await recargaB.promessa; return detalhe(2, comp(7, 3.2, false)); }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, async () => { await putA.promessa; return putOk; }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/2`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    fireEvent.click(estrela(4));
    fireEvent.click(screen.getByText('ir para o 2'));
    await screen.findByRole('heading', { name: 'Filme 2' });
    fireEvent.click(estrela(5));
    await waitFor(() => expect(gets2).toBe(2));
    await act(async () => { putA.resolver(); await putA.promessa; });
    await acomodar(act);
    expect(gets1).toBe(1);
    await act(async () => { recargaB.resolver(); await recargaB.promessa; });
    await waitFor(() => expect(nNotas()).toBe('7'));
  });

  test('corrida: duas escritas seguidas, a primeira recarga chega depois da segunda', async () => {
    const primeira = adiavel();
    let gets = 0;
    simularFetch([
      ['GET', URL_GET(1), async () => {
        gets += 1;
        if (gets === 1) return detalhe(1, comp(0));
        if (gets === 2) { await primeira.promessa; return detalhe(1, comp(1)); }
        return detalhe(1, comp(2));
      }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    fireEvent.click(estrela(4));
    await waitFor(() => expect(gets).toBe(2));
    fireEvent.click(estrela(5));
    await waitFor(() => expect(nNotas()).toBe('2'));
    await act(async () => { primeira.resolver(); await primeira.promessa; });
    await acomodar(act);
    expect(nNotas()).toBe('2');
  });

  test('falha da recarga: os números anteriores ficam e o filme continua na tela', async () => {
    let gets = 0;
    simularFetch([
      ['GET', URL_GET(1), () => { gets += 1; return gets === 1 ? detalhe(1, comp(3)) : json({ codigo: 'X', mensagem: 'falhou' }, 500); }],
      ['PUT', `/api/perfis/${PERFIL}/interacoes/1`, putOk],
    ]);
    montar();
    await screen.findByRole('heading', { name: 'Filme 1' });
    fireEvent.click(estrela(4));
    await waitFor(() => expect(gets).toBe(2));
    await acomodar(act);
    expect(nNotas()).toBe('3');
    expect(screen.getByRole('heading', { name: 'Filme 1' })).toBeTruthy();
    expect(screen.queryByText('falhou')).toBeNull();
    expect(screen.getByText('Estado atual:').textContent).toContain('4');
  });
});
