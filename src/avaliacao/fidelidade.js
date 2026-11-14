// Fidelidade da FC (spec §5.3): compara a busca HNSW (oficial) com a referência em memória (float64)
// e com a busca exata no banco (controle). Funções puras usadas pelo script 19:
// - medidas 1 e 2 (sobreposição e listas idênticas), sobre a parte FC, antes do preenchimento;
// - medida 3 (recall dos relevantes em cada versão, pareado);
// - medida 4 (NDCG@10 do mesmo ordenador nas duas listas finais, com preenchimento; bootstrap pareado);
// - conferência busca exata = referência com tolerância τ sobre os escores em float64;
// - teto do impacto e top 10 idênticos (usados também no teste-2);
// - leitura dos argumentos e mescla da medida 4 dos sistemas com rede (rodada depois da grade).

import { ndcgEm10 } from './metricas.js';
import { recallDosCandidatos } from './experimentos.js';
import { bootstrapPareado } from './estatistica.js';

export const TAU = 1e-5; // tolerância sobre escores float64 (§5.3)
const BOOTSTRAP = { reamostragens: 5000, semente: 2026 };
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/** Sobreposição dos n primeiros: |a_n ∩ b_n| / max(|a_n|, |b_n|); 1 se as duas forem vazias. */
export function sobreposicao(a, b, n) {
  const an = a.slice(0, n);
  const bn = new Set(b.slice(0, n));
  const maior = Math.max(an.length, bn.size);
  if (maior === 0) return 1;
  return an.filter((id) => bn.has(id)).length / maior;
}

/** Os n primeiros de a e de b são a mesma lista (mesmos ids, mesma ordem, mesmo tamanho). */
export function listasIdenticas(a, b, n) {
  const an = a.slice(0, n);
  const bn = b.slice(0, n);
  return an.length === bn.length && an.every((id, i) => id === bn[i]);
}

/**
 * Conferência busca exata = referência (§5.3). Toda divergência tem de ser de precisão:
 * - troca de ordem entre dois filmes com |Δescore64| < τ;
 * - entrada ou saída na posição m de um filme com |escore64 − escoreM| < τ (escoreM = escore64 do
 *   filme na posição m da referência; null quando a referência tem menos de m filmes, e a regra
 *   não se aplica);
 * - entrada ou saída no corte de escore > 0 de um filme com escore64 < τ.
 * @param escore64 Map<id, number> com todo id das duas listas
 * @returns { ok, divergenciasPrecisao (aceitas), erros: string[] (divergências que não são de precisão) }
 */
export function conferirPrecisao({ exata, referencia, escore64, escoreM, tau = TAU }) {
  const e64 = (id) => {
    const x = escore64.get(id);
    if (!Number.isFinite(x)) throw new Error(`conferirPrecisao: falta o escore64 do filme ${id}`);
    return x;
  };
  const naExata = new Map(exata.map((id, i) => [id, i]));
  const naReferencia = new Set(referencia);
  const temM = Number.isFinite(escoreM);
  const erros = [];
  let divergenciasPrecisao = 0;

  // Entradas e saídas: só na posição m ou no corte de escore > 0.
  const foraDaOutra = [
    ...referencia.filter((id) => !naExata.has(id)).map((id) => ['saída', id]),
    ...exata.filter((id) => !naReferencia.has(id)).map((id) => ['entrada', id]),
  ];
  for (const [tipo, id] of foraDaOutra) {
    const x = e64(id);
    if (x < tau || (temM && Math.abs(x - escoreM) < tau)) divergenciasPrecisao++;
    else erros.push(`${tipo} do filme ${id} (escore64 ${x}) fora da posição m (${escoreM}) e do corte de escore > 0`);
  }

  // Trocas de ordem entre os filmes comuns às duas listas.
  const comuns = referencia.filter((id) => naExata.has(id));
  for (let i = 0; i < comuns.length; i++) {
    for (let j = i + 1; j < comuns.length; j++) {
      const a = comuns[i];
      const b = comuns[j];
      if (naExata.get(a) < naExata.get(b)) continue;
      const delta = Math.abs(e64(a) - e64(b));
      if (delta < tau) divergenciasPrecisao++;
      else erros.push(`troca de ordem entre os filmes ${a} e ${b} com |Δescore64| = ${delta} ≥ τ`);
    }
  }
  return { ok: erros.length === 0, divergenciasPrecisao, erros };
}

