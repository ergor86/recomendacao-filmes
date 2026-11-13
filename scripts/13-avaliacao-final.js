// Script 13 (npm run avaliacao-final): avaliação final no u1.test, UMA ÚNICA VEZ (spec §9.2–9.4).
//   npm run avaliacao-final        (sem argumentos; tudo vem de resultados/configuracao-final.json)
// Ordem:
// 1. Junta as entradas das pré-condições SEM tocar no u1.test: configuracao-final.json, existência de
//    avaliacao-final.json, artefatos/regua-final.json, hash da régua no banco, cabeçalho de
//    artefatos/candidatos-final.json e metadados dos 6 modelos finais; chama verificarPreCondicoes.
// 2. Ainda SEM o teste (contexto final sem incluirTeste): confere a régua-final contra os dados, os
//    candidatos de todos os usuários do u1.base, carrega os 6 modelos finais e calcula TODOS os top 10
//    (todos os usuários do u1.base, 3 sementes). Qualquer falha aqui deixa o u1.test intocado.
// 3. Só então lê o u1.test (criarContexto com incluirTeste: true); depois disso, só métricas, nos
//    usuários com relevantes:
//    Exp. 1 popularidade (10 primeiros populares não vistos); Exp. 2 só vetores (10 primeiros vizinhos,
//    sem os usuários sem curtidas, + recall dos candidatos); Exp. 3 híbrido sem rede (recall da união,
//    orçamento efetivo, contribuição exclusiva das fontes); Exp. 4 híbrido + rede; Exp. 5 populares + rede
//    com o mesmo orçamento do Exp. 4 usuário a usuário; Exp. 6 rede sobre todos os não vistos; Exp. 7
//    controle sem popularidade nos candidatos do Exp. 4. Candidatos por prefixo (ruling R6).
//    Se N = 0 venceu a grade, aplica a regra decidida antes (spec §9.2).
// 4. Bootstrap pareado (Exp. 4 − Exp. 1, média das sementes; e por semente, só descritivo), diferenças
//    descritivas dos Exp. 2, 5, 6 e 7 em relação ao Exp. 4 e mainstream × nicho.
// Grava resultados/avaliacao-final.json uma vez (recusa se já existir).

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua, popEscalada } from '../src/features/regua.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { rankingPopularidade } from '../src/candidatos/populares.js';
import { lerCandidatos } from '../src/candidatos/arquivo.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { lerHashCarregado } from '../src/banco/carga.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { candidatosDe, pontuarCandidatos } from '../src/modelo/ranqueador.js';
import { relevantesPorUsuario, avaliarSistema } from '../src/avaliacao/metricas.js';
import { projetar } from '../src/avaliacao/escolha.js';
import { grupoMainstream } from '../src/avaliacao/estatistica.js';
import {
  popularesMesmoOrcamento, todosNaoVistos, verificarPreCondicoes, modelosEsperados, regraNZero,
  recallDosCandidatos, acertosComFonte, contribuicoesDasFontes, top10DoSubconjunto, resumirSemRede,
  resumirComRede, diferencaDescritiva, hipotesePrincipal, valoresMainstream, metricasPorGrupo, mediana,
  listasIguais,
} from '../src/avaliacao/experimentos.js';

const SEMENTES = [1, 2, 3];
const REAMOSTRAGENS = 5000;
const ARQ_CONFIGURACAO = 'resultados/configuracao-final.json';
const ARQ_SAIDA = 'resultados/avaliacao-final.json';
const ARQ_REGUA = 'artefatos/regua-final.json';
const ARQ_CANDIDATOS = 'artefatos/candidatos-final.json';
const f = (x, d = 4) => (x == null ? '-' : x.toFixed(d).replace('.', ','));
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const objeto = (mapa) => Object.fromEntries([...mapa].map(([k, v]) => [String(k), v]));

if (process.argv.length > 2) throw new Error('npm run avaliacao-final não aceita argumentos: a configuração vem de ' + ARQ_CONFIGURACAO);

// ---- 1. Entradas das pré-condições (nada aqui lê o u1.test) ---------------------------------

