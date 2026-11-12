/**
 * Cria um gerador de números aleatórios com semente (algoritmo mulberry32).
 * Diferente de Math.random, a mesma semente gera sempre a mesma sequência, em qualquer
 * máquina. É o que torna as divisões e o bootstrap reprodutíveis.
 * @returns função que devolve um número em [0, 1) a cada chamada
 */
export function criarAleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Embaralha uma lista com o algoritmo de Fisher-Yates (todas as ordens são igualmente prováveis).
 * Devolve uma cópia; a lista original não é alterada.
 */
export function embaralhar(array, aleatorio) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
