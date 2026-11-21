import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CartaoFilme from './CartaoFilme.jsx';
import { filmeExemplo } from '../apoio-testes.js';

const ver = (f) => render(<MemoryRouter><CartaoFilme filme={f} /></MemoryRouter>);

describe('CartaoFilme', () => {
  test('selo "curtir não personaliza" quando não há vetor', () => {
    ver(filmeExemplo({ temVetor: false }));
    expect(screen.getByText('curtir não personaliza')).toBeTruthy();
  });
  test('sem selo quando há vetor; título em inglês com link para o detalhe', () => {
    ver(filmeExemplo());
    expect(screen.queryByText('curtir não personaliza')).toBeNull();
    const link = screen.getByRole('link', { name: /Toy Story/ });
    expect(link.getAttribute('href')).toBe('/filmes/1');
    expect(screen.getByText('Toy Story', { selector: '[lang="en"]' })).toBeTruthy();
  });
});
