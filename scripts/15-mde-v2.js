// Script 15 (npm run mde-v2): MDE pré-registrado do Plano 3 (spec §8.3), antes da grade.
//   npm run mde-v2
// Lê n_t e as médias de curtidas escondidas de resultados/divisoes-v2.json (que precisa estar commitado),
// estima σ_d na validação com o gabarito subamostrado (20 repetições) para dois pares de referência
// (S0 × S1 e S1 × heurística) e grava resultados/mde-v2.json. Não treina nada e não decide nada.

import 'dotenv/config';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { construirFC, perfilFC, rankingReferencia, elegiveisReferencia } from '../src/fc/referencia.js';
import { comporLista } from '../src/candidatos/composicao.js';
import { rankingPopularidade, popularesNaoVistos, vistosPorUsuario } from '../src/candidatos/populares.js';
import { ndcgEm10, relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { bootstrapPareado } from '../src/avaliacao/estatistica.js';
import {
  subamostrarRelevantes, desvioAmostral, mdeFormula, simularDeltaEstrela, icNormal, top10Heuristica,
} from '../src/avaliacao/mde.js';
import { jsonEstavel } from '../src/util/json-estavel.js';

const ENTRADA = 'resultados/divisoes-v2.json';
const SAIDA = 'resultados/mde-v2.json';
const REPETICOES = 20;

const FRASE =
  'Se o ganho real for da ordem do observado na validação sob a mesma subamostragem, a capacidade de detecção ' +
  'é provavelmente boa, mas não garantida. A estimativa vem de outro grupo de usuários (validação), e o par ' +
  'v2 × v1 não é nenhum dos dois pares de referência. A subamostragem imita só de forma aproximada as curtidas ' +
  'invisíveis do u1.test (§13), e a capacidade real no teste-2 pode ser diferente, inclusive menor. ' +
  'A simulação aproxima, não reproduz, o teste final: ela usa outros usuários, outro par de sistemas e outro método de IC.';

// Diz se o arquivo está versionado no git.
function estaCommitado(arq) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', arq], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

if (!estaCommitado(ENTRADA)) {
  throw new Error(`${ENTRADA} não está commitado. Rode "npm run divisoes-v2" e commite o resultado antes do MDE.`);
}
const divisoes = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'));
const nt = divisoes.teste2.avaliaveis;
const q = divisoes.teste2.curtidasEscondidas.media / divisoes.validacao.curtidasEscondidas.media;

const { dirDados } = carregarConfig();
const ctx = criarContexto({ fase: 'v2-exp', dirDados });
const pop = ctx.regua.contagens;
const fc = construirFC(ctx.treino, 943);
const ranking = rankingPopularidade(pop);
const vistos = vistosPorUsuario(ctx.treino);
const relevantesTodos = relevantesPorUsuario(ctx.alvos);

// Top 10 de S0, S1 e da heurística, por usuário (FC150 e escores em memória, referência float64).
const top = { S0: new Map(), S1: new Map(), H: new Map() };
for (const u of relevantesTodos.keys()) {
  const v = vistos.get(u) ?? new Set();
  const populares = popularesNaoVistos(ranking, v, 600);
  const perfil = perfilFC(fc, fc.curtidosPorUsuario.get(u) ?? []);
  let colab = [];
  let nElegiveis = 0;
  let elegiveisEntrePopulares = [];
  const escore64 = new Map();
  if (perfil) {
    const rank = rankingReferencia(fc, perfil, v, 300);
    colab = rank.map((x) => x.id);
    for (const x of rank) escore64.set(x.id, x.escore64);
    const elegiveis = elegiveisReferencia(fc, perfil, v);
    nElegiveis = elegiveis.size;
    elegiveisEntrePopulares = populares.slice(0, 150).filter((id) => elegiveis.has(id));
  }
  const fc150 = comporLista({ populares, colab, k: 0, n: 150, nElegiveis, elegiveisEntrePopulares }).ids;
  top.S0.set(u, populares.slice(0, 10));
  top.S1.set(u, fc150.slice(0, 10));
  top.H.set(u, top10Heuristica(fc150, escore64, pop));
}

const pares = { S0xS1: ['S0', 'S1'], S1xHeuristica: ['S1', 'H'] };
const resultado = {};
for (const [nome, [a, b]] of Object.entries(pares)) {
  const sigmaPorRepeticao = [];
  const nPorRepeticao = [];
  const deltas = [];
  const ics = [];
  for (let r = 1; r <= REPETICOES; r++) {
    const rel = subamostrarRelevantes(relevantesTodos, q, r);
    const d = [];
    for (const [u, rs] of rel) d.push(ndcgEm10(top[b].get(u), rs) - ndcgEm10(top[a].get(u), rs));
    sigmaPorRepeticao.push(desvioAmostral(d));
    nPorRepeticao.push(d.length);
    deltas.push(simularDeltaEstrela(d, nt, r));
    ics.push({ normal: icNormal(d), bootstrap: bootstrapPareado(d, { reamostragens: 5000, semente: 2026 }).ic95 });
  }
  const sigmaD = media(sigmaPorRepeticao);
  resultado[nome] = {
    sigmaD,
    sigmaPorRepeticao,
    nPorRepeticao,
    mde: mdeFormula(sigmaD, nt),
    simulacao: { media: media(deltas), min: Math.min(...deltas), max: Math.max(...deltas) },
    icNormalVsBootstrap: ics,
  };
}

fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(SAIDA, jsonEstavel({ nt, q, frase: FRASE, pares: resultado }) + '\n');
console.log(`Gravado ${SAIDA} (nt = ${nt}, q = ${q.toFixed(4)})`);
for (const [nome, p] of Object.entries(resultado)) {
  const dif = Math.max(...p.icNormalVsBootstrap.flatMap((x) => [
    Math.abs(x.normal[0] - x.bootstrap[0]), Math.abs(x.normal[1] - x.bootstrap[1])]));
  console.log(`${nome}: sigma ${p.sigmaD.toFixed(4)}, MDE ${p.mde.toFixed(5)}, simulação média ${p.simulacao.media.toFixed(5)} ` +
    `[${p.simulacao.min.toFixed(5)}, ${p.simulacao.max.toFixed(5)}], n_r ${Math.min(...p.nPorRepeticao)}-${Math.max(...p.nPorRepeticao)}, ` +
    `maior |normal − bootstrap| ${dif.toFixed(5)}`);
}
