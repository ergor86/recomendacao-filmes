import { carregarDataset } from './dados/carregar.js';
import { criarDivisoes } from './dados/divisoes.js';
import { calcularRegua } from './features/regua.js';

/**
 * Prepara tudo o que um script precisa para trabalhar em uma das duas fases:
 * - 'exp' (experimentos): treino = u1.base sem as notas escondidas; alvos = notas escondidas da validação.
 * - 'final': treino = u1.base inteiro; alvos = u1.test (usado uma única vez, na avaliação final).
 * A régua é calculada só com o treino da fase, para não vazar informação dos alvos.
 * @returns { dataset, divisoes, treino, alvos, regua }
 */
export function criarContexto({ fase, dirDados }) {
  if (fase !== 'exp' && fase !== 'final') {
    throw new Error(`fase inválida: ${fase} (use 'exp' ou 'final')`);
  }
  const dataset = carregarDataset(dirDados);
  const divisoes = criarDivisoes(dataset, { semente: 42 });
  const treino = fase === 'exp' ? divisoes.treinoExp : divisoes.treinoFinal;
  const alvos = fase === 'exp' ? divisoes.validacao : divisoes.teste;
  const { filmes, usuarios, generos, ocupacoes } = dataset;
  const regua = calcularRegua({ treino, filmes, usuarios, generos, ocupacoes, fase });
  return { dataset, divisoes, treino, alvos, regua };
}
