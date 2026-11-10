// Métricas de ranking com relevância binária (spec §9.3).
const TOTAL_FILMES = 1682;

function acertos(top10, relevantes) {
  let n = 0;
  for (const f of top10.slice(0, 10)) if (relevantes.has(f)) n++;
  return n;
}

// Sempre divide por 10, mesmo se a lista for menor.
export function precisaoEm10(top10, relevantes) {
  return acertos(top10, relevantes) / 10;
}

export function recallEm10(top10, relevantes) {
  if (relevantes.size === 0) throw new Error('recallEm10: usuário sem filmes relevantes; remova-o antes de avaliar.');
  return acertos(top10, relevantes) / relevantes.size;
}

export function ndcgEm10(top10, relevantes) {
  if (relevantes.size === 0) throw new Error('ndcgEm10: usuário sem filmes relevantes; remova-o antes de avaliar.');
  let dcg = 0;
  top10.slice(0, 10).forEach((f, i) => {
    if (relevantes.has(f)) dcg += 1 / Math.log2(i + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(relevantes.size, 10); i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
}

export function cobertura(listasTop10) {
  return new Set(listasTop10.flat()).size / TOTAL_FILMES;
}

export function popularidadeMedia(listasTop10, contagens) {
  let soma = 0;
  let n = 0;
  for (const lista of listasTop10) {
    for (const f of lista) {
      soma += contagens[f] ?? 0;
      n++;
    }
  }
  return n === 0 ? 0 : soma / n;
}

// Só nota >= 4; usuários sem relevantes não entram no mapa.
export function relevantesPorUsuario(alvos) {
  const mapa = new Map();
  for (const { usuario, filme, nota } of alvos) {
    if (nota < 4) continue;
    if (!mapa.has(usuario)) mapa.set(usuario, new Set());
    mapa.get(usuario).add(filme);
  }
  return mapa;
}

export function avaliarSistema(top10PorUsuario, relevantesMap, contagens) {
  const porUsuario = new Map();
  const listas = [];
  for (const [usuario, relevantes] of relevantesMap) {
    const lista = top10PorUsuario.get(usuario);
    if (!lista) {
      throw new Error(`avaliarSistema: falta a lista top 10 do usuário ${usuario}; calcule-a antes de avaliar.`);
    }
    listas.push(lista);
    porUsuario.set(usuario, {
      ndcg: ndcgEm10(lista, relevantes),
      precisao: precisaoEm10(lista, relevantes),
      recall: recallEm10(lista, relevantes),
    });
  }
  const n = porUsuario.size;
  if (n === 0) throw new Error('avaliarSistema: nenhum usuário com relevantes para avaliar.');
  const media = (campo) => [...porUsuario.values()].reduce((s, v) => s + v[campo], 0) / n;
  return {
    ndcg: media('ndcg'),
    precisao: media('precisao'),
    recall: media('recall'),
    cobertura: cobertura(listas),
    popularidadeMedia: popularidadeMedia(listas, contagens),
    nUsuarios: n,
    porUsuario,
  };
}
