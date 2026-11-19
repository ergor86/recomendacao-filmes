import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding.jsx';
import { ProvedorAviso } from '../componentes/AvisoAcao.jsx';
import { simularFetch, filmeExemplo, perfilExemplo } from '../apoio-testes.js';

const ID = perfilExemplo().id;
const comContagem = (n) => perfilExemplo({ onboardingConcluido: false, contagens: { notas: 0, gostei: n, queroAssistir: 0, curtidos: n, curtidosComVetor: n } });
const adiado = () => { let resolver; const p = new Promise((r) => { resolver = r; }); return { p, resolver }; };

describe('Onboarding: contador e respostas fora de ordem', () => {
  test('uma contagem velha não sobrescreve a mais nova', async () => {
    const a = adiado();
    const b = adiado();
    let chamada = 0;
    const efeitos = { contribuiParaPerfil: true, excluidoDasRecomendacoes: true, perfilMudou: true };
    simularFetch([
      ['GET', '/api/generos', []],
      ['GET', '/api/perfis', async () => {
        chamada += 1;
        if (chamada === 1) return [comContagem(0)];
        if (chamada === 2) { await a.p; return [comContagem(1)]; }
        await b.p;
        return [comContagem(2)];
      }],
      ['GET', new RegExp(`^/api/perfis/${ID}/onboarding`), { itens: [filmeExemplo({ id: 1 })], proximoCursor: null }],
      ['PUT', `/api/perfis/${ID}/interacoes/1`, { interacao: {}, anterior: null, filme: { temVetor: true }, efeitos }],
      ['DELETE', `/api/perfis/${ID}/interacoes/1`, { anterior: { tipo: 'gostei', nota: null }, efeitos }],
    ]);
    render(<MemoryRouter><ProvedorAviso><Onboarding perfilId={ID} aoConcluir={() => {}} /></ProvedorAviso></MemoryRouter>);
    const gostei = await screen.findByRole('button', { name: 'Gostei' });
    fireEvent.click(gostei); // PUT, depois recontagem 2 (lenta, devolve 1)
    await screen.findByText('Salvo.', { exact: false });
    fireEvent.click(gostei); // DELETE, depois recontagem 3 (devolve 2)
    await new Promise((r) => setTimeout(r, 50));
    await act(async () => { b.resolver(); await b.p; });
    await screen.findByText('2 marcados · sugerimos pelo menos 3');
    await act(async () => { a.resolver(); await a.p; });
    expect(screen.getByText('2 marcados · sugerimos pelo menos 3')).toBeTruthy();
  });
});
