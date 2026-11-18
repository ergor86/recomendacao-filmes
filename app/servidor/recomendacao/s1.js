// Pipeline da S1 (spec 4.4) e efeitos das interações (spec 6.2).
// A lista é a S1 congelada da pesquisa: uma busca com M = 300, FC150 = os 150 primeiros e top 10 =
// prefixo da FC150, completado por populares. A única mudança é o conjunto de exclusão: as
// interações do perfil mais os OCULTOS.
import { buscarColaborativos } from '../../../src/banco/busca-fc.js';
import { perfilFC, vetorDeBusca } from '../../../src/fc/referencia.js';
import { HASHES } from '../../integridade.js';
import { explicar } from './explicacao.js';

export const M = 300;
export const N_FC = 150;
export const K = 10;
export const MODO = 'hnsw';

/** Um filme tem vetor quando está na FC com pelo menos um fã. */
export function temVetorNoFc(fc, id) {
  const fas = fc.fasPorFilme.get(id);
  return Boolean(fas) && fas.length > 0;
}

// "Curtida" (spec 4.4, passo 2): gostei ∪ notas 4–5.
function ehCurtida({ tipo, nota }) {
  return tipo === 'gostei' || (tipo === 'nota' && nota >= 4);
}

/** A interação entra no perfil: curtida em filme com vetor. Define `curtidosComVetor` e os efeitos. */
export function contribui(interacao, temVetor) {
  return temVetor && ehCurtida(interacao);
}

/**
 * Efeitos de um PUT (nova = interação) ou DELETE (nova = null) sobre o mesmo filme (spec 6.2).
 * @returns { contribuiParaPerfil, excluidoDasRecomendacoes, perfilMudou }
 */
export function calcularEfeitos({ nova, anterior, temVetor }) {
  const contribuia = anterior ? contribui(anterior, temVetor) : false;
  if (nova === null) {
    return { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: contribuia };
  }
  const contribuiParaPerfil = contribui(nova, temVetor);
  return { contribuiParaPerfil, excluidoDasRecomendacoes: true, perfilMudou: contribuiParaPerfil !== contribuia };
}

/**
 * Passos 1 a 3: curtidos (ids crescentes), os que têm vetor, e excluir = interagidos ∪ ocultos.
 * @param interacoes Array<{ filmeId, tipo, nota }>
 */
export function derivarConjuntos(interacoes, fc, ocultos) {
  const curtidos = [];
  const curtidosComVetor = [];
  const excluir = new Set(ocultos);
  for (const i of interacoes) {
    excluir.add(i.filmeId);
    if (ehCurtida(i)) curtidos.push(i.filmeId);
    if (contribui(i, temVetorNoFc(fc, i.filmeId))) curtidosComVetor.push(i.filmeId);
  }
  const asc = (a, b) => a - b;
  return { curtidos: curtidos.sort(asc), curtidosComVetor: curtidosComVetor.sort(asc), excluir };
}

/**
 * Passos 1 a 9 da spec 4.4.
 * @param rankingPopulares ids em ordem de n_notas decrescente, depois id
 * @param buscar (vetor, excluirOrdenado, m, modo) → Promise<{ lista, linhasPedidas, empateNaoResolvido }>
 */
export async function recomendar({ interacoes, fc, ocultos, rankingPopulares, buscar }) {
  const { curtidos, curtidosComVetor, excluir } = derivarConjuntos(interacoes, fc, ocultos);

  let semS1; // motivo quando a S1 não traz nenhum item
  let h = null;
  if (curtidos.length === 0) semS1 = 'sem_curtidas';
  else {
    const perfil = perfilFC(fc, curtidos);
    if (perfil === null) semS1 = 'curtidas_sem_vetor';
    else {
      semS1 = 'sem_semelhantes';
      const excluirOrdenado = [...excluir].sort((a, b) => a - b);
      h = await buscar(vetorDeBusca(perfil), excluirOrdenado, M, MODO);
    }
  }

  // Passo 6: S1 = prefixo de K da FC150, que é o prefixo de N_FC de uma única busca H com M.
  const fc150 = h ? h.lista.slice(0, N_FC) : [];
  const itens = fc150.slice(0, K).map(({ id, escore }) => ({
    id, fonte: 'S1', escore, porque: explicar(fc, curtidosComVetor, id),
  }));
  const nS1 = itens.length;

  // Passo 7: completa com populares, sem excluir e sem repetir.
  const naLista = new Set(itens.map((x) => x.id));
  for (const id of rankingPopulares) {
    if (itens.length >= K) break;
    if (excluir.has(id) || naLista.has(id)) continue;
    itens.push({ id, fonte: 'populares', escore: null, porque: [] });
    naLista.add(id);
  }

  // Passo 8
  const motivo = nS1 === K ? 'personalizado' : nS1 > 0 ? 'parcial' : semS1;

  return {
    motivo,
    itens,
    perfil: { curtidos, curtidosComVetor },
    busca: {
      m: M,
      nFc: N_FC,
      linhasPedidas: h ? h.linhasPedidas : null,
      empateNaoResolvido: h ? h.empateNaoResolvido : null,
      candidatosS1: h ? h.lista.length : 0,
      nExcluidos: excluir.size,
    },
  };
}

/**
 * Busca no banco (pool de leitura com search_path=v2_final,public). A rota de produção passa sempre
 * MODO; só os testes passam 'exata'.
 */
export function criarBuscarBanco(poolLeitura) {
  return (vetor, excluirOrdenado, m, modo) => buscarColaborativos(poolLeitura, {
    vetor, excluir: excluirOrdenado, m, hashes: { regua: HASHES.regua, treino: HASHES.treino }, modo,
  });
}