const configuracao = fs.existsSync(ARQ_CONFIGURACAO) ? JSON.parse(fs.readFileSync(ARQ_CONFIGURACAO, 'utf8')) : null;
const avaliacaoExiste = fs.existsSync(ARQ_SAIDA);
const reguaFinal = fs.existsSync(ARQ_REGUA) ? carregarRegua(ARQ_REGUA) : null;
const { pg: configPg, dirDados } = carregarConfig();

let hashBanco = null;
if (configuracao && !avaliacaoExiste && reguaFinal) {
  const pool = criarPool(configPg);
  try {
    await verificarConexao(pool);
    hashBanco = await lerHashCarregado(pool);
  } finally {
    await pool.end();
  }
}

let candidatosFinal = null;
if (fs.existsSync(ARQ_CANDIDATOS)) {
  const { hashRegua, sha256 } = JSON.parse(fs.readFileSync(ARQ_CANDIDATOS, 'utf8'));
  candidatosFinal = { hashRegua, sha256 };
}

const modelos = configuracao
  ? modelosEsperados(configuracao).map(({ nome, semente }) => {
    const arq = `modelos/${nome}-final-s${semente}/metadados.json`;
    return { nome, semente, metadados: fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : null };
  })
  : [];

verificarPreCondicoes({ configuracao, avaliacaoExiste, reguaFinal, hashBanco, candidatosFinal, modelos });

const { k: K, n: N } = configuracao;
if (![50, 100, 150, 200].includes(K) || ![0, 20, 50, 100].includes(N)) {
  throw new Error(`${ARQ_CONFIGURACAO} com (K, N) = (${K}, ${N}) fora da grade; refaça npm run congelar`);
}
if (configuracao.sementeBootstrap !== 2026) throw new Error(`${ARQ_CONFIGURACAO}: sementeBootstrap ${configuracao.sementeBootstrap} ≠ 2026`);
const regra = regraNZero(N);
const regua = reguaFinal;

// ---- 2. Tudo o que não depende do teste, ANTES de lê-lo -------------------------------------
// Régua, candidatos, os 6 modelos e todos os top 10 de todos os usuários do u1.base. Se algo falhar
// aqui, o u1.test continua intocado; depois da leitura só restam as métricas.

const { dataset, treino, regua: reguaSemTeste } = criarContexto({ fase: 'final', dirDados });
if (reguaSemTeste.hash !== regua.hash) {
  throw new Error(`${ARQ_REGUA} difere da régua calculada do u1.base: rode npm run carregar-filmes -- --fase final`);
}
const candidatos = lerCandidatos(ARQ_CANDIDATOS, regua); // confere sha256 do conteúdo e hash da régua

const filmesPorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const usuariosPorId = new Map(dataset.usuarios.map((x) => [x.id, x]));
const historico = historicoDoTreino(treino, filmesPorId);
const ranking = rankingPopularidade(regua.contagens);
const catalogo = dataset.filmes.map((x) => x.id);
const todos = [...historico.keys()].sort((a, b) => a - b); // todos os usuários do u1.base
console.log('== Avaliação final no u1.test (uso único) ==');
console.log(`régua-final ${regua.hash.slice(0, 12)}…; candidatos ${candidatosFinal.sha256.slice(0, 12)}…; (K, N) = (${K}, ${N}); `
  + `${todos.length} usuários no u1.base`);
if (regra.aplicada) console.log('N = 0 venceu a grade: aplicando a regra decidida antes (spec §9.2).');

const vistosDe = new Map();
const entradas = new Map();
for (const u of todos) {
  const entrada = candidatos.get(u);
  if (!entrada) throw new Error(`usuário ${u} sem candidatos em ${ARQ_CANDIDATOS}: rode npm run gerar-candidatos -- --fase final`);
  if (!usuariosPorId.has(u)) throw new Error(`usuário ${u} do treino não existe no dataset`);
  entradas.set(u, entrada);
  vistosDe.set(u, new Set(historico.get(u).notas.keys()));
}

