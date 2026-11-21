import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sobre from './Sobre.jsx';
import { simularFetch, erroApi } from '../apoio-testes.js';
import { RESULTADO_PLANO3 } from '../../../integridade.js';

const num = (x) => x.toFixed(4).replace('.', ',');
const RESUMO = [
  'O sistema compara seus gostos com avaliações de 943 pessoas feitas em 1997–98.',
  'Para testar a técnica, foram separadas algumas avaliações históricas de 445 dessas pessoas.',
  'Os resultados medidos não garantem a mesma qualidade para novos usuários.',
];

// o que GET /api/sobre devolve (app/servidor/rotas/sobre.js), com os números de RESULTADO_PLANO3
const SOBRE = {
  versao: '0.1.0',
  commitCodigo: 'c048537911c14313c4e85c516270513871a14a88',
  hashes: { regua: 'aaa111', treino: 'bbb222', vetoresFC: 'ccc333' },
  resultado: {
    metrica: RESULTADO_PLANO3.metrica,
    v2: RESULTADO_PLANO3.v2,
    v1: RESULTADO_PLANO3.v1,
    media: RESULTADO_PLANO3.media,
    ic95: [...RESULTADO_PLANO3.ic95],
    nUsuarios: RESULTADO_PLANO3.nUsuarios,
    suportada: true,
  },
  resumo: RESUMO,
  metodo: 'O que foi medido: no teste-2 do Plano 3, 20% das notas dos usuários escolhidos foram escondidas; a lista da S1 foi comparada com a da S2.',
  populacao: 'Foram considerados inicialmente 462 usuários, e 445 entraram na métrica (17 ficaram fora da métrica por não terem avaliações relevantes escondidas).',
  conclusao: `Nesta avaliação retrospectiva, com essas ${RESULTADO_PLANO3.nUsuarios} pessoas, a S1 teve NDCG@10 maior que a S2 `
    + `(diferença média de ${num(RESULTADO_PLANO3.media)} no NDCG@10, IC 95% [${num(RESULTADO_PLANO3.ic95[0])}; ${num(RESULTADO_PLANO3.ic95[1])}]).`,
  naoSignifica: ['A qualidade medida não se transfere para perfis novos.', 'A avaliação é retrospectiva.'],
  tecnica: { mecanismo: 'S1/HNSW', m: 300, nFc: 150, modo: 'hnsw', descricao: 'Filtragem colaborativa item a item (S1) com busca HNSW.' },
  avisos: ['O catálogo vai só até 1998: o MovieLens 100K não tem filmes mais novos.', 'Os perfis ficam só neste computador e não têm senha.'],
  licencas: [{ nome: 'MovieLens 100K', texto: 'Dados do GroupLens Research.', url: 'https://grouplens.org/datasets/movielens/100k/' }],
  citacao: 'F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context.',
};

describe('Sobre', () => {
  test('o topo traz as 3 frases do /api/sobre e nenhuma frase sobre "poucos filmes"', async () => {
    const { chamadas } = simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    for (const frase of RESUMO) expect(await screen.findByText(frase)).toBeTruthy();
    expect(chamadas[0].url).toBe('/api/sobre');
    expect(document.body.textContent).not.toMatch(/poucos filmes/);
    expect(screen.getByRole('heading', { level: 1, name: 'Sobre' })).toBeTruthy();
  });

  test('"O que foi medido" mostra a média e o IC de RESULTADO_PLANO3 e o que isso não significa', async () => {
    simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    expect(screen.getByRole('heading', { name: 'O que foi medido' })).toBeTruthy();
    const texto = document.body.textContent;
    expect(texto).toContain(num(RESULTADO_PLANO3.media));
    expect(texto).toContain(num(RESULTADO_PLANO3.ic95[0]));
    expect(texto).toContain(num(RESULTADO_PLANO3.ic95[1]));
    expect(texto).toContain(String(RESULTADO_PLANO3.nUsuarios));
    expect(screen.getByRole('heading', { name: /O que isso não significa/ })).toBeTruthy();
    expect(screen.getByText('A qualidade medida não se transfere para perfis novos.')).toBeTruthy();
  });

  test('nenhum texto apresenta o resultado como desempenho com novos usuários', async () => {
    simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    // o único trecho que fala de novos usuários é a negação vinda da API
    const trechos = document.body.textContent.match(/[^.]*novos usu[aá]rios[^.]*\./gi) ?? [];
    expect(trechos.length).toBeGreaterThan(0);
    for (const t of trechos) expect(t).toMatch(/não garantem/);
  });

  test('o método fica em "O que foi medido"; 462 e 17 ficam em "Detalhes técnicos"', async () => {
    simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    const medido = screen.getByRole('heading', { name: 'O que foi medido' }).closest('section');
    expect(medido.textContent).toContain(SOBRE.metodo);
    expect(medido.textContent).not.toContain(SOBRE.populacao);
    const detalhes = screen.getByText('Detalhes técnicos').closest('details');
    expect(detalhes.textContent).toContain(SOBRE.populacao);
    expect(detalhes.textContent).toMatch(/considerados inicialmente 462 usuários/);
    expect(detalhes.textContent).toMatch(/17 ficaram fora da métrica por não terem avaliações relevantes escondidas/);
    expect(detalhes.textContent).not.toContain(SOBRE.metodo);
  });

  test('os números de população vêm só da API: nada fixo no cliente', async () => {
    const outro = {
      ...SOBRE,
      resultado: { ...SOBRE.resultado, nUsuarios: 447 },
      metodo: 'O que foi medido: método de teste sem números de população.',
      populacao: 'Foram considerados inicialmente 470 usuários, e 447 entraram na métrica (23 ficaram fora da métrica por não terem avaliações relevantes escondidas).',
    };
    simularFetch([['GET', '/api/sobre', outro]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    const detalhes = screen.getByText('Detalhes técnicos').closest('details');
    expect(detalhes.textContent).toContain('470 usuários');
    expect(detalhes.textContent).toContain('23 ficaram fora');
    const texto = document.body.textContent;
    expect(texto).not.toContain('464'); // 447 + 17 fixo
    expect(texto).not.toMatch(/17/);
    expect(texto).not.toContain('462');
  });

  test('"Detalhes técnicos" fica recolhido e traz a técnica e os hashes', async () => {
    simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    const detalhes = screen.getByText('Detalhes técnicos').closest('details');
    expect(detalhes.open).toBe(false);
    const dentro = detalhes.textContent;
    expect(dentro).toContain('M = 300');
    expect(dentro).toContain('FC150');
    expect(dentro).toContain('S1/HNSW');
    for (const h of ['aaa111', 'bbb222', 'ccc333']) expect(dentro).toContain(h);
    expect(dentro).toContain('c048537');
  });

  test('traz os limites, as licenças com link, a citação', async () => {
    simularFetch([['GET', '/api/sobre', SOBRE]]);
    render(<Sobre />);
    await screen.findByText(RESUMO[0]);
    expect(screen.getByText(SOBRE.avisos[0])).toBeTruthy();
    expect(screen.getByRole('link', { name: /MovieLens 100K/ }).getAttribute('href')).toBe('https://grouplens.org/datasets/movielens/100k/');
    expect(screen.getByText(SOBRE.citacao)).toBeTruthy();
  });

  test('falha mostra a mensagem e Tentar de novo refaz o pedido', async () => {
    let n = 0;
    simularFetch([['GET', '/api/sobre', () => (n++ === 0 ? erroApi(500, 'ERRO_INTERNO', 'quebrou') : SOBRE)]]);
    render(<Sobre />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(RESUMO[0])).toBeTruthy();
  });
});
