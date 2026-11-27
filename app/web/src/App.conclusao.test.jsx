import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { within } from '@testing-library/react';
import App from './App.jsx';
import { simularFetch, perfilExemplo, recomendacoesExemplo, erroApi, adiavel, acomodar } from './apoio-testes.js';

// Conclusão dos primeiros filmes num caminho só (botão, "Top 10" e logo), com o erro preso ao perfil.
const operante = { estado: 'operante', perfis: { disponivel: true } };
const ok = (corpo) => new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
const idB = '22222222-2222-4222-8222-222222222222';
const perfilA = () => perfilExemplo({ onboardingConcluido: false });
const perfilB = () => perfilExemplo({ id: idB, nome: 'Bia', onboardingConcluido: false });
const patches = (chamadas) => chamadas.filter((c) => c.metodo === 'PATCH');
const menuTop10 = () => within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Top 10' });
const alerta = () => screen.queryByRole('alert');
const h1Top10 = () => screen.findByRole('heading', { level: 1, name: 'Top 10' });
const noOnboarding = async () => { await screen.findByText(/Perfil: Ana/); return screen.findByText(/Marque filmes que você já viu e gostou/); };
const trocarPara = async (nome) => {
  fireEvent.click(screen.getByRole('button', { name: 'Trocar de perfil' }));
  fireEvent.click((await screen.findByText(nome, { selector: 'span' })).closest('button'));
};

function montar({ patchA, patchB = (p) => ok({ ...p, onboardingConcluido: true }), rota = '/onboarding' }) {
  const a = perfilA();
  const b = perfilB();
  window.localStorage.setItem('perfilAtivo', a.id);
  const sim = simularFetch([
    ['GET', '/api/saude', operante],
    ['GET', '/api/perfis', [a, b]],
    ['PATCH', `/api/perfis/${a.id}`, patchA],
    ['PATCH', `/api/perfis/${idB}`, () => patchB(b)],
    ['GET', /\/recomendacoes/, recomendacoesExemplo([1, 2])],
    ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ['GET', '/api/generos', []],
    ['GET', /\/api\/filmes/, { itens: [], proximoCursor: null }],
  ]);
  render(<MemoryRouter initialEntries={[rota]}><App /></MemoryRouter>);
  return { ...sim, a, b };
}

