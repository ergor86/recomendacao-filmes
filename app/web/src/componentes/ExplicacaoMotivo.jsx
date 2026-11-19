// Textos literais da spec 7 ("Textos de ExplicacaoMotivo"), um por motivo de Recomendacoes.
const TEXTOS = Object.freeze({
  personalizado: 'Filmes curtidos por pessoas que curtiram os mesmos filmes que você.',
  parcial: 'Encontramos menos de 10 filmes parecidos com seus gostos; completamos com os mais avaliados nos dados de 1998.',
  sem_semelhantes: 'Não encontramos filmes parecidos que você ainda não tenha marcado; mostramos os mais avaliados.',
  sem_curtidas: "Você ainda não marcou filmes de que gostou. Enquanto isso, mostramos os mais avaliados. Marque alguns como 'Gostei' ou dê 4–5 estrelas.",
  curtidas_sem_vetor: 'Os filmes que você curtiu são raros nos dados de 1998. Experimente curtir títulos mais conhecidos.',
});

/** Explica, em uma frase, por que a lista tem este aspecto. Motivo desconhecido não mostra nada. */
export default function ExplicacaoMotivo({ motivo }) {
  const texto = TEXTOS[motivo];
  return texto ? <p className="explicacao-motivo">{texto}</p> : null;
}
