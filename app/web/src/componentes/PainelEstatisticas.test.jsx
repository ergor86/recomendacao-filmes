import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PainelEstatisticas from './PainelEstatisticas.jsx';

const base = {
  movielens: { nNotas: 452, media: 3.88, pctAprovacao: 71.2, poucasNotas: false },
  computador: { nNotas: 0, media: null, poucasNotas: true },
  sua: null,
};
const detalhesDoComputador = (container) => [...container.querySelectorAll('details')].find((d) => d.textContent.includes('Neste computador'));

describe('PainelEstatisticas', () => {
  test('poucas notas em cinza e Neste computador recolhido abaixo de 5', () => {
    const { container } = render(<PainelEstatisticas estatisticas={{
      ...base,
      movielens: { nNotas: 3, media: null, pctAprovacao: null, poucasNotas: true },
    }} />);
    const rotulos = screen.getAllByText('poucas notas ainda');
    expect(rotulos.length).toBeGreaterThanOrEqual(2);
    for (const r of rotulos) expect(r.className).toContain('poucas-notas');
    expect(detalhesDoComputador(container).open).toBe(false);
  });

  test('três seções separadas com os rótulos da spec', () => {
    const { container } = render(<PainelEstatisticas estatisticas={{
      movielens: base.movielens,
      computador: { nNotas: 6, media: 4.1, poucasNotas: false },
      sua: { tipo: 'nota', nota: 5 },
    }} />);
    expect(screen.getByText('MovieLens (1997–98, 943 pessoas)')).toBeTruthy();
    expect(screen.getByText('3,88')).toBeTruthy();
    expect(screen.getByText('452')).toBeTruthy();
    expect(screen.getByText(/% de notas 4–5/)).toBeTruthy();
    expect(screen.getByText('Sua nota')).toBeTruthy();
    expect(detalhesDoComputador(container).open).toBe(true);
    expect(container.querySelectorAll('section').length).toBe(3);
  });

  test('gêmeo oculto mostra a nota do canônico', () => {
    render(<PainelEstatisticas estatisticas={base} temGemeoOculto />);
    expect(screen.getByText('O MovieLens tem dois registros deste filme; usamos este.')).toBeTruthy();
  });
});
