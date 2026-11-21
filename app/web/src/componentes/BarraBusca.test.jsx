import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarraBusca from './BarraBusca.jsx';
import { simularFetch } from '../apoio-testes.js';

describe('BarraBusca', () => {
  test('o campo de busca limita o texto a 100 caracteres (o servidor recusa mais com 400)', () => {
    simularFetch([['GET', '/api/generos', []]]);
    render(<BarraBusca valor={{}} aoMudar={() => {}} />);
    expect(screen.getByLabelText('Buscar por título').getAttribute('maxlength')).toBe('100');
  });

  test('as opções de ordem dizem o critério: Mais notas e Maior média', () => {
    simularFetch([['GET', '/api/generos', []]]);
    render(<BarraBusca valor={{}} aoMudar={() => {}} />);
    const opcoes = [...screen.getByLabelText('Ordem').querySelectorAll('option')].map((o) => [o.value, o.textContent]);
    expect(opcoes).toEqual([
      ['mais_avaliados', 'Mais notas'],
      ['mais_bem_avaliados', 'Maior média'],
      ['titulo', 'Título'],
      ['ano', 'Ano (mais recentes)'],
    ]);
  });
});