// Listas de candidatos de cada experimento, por usuário (iguais para todas as sementes).
const listasExp4 = new Map(todos.map((u) => [u, candidatosDe(entradas.get(u), K, N)]));
const idsExp4 = new Map([...listasExp4].map(([u, l]) => [u, l.ids]));
const idsExp5 = new Map(todos.map((u) => [u, popularesMesmoOrcamento(ranking, vistosDe.get(u), idsExp4.get(u).length)]));
const idsExp6 = new Map(todos.map((u) => [u, todosNaoVistos(catalogo, vistosDe.get(u))]));
for (const u of todos) {
  const { populares, vizinhos } = entradas.get(u);
  const naoVistos = new Set(idsExp6.get(u));
  for (const id of [...idsExp4.get(u), ...idsExp5.get(u), ...populares.slice(0, 10), ...vizinhos]) {
    if (!naoVistos.has(id)) throw new Error(`candidato ${id} do usuário ${u} já foi visto no treino: rode npm run gerar-candidatos -- --fase final`);
  }
  if (populares.length < 10) throw new Error(`usuário ${u} com menos de 10 populares em ${ARQ_CANDIDATOS}: rode npm run gerar-candidatos -- --fase final`);
  // Exp. 2: quem tem vizinhos precisa de 10 para o top 10; quem não tem (sem curtidas) fica fora e é contado.
  if (vizinhos.length > 0 && vizinhos.length < 10) {
    throw new Error(`usuário ${u} com só ${vizinhos.length} vizinhos (o top 10 do Exp. 2 exige 10): rode npm run gerar-candidatos -- --fase final`);
  }
}
const listasExp5IguaisExp4 = todos.every((u) => listasIguais(idsExp4.get(u), idsExp5.get(u)));
if (regra.exp5IdenticoAoExp4 && !listasExp5IguaisExp4) {
  throw new Error('N = 0, mas os candidatos do Exp. 5 diferem dos do Exp. 4: confira o ranking da régua-final e os populares do arquivo');
}
// Com N = 0 nenhum candidato vem da fonte vetorial: a contribuição exclusiva é zero por construção.
if (regra.contribuicaoVetorialPorConstrucao && todos.some((u) => [...listasExp4.get(u).fonte.values()].some((x) => x !== 'pop'))) {
  throw new Error('N = 0, mas há candidatos de fonte vetorial no Exp. 4: confira candidatosDe');
}

/**
 * Carrega o modelo final de uma semente, confere o que ele declara e pontua a lista de cada usuário do
 * u1.base; `aoPontuar(u, scores)` recebe os scores de um usuário por vez (não guardamos todos na memória).
 */
async function pontuarSemente(nome, semente, semPop, listaPorUsuario, aoPontuar) {
  const dir = `modelos/${nome}-final-s${semente}`;
  const { modelo, metadados } = await carregarModelo(dir, regua); // falha se faltar arquivo ou a régua divergir
  try {
    if (metadados.nome !== nome || metadados.semente !== semente || metadados.fase !== 'final'
      || metadados.sha256Candidatos !== candidatosFinal.sha256 || Boolean(metadados.semPop) !== semPop) {
      throw new Error(`${dir} não confere (nome, semente, fase, candidatos ou semPop): rode npm run treinar -- --fase final ... para esse modelo`);
    }
    for (const u of todos) {
      const s = pontuarCandidatos({
        modelo, regua, semPop, usuario: usuariosPorId.get(u),
        curtidos: historico.get(u).curtidos, candidatos: listaPorUsuario.get(u), filmesPorId,
      });
      for (const [id, v] of s) {
        if (!Number.isFinite(v)) throw new Error(`score não finito (${v}) do filme ${id} para o usuário ${u} em ${dir}`);
      }
      aoPontuar(u, s);
    }
  } finally {
    modelo.dispose();
  }
}

