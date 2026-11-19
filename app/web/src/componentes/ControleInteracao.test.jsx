import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ControleInteracao, { fraseEfeitos } from './ControleInteracao.jsx';
import { ProvedorAviso } from './AvisoAcao.jsx';
import { simularFetch, filmeExemplo, cabecalho } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const ef = (contribuiParaPerfil, perfilMudou) => ({ contribuiParaPerfil, excluidoDasRecomendacoes: true, perfilMudou });

describe('fraseEfeitos (frases literais da spec 7)', () => {
  test('perfilMudou e contribuiParaPerfil', () => {
    expect(fraseEfeitos({ efeitos: ef(true, true), tipo: 'gostei', nota: null, temVetor: true, operacao: 'put' }))
      .toBe('Este filme agora conta para as suas recomendações.');
  });
  test('perfilMudou sem contribuiParaPerfil (PUT)', () => {
    expect(fraseEfeitos({ efeitos: ef(false, true), tipo: 'nota', nota: 2, temVetor: true, operacao: 'put' }))
      .toBe('Este filme deixou de contar para as suas recomendações e não aparece nelas enquanto estiver marcado.');
  });
  test('nota 1-3 sem mudança de perfil', () => {
    expect(fraseEfeitos({ efeitos: ef(false, false), tipo: 'nota', nota: 3, temVetor: true, operacao: 'put' }))
      .toBe('Notas 1–3 tiram este filme das recomendações, mas ainda não afastam filmes parecidos.');
  });
  test('filme sem vetor com Gostei ou nota 4-5', () => {
    const esperado = 'Este filme é raro nos dados de 1998 e não entra no cálculo dos seus gostos.';
    expect(fraseEfeitos({ efeitos: ef(false, false), tipo: 'gostei', nota: null, temVetor: false, operacao: 'put' })).toBe(esperado);
    expect(fraseEfeitos({ efeitos: ef(false, false), tipo: 'nota', nota: 5, temVetor: false, operacao: 'put' })).toBe(esperado);
  });
  test('Quero assistir', () => {
    expect(fraseEfeitos({ efeitos: ef(false, false), tipo: 'quero_assistir', nota: null, temVetor: true, operacao: 'put' }))
      .toBe('Ele não aparece nas recomendações enquanto estiver na Minha lista.');
  });
  test('DELETE, com e sem perfilMudou', () => {
    const base = { tipo: null, nota: null, temVetor: true, operacao: 'delete' };
    expect(fraseEfeitos({ ...base, efeitos: ef(false, false) })).toBe('Este filme pode voltar a aparecer nas recomendações.');
    expect(fraseEfeitos({ ...base, efeitos: ef(false, true) }))
      .toBe('Ele deixou de contar para os seus gostos. Este filme pode voltar a aparecer nas recomendações.');
  });
});

function montar({ estado = null, rotas = [], aoMudar = () => {}, filme = filmeExemplo() } = {}) {
  const sim = simularFetch(rotas);
  render(
    <ProvedorAviso>
      <ControleInteracao perfilId={PERFIL} filme={filme} estado={estado} aoMudar={aoMudar} />
    </ProvedorAviso>,
  );
  return sim;
}
const URL_INT = `/api/perfis/${PERFIL}/interacoes/1`;
const resp = (anterior, efeitos) => ({ interacao: {}, anterior, filme: { temVetor: true }, efeitos });

