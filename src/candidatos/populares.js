// Fonte de candidatos por popularidade e utilidades sobre o histórico dos usuários.

/**
 * Ordena todos os filmes do mais para o menos popular (nº de notas no treino).
 * Empates são desfeitos pelo id crescente, para o resultado ser sempre o mesmo.
 * Os ids são devolvidos como números.
 */
export function rankingPopularidade(contagens) {
  return Object.keys(contagens)
    .map(Number)
    .sort((a, b) => contagens[b] - contagens[a] || a - b);
}

/** Os k primeiros filmes do ranking que o usuário ainda não viu. Com k = 10, é a linha de base. */
export function popularesNaoVistos(ranking, vistos, k) {
  const saida = [];
  for (const id of ranking) {
    if (saida.length >= k) break;
    if (!vistos.has(id)) saida.push(id);
  }
  return saida;
}

/** Map usuário → conjunto de filmes que ele avaliou no treino (qualquer nota). */
export function vistosPorUsuario(treino) {
  const mapa = new Map();
  for (const { usuario, filme } of treino) {
    if (!mapa.has(usuario)) mapa.set(usuario, new Set());
    mapa.get(usuario).add(filme);
  }
  return mapa;
}
