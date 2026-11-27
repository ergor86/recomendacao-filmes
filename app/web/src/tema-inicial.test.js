import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAVE_TEMA, TEMAS } from './tema.js';

const fonte = readFileSync(resolve(process.cwd(), 'public/tema-inicial.js'), 'utf8');
const rodar = (localStorage) => {
  const attrs = {};
  const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } } };
  new Function('localStorage', 'document', fonte)(localStorage, document);
  return attrs;
};
const com = (valor) => ({ getItem: (k) => (k === CHAVE_TEMA ? valor : null) });

describe('tema-inicial.js (script clássico do <head>)', () => {
  test('claro e escuro viram data-tema', () => {
    expect(rodar(com('claro'))).toEqual({ 'data-tema': 'claro' });
    expect(rodar(com('escuro'))).toEqual({ 'data-tema': 'escuro' });
  });
  test('auto, ausente e inválido não põem nada', () => {
    for (const v of ['auto', null, 'roxo', '']) expect(rodar(com(v))).toEqual({});
  });
  test('localStorage que lança não quebra', () => {
    expect(rodar({ getItem: () => { throw new Error('bloqueado'); } })).toEqual({});
  });
  test('usa a mesma chave e os mesmos valores de tema.js, e é um script clássico', () => {
    expect(fonte).toContain(`'${CHAVE_TEMA}'`);
    for (const t of TEMAS.filter((x) => x !== 'auto')) expect(fonte).toContain(`'${t}'`);
    expect(fonte).not.toMatch(/^\s*(import|export)\s/m);
  });
  test('index.html carrega o script do <head>, antes do módulo, sem async/defer nem inline', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const i = html.indexOf('<script src="/tema-inicial.js"></script>');
    expect(i).toBeGreaterThan(html.indexOf('<head>'));
    expect(i).toBeLessThan(html.indexOf('</head>'));
    expect(i).toBeLessThan(html.indexOf('type="module"'));
  });
});
