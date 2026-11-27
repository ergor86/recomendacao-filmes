import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import Cartaz, { paletaDoCartaz, padraoDoCartaz, tomDoGenero, FAMILIAS } from './componentes/Cartaz.jsx';

const css = readFileSync(resolve(process.cwd(), 'src/estilos.css'), 'utf8');
const bloco = (inicio) => {
  const i = css.indexOf(inicio);
  expect(i, inicio).toBeGreaterThanOrEqual(0);
  let nivel = 0;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') nivel++;
    if (css[j] === '}' && --nivel === 0) return css.slice(i, j + 1);
  }
  return '';
};
const claro = css.slice(css.indexOf(':root'), css.indexOf('@media (prefers-color-scheme: dark)'));
const escuro = bloco('@media (prefers-color-scheme: dark)');

describe('tokens da identidade (PROPOSTA §2)', () => {
  test('claro', () => {
    for (const t of ['--papel: #f6f5f9', '--ficha: #ffffff', '--tinta: #1e1b2e', '--grafite: #575270', '--carimbo: #5a2fc2',
      '--sobre-carimbo: #ffffff', '--carimbo-veu: #ece6fb', '--perigo: #b3122e', '--contorno: #7e7896', '--prateleira: #2a2540', '--risco: #dcd8e6']) {
      expect(claro.toLowerCase()).toContain(t);
    }
  });
  test('escuro, com a borda da prateleira #6B6390', () => {
    for (const t of ['--papel: #17151f', '--ficha: #221f2e', '--tinta: #eeecf5', '--grafite: #b5afc9', '--carimbo: #b9a5ff',
      '--sobre-carimbo: #17151f', '--carimbo-veu: #2f2752', '--perigo: #ff8fa0', '--contorno: #8a83a3', '--prateleira: #3e3856', '--risco: #35304a']) {
      expect(escuro.toLowerCase()).toContain(t);
    }
    expect(escuro.toLowerCase()).toContain('--prateleira-luz: #6b6390');
  });
});

describe('fontes locais', () => {
  test('@font-face com URL local, font-display swap e sem CDN', () => {
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBe(3);
    for (const f of faces) {
      expect(f).toMatch(/url\('\/fontes\/[\w-]+\.woff2'\)/);
      expect(f).toContain('font-display: swap');
    }
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toContain("'Bahnschrift', 'Arial Narrow'");
  });
  test('arquivos e OFL.txt em public/fontes (vão para o build)', () => {
    for (const a of ['Archivo-Regular.woff2', 'Archivo-SemiBold.woff2', 'ArchivoCondensed-ExtraBold.woff2', 'OFL.txt']) {
      expect(existsSync(resolve(process.cwd(), 'public/fontes', a)), a).toBe(true);
    }
  });
});

