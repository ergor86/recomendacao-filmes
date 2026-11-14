import { carregarDataset } from './dados/carregar.js';
import { criarDivisoes } from './dados/divisoes.js';
import { dividirTeste2 } from './dados/teste2.js';
import { calcularRegua } from './features/regua.js';

/**
 * Prepara tudo o que um script precisa para trabalhar em uma das fases:
 * - 'exp' (experimentos): treino = u1.base sem as notas escondidas; alvos = notas escondidas da validação.
 * - 'final': treino = u1.base inteiro; alvos = u1.test (usado uma única vez, na avaliação final).
 *   O u1.test só é lido com incluirTeste: true; sem isso, alvos = null.
 * - 'v2-exp' e 'v2-final' (Plano 3): o u1.test nunca é lido. O teste-2 (notas de usuários 1–462
 *   escondidas dentro do u1.base) sai do treino das duas fases.
 *   v2-exp: treino = semTeste2 sem a validação (463–943); alvos = a validação.
 *   v2-final: treino = semTeste2; alvos = teste-2 só com incluirTeste2: true, senão null.
 * A régua é calculada só com o treino da fase, para não vazar informação dos alvos.
 * @returns fases exp/final: { dataset, divisoes, treino, alvos, regua };
 *          fases v2: { fase, dataset: { filmes, usuarios, generos, ocupacoes }, treino, alvos, regua }
 */
export function criarContexto({ fase, dirDados, incluirTeste = false, incluirTeste2 = false }) {
  const v2 = fase === 'v2-exp' || fase === 'v2-final';
  if (!v2 && fase !== 'exp' && fase !== 'final') {
    throw new Error(`fase inválida: ${fase} (use 'exp', 'final', 'v2-exp' ou 'v2-final')`);
  }
  if (v2 && incluirTeste) {
    throw new Error(`incluirTeste não é permitido na fase ${fase}: o u1.test nunca é lido no Plano 3`);
  }
  if (incluirTeste2 && fase !== 'v2-final') {
    throw new Error(`incluirTeste2 só vale na fase 'v2-final' (recebido: ${fase})`);
  }

  if (v2) {
    const { base, filmes, usuarios, generos, ocupacoes } = carregarDataset(dirDados);
    const { teste2, semTeste2 } = dividirTeste2(base);
    let treino;
    let alvos;
    if (fase === 'v2-exp') {
      const d = criarDivisoes({ base: semTeste2, teste: null }, { semente: 42 });
      treino = d.treinoExp;
      alvos = d.validacao;
    } else {
      treino = semTeste2;
      alvos = incluirTeste2 ? teste2 : null;
    }
    const regua = calcularRegua({ treino, filmes, usuarios, generos, ocupacoes, fase });
    return { fase, dataset: { filmes, usuarios, generos, ocupacoes }, treino, alvos, regua };
  }

  const dataset = carregarDataset(dirDados, { incluirTeste });
  const divisoes = criarDivisoes(dataset, { semente: 42 });
  const treino = fase === 'exp' ? divisoes.treinoExp : divisoes.treinoFinal;
  const alvos = fase === 'exp' ? divisoes.validacao : divisoes.teste;
  const { filmes, usuarios, generos, ocupacoes } = dataset;
  const regua = calcularRegua({ treino, filmes, usuarios, generos, ocupacoes, fase });
  return { dataset, divisoes, treino, alvos, regua };
}