/** Teto do impacto da aproximação sobre o NDCG médio: min(1, nDiferentes / nt). */
export function tetoImpacto(nDiferentes, nt) {
  return Math.min(1, nDiferentes / nt);
}

// Confere que dois mapas têm exatamente os mesmos usuários.
function mesmosUsuarios(a, b, quem) {
  if (a.size !== b.size || [...a.keys()].some((u) => !b.has(u))) {
    throw new Error(`${quem}: os dois mapas precisam ter os mesmos usuários (${a.size} × ${b.size})`);
  }
}

/** Quantos usuários têm o mesmo top 10 (mesma ordem) nos dois mapas Map<u, number[]>. */
export function top10Identicos(a, b) {
  mesmosUsuarios(a, b, 'top10Identicos');
  let iguais = 0;
  for (const [u, lista] of a) if (listasIdenticas(lista, b.get(u), Infinity)) iguais++;
  return { iguais, diferentes: a.size - iguais };
}

/**
 * Medidas 1 e 2 para cada N: sobreposição média dos N primeiros e fração de usuários com a mesma
 * lista (mesma ordem). Os dois mapas Map<u, ids> precisam ter os mesmos usuários.
 * @returns { [N]: { nUsuarios, sobreposicaoMedia, fracaoIdenticas, nIdenticas } }
 */
export function medidas12(a, b, Ns) {
  mesmosUsuarios(a, b, 'medidas12');
  const saida = {};
  for (const n of Ns) {
    const sob = [];
    let nIdenticas = 0;
    for (const [u, lista] of a) {
      sob.push(sobreposicao(lista, b.get(u), n));
      if (listasIdenticas(lista, b.get(u), n)) nIdenticas++;
    }
    saida[String(n)] = { nUsuarios: a.size, sobreposicaoMedia: media(sob), fracaoIdenticas: nIdenticas / a.size, nIdenticas };
  }
  return saida;
}

/**
 * Medida 3: recall dos relevantes nos N primeiros da FC em cada versão, pareado por usuário
 * (diferença HNSW − referência, bootstrap). Só entram usuários com relevantes e com lista no mapa
 * HNSW (os sem perfil ficam de fora).
 * @returns { nUsuarios, porN: { [N]: { recallHnsw, recallReferencia, diferenca: { media, ic95 } } } }
 */
export function medida3(hnsw, referencia, relevantes, Ns) {
  const rel = new Map([...relevantes].filter(([u]) => hnsw.has(u)));
  for (const u of rel.keys()) {
    if (!referencia.has(u)) throw new Error(`medida3: falta a lista de referência do usuário ${u}`);
  }
  const porN = {};
  for (const n of Ns) {
    const corte = (m) => new Map([...rel.keys()].map((u) => [u, m.get(u).slice(0, n)]));
    const h = recallDosCandidatos(corte(hnsw), rel);
    const r = recallDosCandidatos(corte(referencia), rel);
    const difs = [...rel.keys()].map((u) => h.porUsuario.get(u) - r.porUsuario.get(u));
    porN[String(n)] = { recallHnsw: h.media, recallReferencia: r.media, diferenca: bootstrapPareado(difs, BOOTSTRAP) };
  }
  return { nUsuarios: rel.size, porN };
}

/**
 * Medida 4: NDCG@10 do mesmo ordenador sobre o top 10 da lista final HNSW e da referência. Com
 * várias sementes, o NDCG de cada usuário é a média das sementes; a diferença (HNSW − referência)
 * vai ao bootstrap pareado.
 * @param porSemente Array<{ hnsw: Map<u, top10>, referencia: Map<u, top10> }> (uma entrada sem rede)
 * @returns { nUsuarios, ndcgHnsw, ndcgReferencia, diferenca: { media, ic95 }, top10Identicos: [por semente] }
 */
export function resumoMedida4({ relevantes, porSemente }) {
  const nh = [];
  const nr = [];
  for (const [u, rel] of relevantes) {
    const ndcgs = (versao) => porSemente.map((s) => {
      const top10 = s[versao].get(u);
      if (!top10) throw new Error(`resumoMedida4: falta o top 10 (${versao}) do usuário ${u}`);
      return ndcgEm10(top10, rel);
    });
    nh.push(media(ndcgs('hnsw')));
    nr.push(media(ndcgs('referencia')));
  }
  return {
    nUsuarios: relevantes.size,
    ndcgHnsw: media(nh),
    ndcgReferencia: media(nr),
    diferenca: bootstrapPareado(nh.map((x, i) => x - nr[i]), BOOTSTRAP),
    top10Identicos: porSemente.map((s) => top10Identicos(s.hnsw, s.referencia)),
  };
}

