// Ranqueador: monta os candidatos de um usuário (prefixos das listas gravadas, ruling R6),
// pontua cada candidato com a rede e extrai o top-10 de forma determinística.
import { unirCandidatos } from '../candidatos/hibrido.js';
import { demografia, resumoCurtidos, perfilRede, popZDoPar, filmeRede, montarEntrada } from '../features/entrada.js';
import { prever } from './rede.js';

/** Candidatos de (k, n): prefixos das listas gravadas de populares e vizinhos, unidos sem repetição. */
export function candidatosDe(entrada, k, n) {
  return unirCandidatos(entrada.populares.slice(0, k), entrada.vizinhos.slice(0, n));
}

/**
 * Score da rede para cada candidato de um usuário: perfil completo (referência se não há curtidas),
 * popularidade do filme sem desconto (candidato nunca foi avaliado no treino) e um único `prever`.
 * @returns Map<id, score> na ordem dos candidatos
 */
export function pontuarCandidatos({ modelo, regua, semPop, usuario, curtidos, candidatos, filmesPorId }) {
  const dim = semPop ? 68 : 70;
  const demo = demografia(usuario, regua);
  const perfil = perfilRede(resumoCurtidos(curtidos, regua), regua);
  const x = new Float32Array(candidatos.length * dim);
  candidatos.forEach((id, i) => {
    const filme = filmesPorId.get(id);
    if (!filme) throw new Error(`candidato ${id} do usuário ${usuario.id} não existe no catálogo: recarregue os filmes (npm run carregar-filmes)`);
    x.set(montarEntrada(demo, perfil, filmeRede(filme, popZDoPar(id, false, regua)), { semPop }), i * dim);
  });
  const scores = prever(modelo, x, dim);
  return new Map(candidatos.map((id, i) => [id, scores[i]]));
}

/** Os 10 ids de maior score; empates pelo id crescente. Menos de 10 candidatos é erro. */
export function top10PorScore(scores) {
  if (scores.size < 10) {
    throw new Error(`top10PorScore: só ${scores.size} candidatos, mas a avaliação exige 10; aumente k/n ou confira os candidatos`);
  }
  return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10).map(([id]) => id);
}
