// Ranking por (contagem decrescente, id crescente); ids devolvidos como números.
export function rankingPopularidade(contagens) {
  return Object.keys(contagens)
    .map(Number)
    .sort((a, b) => contagens[b] - contagens[a] || a - b);
}

export function popularesNaoVistos(ranking, vistos, k) {
  const saida = [];
  for (const id of ranking) {
    if (saida.length >= k) break;
    if (!vistos.has(id)) saida.push(id);
  }
  return saida;
}

export function vistosPorUsuario(treino) {
  const mapa = new Map();
  for (const { usuario, filme } of treino) {
    if (!mapa.has(usuario)) mapa.set(usuario, new Set());
    mapa.get(usuario).add(filme);
  }
  return mapa;
}
