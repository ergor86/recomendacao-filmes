import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MinhaLista from './MinhaLista.jsx';
import MinhasAvaliacoes from './MinhasAvaliacoes.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, json, cabecalho, filmeExemplo } from '../apoio-testes.js';

// o título do filme aparece também dentro do SVG do cartaz: a consulta mira o título do cartão
const SEL = { selector: '.cartao-titulo' };
const PERFIL = '11111111-1111-4111-8111-111111111111';
const EFEITOS = { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true };
const montarTela = (Tela) => render(<MemoryRouter><ProvedorAviso><Tela perfilId={PERFIL} /></ProvedorAviso></MemoryRouter>);
const entrada = (id, estadoPerfil) => ({
  filme: filmeExemplo({ id, titulo: `Filme ${id}`, estadoPerfil }),
  atualizadoEm: '2026-11-18T12:00:00.000Z',
});
const cartao = (id) => screen.getByText(`Filme ${id}`, SEL).closest('li');

describe('MinhaLista', () => {
  const QUERO = { tipo: 'quero_assistir', nota: null };

  test('pede os "Quero assistir" e mostra "Já assisti: avaliar" e "Remover da lista" em cada filme', async () => {
    const { chamadas } = simularFetch([
      ['GET', /\/interacoes\?/, { itens: [entrada(1, QUERO), entrada(2, QUERO)], total: 2, pagina: 1 }],
    ]);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    expect(chamadas[0].url).toContain(`/api/perfis/${PERFIL}/interacoes?tipos=quero_assistir`);
    expect(screen.getByRole('heading', { level: 1, name: 'Minha lista' })).toBeTruthy();
    expect(within(cartao(1)).getByRole('button', { name: 'Já assisti: avaliar' })).toBeTruthy();
    expect(within(cartao(1)).getByRole('button', { name: 'Remover da lista' })).toBeTruthy();
  });

  test('"Remover da lista" envia DELETE sem corpo e sem Content-Type e o filme sai; Desfazer o traz de volta', async () => {
    const { chamadas } = simularFetch([
      ['GET', /\/interacoes\?/, { itens: [entrada(1, QUERO), entrada(2, QUERO)], total: 2, pagina: 1 }],
      ['DELETE', /\/interacoes\/1$/, { anterior: QUERO, efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: false } }],
      ['PUT', /\/interacoes\/1$/, { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos: EFEITOS }],
    ]);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(within(cartao(1)).getByRole('button', { name: 'Remover da lista' }));
    await waitFor(() => expect(screen.queryByText('Filme 1', SEL)).toBeNull());
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'content-type')).toBeUndefined();
    expect(screen.getByText('Filme 2', SEL)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Filme 1', SEL);
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(JSON.parse(put.init.body)).toEqual({ tipo: 'quero_assistir' });
    expect(cabecalho(put.init, 'content-type')).toBe('application/json');
  });

  test('"Já assisti: avaliar" abre as estrelas; escolher uma nota grava e tira o filme da lista', async () => {
    const { chamadas } = simularFetch([
      ['GET', /\/interacoes\?/, { itens: [entrada(1, QUERO)], total: 1, pagina: 1 }],
      ['PUT', /\/interacoes\/1$/, { interacao: {}, anterior: QUERO, filme: { temVetor: true }, efeitos: EFEITOS }],
    ]);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Já assisti: avaliar' }));
    fireEvent.click(screen.getByRole('radio', { name: '4 de 5 estrelas' }));
    await waitFor(() => expect(screen.queryByText('Filme 1', SEL)).toBeNull());
    expect(JSON.parse(chamadas.find((c) => c.metodo === 'PUT').init.body)).toEqual({ tipo: 'nota', nota: 4 });
    expect(await screen.findByText(/Sua lista está vazia/)).toBeTruthy();
  });

  test('"Carregar mais" pede a página seguinte e acrescenta os filmes', async () => {
    const { chamadas } = simularFetch([
      ['GET', /pagina=1$/, { itens: [entrada(1, QUERO)], total: 2, pagina: 1 }],
      ['GET', /pagina=2$/, { itens: [entrada(2, QUERO)], total: 2, pagina: 2 }],
    ]);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Filme 2', SEL);
    expect(screen.getByText('Filme 1', SEL)).toBeTruthy();
    expect(chamadas.map((c) => c.url).some((u) => /pagina=2/.test(u))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  test('falha ao carregar mostra a mensagem e Tentar de novo', async () => {
    let n = 0;
    simularFetch([['GET', /\/interacoes\?/, () => (n++ === 0 ? new Response('x', { status: 500 }) : { itens: [entrada(1, QUERO)], total: 1, pagina: 1 })]]);
    montarTela(MinhaLista);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText('Filme 1', SEL);
  });
});

describe('MinhasAvaliacoes', () => {
  const NOTA2 = { tipo: 'nota', nota: 2 };
  const GOSTEI = { tipo: 'gostei', nota: null };

  test('pede as notas e os "Gostei" e mostra o estado de cada filme', async () => {
    const { chamadas } = simularFetch([
      ['GET', /\/interacoes\?/, { itens: [entrada(1, NOTA2), entrada(2, GOSTEI)], total: 2, pagina: 1 }],
    ]);
    montarTela(MinhasAvaliacoes);
    await screen.findByText('Filme 1', SEL);
    expect(chamadas[0].url).toContain(`/api/perfis/${PERFIL}/interacoes?tipos=nota,gostei`);
    expect(screen.getByRole('heading', { level: 1, name: 'Minhas avaliações' })).toBeTruthy();
    expect(within(cartao(1)).getByRole('radio', { name: '2 de 5 estrelas', checked: true })).toBeTruthy();
    expect(within(cartao(2)).getByRole('button', { name: 'Gostei', pressed: true })).toBeTruthy();
  });

  test('editar a nota troca o estado sem tirar o filme; remover envia DELETE sem corpo e tira o filme', async () => {
    const { chamadas } = simularFetch([
      ['GET', /\/interacoes\?/, { itens: [entrada(1, NOTA2)], total: 1, pagina: 1 }],
      ['PUT', /\/interacoes\/1$/, { interacao: {}, anterior: NOTA2, filme: { temVetor: true }, efeitos: EFEITOS }],
      ['DELETE', /\/interacoes\/1$/, { anterior: { tipo: 'nota', nota: 5 }, efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: true } }],
    ]);
    montarTela(MinhasAvaliacoes);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(within(cartao(1)).getByRole('radio', { name: '5 de 5 estrelas' }));
    await waitFor(() => expect(within(cartao(1)).getByRole('radio', { name: '5 de 5 estrelas', checked: true })).toBeTruthy());
    expect(JSON.parse(chamadas.find((c) => c.metodo === 'PUT').init.body)).toEqual({ tipo: 'nota', nota: 5 });

    fireEvent.click(within(cartao(1)).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(screen.queryByText('Filme 1', SEL)).toBeNull());
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'content-type')).toBeUndefined();
    expect(await screen.findByText(/Você ainda não avaliou/)).toBeTruthy();
  });

  test('usa o json simulado de lista vazia', async () => {
    simularFetch([['GET', /\/interacoes\?/, json({ itens: [], total: 0, pagina: 1 })]]);
    montarTela(MinhasAvaliacoes);
    expect(await screen.findByText(/Você ainda não avaliou/)).toBeTruthy();
  });
});

