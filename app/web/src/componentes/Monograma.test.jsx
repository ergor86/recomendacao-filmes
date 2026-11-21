import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import Monograma, { corDoMonograma, inicialDoApelido } from './Monograma.jsx';
import { contrasteWcag } from './Cartaz.jsx';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const uuid = (n) => `${String(n).padStart(8, '0')}-1111-4222-8333-${String(n * 7919).padStart(12, '0')}`;

describe('Monograma', () => {
  test('mostra a inicial do apelido em maiúscula e é decorativo (aria-hidden)', () => {
    const { container } = render(<Monograma perfil={{ id: uuid(1), nome: 'ana' }} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.querySelector('text').textContent).toBe('A');
    expect(svg.getAttribute('class')).toContain('monograma');
  });

  test('a inicial ignora espaços, respeita acentos e tem substituto', () => {
    expect(inicialDoApelido('  éder')).toBe('É');
    expect(inicialDoApelido('42 filmes')).toBe('4');
    expect(inicialDoApelido('')).toBe('?');
    expect(inicialDoApelido(undefined)).toBe('?');
    expect(inicialDoApelido('…')).toBe('?');
  });

  test('a cor é determinística pelo id (mesmo id, mesmo SVG; ids diferentes variam)', () => {
    const a = render(<Monograma perfil={{ id: uuid(5), nome: 'Ana' }} />).container.innerHTML.replace(/mono-[^"')]+/g, '');
    const b = render(<Monograma perfil={{ id: uuid(5), nome: 'Ana' }} />).container.innerHTML.replace(/mono-[^"')]+/g, '');
    expect(a).toBe(b);
    const cores = new Set(Array.from({ length: 40 }, (_, i) => corDoMonograma(uuid(i + 1)).c1));
    expect(cores.size).toBeGreaterThan(8);
  });

  test('a letra tem contraste ≥ 4,5 com os dois tons do quadro para 300 ids', () => {
    for (let i = 1; i <= 300; i++) {
      const c = corDoMonograma(uuid(i));
      expect(contrasteWcag(rgb(c.texto), rgb(c.c1))).toBeGreaterThanOrEqual(4.5);
      expect(contrasteWcag(rgb(c.texto), rgb(c.c2))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
