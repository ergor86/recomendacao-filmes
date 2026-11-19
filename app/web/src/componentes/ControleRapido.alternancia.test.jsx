import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ControleRapido from './ControleRapido.jsx';
import ControleInteracao from './ControleInteracao.jsx';
import { ProvedorAviso } from './AvisoAcao.jsx';
import { simularFetch, filmeExemplo } from '../apoio-testes.js';

const PERFIL = '11111111-1111-4111-8111-111111111111';
const URL_INT = `/api/perfis/${PERFIL}/interacoes/1`;
const efeitos = { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true };
const rotas = [
  ['PUT', URL_INT, { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos }],
  ['DELETE', URL_INT, { anterior: { tipo: 'gostei', nota: null }, efeitos }],
];

describe('alternância decide pelo estado mais recente, não pela prop', () => {
  test('ControleRapido: dois cliques rápidos em Gostei enviam PUT e DELETE', async () => {
    const { chamadas } = simularFetch(rotas);
    render(<ProvedorAviso><ControleRapido perfilId={PERFIL} filme={filmeExemplo()} estado={null} aoMudar={() => {}} /></ProvedorAviso>);
    const botao = screen.getByRole('button', { name: 'Gostei' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas).toHaveLength(2));
    expect(chamadas.map((c) => c.metodo)).toEqual(['PUT', 'DELETE']);
  });

  test('ControleInteracao: dois cliques rápidos em Gostei e na mesma estrela enviam PUT e DELETE', async () => {
    const { chamadas } = simularFetch(rotas);
    render(<ProvedorAviso><ControleInteracao perfilId={PERFIL} filme={filmeExemplo()} estado={null} aoMudar={() => {}} /></ProvedorAviso>);
    const botao = screen.getByRole('button', { name: 'Gostei' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas).toHaveLength(2));
    expect(chamadas.map((c) => c.metodo)).toEqual(['PUT', 'DELETE']);
    const estrela = screen.getByRole('radio', { name: '4 de 5 estrelas' });
    fireEvent.click(estrela);
    fireEvent.click(estrela);
    await waitFor(() => expect(chamadas).toHaveLength(4));
    expect(chamadas.slice(2).map((c) => c.metodo)).toEqual(['PUT', 'DELETE']);
  });
});
