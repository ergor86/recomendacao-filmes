// Métricas de ranking com relevância binária (spec §9.3).
// Relevante = filme escondido que o usuário avaliou com nota ≥ 4 (é o gabarito).
// Todas as métricas comparam o top 10 recomendado com esse gabarito; muda só o que cada uma mede.
const TOTAL_FILMES = 1682; // filmes no MovieLens 100K (denominador da cobertura)

// Quantos dos 10 primeiros recomendados estão no gabarito.
function acertos(top10, relevantes) {
  let n = 0;
  for (const f of top10.slice(0, 10)) if (relevantes.has(f)) n++;
  return n;
}

/**
 * Precisão@10: dos 10 recomendados, que fração é relevante. Ex.: 2 acertos dão 0,2.
 * Sempre divide por 10, mesmo se a lista for menor.
 */
export function precisaoEm10(top10, relevantes) {
  return acertos(top10, relevantes) / 10;
}

/**
 * Recall@10: dos filmes relevantes escondidos, que fração apareceu no top 10.
 * Ex.: 2 acertos de 8 relevantes dão 0,25. Usuário sem relevantes não pode ser avaliado (divisão por 0).
 */
export function recallEm10(top10, relevantes) {
  if (relevantes.size === 0) throw new Error('recallEm10: usuário sem filmes relevantes; remova-o antes de avaliar.');
  return acertos(top10, relevantes) / relevantes.size;
}

/**
 * NDCG@10 (ganho cumulativo descontado e normalizado), a métrica principal do projeto.
 * Cada acerto vale 1 / log2(posição + 1): na 1ª posição vale 1, na 2ª ≈ 0,63, na 10ª ≈ 0,29.
 * DCG soma esses valores; IDCG é o melhor DCG possível (todos os relevantes no topo).
 * NDCG = DCG ÷ IDCG, entre 0 e 1.
 */
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

/** Cobertura: fração dos 1682 filmes que aparece em pelo menos uma lista. Baixa = recomenda sempre os mesmos. */
export function cobertura(listasTop10) {
  return new Set(listasTop10.flat()).size / TOTAL_FILMES;
}

/**
 * Média do nº de notas no treino dos filmes recomendados (contagem bruta, não a escala popEscalada).
 * Valor alto indica viés para filmes populares.
 */
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

/**
 * Monta o gabarito: para cada usuário, o conjunto de filmes escondidos com nota ≥ 4.
 * Usuários sem nenhum relevante não entram no mapa (não há como avaliá-los).
 */
export function relevantesPorUsuario(alvos) {
  const mapa = new Map();
  for (const { usuario, filme, nota } of alvos) {
    if (nota < 4) continue;
    if (!mapa.has(usuario)) mapa.set(usuario, new Set());
    mapa.get(usuario).add(filme);
  }
  return mapa;
}

/**
 * Avalia um sistema inteiro: calcula NDCG, precisão e recall de cada usuário e tira a média.
 * Exige, para cada usuário do gabarito, uma lista de exatamente 10 ids distintos.
 * @returns médias, cobertura, popularidadeMediaContagem, nUsuarios e porUsuario (usado no bootstrap)
 */
export function avaliarSistema(top10PorUsuario, relevantesMap, contagens) {
  const porUsuario = new Map();
  const listas = [];
  for (const [usuario, relevantes] of relevantesMap) {
    const lista = top10PorUsuario.get(usuario);
    if (!lista) {
      throw new Error(`avaliarSistema: falta a lista top 10 do usuário ${usuario}; calcule-a antes de avaliar.`);
    }
    if (lista.length !== 10) {
      throw new Error(`avaliarSistema: a lista do usuário ${usuario} tem ${lista.length} filmes em vez de 10; gere sempre o top 10 completo.`);
    }
    if (new Set(lista).size !== lista.length) {
      throw new Error(`avaliarSistema: a lista do usuário ${usuario} tem ids repetidos; remova as repetições antes de avaliar.`);
    }
    listas.push(lista.slice(0, 10));
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
    // média da contagem bruta de avaliações de treino dos filmes recomendados (não é a escala popEscalada)
    popularidadeMediaContagem: popularidadeMedia(listas, contagens),
    nUsuarios: n,
    porUsuario,
  };
}
