import { carregarDataset } from './dados/carregar.js';
import { criarDivisoes } from './dados/divisoes.js';
import { calcularRegua } from './features/regua.js';

// fase 'exp': treino = treinoExp, alvos = validação. fase 'final': treino = base, alvos = teste.
export function criarContexto({ fase, dirDados }) {
  if (fase !== 'exp' && fase !== 'final') {
    throw new Error(`fase inválida: ${fase} (use 'exp' ou 'final')`);
  }
  const dataset = carregarDataset(dirDados);
  const divisoes = criarDivisoes(dataset, { semente: 42 });
  const treino = fase === 'exp' ? divisoes.treinoExp : divisoes.treinoFinal;
  const alvos = fase === 'exp' ? divisoes.validacao : divisoes.teste;
  const { filmes, usuarios, generos, ocupacoes } = dataset;
  const regua = calcularRegua({ treino, filmes, usuarios, generos, ocupacoes });
  return { dataset, divisoes, treino, alvos, regua };
}
