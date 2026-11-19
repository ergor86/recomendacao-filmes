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
