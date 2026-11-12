// Testes estatísticos para comparar dois sistemas nos mesmos usuários (comparação pareada).
// "Pareada" porque cada diferença é do mesmo usuário: por exemplo, NDCG do sistema B − NDCG do sistema A.

import { criarAleatorio } from '../util/aleatorio.js';

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Erro-padrão da média das diferenças: desvio-padrão amostral (divide por n − 1) ÷ √n.
 * Indica quanto essa média oscilaria se repetíssemos o experimento com outros usuários.
 */
export function erroPadraoPareado(difs) {
  const n = difs.length;
  if (n < 2) throw new Error('erroPadraoPareado: são necessárias ao menos 2 diferenças.');
  const m = media(difs);
  const variancia = difs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variancia) / Math.sqrt(n);
}

/**
 * Intervalo de confiança de 95% da média das diferenças, por bootstrap.
 * Sorteia usuários com reposição 5000 vezes, calcula a média em cada sorteio e pega os
 * percentis 2,5% e 97,5%. Se o intervalo não contém 0, a diferença dificilmente é sorte.
 * A semente fixa (2026) torna o resultado reprodutível.
 * @returns { media, ic95: [limite inferior, limite superior] }
 */
export function bootstrapPareado(difs, { reamostragens = 5000, semente = 2026 } = {}) {
  const n = difs.length;
  if (n === 0) throw new Error('bootstrapPareado: lista de diferenças vazia.');
  const aleatorio = criarAleatorio(semente);
  const medias = new Array(reamostragens);
  for (let b = 0; b < reamostragens; b++) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += difs[Math.floor(aleatorio() * n)];
    medias[b] = soma / n;
  }
  medias.sort((a, b) => a - b);
  // Regra do quantil: limite inferior = índice floor(0,025·B); superior = ceil(0,975·B) − 1; ambos limitados a [0, B−1].
  const limitar = (i) => Math.min(reamostragens - 1, Math.max(0, i));
  const lo = medias[limitar(Math.floor(0.025 * reamostragens))];
  const hi = medias[limitar(Math.ceil(0.975 * reamostragens) - 1)];
  return { media: media(difs), ic95: [lo, hi] };
}

/**
 * Separa os usuários em dois grupos pela popularidade média do que eles curtem:
 * 'mainstream' (na mediana ou acima) e 'nicho' (abaixo). Serve para ver se um sistema
 * só funciona para quem gosta de filmes populares.
 * @param mediasPopularidade Map usuário → popularidade média
 */
export function grupoMainstream(mediasPopularidade) {
  const valores = [...mediasPopularidade.values()].sort((a, b) => a - b);
  if (valores.length === 0) return new Map();
  const meio = Math.floor(valores.length / 2);
  const mediana = valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
  const grupos = new Map();
  for (const [u, v] of mediasPopularidade) grupos.set(u, v >= mediana ? 'mainstream' : 'nicho');
  return grupos;
}
