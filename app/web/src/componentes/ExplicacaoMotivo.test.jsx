import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExplicacaoMotivo from './ExplicacaoMotivo.jsx';

const TEXTOS = {
  personalizado: 'Filmes curtidos por pessoas que curtiram os mesmos filmes que você.',
  parcial: 'Encontramos menos de 10 filmes parecidos com seus gostos; completamos com os mais avaliados nos dados de 1998.',
  sem_semelhantes: 'Não encontramos filmes parecidos que você ainda não tenha marcado; mostramos os mais avaliados.',
  sem_curtidas: "Você ainda não marcou filmes de que gostou. Enquanto isso, mostramos os mais avaliados. Marque alguns como 'Gostei' ou dê 4–5 estrelas.",
  curtidas_sem_vetor: 'Os filmes que você curtiu são raros nos dados de 1998. Experimente curtir títulos mais conhecidos.',
};

describe('ExplicacaoMotivo', () => {
  test.each(Object.entries(TEXTOS))('motivo %s: texto literal da spec 7', (motivo, texto) => {
    const { container } = render(<ExplicacaoMotivo motivo={motivo} />);
    expect(container.textContent).toBe(texto);
  });

  test('são exatamente 5 textos, todos diferentes', () => {
    expect(new Set(Object.values(TEXTOS)).size).toBe(5);
  });

  test('motivo desconhecido não mostra nada', () => {
    const { container } = render(<ExplicacaoMotivo motivo="outro" />);
    expect(container.textContent).toBe('');
    expect(screen.queryByText(/./)).toBeNull();
  });
});
