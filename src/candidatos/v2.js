// Candidatos v2 (spec §6): para cada usuário do treino da fase, uma única busca HNSW (M = 300) sobre
// a FC item-item, mais os 600 primeiros populares não vistos. As listas por configuração (K, N) são
// compostas depois, a partir deste arquivo, por listaDaConfiguracao. Também calcula o relatório de
// déficit e o sha256 da FC150.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { jsonEstavel } from '../util/json-estavel.js';
import { rankingPopularidade, popularesNaoVistos, vistosPorUsuario } from './populares.js';
import { comporLista } from './composicao.js';
import { perfilFC, elegiveisReferencia } from '../fc/referencia.js';

const N_POPULARES = 600; // populares não vistos guardados por usuário
const N_POPULARES_ELEGIVEIS = 150; // E ∩ primeiros 150 populares

/** sha256 (hex) do conteúdo de porUsuario em JSON estável. */
export function sha256CandidatosV2(porUsuario) {
  return crypto.createHash('sha256').update(jsonEstavel(porUsuario)).digest('hex');
}

/**
 * Gera as entradas de candidatos de cada usuário.
 * @param buscar (vetor, excluir, m) → Promise<{ lista: [{ id }], empateNaoResolvido }>
 * @param fc FC de referência da fase; @param treino avaliações do treino; @param contagens régua.contagens
 * @param usuarios ids dos usuários (ordem preservada); @param M tamanho da busca
 * @returns { [u]: { colab, populares, nElegiveis, elegiveisEntrePopulares, empateNaoResolvido } }
 */
export async function gerarCandidatosV2({ buscar, fc, treino, contagens, usuarios, M = 300 }) {
  const ranking = rankingPopularidade(contagens);
  const vistosPorU = vistosPorUsuario(treino);
  const porUsuario = {};
  for (const u of usuarios) {
    const vistos = vistosPorU.get(u) ?? new Set();
    const populares = popularesNaoVistos(ranking, vistos, N_POPULARES);
    const perfil = perfilFC(fc, fc.curtidosPorUsuario.get(u) ?? []);
    let entrada;
    if (perfil === null) {
      // Sem curtidas: não há perfil, logo não há busca.
      entrada = { colab: [], populares, nElegiveis: 0, elegiveisEntrePopulares: [], empateNaoResolvido: false };
    } else {
      const norma = Math.sqrt(perfil.reduce((s, x) => s + x * x, 0));
      const vetor = Array.from(perfil, (x) => x / norma);
      const excluir = [...vistos].sort((a, b) => a - b);
      const { lista, empateNaoResolvido } = await buscar(vetor, excluir, M);
      const elegiveis = elegiveisReferencia(fc, perfil, vistos);
      const primeiros = new Set(populares.slice(0, N_POPULARES_ELEGIVEIS));
      entrada = {
        colab: lista.map((x) => x.id),
        populares,
        nElegiveis: elegiveis.size,
        elegiveisEntrePopulares: populares.filter((id) => primeiros.has(id) && elegiveis.has(id)),
        empateNaoResolvido,
      };
    }
    porUsuario[String(u)] = entrada;
  }
  return porUsuario;
}

/** Monta o objeto do arquivo: { fase, hashRegua, hashTreino, M, sha256, porUsuario }. */
export function montarArquivoCandidatosV2(fase, hashRegua, hashTreino, porUsuario) {
  return { fase, hashRegua, hashTreino, M: 300, sha256: sha256CandidatosV2(porUsuario), porUsuario };
}

/**
 * Lê e valida o arquivo de candidatos v2: falha alto se ausente, se o sha256 não confere ou se os
 * hashes de régua e de treino diferem dos em uso.
 * @returns Map<usuário numérico, entrada>
 */
export function lerCandidatosV2(caminho, { hashRegua, hashTreino }) {
  const fase = /candidatos-v2-(v2-\w+)\.json$/.exec(path.basename(caminho))?.[1] ?? '<fase>';
  const comando = `rode npm run candidatos-v2 -- --fase ${fase}`;
  if (!fs.existsSync(caminho)) throw new Error(`arquivo de candidatos v2 ausente (${caminho}): ${comando}`);
  const arq = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  if (!arq.porUsuario || sha256CandidatosV2(arq.porUsuario) !== arq.sha256) {
    throw new Error(`candidatos v2 alterados (sha256 não confere): ${comando}`);
  }
  if (arq.hashRegua !== hashRegua) throw new Error(`candidatos v2 de outra régua: ${comando}`);
  if (arq.hashTreino !== hashTreino) throw new Error(`candidatos v2 de outro treino: ${comando}`);
  return new Map(Object.entries(arq.porUsuario).map(([u, v]) => [Number(u), v]));
}

/** Compõe a lista (K, N) de uma entrada: resultado de comporLista. */
export function listaDaConfiguracao(entrada, k, n) {
  return comporLista({
    populares: entrada.populares,
    colab: entrada.colab,
    k,
    n,
    nElegiveis: entrada.nElegiveis,
    elegiveisEntrePopulares: entrada.elegiveisEntrePopulares,
  });
}

/** FC150 de cada usuário: a lista da configuração (0, 150). Map<u, number[]>. */
export function fc150DeTodos(candidatos) {
  return new Map([...candidatos].map(([u, e]) => [u, listaDaConfiguracao(e, 0, 150).ids]));
}

/** sha256 (hex) da FC150: jsonEstavel do objeto { [u]: ids }. */
export function sha256FC150(mapa) {
  const obj = {};
  for (const [u, ids] of mapa) obj[u] = ids;
  return crypto.createHash('sha256').update(jsonEstavel(obj)).digest('hex');
}

/**
 * Relatório de déficit por configuração.
 * usuariosSemCurtidas conta usuários com nElegiveis = 0 (sem curtidas, ou sem nenhum elegível).
 * @param configuracoes array de [k, n]
 * @returns { 'k-n': { usuariosDeficitReal, usuariosDeficitRecuperacao, usuariosSemCurtidas, vagasReal,
 *   vagasRecuperacao, usuariosDevKMaiorQueElegK, usuariosEmpateNaoResolvido } }
 */
export function relatorioDeficit(porUsuario, configuracoes) {
  const entradas = Object.values(porUsuario);
  const saida = {};
  for (const [k, n] of configuracoes) {
    const r = {
      usuariosDeficitReal: 0, usuariosDeficitRecuperacao: 0, usuariosSemCurtidas: 0,
      vagasReal: 0, vagasRecuperacao: 0, usuariosDevKMaiorQueElegK: 0, usuariosEmpateNaoResolvido: 0,
    };
    for (const e of entradas) {
      const l = listaDaConfiguracao(e, k, n);
      if (l.deficitReal > 0) r.usuariosDeficitReal++;
      if (l.deficitRecuperacao > 0) r.usuariosDeficitRecuperacao++;
      if (e.nElegiveis === 0) r.usuariosSemCurtidas++;
      r.vagasReal += l.deficitReal;
      r.vagasRecuperacao += l.deficitRecuperacao;
      if (l.devKMaiorQueElegK) r.usuariosDevKMaiorQueElegK++;
      if (e.empateNaoResolvido) r.usuariosEmpateNaoResolvido++;
    }
    saida[`${k}-${n}`] = r;
  }
  return saida;
}
