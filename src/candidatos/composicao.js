// Composição exata da lista de candidatos (K, N): P_K + os N primeiros do colaborativo (H_M)
// fora de P_K, na ordem de H_M, + preenchimento por populares. Calcula também o déficit.

/**
 * Monta a lista de candidatos com exatamente K + N filmes, sem repetição.
 * Ordem: P_K (os K primeiros populares); depois os N primeiros de `colab` fora de P_K, na ordem
 * de `colab`; depois o preenchimento com os próximos de `populares` ainda fora da lista.
 * Déficit: devK = |colab \ P_K|; elegK = nElegiveis − |elegiveisEntrePopulares ∩ P_K|;
 * completados = max(0, n − devK) separado em déficit real (faltou elegível) e de recuperação.
 * @returns { ids, fonte: Map id → 'pop'|'fc'|'preenchimento', completados, deficitReal,
 *            deficitRecuperacao, devKMaiorQueElegK }
 */
export function comporLista({ populares, colab, k, n, nElegiveis, elegiveisEntrePopulares }) {
  const pK = populares.slice(0, k);
  const noPK = new Set(pK);
  const ids = [...pK];
  const fonte = new Map(pK.map((id) => [id, 'pop']));

  const colabForaDePK = colab.filter((id) => !noPK.has(id));
  const devK = colabForaDePK.length;
  for (const id of colabForaDePK.slice(0, n)) {
    ids.push(id);
    fonte.set(id, 'fc');
  }

  const alvo = k + n;
  for (const id of populares) {
    if (ids.length >= alvo) break;
    if (fonte.has(id)) continue;
    ids.push(id);
    fonte.set(id, 'preenchimento');
  }
  if (ids.length < alvo) {
    throw new Error(
      `Populares insuficientes para o preenchimento: faltam ${alvo - ids.length} filmes para chegar a ${alvo} ` +
      `(há ${populares.length} populares não vistos). Aumente a lista de populares ou reduza K + N.`,
    );
  }

  const elegK = nElegiveis - elegiveisEntrePopulares.filter((id) => noPK.has(id)).length;
  const completados = Math.max(0, n - devK);
  const deficitReal = Math.min(completados, Math.max(0, n - elegK));
  return {
    ids,
    fonte,
    completados,
    deficitReal,
    deficitRecuperacao: completados - deficitReal,
    devKMaiorQueElegK: devK > elegK,
  };
}