describe('erro preso ao perfil e conclusão única', () => {
  test('o erro do perfil A não aparece no onboarding do perfil B', async () => {
    montar({ patchA: () => erroApi(500, 'X', 'Falha do A.') });
    await noOnboarding();
    fireEvent.click(menuTop10());
    expect((await screen.findByRole('alert')).textContent).toContain('Falha do A.');
    await trocarPara('Bia');
    await screen.findByText(/Perfil: Bia/);
    await screen.findByText(/Marque filmes que você já viu e gostou/);
    expect(alerta()).toBeNull();
  });

  test('botão da tela e menu juntos: um PATCH só', async () => {
    const d = adiavel();
    const { chamadas, a } = montar({ patchA: () => d.promessa });
    await noOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver minhas recomendações' }));
    fireEvent.click(menuTop10());
    await acomodar(act);
    expect(patches(chamadas)).toHaveLength(1);
    d.resolver(ok({ ...a, onboardingConcluido: true }));
    expect(await h1Top10()).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('o botão concluiu: um clique posterior no menu não faz PATCH nem mostra erro', async () => {
    const { chamadas } = montar({ patchA: () => ok({ onboardingConcluido: true }) });
    await noOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver minhas recomendações' }));
    await h1Top10();
    fireEvent.click(menuTop10());
    await acomodar(act);
    expect(patches(chamadas)).toHaveLength(1);
    expect(alerta()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
  });

  test('trocar de perfil com o PATCH de A em voo não conclui B nem monta um perfil sem id', async () => {
    const d = adiavel();
    const { chamadas, a } = montar({ patchA: () => d.promessa });
    await noOnboarding();
    fireEvent.click(menuTop10());
    await trocarPara('Bia');
    await screen.findByText(/Perfil: Bia/);
    await screen.findByText(/Marque filmes que você já viu e gostou/);
    d.resolver(ok({ ...a, onboardingConcluido: true }));
    await acomodar(act);
    expect(screen.queryByRole('heading', { level: 1, name: 'Top 10' })).toBeNull();
    expect(screen.getByText(/Marque filmes que você já viu e gostou/)).toBeTruthy();
    expect(chamadas.some((c) => c.url.includes('undefined'))).toBe(false);
    expect(chamadas.some((c) => c.url.includes(`${idB}/recomendacoes`))).toBe(false);
  });

  test('a falha de A, chegando depois da troca para B, não aparece em B', async () => {
    const d = adiavel();
    montar({ patchA: () => d.promessa });
    await noOnboarding();
    fireEvent.click(menuTop10());
    await trocarPara('Bia');
    await screen.findByText(/Perfil: Bia/);
    d.resolver(erroApi(500, 'X', 'Falha tardia do A.'));
    await acomodar(act);
    expect(alerta()).toBeNull();
  });

  test('perfil ainda sem dados (recarga): o clique conclui em vez de voltar', async () => {
    const p = perfilA();
    window.localStorage.setItem('perfilAtivo', p.id);
    const d = adiavel();
    const { chamadas } = simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', () => d.promessa],
      ['PATCH', `/api/perfis/${p.id}`, { ...p, onboardingConcluido: true }],
      ['GET', /\/recomendacoes/, recomendacoesExemplo([1, 2])],
      ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ]);
    render(<MemoryRouter initialEntries={['/onboarding']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'Top 10' }));
    await waitFor(() => expect(patches(chamadas)).toHaveLength(1));
    d.resolver(ok([{ ...p, onboardingConcluido: true }]));
    expect(await h1Top10()).toBeTruthy();
  });

  test('resposta atrasada do perfil (ainda "não concluído") depois da conclusão não volta ao onboarding', async () => {
    const p = perfilA();
    window.localStorage.setItem('perfilAtivo', p.id);
    const d = adiavel();
    const { chamadas } = simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', async () => { await d.promessa; return ok([p]); }], // uma Response nova por pedido
      ['PATCH', `/api/perfis/${p.id}`, { ...p, onboardingConcluido: true }],
      ['GET', /\/recomendacoes/, recomendacoesExemplo([1, 2])],
      ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ]);
    render(<MemoryRouter initialEntries={['/onboarding']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'Top 10' }));
    await h1Top10();
    d.resolver(); // o servidor já concluiu, mas esta resposta foi pedida antes
    await screen.findByText(/Perfil: Ana/);
    await acomodar(act);
    expect(screen.getByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(screen.queryByText(/Marque filmes que você já viu e gostou/)).toBeNull();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('no celular o painel do menu fecha depois do clique', async () => {
    montar({ patchA: () => ok({ onboardingConcluido: true }) });
    await noOnboarding();
    const botaoMenu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(botaoMenu);
    expect(botaoMenu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(menuTop10());
    expect(botaoMenu.getAttribute('aria-expanded')).toBe('false');
    await h1Top10();
  });

  test('falha a partir de outra tela leva ao onboarding com o erro', async () => {
    montar({ patchA: () => erroApi(500, 'X', 'Falha do A.'), rota: '/catalogo' });
    await screen.findByText(/Perfil: Ana/);
    fireEvent.click(menuTop10());
    expect(await screen.findByText(/Marque filmes que você já viu e gostou/)).toBeTruthy();
    expect(alerta().textContent).toContain('Falha do A.');
  });

  test('nova tentativa limpa o erro anterior enquanto o PATCH está em voo', async () => {
    const d = adiavel();
    let n = 0;
    montar({ patchA: () => (n++ === 0 ? erroApi(500, 'X', 'Falha do A.') : d.promessa) });
    await noOnboarding();
    fireEvent.click(menuTop10());
    await screen.findByRole('alert');
    fireEvent.click(menuTop10());
    await waitFor(() => expect(alerta()).toBeNull());
    d.resolver(erroApi(500, 'X', 'Falha 2.'));
    expect((await screen.findByRole('alert')).textContent).toContain('Falha 2.');
  });

  test('botão não primário do mouse não é interceptado', async () => {
    const { chamadas } = montar({ patchA: () => ok({}) });
    await noOnboarding();
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    menuTop10().dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(false);
    expect(patches(chamadas)).toHaveLength(0);
  });
});
