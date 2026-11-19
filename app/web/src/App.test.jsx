import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { simularFetch, perfilExemplo, recomendacoesExemplo } from './apoio-testes.js';

// o título do filme aparece também dentro do SVG do cartaz: a consulta mira o título do cartão
const SEL = { selector: '.cartao-titulo' };
const operante = { estado: 'operante', perfis: { disponivel: true } };

describe('App', () => {
  test('localStorage que lança não quebra e mostra TelaPerfis', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado'); });
    simularFetch([['GET', '/api/saude', operante], ['GET', '/api/perfis', []]]);
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText('Quem está usando?')).toBeTruthy();
  });

  test('perfil-perdido volta à TelaPerfis', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    simularFetch([['GET', '/api/saude', operante], ['GET', '/api/perfis', [p]]]);
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText(/Perfil: Ana/)).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('perfil-perdido')); });
    expect(await screen.findByText('Quem está usando?')).toBeTruthy();
    expect(window.localStorage.getItem('perfilAtivo')).toBeNull();
  });

  test('fora do estado operante mostra a TelaPreparando', async () => {
    simularFetch([['GET', '/api/saude', { estado: 'preparando', etapa: 2, total: 8, mensagem: 'Importando', perfis: { disponivel: false, motivo: 'sem_dados' } }]]);
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText(/Etapa 2 de 8/)).toBeTruthy();
  });

  test('servidor fora do ar mostra a mensagem e o botão Tentar de novo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x'); }));
    render(<MemoryRouter><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Não consegui falar com o servidor local. Ele está rodando?')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  test('falha ao resolver o nome do perfil guardado mostra a mensagem e Tentar de novo refaz', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    let n = 0;
    simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', () => (n++ === 0 ? new Response('x', { status: 500 }) : [p])],
      ['GET', `/api/perfis/${p.id}/recomendacoes`, recomendacoesExemplo([1])],
    ]);
    render(<MemoryRouter><App /></MemoryRouter>);
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(botao);
    expect(await screen.findByText(/Perfil: Ana/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  test('perfil com onboarding concluído abre no Top 10 e traz a navegação', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    const { chamadas } = simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', [p]],
      ['GET', `/api/perfis/${p.id}/recomendacoes`, recomendacoesExemplo([1, 2])],
    ]);
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 10' })).toBeTruthy();
    expect(await screen.findByText('Filme 1', SEL)).toBeTruthy();
    expect(chamadas.some((c) => c.url === `/api/perfis/${p.id}/recomendacoes`)).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
  });

  test('perfil sem onboarding concluído vai ao onboarding, não ao Top 10', async () => {
    const p = perfilExemplo({ onboardingConcluido: false });
    window.localStorage.setItem('perfilAtivo', p.id);
    simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', [p]],
      ['GET', /\/onboarding/, { itens: [], proximoCursor: null }],
    ]);
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText(/Marque filmes que você já viu e gostou/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Top 10' })).toBeNull();
  });

  test('/sobre abre sem perfil ativo', async () => {
    simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/sobre', {
        versao: '0.1.0', commitCodigo: 'c048537', hashes: { regua: 'a', treino: 'b', vetoresFC: 'c' },
        resultado: { media: 0.0294, ic95: [0.0136, 0.0458], nUsuarios: 445 }, resumo: ['Frase um.', 'Frase dois.', 'Frase três.'],
        metodo: '', conclusao: '', naoSignifica: [], tecnica: { mecanismo: 'S1/HNSW', m: 300, nFc: 150, descricao: '' },
        avisos: [], licencas: [], citacao: '',
      }],
    ]);
    render(<MemoryRouter initialEntries={['/sobre']}><App /></MemoryRouter>);
    expect(await screen.findByText('Frase um.')).toBeTruthy();
    expect(screen.queryByText('Quem está usando?')).toBeNull();
  });

  test('/minha-lista e /minhas-avaliacoes pedem os tipos certos', async () => {
    const p = perfilExemplo();
    window.localStorage.setItem('perfilAtivo', p.id);
    const { chamadas } = simularFetch([
      ['GET', '/api/saude', operante],
      ['GET', '/api/perfis', [p]],
      ['GET', /\/interacoes\?/, { itens: [], total: 0, pagina: 1 }],
    ]);
    const { unmount } = render(<MemoryRouter initialEntries={['/minha-lista']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Minha lista' });
    await waitFor(() => expect(chamadas.some((c) => c.url.includes('tipos=quero_assistir'))).toBe(true));
    unmount();
    render(<MemoryRouter initialEntries={['/minhas-avaliacoes']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: 'Minhas avaliações' });
    await waitFor(() => expect(chamadas.some((c) => c.url.includes('tipos=nota,gostei'))).toBe(true));
  });
});