/** Entrada de candidatos da referência: a entrada HNSW com o colab trocado pela lista da referência. */
export function entradaReferencia(entrada, colabReferencia) {
  return { ...entrada, colab: colabReferencia };
}

/**
 * Argumentos do script 19: `--fase v2-exp` (obrigatório) e `--medida4 S3,v2` (opcional; nomes de
 * sistema S0–S3, S4-<k>-<n> ou v2 = a escolhida da grade).
 * @returns { fase, medida4: string[] | null }
 */
export function lerArgumentosFidelidade(argv) {
  const i = argv.indexOf('--fase');
  const fase = i >= 0 ? argv[i + 1] : undefined;
  if (fase !== 'v2-exp') throw new Error(`fase inválida: ${fase} (use --fase v2-exp)`);
  const j = argv.indexOf('--medida4');
  if (j < 0) return { fase, medida4: null };
  const valor = argv[j + 1];
  if (!valor || valor.startsWith('--')) throw new Error('--medida4 sem lista: use, por exemplo, --medida4 S3,v2');
  const medida4 = valor.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of medida4) {
    if (!/^(v2|S[0-3]|S4-\d+-\d+)$/.test(s)) throw new Error(`sistema desconhecido em --medida4: ${s} (use S0–S3, S4-<k>-<n> ou v2)`);
  }
  return { fase, medida4 };
}

/** (k, n) de um sistema com rede: S2 = (150, 0), S3 = (0, 150), S4-k-n; null para S0 e S1 (sem rede). */
export function kNDoSistema(nome) {
  if (nome === 'S0' || nome === 'S1') return null;
  if (nome === 'S2') return { k: 150, n: 0 };
  if (nome === 'S3') return { k: 0, n: 150 };
  const m = /^S4-(\d+)-(\d+)$/.exec(nome);
  if (!m) throw new Error(`nome de sistema desconhecido: ${nome} (use S0–S3 ou S4-<k>-<n>)`);
  return { k: Number(m[1]), n: Number(m[2]) };
}

/**
 * Sistemas da medida 4 com rede: v2 vira a escolhida da grade; nomes repetidos viram um só.
 * Pulados (com o motivo): S0 (não usa a FC), S1 (medido sem rede na primeira execução) e, com o
 * portão reprovado, qualquer sistema com FC (não foi treinado).
 * @returns Array<{ nome, pedidos, k, n } | { nome, pedidos, pulado }>
 */
export function resolverSistemasMedida4(pedidos, grade) {
  const escolhida = grade?.escolha?.escolhida;
  if (!escolhida) throw new Error('resultados/grade-v2-exp.json sem escolha.escolhida: rode npm run grade-v2');
  const porNome = new Map();
  for (const p of pedidos) {
    const nome = p === 'v2' ? escolhida : p;
    if (!porNome.has(nome)) porNome.set(nome, []);
    porNome.get(nome).push(p);
  }
  return [...porNome].map(([nome, ps]) => {
    if (nome === 'S0') return { nome, pedidos: ps, pulado: 'S0 não usa a FC: a aproximação não tem efeito por construção' };
    if (nome === 'S1') return { nome, pedidos: ps, pulado: 'S1 não tem rede: medida 4 já calculada na execução sem --medida4' };
    const { k, n } = kNDoSistema(nome);
    if (grade.cenario === 'reprovado' && n > 0) {
      return { nome, pedidos: ps, pulado: `portão reprovado: ${nome} não foi treinado na grade` };
    }
    return { nome, pedidos: ps, k, n };
  });
}

/**
 * Mescla a medida 4 de novos sistemas no arquivo de fidelidade já gravado (sem apagar os demais).
 * Recusa se os candidatos v2 mudaram desde a execução das medidas 1–3.
 * @param novos { [sistema]: resumo }; pulados { [sistema]: motivo }
 */
export function mesclarMedida4(existente, novos, { sha256Candidatos, v2Escolhida, pulados = {} }) {
  if (existente.sha256Candidatos !== sha256Candidatos) {
    throw new Error('candidatos v2 diferentes dos usados em resultados/fidelidade-fc-v2-exp.json: rode npm run fidelidade-v2 -- --fase v2-exp sem --medida4 antes');
  }
  return {
    ...existente,
    medida4: { ...existente.medida4, ...novos },
    medida4Pulados: { ...existente.medida4Pulados, ...pulados },
    v2Escolhida,
  };
}
