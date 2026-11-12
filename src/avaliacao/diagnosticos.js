// Diagnósticos de sanidade dos modelos: AUC (Mann-Whitney) e correlação de Pearson.
// Funções puras, sem dependências.

/**
 * AUC pela estatística de Mann-Whitney com posto médio nos empates.
 * Scores constantes dão exatamente 0,5. Ordena uma vez (O(n log n)), serve para ~200 mil linhas.
 * `rotulos` são 0/1; sem positivos ou sem negativos o AUC não existe e a função falha.
 */
export function auc(scores, rotulos) {
  const n = scores.length;
  if (rotulos.length !== n) {
    throw new Error(`auc: scores e rótulos com tamanho diferente (${n} e ${rotulos.length}); confira o pareamento`);
  }
  let positivos = 0;
  for (let i = 0; i < n; i++) if (rotulos[i] === 1) positivos++;
  const negativos = n - positivos;
  if (positivos === 0) throw new Error('auc: não há nenhum positivo (rótulo 1); o AUC não é definido, confira os pares usados');
  if (negativos === 0) throw new Error('auc: não há nenhum negativo (rótulo 0); o AUC não é definido, confira os pares usados');
  const ordem = new Uint32Array(n);
  for (let i = 0; i < n; i++) ordem[i] = i;
  ordem.sort((a, b) => scores[a] - scores[b]);
  // Soma dos postos (1-based) dos positivos; grupos empatados recebem o posto médio.
  let somaPostos = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[ordem[j + 1]] === scores[ordem[i]]) j++;
    const postoMedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (rotulos[ordem[k]] === 1) somaPostos += postoMedio;
    i = j + 1;
  }
  return (somaPostos - (positivos * (positivos + 1)) / 2) / (positivos * negativos);
}

/**
 * Correlação de Pearson entre dois vetores. Devolve null quando um deles é constante (desvio 0),
 * nunca NaN. Tamanhos diferentes ou vazios dão erro.
 */
export function correlacao(a, b) {
  if (a.length !== b.length) {
    throw new Error(`correlacao: vetores com tamanho diferente (${a.length} e ${b.length})`);
  }
  const n = a.length;
  if (n === 0) throw new Error('correlacao: vetores vazios');
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return null;
  return sab / Math.sqrt(saa * sbb);
}
