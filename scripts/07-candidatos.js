// Script 07 (npm run candidatos): mede a geração de candidatos na validação.
// - Recall dos populares com K = 50, 100, 150 e 200.
// - Recall dos vizinhos vetoriais com N = 20, 50 e 100.
// - Grade K × N da união: recall, tamanho médio da lista e contribuição exclusiva dos vetores.
// - Experimento 2: recomendar só os 10 vizinhos mais próximos, sem popularidade.
// Grava resultados/candidatos-validacao.json.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua } from '../src/features/regua.js';
import { avaliarSistema, relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { rankingPopularidade, popularesNaoVistos, vistosPorUsuario } from '../src/candidatos/populares.js';
import { unirCandidatos, gerarCandidatos, contribuicaoExclusivaAgregada } from '../src/candidatos/hibrido.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';

const KS = [50, 100, 150, 200];
const NS = [20, 50, 100];
const NS_GRADE = [0, ...NS];
const f = (x, d = 4) => x.toFixed(d).replace('.', ',');

const { pg: configPg, dirDados } = carregarConfig();
const regua = carregarRegua('artefatos/regua-exp.json');
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase: 'exp', dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error('régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes (recalcula e regrava artefatos/regua-exp.json e recarrega a tabela filmes)');
}

const filmePorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const vistos = vistosPorUsuario(treino);
// Filmes curtidos (nota ≥ 4) de cada usuário no treino: a base do perfil.
const curtidas = new Map();
for (const a of treino) {
  if (a.nota >= 4) {
    if (!curtidas.has(a.usuario)) curtidas.set(a.usuario, []);
    curtidas.get(a.usuario).push(filmePorId.get(a.filme));
  }
}
const ranking = rankingPopularidade(regua.contagens);
const relevantes = relevantesPorUsuario(alvos);
const usuarios = [...relevantes.keys()].sort((a, b) => a - b);

// Acumuladores: somam os valores de cada usuário; no fim, dividimos pelo nº de usuários.
const acc = {
  pop: Object.fromEntries(KS.map((k) => [k, 0])),
  vet: Object.fromEntries(NS.map((n) => [n, 0])),
  uniao: {}, // chave `${k}/${n}`: { recall, tamanho, listas } (listas: { acertos, fonte } por usuário)
};
for (const k of KS) for (const n of NS_GRADE) acc.uniao[`${k}/${n}`] = { recall: 0, tamanho: 0, listas: [] };
let nComVetor = 0;
const top10 = new Map();
let excluidosExp2 = 0;

const pool = criarPool(configPg);
try {
  await verificarConexao(pool);
  for (const u of usuarios) {
    const rel = relevantes.get(u);
    const vistosU = vistos.get(u) ?? new Set();
    // Eficiência: a fonte vetorial é consultada UMA vez por usuário com N = 100 e os demais N são
    // prefixos desse resultado. Os N primeiros do resultado com n = 100 são idênticos a uma consulta
    // com n = N só no modo 'exata' (ordenação determinística por (distância, id)). Sob HNSW
    // (ef_search 70/100/150), uma consulta separada com N pequeno pode diferir marginalmente.
    // O mesmo vale, exatamente, para os populares: K = 200 e prefixos 50/100/150/200.
    const { ids: vizinhos, vetorUsuario } = await gerarCandidatos({
      pool, regua, vistos: vistosU, filmesCurtidos: curtidas.get(u) ?? [], ranking, k: 0, n: 100,
    });
    const temVetor = vetorUsuario !== null;
    const pops = popularesNaoVistos(ranking, vistosU, Math.max(...KS));
    const recall = (ids) => ids.filter((id) => rel.has(id)).length / rel.size;

    for (const k of KS) acc.pop[k] += recall(pops.slice(0, k));
    if (temVetor) {
      nComVetor++;
      for (const n of NS) acc.vet[n] += recall(vizinhos.slice(0, n));
      top10.set(u, vizinhos.slice(0, 10));
    } else {
      excluidosExp2++;
    }
    for (const k of KS) {
      for (const n of NS_GRADE) {
        const { ids, fonte } = unirCandidatos(pops.slice(0, k), vizinhos.slice(0, n));
        const acertos = ids.filter((id) => rel.has(id));
        const a = acc.uniao[`${k}/${n}`];
        a.recall += acertos.length / rel.size;
        a.tamanho += ids.length;
        a.listas.push({ acertos, fonte });
      }
    }
  }
} finally {
  await pool.end();
}