// Top 10 por semente de cada experimento com rede, para todos os usuários do u1.base.
const top10PorSemente = [];
let top10Exp5IgualExp4 = true;
for (const semente of SEMENTES) {
  const t = { semente, exp4: new Map(), exp5: new Map(), exp6: new Map(), exp7: new Map() };
  // Modelo: pontua uma vez todos os não vistos (superconjunto dos candidatos do Exp. 4 e do Exp. 5),
  // para os três experimentos usarem exatamente os mesmos scores.
  await pontuarSemente(configuracao.modelo, semente, false, idsExp6, (u, s) => {
    t.exp4.set(u, top10DoSubconjunto(s, idsExp4.get(u)));
    t.exp5.set(u, top10DoSubconjunto(s, idsExp5.get(u)));
    t.exp6.set(u, top10DoSubconjunto(s, idsExp6.get(u)));
  });
  // Controle: só os candidatos do Exp. 4.
  await pontuarSemente(configuracao.controle, semente, true, idsExp4, (u, s) => t.exp7.set(u, top10DoSubconjunto(s, idsExp4.get(u))));
  if (!todos.every((u) => listasIguais(t.exp4.get(u), t.exp5.get(u)))) top10Exp5IgualExp4 = false;
  top10PorSemente.push(t);
  console.log(`  semente ${semente}: top 10 dos Exp. 4–7 calculados para ${todos.length} usuários`);
}
if (regra.exp5IdenticoAoExp4 && !top10Exp5IgualExp4) {
  throw new Error('N = 0, mas o top 10 do Exp. 5 difere do Exp. 4 em alguma semente: confira o ranking e os scores');
}
const top10Exp1 = new Map(todos.map((u) => [u, entradas.get(u).populares.slice(0, 10)]));
const top10Exp2 = new Map(todos.filter((u) => entradas.get(u).vizinhos.length > 0).map((u) => [u, entradas.get(u).vizinhos.slice(0, 10)]));
const candidatosExp2 = new Map([...top10Exp2.keys()].map((u) => [u, entradas.get(u).vizinhos.slice(0, regra.nRecallExp2)]));

// ---- 3. Único ponto em que o u1.test é lido; daqui em diante, só métricas ---------------------

const { alvos, treino: treinoComTeste, regua: reguaCalculada } = criarContexto({ fase: 'final', dirDados, incluirTeste: true });
if (reguaCalculada.hash !== regua.hash || treinoComTeste.length !== treino.length) {
  throw new Error('a régua ou o treino mudaram ao incluir o teste: confira criarContexto (vazamento?)');
}

// Usuários avaliados: os do u1.test com pelo menos um relevante, em ordem crescente de id.
const relevantesBrutos = relevantesPorUsuario(alvos);
const usuarios = [...relevantesBrutos.keys()].sort((a, b) => a - b);
const relevantes = new Map(usuarios.map((u) => [u, relevantesBrutos.get(u)]));
const usuariosDoTeste = new Set(alvos.map((a) => a.usuario));
const semRelevantes = [...usuariosDoTeste].filter((u) => !relevantes.has(u)).sort((a, b) => a - b);
const foraDoTreino = usuarios.filter((u) => !historico.has(u));
if (foraDoTreino.length > 0) throw new Error(`usuários do teste sem histórico no u1.base (${foraDoTreino.join(', ')}): sem candidatos nem perfil`);
console.log(`usuários do teste: ${usuariosDoTeste.size}; avaliados (com relevantes): ${usuarios.length}; sem relevantes: ${semRelevantes.join(', ') || '-'}`);

// ---- Exp. 1: popularidade --------------------------------------------------------------------

const exp1 = resumirSemRede(avaliarSistema(top10Exp1, relevantes, regua.contagens));
console.log(`\nExp. 1 popularidade: NDCG ${f(exp1.ndcg)}`);

// ---- Exp. 2: só vetores ----------------------------------------------------------------------

const comVizinhos = usuarios.filter((u) => top10Exp2.has(u));
const exp2Excluidos = usuarios.filter((u) => !top10Exp2.has(u));
const relevantesExp2 = new Map(comVizinhos.map((u) => [u, relevantes.get(u)]));
const exp2Top10 = resumirSemRede(avaliarSistema(top10Exp2, relevantesExp2, regua.contagens));
const exp2Recall = recallDosCandidatos(candidatosExp2, relevantesExp2);
console.log(`Exp. 2 só vetores: NDCG ${f(exp2Top10.ndcg)} (${comVizinhos.length} usuários; ${exp2Excluidos.length} sem curtidas fora); `
  + `recall dos ${regra.nRecallExp2} vizinhos ${f(exp2Recall.media)}`);

// ---- Exp. 3: híbrido sem rede (nível de candidatos) -------------------------------------------

