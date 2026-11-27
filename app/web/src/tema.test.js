import { describe, test, expect, vi } from 'vitest';
import { lerTema, aplicarTema, salvarTema, CHAVE_TEMA } from './tema.js';

describe('tema.js', () => {
  test('a chave é minha-prateleira:tema', () => {
    expect(CHAVE_TEMA).toBe('minha-prateleira:tema');
  });
  test('sem valor salvo, o tema é auto', () => {
    expect(lerTema()).toBe('auto');
  });
  test('valor inválido salvo vira auto', () => {
    window.localStorage.setItem(CHAVE_TEMA, 'roxo');
    expect(lerTema()).toBe('auto');
  });
  test('localStorage que lança não quebra a leitura nem a escrita', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(lerTema()).toBe('auto');
    expect(() => salvarTema('escuro')).not.toThrow();
  });
  test('aplicarTema põe, troca e remove data-tema no <html>', () => {
    aplicarTema('escuro');
    expect(document.documentElement.getAttribute('data-tema')).toBe('escuro');
    aplicarTema('claro');
    expect(document.documentElement.getAttribute('data-tema')).toBe('claro');
    aplicarTema('auto');
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false);
  });
  test('salvar e ler de volta', () => {
    for (const t of ['claro', 'escuro', 'auto']) {
      salvarTema(t);
      expect(lerTema()).toBe(t);
    }
  });
  test('salvar valor inválido não grava', () => {
    salvarTema('escuro');
    salvarTema('xyz');
    expect(lerTema()).toBe('escuro');
  });
});
