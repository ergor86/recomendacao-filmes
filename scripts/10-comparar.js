// Script 10 (npm run comparar): compara modelos na validação (fase exp).
//   npm run comparar -- --passo 1|2|4 --modelos <nome>,<nome>
// - Passos 1 e 2: candidatos de K = 200, N = 100. Passo 4: (K, N) de escolhidaKN em resultados/grade-validacao.json.
// - Confere que o sha256Candidatos de cada modelo é o do artefatos/candidatos-exp.json atual.
// - Para cada modelo e semente (1, 2, 3): pontua os candidatos de cada usuário de validação com relevantes,
//   tira o top-10 e avalia (avaliarSistema). O valor por usuário de um modelo é a média das 3 sementes.
// - Diagnósticos: AUC de validação (média das sementes, do treino-<nome>-exp.json) e correlação entre o
//   score e o popZ do filme em todos os pares (usuário, candidato) da semente 1.
// - Passos 1 e 2: escolherConfiguracao (simplicidade [0] para uniforme / 64-32). Passo 4: escolha null e
//   controle = diferença média (primeiro − segundo) e erro padrão pareado.
// - Trava R9: NDCG médio de um modelo fora de [0,15; 0,35] grava o JSON, avisa e sai com código 3.
// Grava resultados/comparacao-passo<passo>.json. Não usa o banco e não lê u1.test.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua, popZ } from '../src/features/regua.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { lerCandidatos } from '../src/candidatos/arquivo.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { candidatosDe, pontuarCandidatos, top10PorScore } from '../src/modelo/ranqueador.js';
import { relevantesPorUsuario, avaliarSistema } from '../src/avaliacao/metricas.js';
import { projetar, mediaEntreSementes, escolherConfiguracao } from '../src/avaliacao/escolha.js';
import { correlacao } from '../src/avaliacao/diagnosticos.js';
import { erroPadraoPareado } from '../src/avaliacao/estatistica.js';

const SEMENTES = [1, 2, 3];
const LIMITES_R9 = [0.15, 0.35];
const f = (x, d = 4) => (x == null ? '-' : x.toFixed(d).replace('.', ','));
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/** Lê os argumentos da linha de comando; falha alto com o uso correto se algo estiver errado. */
function lerArgumentos(argv) {
  const uso = 'uso: npm run comparar -- --passo 1|2|4 --modelos <nome>,<nome>';
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const nome = argv[i];
    if (nome !== '--passo' && nome !== '--modelos') throw new Error(`argumento desconhecido "${nome}"\n${uso}`);
    const valor = argv[++i];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`falta o valor de ${nome}\n${uso}`);
    a[nome.slice(2)] = valor;
  }
  a.passo = Number(a.passo);
  if (![1, 2, 4].includes(a.passo)) throw new Error(`--passo inválido (use 1, 2 ou 4)\n${uso}`);
  a.modelos = (a.modelos ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (a.modelos.length !== 2 || a.modelos[0] === a.modelos[1]) {
    throw new Error(`--modelos deve ter exatamente 2 nomes diferentes, separados por vírgula\n${uso}`);
  }
  if (a.passo === 4 && a.modelos[1] !== `${a.modelos[0]}-sempop`) {
    throw new Error(`no passo 4 o segundo modelo deve ser o controle do primeiro: --modelos ${a.modelos[0]},${a.modelos[0]}-sempop\n${uso}`);
  }
  return a;
}

/** (K, N) do passo: 200/100 nos passos 1 e 2; no passo 4, escolhidaKN da grade de validação. */
function kNDoPasso(passo) {
  if (passo !== 4) return { k: 200, n: 100 };
  const arq = 'resultados/grade-validacao.json';
  if (!fs.existsSync(arq)) throw new Error(`${arq} ausente: o passo 4 exige a grade de (K, N) do passo 3; rode-a antes`);
  const kn = JSON.parse(fs.readFileSync(arq, 'utf8')).escolhidaKN;
  if (![50, 100, 150, 200].includes(kn?.k) || ![0, 20, 50, 100].includes(kn?.n)) {
    throw new Error(`${arq} sem escolhidaKN válida (k ∈ {50, 100, 150, 200}, n ∈ {0, 20, 50, 100}); refaça o passo 3`);
  }
  return { k: kn.k, n: kn.n };
}

