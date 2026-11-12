// Geração híbrida de candidatos: populares não vistos ∪ vizinhos vetoriais do perfil.
// A lista resultante é o que a rede neural (Plano 2) vai ordenar.

import { popularesNaoVistos } from './populares.js';
import { buscarVizinhos } from '../banco/busca.js';
import { perfilUsuario, vetorBuscaUsuario } from '../features/codificacao.js';

/**
 * Une as duas listas sem repetição: populares primeiro, depois os vizinhos novos.
 * Também registra a fonte de cada filme: 'pop', 'vet' ou 'ambas'.
 * @returns { ids, fonte: Map id → fonte }
 */
export function unirCandidatos(populares, vizinhos) {
  const fonte = new Map();
  const ids = [];
  for (const id of populares) {
    if (fonte.has(id)) continue;
    fonte.set(id, 'pop');
    ids.push(id);
  }
  for (const id of vizinhos) {
    if (fonte.get(id) === 'pop') fonte.set(id, 'ambas');
    else if (!fonte.has(id)) {
      fonte.set(id, 'vet');
      ids.push(id);
    }
  }
  return { ids, fonte };
}

/**
 * Gera os candidatos de um usuário: os k populares que ele não viu e os n vizinhos vetoriais
 * do perfil dele (excluindo os vistos), unidos sem repetição.
 * Sem curtidas (ou com n = 0) não há perfil: volta só com os populares e vetorUsuario = null.
 */
export async function gerarCandidatos({ pool, regua, vistos, filmesCurtidos, ranking, k, n }) {
  const populares = popularesNaoVistos(ranking, vistos, k);
  const perfil = n === 0 ? null : perfilUsuario(filmesCurtidos, regua);
  if (perfil === null) {
    return { ...unirCandidatos(populares, []), vetorUsuario: null };
  }
  const vetorUsuario = vetorBuscaUsuario(perfil, regua);
  const excluir = [...vistos].sort((a, b) => a - b);
  const vizinhos = await buscarVizinhos(pool, { vetor: vetorUsuario, excluir, n, regua });
  return { ...unirCandidatos(populares, vizinhos.map((v) => v.id)), vetorUsuario };
}

// Contribuição exclusiva dos vetores para um usuário: fração dos acertos (relevantes entre os
// candidatos) que só a fonte vetorial trouxe. Mede o que os vetores acrescentam aos populares.
export function contribuicaoExclusiva(acertos, fonte) {
  if (acertos.length === 0) return 0;
  return acertos.filter((id) => fonte.get(id) === 'vet').length / acertos.length;
}

// Razão agregada (pooled) sobre os usuários: soma dos acertos só vetoriais / soma dos acertos da união.
// Cada lista é { acertos: [ids], fonte: Map }. Difere da média das razões por usuário.
export function contribuicaoExclusivaAgregada(listas) {
  let vet = 0;
  let total = 0;
  for (const { acertos, fonte } of listas) {
    total += acertos.length;
    vet += acertos.filter((id) => fonte.get(id) === 'vet').length;
  }
  return total === 0 ? 0 : vet / total;
}
