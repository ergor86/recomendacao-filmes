// Sistemas da v2 (spec §8.2–§8.5): a grade de configurações por cenário do portão, os nomes S0–S4,
// as chaves de simplicidade da escolha, o top 10 dos sistemas sem rede (S0 e S1) e os relatórios
// da grade: conferência da FC150 única, posições vindas do preenchimento, contribuições descritivas,
// MDE descritivo de v2 × v1 com o ganho sob a mesma subamostragem e a lista da medida 4.
import path from 'node:path';
import { ndcgEm10 } from './metricas.js';
import { erroPadraoPareado, bootstrapPareado } from './estatistica.js';
import { subamostrarRelevantes, desvioAmostral, mdeFormula } from './mde.js';
import { kNDoSistema } from './fidelidade.js';

const VALORES = [0, 50, 100, 150];
const ORCAMENTO_FIXO = [{ k: 150, n: 0 }, { k: 100, n: 50 }, { k: 50, n: 100 }, { k: 0, n: 150 }];

export const ARQ_GRADE_OFICIAL = 'resultados/grade-v2-exp.json';
export const AVISO_VERIFICACAO = 'execução de verificação; não é a grade oficial';
export const FRASE_OTIMISTA = 'escolha e parada usam a validação; não é estimativa imparcial';

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Configurações (K, N) com rede a treinar no cenário do portão (§8.1, §8.2, corte 2 da §12).
 * aprovado: as 15 células de {0, 50, 100, 150}², sem (0, 0), em K e depois N crescentes; com o corte
 * do orçamento variável, só as 4 de orçamento fixo 150. reprovado: só (150, 0), com ou sem o corte.
 */
export function configuracoesDaGrade(cenario, { cortarOrcamentoVariavel = false } = {}) {
  if (cenario === 'reprovado') return [{ k: 150, n: 0 }];
  if (cenario !== 'aprovado') throw new Error(`cenário do portão inválido: ${cenario} (use aprovado ou reprovado; rode npm run portao-v2)`);
  if (cortarOrcamentoVariavel) return ORCAMENTO_FIXO.map((c) => ({ ...c }));
  const grade = [];
  for (const k of VALORES) for (const n of VALORES) if (k + n > 0) grade.push({ k, n });
  return grade;
}

/** Nome do sistema com rede da configuração (K, N): S2 = (150, 0), S3 = (0, 150), S4-k-n as demais. */
export function nomeSistema({ k, n }) {
  if (k === 150 && n === 0) return 'S2';
  if (k === 0 && n === 150) return 'S3';
  return `S4-${k}-${n}`;
}

/** Grupo do relatório (§8.2): 'fixo' quando K + N = 150, senão 'variavel'. */
export function grupoOrcamento({ k, n }) {
  return k + n === 150 ? 'fixo' : 'variavel';
}

/**
 * Chave de simplicidade da §8.4 (comparada lexicograficamente, menor = mais simples):
 * S1 → [0]; S2 → [1]; S0 → [2, 0, 0, 10, 10]; demais → [2, 1, N, K + N, K].
 */
export function simplicidadeV2(sistema) {
  if (sistema === 'S1') return [0];
  if (sistema === 'S2') return [1];
  if (sistema === 'S0') return [2, 0, 0, 10, 10];
  if (!/^S3$|^S4-\d+-\d+$/.test(sistema)) throw new Error(`sistema desconhecido: ${sistema} (use S0–S3 ou S4-<k>-<n>)`);
  const { k, n } = kNDoSistema(sistema);
  return [2, 1, n, k + n, k];
}

/** Top 10 de S1 (FC sozinha): o início da FC150, já ordenada pelo escore oficial. */
export function top10S1(fc150) {
  return fc150.slice(0, 10);
}

/** Top 10 de S0 (popularidade): os 10 primeiros populares não vistos. */
export function top10S0(populares) {
  return populares.slice(0, 10);
}

// Interpreta "k-n" da opção --somente.
function lerCelula(texto) {
  const m = /^(\d+)-(\d+)$/.exec(texto);
  const k = m ? Number(m[1]) : NaN;
  const n = m ? Number(m[2]) : NaN;
  if (!m || !VALORES.includes(k) || !VALORES.includes(n) || k + n === 0) {
    throw new Error(`--somente: configuração inválida "${texto}" (use k-n com k, n ∈ {0, 50, 100, 150}, sem 0-0)`);
  }
  return { k, n };
}

/**
 * Diz se `alvo` é a pasta `base` ou está dentro dela (caminhos resolvidos a partir do diretório atual).
 * No Windows a comparação ignora maiúsculas, como o NTFS.
 */
