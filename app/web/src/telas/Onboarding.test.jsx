import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, perfilExemplo } from '../apoio-testes.js';

const ID = perfilExemplo().id;
const generos = [{ id: 'Action', rotulo: 'Ação' }];
const itens = [filmeExemplo({ id: 1, titulo: 'Toy Story' }), filmeExemplo({ id: 2, titulo: 'GoldenEye' })];
const comContagem = (n) => perfilExemplo({ onboardingConcluido: false, contagens: { notas: 0, gostei: n, queroAssistir: 0, curtidos: n, curtidosComVetor: n } });

function montar(contagem = 0, extras = []) {
  const sim = simularFetch([
    ['GET', '/api/generos', generos],
    ['GET', '/api/perfis', () => [comContagem(contagem)]],
    ['GET', new RegExp(`^/api/perfis/${ID}/onboarding`), { itens, proximoCursor: '100:10' }],
    ...extras,
  ]);
  render(<MemoryRouter><ProvedorAviso><Onboarding perfilId={ID} aoConcluir={() => {}} /></ProvedorAviso></MemoryRouter>);
  return sim;
}

describe('Onboarding', () => {
  test('contador "N marcados · sugerimos pelo menos 3" e botão "Pular por enquanto" com 0', async () => {
    montar(0);
    expect(await screen.findByText('Toy Story', { selector: '.cartao-titulo' })).toBeTruthy();
    expect(await screen.findByText('0 marcados · sugerimos pelo menos 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pular por enquanto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver minhas recomendações' })).toBeNull();
  });

  test('com 2 marcados o botão continua disponível, sem destaque', async () => {
    montar(2);
    expect(await screen.findByText('2 marcados · sugerimos pelo menos 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver minhas recomendações' }).className).not.toContain('destaque');
  });

  test('a partir de 3 o botão principal fica em destaque e o contador some', async () => {
    montar(3);
    const b = await screen.findByRole('button', { name: 'Ver minhas recomendações' });
    await waitFor(() => expect(b.className).toContain('destaque'));
    expect(screen.queryByText(/marcados · sugerimos/)).toBeNull();
  });

  test('nenhum texto afirma limiar', async () => {
    montar(0);
    await screen.findByText('Toy Story', { selector: '.cartao-titulo' });
    const t = document.body.textContent;
    expect(t).not.toContain('Faltam');
    expect(t).not.toContain('para personalizar');
    expect(t).toContain('Marque filmes que você já viu e gostou. Cada um já muda as suas recomendações; sugerimos pelo menos 3, para que a lista não dependa de um filme só. O catálogo vai até 1998.');
  });

  test('"Não reconheço nenhum: mostrar outros" avança o cursor', async () => {
    const { chamadas } = montar(0);
    await screen.findByText('Toy Story', { selector: '.cartao-titulo' });
    fireEvent.click(screen.getByRole('button', { name: 'Não reconheço nenhum: mostrar outros' }));
    await waitFor(() => expect(chamadas.some((c) => c.url.includes('cursor=100%3A10'))).toBe(true));
  });

  test('concluir envia PATCH onboardingConcluido', async () => {
    const { chamadas } = montar(3, [['PATCH', `/api/perfis/${ID}`, comContagem(3)]]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver minhas recomendações' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(true));
    expect(chamadas.find((c) => c.metodo === 'PATCH').init.body).toBe(JSON.stringify({ onboardingConcluido: true }));
  });
});