const nU = usuarios.length;
if (nU === 0 || nComVetor === 0) throw new Error('nenhum usuário avaliável; confira os dados em data/');

const exp2 = avaliarSistema(top10, new Map([...relevantes].filter(([u]) => top10.has(u))), regua.contagens);

const saida = {
  fase: 'exp',
  hashRegua: regua.hash,
  semente: 42,
  reprodutibilidade: "idêntica por carga do índice HNSW; recarregar o banco reconstrói o grafo e pode alterar levemente os números",
  definicoes: {
    recallDosCandidatos: 'por usuário, acertos entre os candidatos ÷ total de filmes relevantes escondidos (nota ≥ 4); média sobre os usuários',
    orcamentoEfetivo: 'tamanho médio da lista de candidatos após a união sem repetição (≤ K + N)',
    contribuicaoExclusiva: 'agregada (pooled) sobre os usuários: soma dos acertos cuja única fonte foi a vetorial ÷ soma dos acertos da união; não é a média das razões por usuário',
  },
  nUsuarios: nU,
  nUsuariosComVetor: nComVetor,
  populares: Object.fromEntries(KS.map((k) => [`K${k}`, { recall: acc.pop[k] / nU }])),
  vetorial: Object.fromEntries(NS.map((n) => [`N${n}`, { recall: acc.vet[n] / nComVetor }])),
  grade: KS.flatMap((k) => NS_GRADE.map((n) => {
    const a = acc.uniao[`${k}/${n}`];
    return {
      k, n,
      recallUniao: a.recall / nU,
      orcamentoEfetivo: a.tamanho / nU,
      contribuicaoExclusiva: contribuicaoExclusivaAgregada(a.listas),
    };
  })),
  exp2: {
    nUsuarios: exp2.nUsuarios,
    excluidosSemVetor: excluidosExp2,
    ndcg: exp2.ndcg,
    precisao: exp2.precisao,
    recall: exp2.recall,
  },
};

console.log('== Candidatos híbridos (fase exp, validação) ==');
console.log(`usuários com relevantes: ${nU}; com vetor: ${nComVetor}`);
console.log('-- Populares (recall) --');
for (const k of KS) console.log(`  K=${k}: ${f(saida.populares[`K${k}`].recall)}`);
console.log(`-- Vetorial (recall, ${nComVetor} usuários com vetor) --`);
for (const n of NS) console.log(`  N=${n}: ${f(saida.vetorial[`N${n}`].recall)}`);
console.log('-- Grade K x N: recall da união | orçamento efetivo | contribuição exclusiva agregada (Σ acertos só vetoriais / Σ acertos da união) --');
for (const g of saida.grade) {
  console.log(`  K=${g.k} N=${g.n}: ${f(g.recallUniao)} | ${f(g.orcamentoEfetivo, 1)} | ${f(g.contribuicaoExclusiva)}`);
}
console.log('-- Exp. 2: só vetores, top 10 por distância --');
console.log(`  usuários excluídos (sem vetor): ${excluidosExp2}`);
console.log(`  avaliados: ${exp2.nUsuarios}`);
console.log(`  NDCG@10: ${f(exp2.ndcg)}`);
console.log(`  P@10: ${f(exp2.precisao)}`);
console.log(`  R@10: ${f(exp2.recall)}`);

fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync('resultados/candidatos-validacao.json', JSON.stringify(saida, null, 2) + '\n');
