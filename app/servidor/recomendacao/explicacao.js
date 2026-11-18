// Explicação de um item S1 (spec 4.4, passo 9): até 2 curtidos com vetor que mais contribuem para o
// escore do item. Não altera a ordem da lista.
//
// Contribuição de i ao escore de j: c_ij = |F_i ∩ F_j| / (√|F_i|·√|F_j|). Como √|F_j| é comum a
// todos os i, a ordem compara a_i/√|F_i| com a = |F_i ∩ F_j|, em inteiros e sem ponto flutuante:
// i vem antes de k quando a_i²·|F_k| > a_k²·|F_i|; empate → menor id. Com |F| ≤ 943, os produtos
// ficam abaixo de 10^9, muito longe de 2^53.

const MAX_EXPLICACOES = 2;

/**
 * @param fc { fasPorFilme: Map<id, number[]> } (o fc em memória)
 * @param curtidosComVetor ids curtidos que têm vetor
 * @param itemId o item S1 a explicar
 * @returns ids (no máximo 2) com |F_i ∩ F_j| > 0, em ordem de contribuição decrescente e id crescente
 */
export function explicar(fc, curtidosComVetor, itemId) {
  const fasJ = fc.fasPorFilme.get(itemId);
  if (!fasJ || fasJ.length === 0) return [];
  const conjuntoJ = new Set(fasJ);
  const candidatos = [];
  for (const id of curtidosComVetor) {
    const fasI = fc.fasPorFilme.get(id);
    if (!fasI || fasI.length === 0) continue;
    let a = 0;
    for (const u of fasI) if (conjuntoJ.has(u)) a++;
    if (a > 0) candidatos.push({ id, a, n: fasI.length });
  }
  candidatos.sort((x, y) => {
    const esq = x.a * x.a * y.n;
    const dir = y.a * y.a * x.n;
    if (esq !== dir) return esq > dir ? -1 : 1;
    return x.id - y.id;
  });
  return candidatos.slice(0, MAX_EXPLICACOES).map((c) => c.id);
}
