import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Moldura from './Moldura.jsx';

describe('Moldura', () => {
  test('o cabeçalho traz o nome "Minha Prateleira"', () => {
    render(<Moldura perfil={{ id: 'x', nome: 'Ana' }} onTrocarPerfil={() => {}}><p>conteúdo</p></Moldura>);
    expect(screen.getByRole('banner').textContent).toContain('Minha Prateleira');
    expect(screen.queryByText('Recomendação de filmes')).toBeNull();
  });
});
