// Apoio dos testes: um fetch simulado por tabela de rotas, que registra as chamadas.
import { vi } from 'vitest';

export function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}
export const semCorpo = (status = 204) => new Response(null, { status });
export const erroApi = (status, codigo, mensagem = 'erro') => json({ codigo, mensagem }, status);

/** rotas: [[metodo, 'caminho exato' | RegExp, (init, url) => Response | corpo | corpo]] */
export function simularFetch(rotas) {
  const chamadas = [];
  const fn = vi.fn(async (url, init = {}) => {
    const metodo = (init.method ?? 'GET').toUpperCase();
    chamadas.push({ metodo, url: String(url), init });
    const rota = rotas.find(([m, c]) => m === metodo && (c instanceof RegExp ? c.test(String(url)) : c === String(url)));
    if (!rota) return erroApi(404, 'ROTA_NAO_ENCONTRADA');
    const r = typeof rota[2] === 'function' ? await rota[2](init, String(url)) : rota[2];
    return r instanceof Response ? r : json(r);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, chamadas };
}

export const cabecalho = (init, nome) => {
  const h = init?.headers ?? {};
  const achado = Object.keys(h).find((k) => k.toLowerCase() === nome.toLowerCase());
  return achado ? h[achado] : undefined;
};

export const perfilExemplo = (extra = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  nome: 'Ana',
  exemplo: false,
  onboardingConcluido: true,
  contagens: { notas: 1, gostei: 2, queroAssistir: 0, curtidos: 3, curtidosComVetor: 3 },
  ...extra,
});

export const filmeExemplo = (extra = {}) => ({
  id: 1,
  titulo: 'Toy Story',
  tituloOriginal: 'Toy Story',
  ano: 1995,
  generos: ['Animation', "Children's", 'Comedy'],
  temVetor: true,
  midia: { cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null },
  estadoPerfil: null,
  ...extra,
});

/** Promessa com resolução manual: controla exatamente quando uma resposta simulada chega. */
export function adiavel() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

/** Recomendacoes (spec 6.3) com os filmes `ids`, em ordem; títulos "Filme <id>". */
export function recomendacoesExemplo(ids, extra = {}) {
  return {
    perfilId: '11111111-1111-4111-8111-111111111111',
    geradoEm: '2026-11-18T12:00:00.000Z',
    motivo: 'personalizado',
    perfil: { curtidos: 5, curtidosComVetor: 4, baseadoEm: [{ id: 100, titulo: 'Base A' }, { id: 101, titulo: 'Base B' }] },
    itens: ids.map((id, k) => ({
      posicao: k + 1,
      fonte: 'S1',
      escore: 0.5,
      porque: [{ id: 100, titulo: 'Base A' }],
      filme: filmeExemplo({ id, titulo: `Filme ${id}`, tituloOriginal: `Filme ${id}` }),
    })),
    busca: null,
    ...extra,
  };
}

/** Deixa os microtarefas e algumas voltas do laço de eventos correrem (resposta tardia já consumida). */
export async function acomodar(act) {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}