const exp3Recall = recallDosCandidatos(idsExp4, relevantes);
const exp3Contribuicoes = contribuicoesDasFontes(acertosComFonte(listasExp4, relevantes));
const orcamentoEfetivo = media(usuarios.map((u) => idsExp4.get(u).length));
console.log(`Exp. 3 híbrido sem rede: recall da união ${f(exp3Recall.media)}; orçamento efetivo ${f(orcamentoEfetivo, 1)}; `
  + `exclusiva vet ${f(exp3Contribuicoes.vet)}, pop ${f(exp3Contribuicoes.pop)}`);

// ---- Exp. 4, 5, 6 (modelo) e 7 (controle), por semente -----------------------------------------

const porSemente = { exp4: [], exp5: [], exp6: [], exp7: [] };
const contribuicaoTop10Exp4 = [];
for (const t of top10PorSemente) {
  for (const e of ['exp4', 'exp5', 'exp6', 'exp7']) {
    porSemente[e].push({ semente: t.semente, resultado: avaliarSistema(t[e], relevantes, regua.contagens) });
  }
  // Contribuição exclusiva no top 10 do Exp. 4 (fração dos acertos vinda só dos vetores, spec §9.2).
  contribuicaoTop10Exp4.push({
    semente: t.semente,
    ...contribuicoesDasFontes(usuarios.map((u) => ({
      acertos: t.exp4.get(u).filter((id) => relevantes.get(u).has(id)), fonte: listasExp4.get(u).fonte,
    }))),
  });
  console.log(`  semente ${t.semente}: Exp. 4 ${f(porSemente.exp4.at(-1).resultado.ndcg)}, Exp. 5 ${f(porSemente.exp5.at(-1).resultado.ndcg)}, `
    + `Exp. 6 ${f(porSemente.exp6.at(-1).resultado.ndcg)}, Exp. 7 ${f(porSemente.exp7.at(-1).resultado.ndcg)}`);
}

const exp4 = resumirComRede(porSemente.exp4);
const exp5 = resumirComRede(porSemente.exp5);
const exp6 = resumirComRede(porSemente.exp6);
const exp7 = resumirComRede(porSemente.exp7);
for (const [nome, e] of [['Exp. 4', exp4], ['Exp. 5', exp5], ['Exp. 6', exp6], ['Exp. 7', exp7]]) {
  if (!Number.isFinite(e.ndcg)) throw new Error(`NDCG não finito no ${nome}`);
  console.log(`${nome}: NDCG ${f(e.ndcg)} [mín ${f(e.minMax.ndcg[0])}, máx ${f(e.minMax.ndcg[1])}]; cobertura ${f(e.cobertura.media)}`);
}

// ---- 4. Hipótese principal, diferenças descritivas e mainstream × nicho -------------------------

const ndcgExp1 = projetar(exp1.porUsuario, 'ndcg');
const opcoesBootstrap = { reamostragens: REAMOSTRAGENS, semente: configuracao.sementeBootstrap };
const hipotese = {
  comparacao: 'Exp. 4 − Exp. 1', metrica: 'ndcg', ...opcoesBootstrap,
  ...hipotesePrincipal(projetar(exp4.porUsuario, 'ndcg'), ndcgExp1, opcoesBootstrap),
  porSementeDescritivo: porSemente.exp4.map(({ semente, resultado }) => ({
    semente, ...hipotesePrincipal(projetar(resultado.porUsuario, 'ndcg'), ndcgExp1, opcoesBootstrap),
  })),
};
console.log(`\nhipótese principal (Exp. 4 − Exp. 1): ${f(hipotese.media)}, IC95 [${f(hipotese.ic95[0])}; ${f(hipotese.ic95[1])}] → `
  + `${hipotese.suportada ? 'SUPORTADA' : 'não suportada'}`);

const diferencasDescritivas = {
  exp2: diferencaDescritiva(exp2Top10.porUsuario, exp4.porUsuario),
  exp5: diferencaDescritiva(exp5.porUsuario, exp4.porUsuario),
  exp6: diferencaDescritiva(exp6.porUsuario, exp4.porUsuario),
  exp7: diferencaDescritiva(exp7.porUsuario, exp4.porUsuario),
};

