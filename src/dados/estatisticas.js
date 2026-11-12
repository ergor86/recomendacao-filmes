// Estatísticas descritivas usadas na análise exploratória (script 03-eda).

/** Média aritmética; 0 para lista vazia. */
export function media(valores) {
  if (valores.length === 0) return 0;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * Mediana: o valor do meio depois de ordenar; para quantidade par, média dos dois centrais.
 * É menos sensível a valores extremos do que a média.
 */
export function mediana(valores) {
  if (valores.length === 0) return 0;
  const o = [...valores].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Mínimo, mediana, média e máximo de uma lista de números. */
export function resumoLista(valores) {
  return {
    min: Math.min(...valores),
    mediana: mediana(valores),
    media: media(valores),
    max: Math.max(...valores),
  };
}

/** Conta quantas notas 1, 2, 3, 4 e 5 existem nas avaliações. */
export function distribuicaoNotas(avaliacoes) {
  const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const a of avaliacoes) d[a.nota] += 1;
  return d;
}

/**
 * Descreve um grupo de usuários, para comparar validação e teste (spec §3):
 * notas e curtidas (nota ≥ 4) por usuário, idade média e fração de mulheres.
 * Usuários sem avaliações entram com contagem 0.
 */
export function resumoPopulacao(avaliacoes, usuariosIds, usuarios) {
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  const notas = new Map(usuariosIds.map((id) => [id, 0]));
  const curtidas = new Map(usuariosIds.map((id) => [id, 0]));
  for (const a of avaliacoes) {
    if (!notas.has(a.usuario)) continue;
    notas.set(a.usuario, notas.get(a.usuario) + 1);
    if (a.nota >= 4) curtidas.set(a.usuario, curtidas.get(a.usuario) + 1);
  }
  const n = [...notas.values()];
  const c = [...curtidas.values()];
  const perfis = usuariosIds.map((id) => porId.get(id));
  return {
    notasMedia: media(n),
    notasMediana: mediana(n),
    curtidasMedia: media(c),
    curtidasMediana: mediana(c),
    idadeMedia: media(perfis.map((u) => u.idade)),
    fracaoMulheres: media(perfis.map((u) => (u.genero === 'F' ? 1 : 0))),
  };
}