/** Simplicidade dos dois braços: [0] para uniforme (passo 1) ou 64-32 (passo 2); [1] para o outro. */
function simplicidadeDe(passo, nome) {
  if (passo === 1) {
    if (nome.startsWith('uniforme-')) return [0];
    if (nome.startsWith('candidatos-')) return [1];
    throw new Error(`passo 1 compara esquemas de negativos; nome sem uniforme-/candidatos-: ${nome}`);
  }
  if (nome.endsWith('-64-32') && !nome.endsWith('-128-64-32')) return [0];
  if (nome.endsWith('-128-64-32')) return [1];
  throw new Error(`passo 2 compara arquiteturas; nome sem -64-32/-128-64-32 no fim: ${nome}`);
}

/** AUC de validação média das sementes, lida de resultados/treino-<nome>-exp.json. */
function aucValidacaoMedia(nome) {
  const arq = `resultados/treino-${nome}-exp.json`;
  if (!fs.existsSync(arq)) throw new Error(`${arq} ausente: rode npm run treinar -- --fase exp para o modelo ${nome}`);
  const t = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const aucs = SEMENTES.map((s) => t.sementes?.find((x) => x.semente === s)?.aucValidacao);
  if (aucs.some((v) => typeof v !== 'number')) throw new Error(`${arq} sem aucValidacao para todas as sementes; refaça o treino`);
  return media(aucs);
}

// ---------------------------------------------------------------------------------------------

const args = lerArgumentos(process.argv.slice(2));
const { passo } = args;
const { k, n } = kNDoPasso(passo);

const { dirDados } = carregarConfig();
const regua = carregarRegua('artefatos/regua-exp.json');
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase: 'exp', dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error('régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes -- --fase exp');
}
const caminhoCandidatos = 'artefatos/candidatos-exp.json';
const candidatos = lerCandidatos(caminhoCandidatos, regua);
const sha256Atual = JSON.parse(fs.readFileSync(caminhoCandidatos, 'utf8')).sha256;

const filmesPorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const usuariosPorId = new Map(dataset.usuarios.map((x) => [x.id, x]));
const historico = historicoDoTreino(treino, filmesPorId);
const relevantes = relevantesPorUsuario(alvos);
const usuarios = [...relevantes.keys()];

// Candidatos de (K, N) por usuário avaliado, calculados uma vez e reusados em todos os modelos.
const candidatosPorUsuario = new Map();
for (const u of usuarios) {
  const entrada = candidatos.get(u);
  if (!entrada) throw new Error(`usuário ${u} sem candidatos em ${caminhoCandidatos}: rode npm run gerar-candidatos -- --fase exp`);
  candidatosPorUsuario.set(u, candidatosDe(entrada, k, n).ids);
}

console.log(`== Comparação na validação, passo ${passo} (K = ${k}, N = ${n}) ==`);
console.log(`régua ${regua.hash.slice(0, 12)}…; candidatos ${sha256Atual.slice(0, 12)}…; ${usuarios.length} usuários com relevantes`);

