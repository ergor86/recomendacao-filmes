import { describe, test, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Moldura from './Moldura.jsx';

const montar = (perfil, rota = '/') => render(
  <MemoryRouter initialEntries={[rota]}>
    <Moldura perfil={perfil} onTrocarPerfil={() => {}}><p>conteúdo</p></Moldura>
  </MemoryRouter>,
);

describe('Moldura', () => {
  test('o cabeçalho traz o nome "Minha Prateleira"', () => {
    montar({ id: 'x', nome: 'Ana' });
    expect(screen.getByRole('banner').textContent).toContain('Minha Prateleira');
    expect(screen.queryByText('Recomendação de filmes')).toBeNull();
  });

  test('com perfil, a navegação leva a Top 10, Catálogo, Minha lista, Minhas avaliações e Sobre', () => {
    montar({ id: 'x', nome: 'Ana' }, '/catalogo');
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Top 10', 'Catálogo', 'Minha lista', 'Minhas avaliações', 'Sobre']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/catalogo', '/minha-lista', '/minhas-avaliacoes', '/sobre']);
    expect(within(nav).getByRole('link', { name: 'Catálogo' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Top 10' }).getAttribute('aria-current')).toBeNull();
  });

  test('em telas estreitas a navegação é um menu que abre e fecha', () => {
    montar({ id: 'x', nome: 'Ana' });
    const botao = screen.getByRole('button', { name: 'Menu' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Sobre' }));
    expect(botao.getAttribute('aria-expanded')).toBe('false');
  });

  test('sem perfil não há navegação principal, e o rodapé mantém o link Sobre', () => {
    montar(null);
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
    const rodape = screen.getByRole('contentinfo');
    expect(rodape.textContent).toBe('Projeto acadêmico · dados MovieLens 100K (GroupLens) · Sobre');
    expect(within(rodape).getByRole('link', { name: 'Sobre' }).getAttribute('href')).toBe('/sobre');
  });

  test('a marca "Minha Prateleira" é um link para o início', () => {
    montar({ id: 'x', nome: 'Ana' }, '/sobre');
    expect(screen.getByRole('link', { name: 'Minha Prateleira' }).getAttribute('href')).toBe('/');
  });

  test('sem perfil a marca continua sendo um link para o início', () => {
    montar(null, '/sobre');
    expect(screen.getByRole('link', { name: 'Minha Prateleira' }).getAttribute('href')).toBe('/');
  });
});

describe('Moldura: monograma e cabeçalho do celular', () => {
  test('o monograma do perfil é decorativo e o nome continua em texto', () => {
    montar({ id: 'x', nome: 'Ana' });
    const topo = screen.getByRole('banner');
    const monogramas = topo.querySelectorAll('svg.monograma');
    expect(monogramas.length).toBeGreaterThan(0);
    for (const m of monogramas) {
      expect(m.getAttribute('aria-hidden')).toBe('true');
      expect(m.querySelector('text').textContent).toBe('A');
    }
    expect(topo.querySelector('.moldura-perfil').textContent).toContain('Perfil: Ana');
  });

  test('o botão Menu continua com o nome acessível "Menu" (monograma decorativo dentro dele)', () => {
    montar({ id: 'x', nome: 'Ana' });
    const botao = screen.getByRole('button', { name: 'Menu' });
    expect(botao.querySelector('svg.monograma')).not.toBeNull();
  });

  test('a navegação e o perfil ficam num painel recolhível único, controlado pelo botão Menu', () => {
    montar({ id: 'x', nome: 'Ana' });
    const botao = screen.getByRole('button', { name: 'Menu' });
    const painel = document.getElementById(botao.getAttribute('aria-controls'));
    expect(painel.classList.contains('menu-painel')).toBe(true);
    expect(painel.classList.contains('aberta')).toBe(false);
    expect(painel.contains(screen.getByRole('navigation', { name: 'Principal' }))).toBe(true);
    expect(painel.contains(screen.getByRole('button', { name: 'Trocar de perfil' }))).toBe(true);
    fireEvent.click(botao);
    expect(painel.classList.contains('aberta')).toBe(true);
  });

  test('sem perfil não há botão Menu nem monograma', () => {
    montar(null);
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    expect(document.querySelector('svg.monograma')).toBeNull();
  });
});