describe('movimento', () => {
  test('o pouso do carimbo existe e reduced-motion o desliga', () => {
    expect(css).toMatch(/\.carimbo-gostei\s*\{[^}]*animation:\s*carimbar 160ms/);
    expect(bloco('@media (prefers-reduced-motion: reduce)')).toMatch(/\.carimbo-gostei[^}]*animation:\s*none/);
  });
  test('sem estilos inline nos cartazes', () => {
    const { container } = render(<Cartaz filme={{ id: 1, titulo: 'A', ano: 1990, generos: ['Drama'] }} />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('Cartaz da identidade', () => {
  const GENEROS = Object.keys(FAMILIAS);
  const f = (id, g) => ({ id, titulo: `Filme ${id}`, ano: 1990, generos: [g] });
  test('19 gêneros × 30 filmes: contraste ≥ 4,5, tom e padrão determinísticos', () => {
    expect(GENEROS.length).toBe(19);
    for (const g of GENEROS) {
      for (let id = 1; id <= 30; id++) {
        const p = paletaDoCartaz(f(id, g));
        expect(p.contraste, `${g} ${id}`).toBeGreaterThanOrEqual(4.5);
        expect(paletaDoCartaz(f(id, g))).toEqual(p);
        const pad = padraoDoCartaz(f(id, g));
        expect(pad).toBe(padraoDoCartaz(f(id, g)));
        expect([0, 1, 2, 3, 4]).toContain(pad);
        const claroTom = tomDoGenero(g).luz >= 0.55;
        expect(p.texto, `${g} ${id}`).toBe(claroTom ? '#1a1625' : '#ffffff');
      }
    }
  });
  test('os 5 padrões aparecem e drama é verde-petróleo', () => {
    const usados = new Set();
    for (let id = 1; id <= 60; id++) usados.add(padraoDoCartaz(f(id, 'drama')));
    expect(usados.size).toBe(5);
    expect(FAMILIAS.drama).toBe(172);
  });
  test('moldura de capa de fita, título por classe e ancorado na base', () => {
    const { container } = render(<Cartaz filme={{ id: 9, titulo: 'The Usual Suspects', ano: 1995, generos: ['Crime'] }} tamanho="grande" />);
    expect(container.querySelector('rect.cartaz-moldura')).toBeTruthy();
    const linhas = container.querySelectorAll('text.cartaz-titulo tspan');
    expect(container.querySelector('text.cartaz-titulo').getAttribute('font-family')).toBeNull();
    expect(container.querySelector('text.cartaz-ano').textContent).toBe('1995');
    expect(linhas.length).toBeGreaterThan(0);
  });
});

describe('carimbo e layout', () => {
  test('CSS da estante, menu e alvos', () => {
    expect(css).toContain('.estante');
    expect(css).toMatch(/\.cartao-titulo::before/);
    expect(css).toMatch(/@media \(max-width: 760px\)/);
    expect(css).toMatch(/repeat\(6,/);
    expect(css).toMatch(/repeat\(2,/);
  });
});

describe('correção 1: breakpoint único, alvos e Top 10', () => {
  test('um só ponto de quebra de celular (760 px) em todo o CSS', () => {
    const larguras = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]);
    expect(larguras).not.toContain('639');
    expect(new Set(larguras.filter((l) => Number(l) < 1000))).toEqual(new Set(['760']));
  });
  test('área clicável de 44 px na dica e no link do rodapé', () => {
    expect(css).toMatch(/\.dica::after\s*\{[^}]*inset:\s*-10px/);
    expect(css).toMatch(/\.moldura-rodape a\s*\{[^}]*min-height:\s*44px/);
  });
  test('busca sem largura mínima fixa que estoure a tela', () => {
    expect(css).not.toMatch(/\.barra-busca\s*\{[^}]*minmax\(2\d\dpx/);
  });
  test('Top 10: numeral por contador, alinhado ao topo, texto compacto ao lado da capa', () => {
    expect(css).toMatch(/\.item-recomendacao::before\s*\{[^}]*counter\(posicao\)/);
    expect(css).toMatch(/\.item-recomendacao\s*\{[^}]*align-items:\s*start/);
    expect(css).toMatch(/\.item-recomendacao \.cartao-capa\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.item-recomendacao \.controle-rapido \.gostei\s*\{[^}]*flex:\s*0 0 auto/);
  });
});

test('estrelas quebram linha em vez de estourar o cartão estreito', () => {
  expect(css).toMatch(/\.estrelas\s*\{[^}]*flex-wrap:\s*wrap/);
});

describe('símbolos gerados por CSS não entram no nome acessível', () => {
  test("todo `content` com símbolo literal (✓, ⊘, ✦) traz o texto alternativo vazio: content: '…' / ''", () => {
    const literais = [...css.matchAll(/content:\s*('[^']+')(\s*\/\s*'')?\s*;/g)];
    expect(literais.length).toBeGreaterThanOrEqual(3);
    const semAlternativo = literais.filter((m) => !m[2]).map((m) => m[0]);
    expect(semAlternativo).toEqual([]);
  });
});

describe('seletor de tema (decisão do usuário, 2026-11-25)', () => {
  test('o escuro do sistema só vale fora do tema Claro forçado', () => {
    expect(escuro).toContain(':root:not([data-tema="claro"])');
    expect(escuro).not.toMatch(/(^|\n)\s*:root\s*\{/);
  });
  test('o tema Escuro forçado tem os mesmos tokens escuros', () => {
    const r = bloco(':root[data-tema="escuro"]').toLowerCase();
    for (const t of ['--papel: #17151f', '--ficha: #221f2e', '--tinta: #eeecf5', '--grafite: #b5afc9', '--carimbo: #b9a5ff',
      '--sobre-carimbo: #17151f', '--carimbo-veu: #2f2752', '--perigo: #ff8fa0', '--contorno: #8a83a3', '--prateleira: #3e3856',
      '--prateleira-luz: #6b6390', '--risco: #35304a',
      '--sombra-cartaz: 0 0 0 1px rgb(255 255 255 / 0.10), 0 12px 20px -10px rgb(0 0 0 / 0.9)']) expect(r).toContain(t);
    expect(r).toContain('color-scheme: dark');
  });
  test('color-scheme acompanha: claro, escuro e automático', () => {
    expect(bloco(':root[data-tema="claro"]')).toContain('color-scheme: light');
    expect(claro).toContain('color-scheme: light dark');
  });
});

describe('botão de tema: layout', () => {
  test('44 px de largura, sem restos do seletor', () => {
    expect(css).toMatch(/\.botao-tema\s*\{[^}]*width: 44px/);
    expect(css).not.toContain('.seletor-tema');
  });
  test('sem perfil (desktop) o botão de tema vai para o canto direito do cabeçalho', () => {
    expect(css).toMatch(/\.moldura-nome \+ \.botao-tema\s*\{\s*margin-left: auto/);
  });
  test('no celular a linha não quebra: marca encolhe, tema vem logo antes do Menu', () => {
    const m = bloco('@media (max-width: 760px)');
    expect(m).toMatch(/\.moldura-nome\s*\{\s*flex: 1 1 0;\s*min-width: 0/);
    expect(m).toMatch(/\.botao-tema\s*\{\s*order: 1/);
    expect(m).toMatch(/\.menu-botao\s*\{\s*order: 2/);
    expect(m).not.toMatch(/\.menu-botao\s*\{\s*margin-left: auto/);
  });
});

describe('cabeçalho compacto do celular (igual à main)', () => {
  test('marca e Menu mantêm a tipografia e o espaçamento compactos', () => {
    const m = bloco('@media (max-width: 760px)');
    expect(m).toMatch(/\.moldura-nome\s*\{\s*gap: 6px;\s*\}/);
    expect(m).toMatch(/\.moldura-nome span\s*\{\s*font-size: 1\.25rem;\s*\}/);
    expect(m).toMatch(/\.menu-botao\s*\{\s*gap: 6px;\s*padding-inline: 10px;\s*\}/);
  });
});