const modelos = [];
const configs = [];
for (const nome of args.modelos) {
  const porSemente = [];
  const porUsuarioPorSemente = [];
  const paresSemente1 = { score: [], pop: [] };
  for (const semente of SEMENTES) {
    const dir = `modelos/${nome}-exp-s${semente}`;
    const { modelo, metadados } = await carregarModelo(dir, regua);
    try {
      if (metadados.fase !== 'exp') throw new Error(`${dir} é da fase ${metadados.fase}; a comparação usa modelos da fase exp`);
      if (metadados.sha256Candidatos !== sha256Atual) {
        throw new Error(`${dir} foi treinado com outros candidatos (sha256 ${String(metadados.sha256Candidatos).slice(0, 12)}… ≠ `
          + `${sha256Atual.slice(0, 12)}…): retreine com npm run treinar -- --fase exp --negativos ${metadados.negativos} `
          + `--arquitetura ${metadados.arquitetura}${metadados.semPop ? ' --sem-pop' : ''} --motivo "candidatos regerados"`);
      }
      const top10 = new Map();
      for (const u of usuarios) {
        const usuario = usuariosPorId.get(u);
        if (!usuario) throw new Error(`usuário ${u} da validação não existe no dataset`);
        const scores = pontuarCandidatos({
          modelo, regua, semPop: Boolean(metadados.semPop), usuario,
          curtidos: historico.get(u)?.curtidos ?? [], candidatos: candidatosPorUsuario.get(u), filmesPorId,
        });
        top10.set(u, top10PorScore(scores));
        if (semente === 1) {
          for (const [id, s] of scores) {
            paresSemente1.score.push(s);
            paresSemente1.pop.push(popZ(regua.contagens[id] ?? 0, regua));
          }
        }
      }
      const r = avaliarSistema(top10, relevantes, regua.contagens);
      porSemente.push({
        semente, ndcg: r.ndcg, precisao: r.precisao, recall: r.recall,
        cobertura: r.cobertura, popularidadeMediaContagem: r.popularidadeMediaContagem,
      });
      porUsuarioPorSemente.push(r.porUsuario);
      console.log(`  ${nome} s${semente}: NDCG ${f(r.ndcg)}, P ${f(r.precisao)}, R ${f(r.recall)}, `
        + `cobertura ${f(r.cobertura)}, popularidade ${f(r.popularidadeMediaContagem, 1)}`);
    } finally {
      modelo.dispose();
    }
  }
  const porUsuario = {
    ndcg: mediaEntreSementes(porUsuarioPorSemente.map((p) => projetar(p, 'ndcg'))),
    precisao: mediaEntreSementes(porUsuarioPorSemente.map((p) => projetar(p, 'precisao'))),
    recall: mediaEntreSementes(porUsuarioPorSemente.map((p) => projetar(p, 'recall'))),
  };
  const correlacaoScorePopularidade = correlacao(paresSemente1.score, paresSemente1.pop);
  if (correlacaoScorePopularidade == null) {
    console.warn(`ATENÇÃO: correlação score × popularidade indefinida para ${nome} (score ou popZ constante nos candidatos)`);
  }
  const m = {
    nome,
    ndcg: media([...porUsuario.ndcg.values()]),
    precisao: media([...porUsuario.precisao.values()]),
    recall: media([...porUsuario.recall.values()]),
    porSemente,
    diagnosticos: { aucValidacao: aucValidacaoMedia(nome), correlacaoScorePopularidade },
  };
  modelos.push(m);
  configs.push({
    nome, porUsuario: porUsuario.ndcg, porSemente: porSemente.map((s) => s.ndcg),
    simplicidade: passo === 4 ? [0] : simplicidadeDe(passo, nome),
  });
  console.log(`${nome}: NDCG ${f(m.ndcg)}, P ${f(m.precisao)}, R ${f(m.recall)}; `
    + `AUC val ${f(m.diagnosticos.aucValidacao)}; correlação score × popZ ${f(correlacaoScorePopularidade)}`);
}

let escolha = null;
let controle = null;
if (passo === 4) {
  const [a, b] = configs;
  const difs = [...a.porUsuario].map(([u, v]) => v - b.porUsuario.get(u));
  controle = {
    modelo: b.nome,
    diferencaMedia: media([...a.porUsuario.values()]) - media([...b.porUsuario.values()]),
    erroPadrao: erroPadraoPareado(difs),
  };
  console.log(`\ncontrole ${b.nome}: diferença média ${f(controle.diferencaMedia)} (erro padrão ${f(controle.erroPadrao)})`);
} else {
  escolha = escolherConfiguracao(configs);
  console.log('\nescolha:');
  for (const t of escolha.tabela) {
    console.log(`  ${t.nome}: média ${f(t.media)}, diferença ${f(t.diferenca)}, erro padrão ${f(t.erroPadrao)}${t.empata ? ' (empata)' : ''}`);
  }
  console.log(`  melhor: ${escolha.melhor}; escolhida: ${escolha.escolhida}${escolha.fragil ? ' (decisão FRÁGIL: faixas por semente se sobrepõem)' : ''}`);
}

const arquivoSaida = `resultados/comparacao-passo${passo}.json`;
fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(arquivoSaida, JSON.stringify({ passo, k, n, modelos, escolha, controle }, null, 2) + '\n');
console.log(`\ngravado: ${arquivoSaida}`);

// Trava R9: fora da faixa de sanidade, o resultado fica gravado, mas o processo para com código 3.
const foraDaFaixa = modelos.filter((m) => m.ndcg < LIMITES_R9[0] || m.ndcg > LIMITES_R9[1]);
if (foraDaFaixa.length) {
  for (const m of foraDaFaixa) {
    console.error(`TRAVA R9: NDCG@10 de ${m.nome} = ${f(m.ndcg)} fora de [${f(LIMITES_R9[0], 2)}; ${f(LIMITES_R9[1], 2)}]: pare e investigue antes de seguir`);
  }
  process.exit(3);
}