describe('ControleInteracao', () => {
  test('texto fixo literal', () => {
    montar();
    expect(document.body.textContent).toContain(
      "Gostei e notas 4–5 entram no cálculo dos seus gostos. Qualquer marcação, inclusive notas 1–3 e 'Quero assistir', tira o filme das suas recomendações. Notas 1–3 ainda não afastam filmes parecidos.",
    );
  });

  test('estrelas: setas do teclado mudam a seleção e clicar na atual remove', async () => {
    let estado = null;
    const { chamadas } = montar({
      aoMudar: (novo) => { estado = novo; },
      rotas: [
        ['PUT', URL_INT, (init) => resp(null, ef(JSON.parse(init.body).nota >= 4, JSON.parse(init.body).nota >= 4))],
      ],
    });
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    const estrelas = screen.getAllByRole('radio');
    expect(estrelas).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 de 5 estrelas' })).toBeTruthy();
    estrelas[0].focus();
    fireEvent.keyDown(estrelas[0], { key: 'ArrowRight' });
    await waitFor(() => expect(estado).toEqual({ tipo: 'nota', nota: 2 }));
    expect(document.activeElement).toBe(estrelas[1]);
    const put = chamadas.find((c) => c.metodo === 'PUT');
    expect(JSON.parse(put.init.body)).toEqual({ tipo: 'nota', nota: 2 });
    expect(cabecalho(put.init, 'Content-Type')).toBe('application/json');
    fireEvent.keyDown(estrelas[1], { key: 'ArrowRight' });
    await waitFor(() => expect(estado).toEqual({ tipo: 'nota', nota: 3 }));
    fireEvent.keyDown(estrelas[2], { key: 'ArrowLeft' });
    await waitFor(() => expect(estado).toEqual({ tipo: 'nota', nota: 2 }));
  });

  test('clicar na estrela atual remove a nota (DELETE sem corpo e sem cabeçalho)', async () => {
    let estado = { tipo: 'nota', nota: 4 };
    const { chamadas } = montar({
      estado,
      aoMudar: (n) => { estado = n; },
      rotas: [['DELETE', URL_INT, { anterior: { tipo: 'nota', nota: 4 }, efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: true } }]],
    });
    const atual = screen.getByRole('radio', { name: '4 de 5 estrelas' });
    expect(atual.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(atual);
    await waitFor(() => expect(estado).toBeNull());
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'Content-Type')).toBeUndefined();
    expect(await screen.findByText(/Ele deixou de contar para os seus gostos\. Este filme pode voltar a aparecer nas recomendações\./)).toBeTruthy();
  });

  test('Gostei mostra Salvo, a substituição e a frase, e Desfazer reaplica o anterior', async () => {
    const { chamadas } = montar({
      estado: { tipo: 'nota', nota: 2 },
      rotas: [['PUT', URL_INT, (init) => (JSON.parse(init.body).tipo === 'gostei'
        ? resp({ tipo: 'nota', nota: 2 }, ef(true, true))
        : resp({ tipo: 'gostei', nota: null }, ef(false, true)))]],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gostei' }));
    expect(await screen.findByText(/Salvo/)).toBeTruthy();
    expect(screen.getByText(/Sua nota 2 foi substituída por Gostei/)).toBeTruthy();
    expect(screen.getByText(/Este filme agora conta para as suas recomendações\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(2));
    expect(JSON.parse(chamadas.filter((c) => c.metodo === 'PUT')[1].init.body)).toEqual({ tipo: 'nota', nota: 2 });
  });

  test('Remover fica desabilitado sem estado', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Remover' }).disabled).toBe(true);
  });
});

describe('ControleInteracao: falha de rede numa escrita (spec 7)', () => {
  test('mostra a frase e o botão "Tentar de novo", que repete a escrita', async () => {
    let falhar = true;
    const { chamadas } = montar({
      rotas: [['PUT', URL_INT, () => {
        if (falhar) throw new TypeError('Failed to fetch');
        return resp(null, ef(true, true));
      }]],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gostei' }));
    expect(await screen.findByText('Não consegui falar com o servidor local. Ele está rodando?')).toBeTruthy();
    const tentar = screen.getByRole('button', { name: 'Tentar de novo' });
    falhar = false;
    fireEvent.click(tentar);
    expect(await screen.findByText(/Salvo/)).toBeTruthy();
    expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(2);
    expect(JSON.parse(chamadas.filter((c) => c.metodo === 'PUT')[1].init.body)).toEqual({ tipo: 'gostei' });
  });

  test('um erro da API (não de rede) não oferece "Tentar de novo"', async () => {
    montar({ rotas: [['PUT', URL_INT, () => new Response(JSON.stringify({ codigo: 'VALIDACAO', mensagem: 'Pedido inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })]] });
    fireEvent.click(screen.getByRole('button', { name: 'Gostei' }));
    expect(await screen.findByText('Pedido inválido.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });
});
