import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Cartaz, { paletaDoCartaz, hashFnv1a } from './Cartaz.jsx';

const filme = (id, extra = {}) => ({
  id,
  titulo: `Filme número ${id} com um título bem comprido para quebrar em várias linhas`,
  ano: 1990 + (id % 9),
  generos: ['Drama'],
  ...extra,
});

describe('Cartaz', () => {
  test('FNV-1a de 32 bits (vetores conhecidos)', () => {
    expect(hashFnv1a('')).toBe(0x811c9dc5);
    expect(hashFnv1a('a')).toBe(0xe40c292c);
    expect(hashFnv1a('foobar')).toBe(0xbf9cf968);
  });

  test('mesmo id → mesmo SVG; contraste ≥ 4,5 para 50 ids', () => {
    const a = render(<Cartaz filme={filme(7)} tamanho="medio" />);
    const b = render(<Cartaz filme={filme(7)} tamanho="medio" />);
    expect(a.container.innerHTML).toBe(b.container.innerHTML);
    const c = render(<Cartaz filme={filme(8)} tamanho="medio" />);
    expect(c.container.innerHTML).not.toBe(a.container.innerHTML);
    const generos = [['Action'], ['Comedy'], ['Horror'], ['Drama', 'Romance'], ['unknown'], [], ['Documentary'], ['Film-Noir']];
    for (let id = 1; id <= 50; id++) {
      const p = paletaDoCartaz(filme(id, { generos: generos[id % generos.length] }));
      expect(p.contraste).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('role=img com aria-label e até 3 linhas de título', () => {
    render(<Cartaz filme={filme(3)} tamanho="grande" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe(`Cartaz: ${filme(3).titulo} (1993)`);
    expect(img.querySelectorAll('text.cartaz-titulo tspan').length).toBeLessThanOrEqual(3);
    expect(img.querySelector('text.cartaz-titulo').textContent).toContain('…');
  });

  test('onerror cai no SVG', () => {
    const { container } = render(
      <Cartaz filme={filme(5)} tamanho="pequeno" midia={{ cartaz: { tipo: 'externo', url: 'https://exemplo.invalido/c.jpg', largura: 200, altura: 300 } }} />,
    );
    const img = container.querySelector('img');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[role="img"]')).toBeTruthy();
  });
});
