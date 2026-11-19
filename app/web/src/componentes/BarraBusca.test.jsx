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
});