describe('paginação depois de remoções (nenhum filme é pulado)', () => {
  const QUERO = { tipo: 'quero_assistir', nota: null };
  const EFEITOS_DEL = { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: false };

  /** Servidor simulado: lista de ids em memória, páginas de `tamanho`, DELETE remove o id. */
  function servidor(ids, tamanho) {
    const lista = [...ids];
    simularFetch([
      ['GET', /\/interacoes\?/, (init, url) => {
        const pagina = Number(/pagina=(\d+)/.exec(url)[1]);
        const fatia = lista.slice((pagina - 1) * tamanho, pagina * tamanho);
        return { itens: fatia.map((id) => entrada(id, QUERO)), total: lista.length, pagina };
      }],
      ['DELETE', /\/interacoes\/\d+$/, (init, url) => {
        lista.splice(lista.indexOf(Number(/(\d+)$/.exec(url)[1])), 1);
        return { anterior: QUERO, efeitos: EFEITOS_DEL };
      }],
    ]);
  }

  test('remover da primeira página e carregar mais mostra todos os filmes restantes, e o botão some no fim', async () => {
    servidor([1, 2, 3, 4, 5], 2);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(within(cartao(1)).getByRole('button', { name: 'Remover da lista' }));
    await waitFor(() => expect(screen.queryByText('Filme 1', SEL)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Filme 5', SEL);
    for (const id of [2, 3, 4, 5]) expect(screen.getByText(`Filme ${id}`, SEL)).toBeTruthy(); // o 3 não foi pulado
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  test('esvaziar a primeira página recarrega a lista em vez de mostrar grade vazia com "Carregar mais"', async () => {
    servidor([1, 2, 3], 1);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(within(cartao(1)).getByRole('button', { name: 'Remover da lista' }));
    await screen.findByText('Filme 2', SEL);
    expect(screen.queryByText('Filme 1', SEL)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('Filme 3', SEL);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  test('remover tudo, sem mais páginas, mostra a mensagem de lista vazia e nenhum botão', async () => {
    servidor([1], 2);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(within(cartao(1)).getByRole('button', { name: 'Remover da lista' }));
    expect(await screen.findByText(/Sua lista está vazia/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  test('o foco não cai no body quando o item focado sai: vai para o item da mesma posição', async () => {
    servidor([1, 2, 3], 5);
    montarTela(MinhaLista);
    await screen.findByText('Filme 1', SEL);
    const botao = within(cartao(2)).getByRole('button', { name: 'Remover da lista' });
    botao.focus();
    fireEvent.click(botao);
    await waitFor(() => expect(screen.queryByText('Filme 2', SEL)).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.closest('li').dataset.filmeId).toBe('3');
  });
});
