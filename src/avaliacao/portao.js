// Portão da FC como fonte de candidatos (spec §8.1): composições (K, N) e avaliação dos
// critérios (a) e (b). Funções puras; a leitura dos dados fica em scripts/18-portao-v2.js.

import { erroPadraoPareado } from './estatistica.js';

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/** Composições do portão para uma lista de tamanho L: p ∈ {0; 0,25; 0,5; 0,75; 1}, n = round(p·L), k = L − n. */
export function composicoesPortao(L) {
  return [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const n = Math.round(p * L);
    return { p, k: L - n, n };
  });
}

/**
 * Avalia o portão. `recallPorComposicao`: Map<'k-n', Map<u, recall>>; `curtidasEscondidas`:
 * Map<u, nº de relevantes do usuário na validação>. Critério (a): melhor mistura entre 112-38,
 * 75-75 e 37-113 (empate pelo menor n) supera 150-0 por mais de 1 EP pareado. Critério (b):
 * retirados os floor(0,1·n) usuários com mais curtidas escondidas, 100-50 − 150-0 tem média > 0.
 */
export function avaliarPortao({ recallPorComposicao, curtidasEscondidas }) {
  const get = (chave) => {
    const m = recallPorComposicao.get(chave);
    if (!m) throw new Error(`avaliarPortao: falta o recall da composição ${chave}`);
    return m;
  };
  const base = get('150-0');
  const usuarios = [...base.keys()].sort((a, b) => a - b);
  for (const [chave, m] of recallPorComposicao) {
    if (m.size !== usuarios.length || usuarios.some((u) => !m.has(u))) {
      throw new Error(`avaliarPortao: a composição ${chave} não tem os mesmos usuários de 150-0`);
    }
  }

  const candidatas = [['112-38', 38], ['75-75', 75], ['37-113', 113]].map(([chave, n]) => ({
    chave, n, recallMedio: media(usuarios.map((u) => get(chave).get(u))),
  }));
  const melhor = candidatas.reduce((m, c) => (c.recallMedio > m.recallMedio || (c.recallMedio === m.recallMedio && c.n < m.n) ? c : m));
  const difsA = usuarios.map((u) => get(melhor.chave).get(u) - base.get(u));
  const diferenca = media(difsA);
  const erroPadrao = erroPadraoPareado(difsA);
  const criterioA = { diferenca, erroPadrao, passa: diferenca > erroPadrao };

  const ordenados = [...usuarios].sort((a, b) => (curtidasEscondidas.get(b) ?? 0) - (curtidasEscondidas.get(a) ?? 0) || a - b);
  const nRetirados = Math.floor(0.1 * ordenados.length);
  const restantes = ordenados.slice(nRetirados);
  const dif = (u) => get('100-50').get(u) - base.get(u);
  const valor = media(restantes.map(dif));
  const total = ordenados.reduce((s, u) => s + dif(u), 0);
  const dosRetirados = ordenados.slice(0, nRetirados).reduce((s, u) => s + dif(u), 0);
  // Descritivo (§8.1): fração do ganho total vinda dos usuários retirados.
  const fracaoDoGanhoDosRetirados = total === 0 ? null : dosRetirados / total;
  const criterioB = { nRetirados, valor, passa: valor > 0, fracaoDoGanhoDosRetirados };

  const passa = criterioA.passa && criterioB.passa;
  return { melhorMistura: melhor.chave, criterioA, criterioB, passa, cenario: passa ? 'aprovado' : 'reprovado' };
}
