import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { simularFetch, perfilExemplo, recomendacoesExemplo, erroApi, adiavel, acomodar } from './apoio-testes.js';
import { act } from '@testing-library/react';

const operante = { estado: 'operante', perfis: { disponivel: true } };
const SEL = { selector: '.cartao-titulo' };
const novo = () => perfilExemplo({ onboardingConcluido: false });
const patches = (chamadas) => chamadas.filter((c) => c.metodo === 'PATCH');

function montar(p, { rota = '/onboarding', patch = { ...p, onboardingConcluido: true }, extra = [] } = {}) {
  window.localStorage.setItem('perfilAtivo', p.id);
  const sim = simularFetch([
    ['GET', '/api/saude', operante],
    ['GET', '/api/perfis', [p]],
    ['PATCH', `/api/perfis/${p.id}`, patch],
    ['GET', `/api/perfis/${p.id}/recomendacoes`, recomendacoesExemplo([1, 2])],
    ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ...extra,
  ]);
  render(<MemoryRouter initialEntries={[rota]}><App /></MemoryRouter>);
  return sim;
}
const menuTop10 = () => within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Top 10' });
const logo = () => screen.getByRole('link', { name: /Minha Prateleira/ });
// espera também o nome do perfil guardado ser resolvido (é nele que vem onboardingConcluido)
const noOnboarding = async () => { await screen.findByText(/Perfil: Ana/); return screen.findByText(/Marque filmes que você já viu e gostou/); };

describe('"Top 10" e o logo concluem os primeiros filmes', () => {
  test('"Top 10" do menu: um PATCH e o Top 10 aparece', async () => {
    const p = novo();
    const { chamadas } = montar(p);
    await noOnboarding();
    fireEvent.click(menuTop10());
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(await screen.findByText('Filme 1', SEL)).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
    expect(JSON.parse(patches(chamadas)[0].init.body)).toEqual({ onboardingConcluido: true });
    expect(screen.queryByText(/Marque filmes que você já viu e gostou/)).toBeNull();
  });

  test('o logo faz o mesmo', async () => {
    const p = novo();
    const { chamadas } = montar(p);
    await noOnboarding();
    fireEvent.click(logo());
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('sem nenhum filme marcado também conclui e mostra o Top 10 (populares)', async () => {
    const p = novo();
    p.contagens = { notas: 0, gostei: 0, queroAssistir: 0, curtidos: 0, curtidosComVetor: 0 };
    const { chamadas } = montar(p, {
      extra: [['GET', `/api/perfis/${p.id}/recomendacoes`, recomendacoesExemplo([1, 2], { motivo: 'perfil_vazio', perfil: { curtidos: 0, curtidosComVetor: 0, baseadoEm: [] } })]],
    });
    await noOnboarding();
    fireEvent.click(menuTop10());
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('PATCH falha: continua no onboarding com a mensagem de erro', async () => {
    const p = novo();
    const { chamadas } = montar(p, { patch: () => erroApi(500, 'ERRO_INTERNO', 'Não deu para concluir agora.') });
    await noOnboarding();
    fireEvent.click(menuTop10());
    expect((await screen.findByRole('alert')).textContent).toContain('Não deu para concluir agora.');
    expect(screen.queryByRole('heading', { level: 1, name: 'Top 10' })).toBeNull();
    expect(screen.getByText(/Marque filmes que você já viu e gostou/)).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('perfil já concluído: "Top 10" e o logo não fazem PATCH', async () => {
    const p = perfilExemplo();
    const { chamadas } = montar(p, { rota: '/' });
    await screen.findByRole('heading', { level: 1, name: 'Top 10' });
    fireEvent.click(menuTop10());
    fireEvent.click(logo());
    await acomodar(act);
    expect(patches(chamadas)).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
  });

  test('dois cliques rápidos: um PATCH só', async () => {
    const p = novo();
    const d = adiavel();
    const { chamadas } = montar(p, { patch: () => d.promessa });
    await noOnboarding();
    fireEvent.click(menuTop10());
    fireEvent.click(menuTop10());
    fireEvent.click(logo());
    await acomodar(act);
    expect(patches(chamadas)).toHaveLength(1);
    d.resolver(new Response(JSON.stringify({ ...p, onboardingConcluido: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(patches(chamadas)).toHaveLength(1);
  });

  test('Ctrl/Meta/Shift no "Top 10" não é interceptado', async () => {
    const p = novo();
    const { chamadas } = montar(p);
    await noOnboarding();
    for (const tecla of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      const evento = new MouseEvent('click', { bubbles: true, cancelable: true, [tecla]: true });
      menuTop10().dispatchEvent(evento);
      expect(evento.defaultPrevented, tecla).toBe(false);
    }
    expect(patches(chamadas)).toHaveLength(0);
    expect(menuTop10().getAttribute('href')).toBe('/');
  });
});

describe('o que não muda', () => {
  test('recarregar / com perfil não concluído continua no onboarding', async () => {
    const p = novo();
    const { chamadas } = montar(p, { rota: '/' });
    await noOnboarding();
    expect(screen.queryByRole('heading', { level: 1, name: 'Top 10' })).toBeNull();
    expect(patches(chamadas)).toHaveLength(0);
  });

  test('escolher um perfil não concluído na tela de perfis leva ao onboarding', async () => {
    const p = novo();
    simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', [p]],
      ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ]);
    render(<MemoryRouter><App /></MemoryRouter>);
    await screen.findByText('Quem está usando?');
    fireEvent.click((await screen.findByText('Ana', { selector: 'span' })).closest('button'));
    await noOnboarding();
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Top 10' })).toBeNull());
  });
});
