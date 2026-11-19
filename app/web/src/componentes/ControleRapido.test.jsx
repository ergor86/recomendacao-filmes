import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ControleRapido from './ControleRapido.jsx';
import { ProvedorAviso } from './AvisoAcao.jsx';
import { simularFetch, filmeExemplo, cabecalho } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const URL_INT = `/api/perfis/${PERFIL}/interacoes/1`;
const efeitos = { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true };

function montar(estado, rotas, aoMudar = () => {}) {
  const sim = simularFetch(rotas);
  render(
    <ProvedorAviso>
      <ControleRapido perfilId={PERFIL} filme={filmeExemplo()} estado={estado} aoMudar={aoMudar} />
    </ProvedorAviso>,
  );
  return sim;
}

describe('ControleRapido', () => {
  test('Gostei marca com PUT e JSON', async () => {
    let novo;
    const { chamadas } = montar(null, [['PUT', URL_INT, { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos }]], (e) => { novo = e; });
    const botao = screen.getByRole('button', { name: 'Gostei' });
    expect(botao.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(botao);
    await waitFor(() => expect(novo).toEqual({ tipo: 'gostei', nota: null }));
    expect(chamadas[0].init.body).toBe(JSON.stringify({ tipo: 'gostei' }));
    expect(cabecalho(chamadas[0].init, 'Content-Type')).toBe('application/json');
  });

  test('Gostei já marcado remove com DELETE sem corpo e sem Content-Type', async () => {
    let novo;
    const { chamadas } = montar({ tipo: 'gostei', nota: null }, [['DELETE', URL_INT, { anterior: { tipo: 'gostei', nota: null }, efeitos: { ...efeitos, contribuiParaPerfil: false } }]], (e) => { novo = e; });
    const botao = screen.getByRole('button', { name: 'Gostei' });
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(botao);
    await waitFor(() => expect(novo).toBeNull());
    expect(chamadas[0].init.body).toBeUndefined();
    expect(cabecalho(chamadas[0].init, 'Content-Type')).toBeUndefined();
  });

  test('menu "…" tem Quero assistir e Dar nota', async () => {
    let novo;
    const { chamadas } = montar(null, [['PUT', URL_INT, { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos: { ...efeitos, contribuiParaPerfil: false } }]], (e) => { novo = e; });
    const menu = screen.getByRole('button', { name: /Mais ações/ });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Dar nota' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quero assistir' }));
    await waitFor(() => expect(novo).toEqual({ tipo: 'quero_assistir', nota: null }));
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ tipo: 'quero_assistir' });
  });

  test('Dar nota mostra as estrelas', () => {
    montar(null, []);
    fireEvent.click(screen.getByRole('button', { name: /Mais ações/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar nota' }));
    expect(screen.getByRole('radiogroup')).toBeTruthy();
  });
});
