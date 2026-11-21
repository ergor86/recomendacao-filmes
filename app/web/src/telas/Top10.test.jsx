import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { paletaDoCartaz } from '../componentes/Cartaz.jsx';
import Top10 from './Top10.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import {
  simularFetch, json, erroApi, cabecalho, adiavel, recomendacoesExemplo, acomodar,
} from '../apoio-testes.js';

// o título do filme aparece também dentro do SVG do cartaz: a consulta mira o título do cartão
const SEL = { selector: '.cartao-titulo' };
const PERFIL = '11111111-1111-4111-8111-111111111111';
const URL_RECS = `/api/perfis/${PERFIL}/recomendacoes`;
const EFEITOS = { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true };
const PUT_OK = () => json({ interacao: {}, anterior: null, filme: { temVetor: true }, efeitos: EFEITOS });
const DELETE_OK = () => json({
  anterior: { tipo: 'gostei', nota: null },
  efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: true },
});

const recs = (...ids) => recomendacoesExemplo(ids);
const item = (id) => document.querySelector(`li[data-filme-id="${id}"]`);
const idsNaTela = () => [...document.querySelectorAll('ol li[data-filme-id]')].map((li) => li.dataset.filmeId);
const gostei = (id) => within(item(id)).getByRole('button', { name: 'Gostei' });
const gets = (chamadas) => chamadas.filter((c) => c.metodo === 'GET' && c.url === URL_RECS);

/** Os GETs de recomendações saem de uma fila (corpo, Response ou promessa controlada); PUT e DELETE por funções. */
function montar({ fila, put = PUT_OK, del = DELETE_OK }) {
  const filaGets = [...fila];
  const r = simularFetch([
    ['GET', URL_RECS, () => {
      const v = filaGets.shift();
      if (v === undefined) throw new Error('GET inesperado');
      return v;
    }],
    ['PUT', /\/interacoes\/\d+$/, put],
    ['DELETE', /\/interacoes\/\d+$/, del],
  ]);
  render(<MemoryRouter><ProvedorAviso><Top10 perfilId={PERFIL} /></ProvedorAviso></MemoryRouter>);
  return r;
}

afterEach(() => { delete Element.prototype.animate; });