export function dentroDe(base, alvo, plataforma = process.platform) {
  const norm = (p) => (plataforma === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(base), norm(alvo));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Argumentos do script 20. Oficial (sem opções de verificação): grava resultados/grade-v2-exp.json e
 * modelos em modelos/. Opções de verificação (--somente k-n,..., --max-epocas n, --saida arq,
 * --dir-modelos dir): exigem --saida fora de resultados/ e --dir-modelos fora de modelos/.
 * --cortar-orcamento-variavel é do modo oficial (decidido antes de rodar, §12).
 */
export function lerArgumentosGrade(argv) {
  const a = { somente: null, maxEpocas: 50, saida: null, dirModelos: null, cortarOrcamentoVariavel: false };
  let verificacao = false;
  for (let i = 0; i < argv.length; i++) {
    const opcao = argv[i];
    const valor = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${opcao} exige um valor`);
      return v;
    };
    if (opcao === '--cortar-orcamento-variavel') a.cortarOrcamentoVariavel = true;
    else if (opcao === '--somente') { a.somente = valor().split(',').map(lerCelula); verificacao = true; }
    else if (opcao === '--max-epocas') {
      const v = valor();
      a.maxEpocas = Number(v);
      if (!Number.isInteger(a.maxEpocas) || a.maxEpocas < 1) throw new Error(`--max-epocas inválido: ${v} (inteiro ≥ 1)`);
      verificacao = true;
    } else if (opcao === '--saida') { a.saida = valor(); verificacao = true; }
    else if (opcao === '--dir-modelos') { a.dirModelos = valor(); verificacao = true; }
    else throw new Error(`opção desconhecida: ${opcao} (use --cortar-orcamento-variavel, --somente, --max-epocas, --saida, --dir-modelos)`);
  }
  if (!verificacao) return { ...a, saida: ARQ_GRADE_OFICIAL, dirModelos: 'modelos', verificacao };
  if (!a.saida || dentroDe('resultados', a.saida)) {
    throw new Error(`${AVISO_VERIFICACAO}: informe --saida com um arquivo fora de resultados/ (lá ficam os resultados oficiais, como ${ARQ_GRADE_OFICIAL})`);
  }
  if (!a.dirModelos || dentroDe('modelos', a.dirModelos)) {
    throw new Error(`${AVISO_VERIFICACAO}: informe --dir-modelos com uma pasta fora de modelos/`);
  }
  return { ...a, verificacao };
}

/**
 * Confere a FC150 única antes de avaliar: para cada usuário avaliado, fc150.get(u) tem 150 ids e
 * contém o top 10 de S1 e o top 10 de S3 em cada semente. Falha alto na primeira violação.
 * @param top10S1PorUsuario Map<u, ids>; @param top10S3PorSemente Map<u, ids>[] (vazio sem S3)
 */
export function conferirFC150(fc150, usuarios, top10S1PorUsuario, top10S3PorSemente) {
  for (const u of usuarios) {
    const lista = fc150.get(u);
    if (!lista) throw new Error(`FC150 sem o usuário ${u}: rode npm run candidatos-v2 -- --fase v2-exp`);
    if (lista.length !== 150) throw new Error(`FC150 do usuário ${u} tem ${lista.length} filmes em vez de 150`);
    const conjunto = new Set(lista);
    const conferir = (sistema, top10) => {
      for (const id of top10 ?? []) {
        if (!conjunto.has(id)) throw new Error(`top 10 de ${sistema} do usuário ${u} tem o filme ${id} fora da FC150: a FC150 não é única`);
      }
    };
    conferir('S1', top10S1PorUsuario.get(u));
    top10S3PorSemente.forEach((m, i) => conferir(`S3 (semente ${i + 1})`, m.get(u)));
  }
}

/**
 * Posições do top 10 vindas do preenchimento (§6): soma, por usuário, dos ids do top 10 cuja fonte na
 * lista do sistema é 'preenchimento'. @param fontes Map<u, Map<id, 'pop'|'fc'|'preenchimento'>>
 * @returns { posicoes, usuarios (com ≥ 1 posição), nUsuarios }
 */
export function posicoesDoPreenchimento(top10PorUsuario, fontes) {
  let posicoes = 0;
  let usuarios = 0;
  for (const [u, top10] of top10PorUsuario) {
    let c = 0;
    for (const id of top10) {
      const f = fontes.get(u)?.get(id);
      if (f === undefined) throw new Error(`filme ${id} do top 10 do usuário ${u} não está na lista de candidatos do sistema`);
      if (f === 'preenchimento') c++;
    }
    posicoes += c;
    if (c > 0) usuarios++;
  }
  return { posicoes, usuarios, nUsuarios: top10PorUsuario.size };
}

/** Diferença pareada a − b por usuário: média, EP, IC 95% por bootstrap (5.000, semente 2026), rotulada descritiva. */
export function diferencaDescritiva(a, b) {
  if (a.size !== b.size || [...a.keys()].some((u) => !b.has(u))) {
    throw new Error(`diferencaDescritiva: conjuntos de usuários diferentes (${a.size} e ${b.size}); avalie todos no mesmo conjunto`);
  }
  const difs = [...a].map(([u, v]) => v - b.get(u));
  const { media: m, ic95 } = bootstrapPareado(difs, { reamostragens: 5000, semente: 2026 });
  return { media: m, erroPadrao: erroPadraoPareado(difs), ic95, nUsuarios: difs.length, rotulo: 'descritiva' };
}

// Entre os nomes presentes, o de maior média; empate pela simplicidade (§8.4) e depois pelo nome.
function melhorPorMedia(porUsuario, nomes) {
  const presentes = nomes.filter((n) => porUsuario.has(n));
  if (presentes.length === 0) return null;
  const mediaDe = (n) => media([...porUsuario.get(n).values()]);
  return presentes.reduce((b, c) => {
    const d = mediaDe(c) - mediaDe(b);
    if (d !== 0) return d > 0 ? c : b;
    const sb = simplicidadeV2(b);
    const sc = simplicidadeV2(c);
    for (let i = 0; i < Math.max(sb.length, sc.length); i++) {
      if ((sc[i] ?? 0) !== (sb[i] ?? 0)) return (sc[i] ?? 0) < (sb[i] ?? 0) ? c : b;
    }
    return c < b ? c : b;
  });
}

/**
 * Contribuições da §8.5, todas descritivas: S1 − S0; S3 − S1; melhor de (100, 50), (50, 100) e
 * (0, 150) − S2; melhor S4 − S3; melhor S4 − S2. Os "melhores" são escolhidos pela média depois de ver
 * os resultados (registrados em `melhor`). Conta com sistema não rodado → a string `motivoAusente`.
 * @param porUsuario Map<nome, Map<u, ndcg>>
 */
export function contribuicoesV2(porUsuario, { motivoAusente }) {
  const s4 = [...porUsuario.keys()].filter((n) => n.startsWith('S4-')).sort();
  const melhorFixo = melhorPorMedia(porUsuario, ['S4-100-50', 'S4-50-100', 'S3']);
  const melhorS4 = melhorPorMedia(porUsuario, s4);
  const conta = (a, b) => {
    if (!a || !b || !porUsuario.has(a) || !porUsuario.has(b)) return motivoAusente;
    return diferencaDescritiva(porUsuario.get(a), porUsuario.get(b));
  };
  const comMelhor = (melhor, b) => {
    const r = conta(melhor, b);
    return typeof r === 'string' ? r : { melhor, escolhidoDepoisDeVer: true, ...r };
  };
  return {
    'S1 - S0': conta('S1', 'S0'),
    'S3 - S1': conta('S3', 'S1'),
    'melhor de (100, 50), (50, 100), (0, 150) - S2': comMelhor(melhorFixo, 'S2'),
    'melhor S4 - S3': comMelhor(melhorS4, 'S3'),
    'melhor S4 - S2': comMelhor(melhorS4, 'S2'),
  };
}

// NDCG médio entre as sementes de um usuário, contra um gabarito.
function ndcgMedioSementes(top10PorSemente, u, relevantes) {
  return media(top10PorSemente.map((m) => {
    const lista = m.get(u);
    if (!lista) throw new Error(`MDE descritivo: falta o top 10 do usuário ${u}`);
    return ndcgEm10(lista, relevantes);
  }));
}

/**
 * MDE descritivo de v2 × v1 (§8.3, depois da grade) e o ganho sob a mesma subamostragem: para r = 1..20,
 * subamostra os relevantes com q (subamostrarRelevantes), recalcula o NDCG dos top 10 já calculados
 * (média das sementes) nos usuários que mantiveram relevantes, e toma σ_d,r e a média de v2 − v1.
 * @param top10V2, top10V1 Map<u, ids>[] (uma por semente; [mapa] sem rede)
 * @returns { sigmaD, sigmaPorRepeticao, nPorRepeticao, ganhoPorRepeticao, mde, ganhoSobSubamostragem, otimista, nota }
 */
export function mdeDescritivoV2({ top10V2, top10V1, relevantes, q, nt }) {
  const sigmaPorRepeticao = [];
  const nPorRepeticao = [];
  const ganhoPorRepeticao = [];
  for (let r = 1; r <= 20; r++) {
    const sub = subamostrarRelevantes(relevantes, q, r);
    const difs = [...sub].map(([u, rel]) => ndcgMedioSementes(top10V2, u, rel) - ndcgMedioSementes(top10V1, u, rel));
    sigmaPorRepeticao.push(desvioAmostral(difs));
    nPorRepeticao.push(difs.length);
    ganhoPorRepeticao.push(media(difs));
  }
  const sigmaD = media(sigmaPorRepeticao);
  return {
    sigmaD, sigmaPorRepeticao, nPorRepeticao, ganhoPorRepeticao, q, nt,
    mde: mdeFormula(sigmaD, nt),
    ganhoSobSubamostragem: media(ganhoPorRepeticao),
    otimista: true,
    nota: FRASE_OTIMISTA,
  };
}

/**
 * Sistemas da medida 4 de fidelidade depois da grade (§8.1): aprovado → S3 e v2; reprovado → v2.
 * A v2 sai se for S0 (não usa a FC) ou S1 (já medida sem rede).
 */
export function pedidosMedida4(cenario, escolhida) {
  const pedidos = cenario === 'aprovado' ? ['S3', 'v2'] : ['v2'];
  return pedidos.filter((p) => !(p === 'v2' && (escolhida === 'S0' || escolhida === 'S1')));
}
