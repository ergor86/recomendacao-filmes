import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SeletorTema from './SeletorTema.jsx';
import Moldura from './Moldura.jsx';
import { CHAVE_TEMA } from '../tema.js';

afterEach(() => document.documentElement.removeAttribute('data-tema'));
const botao = () => screen.getByRole('button', { name: /^Tema: / });
const icone = () => botao().querySelector('svg').getAttribute('data-icone');

describe('botão de tema', () => {
  test('por padrão "Tema: Automático", com title igual, sem aria-pressed e ícone oculto', () => {
    render(<SeletorTema />);
    const b = screen.getByRole('button', { name: 'Tema: Automático' });
    expect(b.getAttribute('title')).toBe('Tema: Automático');
    expect(b.hasAttribute('aria-pressed')).toBe(false);
    expect(b.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(icone()).toBe('auto');
  });
  test('começa pelo valor salvo', () => {
    window.localStorage.setItem(CHAVE_TEMA, 'escuro');
    render(<SeletorTema />);
    expect(botao().getAttribute('aria-label')).toBe('Tema: Escuro');
    expect(icone()).toBe('escuro');
  });
  test('três cliques percorrem Claro, Escuro e Automático, aplicando, salvando e mantendo o foco', () => {
    render(<SeletorTema />);
    const b = botao();
    b.focus();
    const passos = [['Claro', 'claro', 'claro'], ['Escuro', 'escuro', 'escuro'], ['Automático', null, 'auto']];
    for (const [nome, attr, ic] of passos) {
      fireEvent.click(b);
      expect(botao().getAttribute('aria-label')).toBe(`Tema: ${nome}`);
      expect(botao().getAttribute('title')).toBe(`Tema: ${nome}`);
      expect(document.documentElement.getAttribute('data-tema')).toBe(attr);
      expect(window.localStorage.getItem(CHAVE_TEMA)).toBe(ic);
      expect(icone()).toBe(ic);
      expect(document.activeElement).toBe(b);
    }
  });
  test.each([[{ id: 'x', nome: 'Ana' }], [null]])('aparece no cabeçalho, fora do painel do menu (perfil %#)', (perfil) => {
    render(<MemoryRouter><Moldura perfil={perfil} onTrocarPerfil={() => {}}><p>x</p></Moldura></MemoryRouter>);
    const b = screen.getByRole('button', { name: 'Tema: Automático' });
    expect(screen.getByRole('banner').contains(b)).toBe(true);
    expect(b.closest('.menu-painel')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  test('outra aba que muda o tema atualiza o botão e o data-tema (evento storage)', () => {
    render(<SeletorTema />);
    window.localStorage.setItem(CHAVE_TEMA, 'escuro');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_TEMA, newValue: 'escuro' })); });
    expect(botao().getAttribute('aria-label')).toBe('Tema: Escuro');
    expect(document.documentElement.getAttribute('data-tema')).toBe('escuro');
    window.localStorage.removeItem(CHAVE_TEMA);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_TEMA, newValue: null })); });
    expect(botao().getAttribute('aria-label')).toBe('Tema: Automático');
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false);
  });
});