describe('Top10: abertura', () => {
  test('busca as recomendações sem cache e mostra base, contagem, lista numerada, "porque" e a explicação', async () => {
    const r = recomendacoesExemplo([1, 2], { motivo: 'parcial' });
    r.itens[1] = { ...r.itens[1], fonte: 'populares', escore: null, porque: [] };
    r.itens[0].porque = [{ id: 100, titulo: 'Base A' }, { id: 101, titulo: 'Base B' }];
    const { chamadas } = montar({ fila: [r] });
    await screen.findByText('Filme 1', SEL);
    expect(chamadas[0].init.cache).toBe('no-store');
    expect(screen.getByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(screen.getByText(/Baseado em:/).textContent).toContain('Base A');
    expect(screen.getByText(/Baseado em:/).textContent).toContain('Base B');
    expect(screen.getByText('4 dos seus 5 filmes curtidos estão sendo usados')).toBeTruthy();
    expect(document.querySelector('ol')).not.toBeNull();
    expect(within(item(1)).getByText(/Porque você curtiu/).textContent).toBe('Porque você curtiu Base A e Base B');
    expect(within(item(2)).getByText('Mais avaliados nos dados de 1998')).toBeTruthy();
    expect(within(item(1)).queryByText('Mais avaliados nos dados de 1998')).toBeNull();
    expect(screen.getByText(/Encontramos menos de 10 filmes parecidos/)).toBeTruthy();
    expect(screen.queryByText('Novo')).toBeNull();
  });

  test('falha ao abrir mostra a mensagem e Tentar de novo refaz o pedido', async () => {
    const { chamadas } = montar({ fila: [erroApi(500, 'ERRO_INTERNO', 'quebrou'), recs(1)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText('Filme 1', SEL);
    expect(gets(chamadas)).toHaveLength(2);
  });
});

describe('Top10: atualização automática', () => {
  test('resposta antiga que chega depois da nova é descartada', async () => {
    const g2 = adiavel();
    const g3 = adiavel();
    const { chamadas } = montar({ fila: [recs(1, 2, 3), g2.promessa, g3.promessa] });
    await screen.findByText('Filme 1', SEL);

    fireEvent.click(gostei(1));
    await waitFor(() => expect(gets(chamadas)).toHaveLength(2));
    const sinalAntigo = gets(chamadas)[1].init.signal;
    expect(sinalAntigo.aborted).toBe(false);

    fireEvent.click(gostei(2));
    await waitFor(() => expect(gets(chamadas)).toHaveLength(3));
    expect(sinalAntigo.aborted).toBe(true); // o GET anterior é abortado

    g3.resolver(json(recs(3, 4, 5)));
    await waitFor(() => expect(idsNaTela()).toEqual(['3', '4', '5']));

    // a resposta velha chega depois (o fetch simulado ignora o aborto): não pode trocar a lista
    g2.resolver(json(recs(2, 3, 6)));
    await acomodar(act);
    expect(idsNaTela()).toEqual(['3', '4', '5']);
  });

  test('duas marcações rápidas → um GET final, sem os dois itens', async () => {
    const p1 = adiavel();
    const p2 = adiavel();
    const puts = [p1.promessa, p2.promessa];
    const { chamadas } = montar({ fila: [recs(1, 2, 3), recs(3, 4, 5)], put: () => puts.shift() });
    await screen.findByText('Filme 1', SEL);

    fireEvent.click(gostei(1));
    fireEvent.click(gostei(2));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(2));

    p1.resolver(PUT_OK());
    await acomodar(act);
    expect(gets(chamadas)).toHaveLength(1); // ainda há escrita pendente: o GET não sai

    p2.resolver(PUT_OK());
    await waitFor(() => expect(idsNaTela()).toEqual(['3', '4', '5']));
    expect(gets(chamadas)).toHaveLength(2); // um único GET final
    expect(item(1)).toBeNull();
    expect(item(2)).toBeNull();
  });

  test('durante a atualização a lista fica aria-busy com "Atualizando…" e os itens continuam na tela', async () => {
    const g2 = adiavel();
    const { chamadas } = montar({ fila: [recs(1, 2, 3), g2.promessa] });
    await screen.findByText('Filme 1', SEL);
    const lista = document.querySelector('ol');
    expect(lista.getAttribute('aria-busy')).not.toBe('true');
    fireEvent.click(gostei(1));
    await waitFor(() => expect(gets(chamadas)).toHaveLength(2));
    expect(lista.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Atualizando…')).toBeTruthy();
    expect(idsNaTela()).toEqual(['1', '2', '3']);
    g2.resolver(json(recs(2, 3, 4)));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    expect(lista.getAttribute('aria-busy')).not.toBe('true');
    expect(screen.queryByText('Atualizando…')).toBeNull();
  });

  test('foco vai para o item da mesma posição quando o focado sai', async () => {
    montar({ fila: [recs(1, 2, 3), recs(1, 3, 4)] });
    await screen.findByText('Filme 2', SEL);
    gostei(2).focus();
    expect(document.activeElement).toBe(gostei(2));
    fireEvent.click(gostei(2));
    await waitFor(() => expect(idsNaTela()).toEqual(['1', '3', '4']));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.closest('li').dataset.filmeId).toBe('3'); // a posição 2 agora é do filme 3
  });

  test('foco vai para o item anterior quando o último sai, e para o título quando a lista esvazia', async () => {
    montar({ fila: [recs(1, 2, 3), recs(1, 2), recs()] });
    await screen.findByText('Filme 3', SEL);
    gostei(3).focus();
    fireEvent.click(gostei(3));
    await waitFor(() => expect(idsNaTela()).toEqual(['1', '2']));
    expect(document.activeElement.closest('li').dataset.filmeId).toBe('2');

    gostei(2).focus();
    fireEvent.click(gostei(2));
    await waitFor(() => expect(idsNaTela()).toEqual([]));
    const titulo = screen.getByRole('heading', { level: 1, name: 'Top 10' });
    expect(titulo.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(titulo);
  });

  test('Novo só para itens ausentes na abertura; Desfazer não gera Novo e o aviso não é recriado', async () => {
    const { chamadas } = montar({ fila: [recs(1, 2, 3), recs(2, 3, 4), recs(1, 2, 3, 4)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    expect(within(item(4)).getByText('Novo')).toBeTruthy();
    expect(within(item(2)).queryByText('Novo')).toBeNull();
    expect(within(item(3)).queryByText('Novo')).toBeNull();

    // o "Desfazer" do aviso continua lá depois que a lista se atualizou
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(idsNaTela()).toEqual(['1', '2', '3', '4']));
    expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(true);
    expect(within(item(1)).queryByText('Novo')).toBeNull(); // voltou pelo Desfazer
    expect(within(item(4)).getByText('Novo')).toBeTruthy(); // continua ausente da lista da abertura
  });

  test('as marcações: PUT leva Content-Type JSON; DELETE (Desfazer) não leva corpo nem cabeçalho', async () => {
    const { chamadas } = montar({ fila: [recs(1, 2), recs(2, 3), recs(1, 2)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3']));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(true));
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(cabecalho(put.init, 'content-type')).toBe('application/json');
    expect(JSON.parse(put.init.body)).toEqual({ tipo: 'gostei' });
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'content-type')).toBeUndefined();
  });

  test('anúncio aria-live único com "Recomendações atualizadas"', async () => {
    montar({ fila: [recs(1, 2, 3), recs(2, 3, 4)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    const regioes = document.querySelectorAll('[aria-live]');
    expect(regioes).toHaveLength(1);
    await waitFor(() => expect(regioes[0].textContent).toContain('Recomendações atualizadas: 1 filme novo, Filme 4'));
    expect(regioes[0].textContent).toContain('Salvo');
    expect(within(regioes[0]).getByRole('button', { name: 'Desfazer' })).toBeTruthy();
  });

  test('vários filmes novos são contados no anúncio', async () => {
    montar({ fila: [recs(1, 2, 3), recs(2, 3, 4, 5)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4', '5']));
    const regiao = document.querySelector('[aria-live]');
    await waitFor(() => expect(regiao.textContent).toContain('Recomendações atualizadas: 2 filmes novos'));
  });

  test('erro no GET mostra a faixa Tentar de novo, mantém a lista e refaz o pedido', async () => {
    const { chamadas } = montar({ fila: [recs(1, 2, 3), erroApi(500, 'ERRO_INTERNO', 'quebrou'), recs(2, 3, 4)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' });
    expect(screen.getByText(/Não consegui atualizar as recomendações/)).toBeTruthy();
    expect(idsNaTela()).toEqual(['1', '2', '3']); // a lista fica como está
    expect(document.querySelector('ol').getAttribute('aria-busy')).not.toBe('true');
    fireEvent.click(botao);
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(gets(chamadas)).toHaveLength(3);
  });

  test('falha da escrita não pede o GET e devolve o item à lista', async () => {
    const { chamadas } = montar({ fila: [recs(1, 2, 3)], put: () => erroApi(500, 'ERRO_INTERNO', 'não salvou') });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PUT')).toBe(true));
    await acomodar(act);
    expect(gets(chamadas)).toHaveLength(1);
    expect(idsNaTela()).toEqual(['1', '2', '3']);
    expect(document.querySelector('ol').getAttribute('aria-busy')).not.toBe('true');
    expect(item(1).className).not.toContain('saindo');
  });
});

describe('Top10: animação FLIP', () => {
  /** Posição simulada: 100 px por índice do item na lista. */
  function simularPosicoes() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function posicao() {
      const li = this.closest?.('li[data-filme-id]');
      const indice = li ? [...li.parentElement.children].indexOf(li) : 0;
      return { top: indice * 100, left: 0, right: 100, bottom: indice * 100 + 90, width: 100, height: 90, x: 0, y: indice * 100 };
    });
  }
  const mediaReduzida = (reduzir) => vi.stubGlobal('matchMedia', vi.fn((consulta) => ({
    matches: reduzir && /prefers-reduced-motion:\s*reduce/.test(consulta),
    media: consulta,
    addEventListener() {},
    removeEventListener() {},
  })));

  test('sem reduced-motion, os itens que ficam deslizam com Web Animations em no máximo 300 ms', async () => {
    mediaReduzida(false);
    simularPosicoes();
    const animar = vi.fn(() => ({ finished: Promise.resolve() }));
    Element.prototype.animate = animar;
    montar({ fila: [recs(1, 2, 3), recs(2, 3, 4)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    expect(animar).toHaveBeenCalled();
    for (const [, opcoes] of animar.mock.calls) {
      expect(opcoes.duration).toBeGreaterThan(0);
      expect(opcoes.duration).toBeLessThanOrEqual(300);
    }
    // o filme 2 subiu da posição 1 para a 0: o quadro inicial o desloca 100 px para baixo
    const indice = animar.mock.contexts.findIndex((el) => el.closest('li')?.dataset.filmeId === '2');
    expect(indice).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(animar.mock.calls[indice][0])).toContain('100px');
  });

  test('reduced-motion: troca sem animação', async () => {
    mediaReduzida(true);
    simularPosicoes();
    const animar = vi.fn();
    Element.prototype.animate = animar;
    montar({ fila: [recs(1, 2, 3), recs(2, 3, 4)] });
    await screen.findByText('Filme 1', SEL);
    fireEvent.click(gostei(1));
    await waitFor(() => expect(idsNaTela()).toEqual(['2', '3', '4']));
    await acomodar(act);
    expect(animar).not.toHaveBeenCalled();
  });
});

describe('Top10: "Baseado em" com mini-capas', () => {
  test('cada base é um chip com mini-capa decorativa e o título como nome', async () => {
    montar({ fila: [recomendacoesExemplo([1, 2])] });
    await screen.findByText('Filme 1', SEL);
    const chips = document.querySelectorAll('.baseado-em .chip-base');
    expect(chips).toHaveLength(2);
    // o texto exposto (sem o que é aria-hidden) é só o título
    const nomeAcessivel = (c) => { const k = c.cloneNode(true); k.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove()); return k.textContent.trim(); };
    expect([...chips].map(nomeAcessivel)).toEqual(['Base A', 'Base B']);
    for (const c of chips) {
      const capa = c.querySelector('svg.cartaz');
      expect(capa).not.toBeNull();
      expect(capa.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(capa.className.baseVal).toContain('cartaz-pequeno');
    }
    // a mini-capa não entra na árvore de acessibilidade: não há imagem "Cartaz: Base A" dentro do bloco
    expect(within(document.querySelector('.baseado-em')).queryAllByRole('img')).toHaveLength(0);
    expect(document.querySelector('.baseado-em').textContent).toContain('Baseado em:');
  });

  test('os chips são itens de uma lista (leitor de tela anuncia os títulos separados)', async () => {
    montar({ fila: [recomendacoesExemplo([1, 2])] });
    await screen.findByText('Filme 1', SEL);
    const lista = within(document.querySelector('.baseado-em')).getByRole('list');
    const itens = within(lista).getAllByRole('listitem');
    expect(itens.map((i) => i.querySelector('em').textContent)).toEqual(['Base A', 'Base B']);
  });

  test('a mini-capa usa a mesma família e cor do cartaz do mesmo filme na lista', async () => {
    const r = recomendacoesExemplo([1]);
    r.perfil.baseadoEm = [{ id: 1, titulo: 'Filme 1', ano: 1995, generos: ['Horror'] }];
    r.itens[0].filme = { ...r.itens[0].filme, generos: ['Horror'], ano: 1995 };
    montar({ fila: [r] });
    await screen.findByText('Filme 1', SEL);
    const stops = (svg) => [...svg.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'));
    const mini = document.querySelector('.baseado-em svg.cartaz');
    const grande = document.querySelector('li[data-filme-id="1"] svg.cartaz');
    expect(stops(mini)).toEqual(stops(grande));
    expect(stops(mini)[0]).toBe(paletaDoCartaz({ id: 1, generos: ['Horror'] }).c1);
    expect(stops(mini)[0]).not.toBe(paletaDoCartaz({ id: 1, generos: [] }).c1);
  });
});
