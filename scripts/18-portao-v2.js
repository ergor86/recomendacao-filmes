// Script 18 (npm run portao-v2): portão da FC (spec §8.1) sobre o H_M do HNSW, na fase v2-exp.
// Lê artefatos/candidatos-v2-v2-exp.json e grava resultados/portao-fc-v2-exp.json.
// Não lê teste-2 nem u1.test; o gabarito é a validação.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { lerCandidatosV2, listaDaConfiguracao } from '../src/candidatos/v2.js';
import { relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { recallDosCandidatos } from '../src/avaliacao/experimentos.js';
import { composicoesPortao, avaliarPortao } from '../src/avaliacao/portao.js';

const fase = 'v2-exp';
const { dirDados } = carregarConfig();
const ctx = criarContexto({ fase, dirDados });
const candidatos = lerCandidatosV2(`artefatos/candidatos-v2-${fase}.json`, {
  hashRegua: ctx.regua.hash, hashTreino: hashAvaliacoes(ctx.treino),
});
const relevantes = relevantesPorUsuario(ctx.alvos);
const curtidasEscondidas = new Map([...relevantes].map(([u, r]) => [u, r.size]));
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

// Recall por composição (k-n) de cada usuário avaliado.
const recallPorComposicao = new Map();
function recallDe(k, n) {
  const listas = new Map();
  for (const u of relevantes.keys()) {
    const e = candidatos.get(u);
    if (!e) throw new Error(`usuário ${u} da validação sem candidatos v2: rode npm run candidatos-v2 -- --fase ${fase}`);
    listas.set(u, listaDaConfiguracao(e, k, n).ids);
  }
  const { media: m, porUsuario } = recallDosCandidatos(listas, relevantes);
  recallPorComposicao.set(`${k}-${n}`, porUsuario);
  return m;
}

const composicoes = {};
for (const L of [50, 100, 150, 200]) {
  composicoes[L] = composicoesPortao(L).map(({ p, k, n }) => ({ p, k, n, recallMedio: recallDe(k, n) }));
}
const recall100_50 = recallDe(100, 50);
for (const chave of ['150-0', '100-50', '112-38', '75-75', '37-113']) {
  if (!recallPorComposicao.has(chave)) throw new Error(`recallPorComposicao sem a composição ${chave}`);
}

const avaliacao = avaliarPortao({ recallPorComposicao, curtidasEscondidas });

// Contribuição sobre P ∪ F (top-150 de cada fonte, FC pura sem preenchimento).
const soma = { soPop: 0, soFC: 0, ambas: 0, nenhuma: 0 };
const porUsuario = { soPop: [], soFC: [], ambas: [], nenhuma: [] };
for (const [u, r] of relevantes) {
  const e = candidatos.get(u);
  const P = new Set(e.populares.slice(0, 150));
  const F = new Set(e.colab.slice(0, 150));
  const c = { soPop: 0, soFC: 0, ambas: 0, nenhuma: 0 };
  for (const id of r) {
    const p = P.has(id), f = F.has(id);
    c[p && f ? 'ambas' : p ? 'soPop' : f ? 'soFC' : 'nenhuma']++;
  }
  for (const k of Object.keys(c)) { soma[k] += c[k]; porUsuario[k].push(c[k]); }
}
const contribuicaoPuF = {
  agregado: soma,
  mediaPorUsuario: Object.fromEntries(Object.keys(soma).map((k) => [k, media(porUsuario[k])])),
};

// Fração de usuários com ≥ 1 relevante só na parte FC de (100, 50).
let comSoFC = 0;
for (const [u, r] of relevantes) {
  const { ids, fonte } = listaDaConfiguracao(candidatos.get(u), 100, 50);
  if (ids.some((id) => r.has(id) && fonte.get(id) === 'fc')) comSoFC++;
}

const saida = {
  fonteFC: 'hnsw',
  aviso: 'portão já visto na prévia; não pré-registrado',
  cenario: avaliacao.cenario,
  nUsuarios: relevantes.size,
  composicoes,
  composicoesExtras: ['100-50'],
  composicoesExtrasRecall: { '100-50': recall100_50 },
  melhorMistura: avaliacao.melhorMistura,
  criterioA: avaliacao.criterioA,
  criterioB: avaliacao.criterioB,
  contribuicaoPuF,
  fracaoSoFC_100_50: comSoFC / relevantes.size,
};
fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(`resultados/portao-fc-v2-${fase}.json`, jsonEstavel(saida) + '\n');

console.log(`== Portão da FC (HNSW, ${fase}); usuários: ${relevantes.size} ==`);
for (const c of composicoes[150]) console.log(`  ${c.k}-${c.n}: recall ${c.recallMedio.toFixed(4)}`);
console.log(`  100-50: recall ${recall100_50.toFixed(4)}`);
console.log(`(a) melhor ${avaliacao.melhorMistura}: dif ${avaliacao.criterioA.diferenca.toFixed(5)} EP ${avaliacao.criterioA.erroPadrao.toFixed(5)} passa ${avaliacao.criterioA.passa}`);
console.log(`(b) retirados ${avaliacao.criterioB.nRetirados}: valor ${avaliacao.criterioB.valor.toFixed(5)} passa ${avaliacao.criterioB.passa}`);
console.log(`cenário: ${avaliacao.cenario}; fração só-FC (100,50): ${(comSoFC / relevantes.size).toFixed(3)}`);