const curtidosPorUsuario = new Map(usuarios.map((u) => [u, (historico.get(u)?.curtidos ?? []).map((x) => x.id)]));
const { valores, semCurtidas } = valoresMainstream(usuarios, curtidosPorUsuario, (id) => popEscalada(regua.contagens[id] ?? 0, regua));
const grupos = grupoMainstream(valores);
const tamanhos = { mainstream: 0, nicho: 0, semCurtidas };
for (const g of grupos.values()) tamanhos[g]++;
const sistemas = { exp1, exp2: exp2Top10, exp4, exp5, exp6, exp7 };
const mainstreamNicho = {
  escala: configuracao.escalaMainstream,
  mediana: mediana([...valores.values()]),
  tamanhos,
  porExperimento: Object.fromEntries(Object.entries(sistemas).map(([k, e]) => [k, metricasPorGrupo(e.porUsuario, grupos)])),
  exp3RecallDaUniao: Object.fromEntries(['mainstream', 'nicho'].map((g) => {
    const r = [...grupos].filter(([, x]) => x === g).map(([u]) => exp3Recall.porUsuario.get(u));
    return [g, r.length === 0 ? null : { n: r.length, recall: media(r) }];
  })),
};
console.log(`grupos: mainstream ${tamanhos.mainstream}, nicho ${tamanhos.nicho}, sem curtidas ${semCurtidas}`);

// ---- Gravação (uma vez) ------------------------------------------------------------------------

/** Experimento para o JSON: tira o Map porUsuario e grava só o NDCG por usuário (para reanálise sem reler o teste). */
const paraJson = (e) => {
  const { porUsuario, ...resto } = e;
  return { ...resto, ndcgPorUsuario: objeto(projetar(porUsuario, 'ndcg')) };
};

const saida = {
  data: new Date().toISOString(),
  configuracao,
  hashReguaFinal: regua.hash,
  sha256Candidatos: candidatosFinal.sha256,
  sementeBootstrap: configuracao.sementeBootstrap,
  reamostragens: REAMOSTRAGENS,
  sementes: SEMENTES,
  usuarios: {
    noTeste: usuariosDoTeste.size, avaliados: usuarios.length, semRelevantes,
    exp2Avaliados: comVizinhos.length, exp2ExcluidosSemCurtidas: exp2Excluidos,
  },
  regraNZero: regra,
  experimentos: {
    exp1: { nome: 'popularidade: top 10 populares não vistos', ...paraJson(exp1) },
    exp2: {
      nome: 'só vetores: 10 primeiros vizinhos', top10: paraJson(exp2Top10),
      recallDosCandidatos: { n: regra.nRecallExp2, media: exp2Recall.media },
      usuariosExcluidosSemCurtidas: exp2Excluidos.length,
    },
    exp3: {
      nome: 'híbrido sem rede (candidatos)', k: K, n: N,
      recallDaUniao: exp3Recall.media, orcamentoEfetivo,
      contribuicaoExclusiva: { ...exp3Contribuicoes, vetorialZeroPorConstrucao: regra.contribuicaoVetorialPorConstrucao },
    },
    exp4: { nome: 'híbrido + rede', modelo: configuracao.modelo, ...paraJson(exp4), contribuicaoExclusivaNoTop10: contribuicaoTop10Exp4 },
    exp5: {
      nome: 'populares + rede com o mesmo orçamento do Exp. 4', modelo: configuracao.modelo, ...paraJson(exp5),
      candidatosIdenticosAoExp4: listasExp5IguaisExp4, top10IdenticoAoExp4: top10Exp5IgualExp4,
      reportadoComoIdenticoAoExp4: regra.exp5IdenticoAoExp4,
    },
    exp6: { nome: 'rede sobre todos os não vistos (não é teto)', modelo: configuracao.modelo, ...paraJson(exp6) },
    exp7: { nome: 'híbrido + rede sem popularidade no ranqueador', modelo: configuracao.controle, ...paraJson(exp7) },
  },
  hipotesePrincipal: hipotese,
  diferencasDescritivasEmRelacaoAoExp4: diferencasDescritivas,
  mainstreamNicho,
};

fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(ARQ_SAIDA, JSON.stringify(saida, null, 2) + '\n', { flag: 'wx' }); // 'wx': nunca sobrescreve
console.log(`\ngravado: ${ARQ_SAIDA}`);
