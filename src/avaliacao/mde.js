// MDE pré-registrado (spec §8.3): menor ganho detectável, uma capacidade de detecção e não uma previsão.
// Reúne a subamostragem do gabarito, a fórmula, a simulação de conferência e a heurística do 2º par.

import { criarAleatorio } from '../util/aleatorio.js';

const Z_975 = 1.959963985;
const Z_80 = 0.841621234;

// Média aritmética.
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Subamostra o gabarito para imitar o teste-2: cada relevante é mantido com probabilidade q.
 * Semente por usuário: 30_000_000 + 1000·r + u; relevantes percorridos em id crescente.
 * Usuários sem nenhum relevante mantido saem do mapa.
 */
export function subamostrarRelevantes(relevantes, q, r) {
  const saida = new Map();
  for (const [u, conjunto] of relevantes) {
    const aleatorio = criarAleatorio(30_000_000 + 1000 * r + u);
    const mantidos = new Set();
    for (const id of [...conjunto].sort((a, b) => a - b)) {
      if (aleatorio() < q) mantidos.add(id);
    }
    if (mantidos.size > 0) saida.set(u, mantidos);
  }
  return saida;
}

/** Desvio padrão amostral (divide por n − 1). */
export function desvioAmostral(valores) {
  const n = valores.length;
  if (n < 2) throw new Error('desvioAmostral: são necessários ao menos 2 valores.');
  const m = media(valores);
  return Math.sqrt(valores.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}

/** MDE da fórmula: (z_0,975 + z_0,80) · σ / √n_t. */
export function mdeFormula(sigma, nt) {
  return (Z_975 + Z_80) * sigma / Math.sqrt(nt);
}

/**
 * Simulação de conferência: centra as diferenças, sorteia B amostras de tamanho nt com reposição
 * (semente 40_000_000 + r) e devolve o quantil 0,80 de 1,96·ep_s − m_s (menor ganho em que 80%
 * dos IC normais excluem zero).
 */
export function simularDeltaEstrela(difs, nt, r, B = 10_000) {
  const m = media(difs);
  const c = difs.map((d) => d - m);
  const n = c.length;
  const aleatorio = criarAleatorio(40_000_000 + r);
  const limiares = new Array(B);
  for (let b = 0; b < B; b++) {
    let soma = 0;
    let somaQ = 0;
    for (let i = 0; i < nt; i++) {
      const x = c[Math.floor(aleatorio() * n)];
      soma += x;
      somaQ += x * x;
    }
    const ms = soma / nt;
    const variancia = (somaQ - nt * ms * ms) / (nt - 1);
    const ep = Math.sqrt(Math.max(0, variancia)) / Math.sqrt(nt);
    limiares[b] = 1.96 * ep - ms;
  }
  limiares.sort((a, b) => a - b);
  return limiares[Math.ceil(0.8 * B) - 1];
}

/** IC normal de 95% da média: média ± 1,96 · desvio / √n. */
export function icNormal(difs) {
  const m = media(difs);
  const meia = 1.96 * desvioAmostral(difs) / Math.sqrt(difs.length);
  return [m - meia, m + meia];
}

/**
 * Top 10 da heurística: FC150 ordenada por escore64 · √pop desc (id asc). Quem não tem escore
 * (preenchimento) fica com 0 e vai para o fim, por pop desc e id asc.
 */
export function top10Heuristica(fc150, escore64, pop) {
  const p = (id) => pop[id] ?? 0;
  const chave = (id) => (escore64.get(id) ?? 0) * Math.sqrt(p(id));
  return [...fc150]
    .sort((a, b) => {
      const sa = escore64.has(a);
      const sb = escore64.has(b);
      if (sa !== sb) return sa ? -1 : 1;
      if (sa) return chave(b) - chave(a) || a - b;
      return p(b) - p(a) || a - b;
    })
    .slice(0, 10);
}
