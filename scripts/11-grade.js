// Script 11 (npm run grade): passo 3 da validação, grade de (K, N) com os modelos congelados.
//   npm run grade -- --modelo <escolhido no passo 2> --perdedor-passo1 <nome>
// - Para cada modelo e semente (1, 2, 3), pontua uma única vez os candidatos (K = 200, N = 100) de cada
//   usuário de validação com relevantes; para cada (K, N) ∈ {50, 100, 150, 200} × {0, 20, 50, 100}, pega os
//   ids de candidatosDe(entrada, K, N) (prefixos, ruling R6), tira o top-10 por score entre eles e avalia.
//   O NDCG por usuário de uma linha é a média das 3 sementes; orcamentoEfetivo = tamanho médio da lista.
// - Modelo escolhido: escolherConfiguracao com simplicidade [K + N, N] (spec §9.1); escolhidaKN = { k, n }.
// - Perdedor do passo 1: a mesma grade, só descritiva (sem escolha).
// - Grupos mainstream × nicho da validação (spec §9.4 v3.2): valor do usuário = média de popEscalada das
//   contagens da régua-exp dos filmes curtidos no treino; corte na mediana (grupoMainstream); usuários sem
//   curtidas ficam fora e são contados. NDCG por grupo da popularidade (10 primeiros populares não vistos) e
//   do modelo escolhido no (K, N) escolhido.
// - Trava R9: NDCG da configuração escolhida fora de [0,15; 0,35] grava o JSON, avisa e sai com código 3.
// Grava resultados/grade-validacao.json. Não usa o banco e não lê u1.test.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua, popEscalada } from '../src/features/regua.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { lerCandidatos } from '../src/candidatos/arquivo.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { candidatosDe, pontuarCandidatos, top10PorScore } from '../src/modelo/ranqueador.js';
import { relevantesPorUsuario, avaliarSistema } from '../src/avaliacao/metricas.js';
import { projetar, mediaEntreSementes, escolherConfiguracao } from '../src/avaliacao/escolha.js';
import { grupoMainstream } from '../src/avaliacao/estatistica.js';

const SEMENTES = [1, 2, 3];
const KS = [50, 100, 150, 200];
const NS = [0, 20, 50, 100];
const LIMITES_R9 = [0.15, 0.35];
const ESCALA = 'media de popEscalada dos curtidos no treino';
const f = (x, d = 4) => (x == null ? '-' : x.toFixed(d).replace('.', ','));
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/** Lê os argumentos da linha de comando; falha alto com o uso correto se algo estiver errado. */
function lerArgumentos(argv) {
  const uso = 'uso: npm run grade -- --modelo <nome> --perdedor-passo1 <nome>';
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const nome = argv[i];
    if (nome !== '--modelo' && nome !== '--perdedor-passo1') throw new Error(`argumento desconhecido "${nome}"\n${uso}`);
    const valor = argv[++i];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`falta o valor de ${nome}\n${uso}`);
    a[nome === '--modelo' ? 'modelo' : 'perdedor'] = valor;
  }
  if (!a.modelo || !a.perdedor) throw new Error(`--modelo e --perdedor-passo1 são obrigatórios\n${uso}`);
  if (a.modelo === a.perdedor) throw new Error(`--modelo e --perdedor-passo1 devem ser diferentes\n${uso}`);
  if (a.modelo.endsWith('-sempop') || a.perdedor.endsWith('-sempop')) {
    throw new Error('a grade usa os modelos com popularidade (passos 1 e 2), não o controle -sempop');
  }
  return a;
}

/** Confere que o modelo é o escolhido no passo 2 (resultados/comparacao-passo2.json) — script fora de ordem é erro. */
function conferirOrdem(modelo, perdedor) {
  const arq2 = 'resultados/comparacao-passo2.json';
  const arq1 = 'resultados/comparacao-passo1.json';
  for (const arq of [arq1, arq2]) {
    if (!fs.existsSync(arq)) throw new Error(`${arq} ausente: o passo 3 exige os passos 1 e 2 (npm run comparar)`);
  }
  const p2 = JSON.parse(fs.readFileSync(arq2, 'utf8'));
  if (p2.escolha?.escolhida !== modelo) {
    throw new Error(`--modelo ${modelo} não é o escolhido no passo 2 (${p2.escolha?.escolhida}); use o de ${arq2}`);
  }
  const p1 = JSON.parse(fs.readFileSync(arq1, 'utf8'));
  const perdedores = (p1.modelos ?? []).map((m) => m.nome).filter((n) => n !== p1.escolha?.escolhida);
  if (!perdedores.includes(perdedor)) {
    throw new Error(`--perdedor-passo1 ${perdedor} não é o perdedor do passo 1 (${perdedores.join(', ')}); confira ${arq1}`);
  }
}

// ---------------------------------------------------------------------------------------------

const args = lerArgumentos(process.argv.slice(2));
conferirOrdem(args.modelo, args.perdedor);

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

// Entradas de candidatos (K = 200, N = 100) e listas de cada (K, N) por usuário, calculadas uma vez.
const entradas = new Map();
for (const u of usuarios) {
  const entrada = candidatos.get(u);
  if (!entrada) throw new Error(`usuário ${u} sem candidatos em ${caminhoCandidatos}: rode npm run gerar-candidatos -- --fase exp`);
  if (!usuariosPorId.has(u)) throw new Error(`usuário ${u} da validação não existe no dataset`);
  entradas.set(u, entrada);
}
const celulas = [];
for (const k of KS) {
  for (const n of NS) {
    const listas = new Map(usuarios.map((u) => [u, candidatosDe(entradas.get(u), k, n).ids]));
    const orcamentoEfetivo = media([...listas.values()].map((l) => l.length));
    celulas.push({ nome: `k${k}-n${n}`, k, n, listas, orcamentoEfetivo });
  }
}
const listasCompletas = new Map(usuarios.map((u) => [u, candidatosDe(entradas.get(u), 200, 100).ids]));

/**
 * Avalia a grade inteira de um modelo: por semente, pontua os candidatos (200, 100) de cada usuário uma
 * vez e, para cada (K, N), tira o top-10 entre os ids da célula. Devolve as linhas da grade e o NDCG por
 * usuário (média das sementes) de cada célula.
 */
async function avaliarGrade(nome) {
  const ndcgPorSemente = celulas.map(() => []); // [célula][semente] → Map<usuario, ndcg>
  const mediasPorSemente = celulas.map(() => []); // [célula][semente] → NDCG médio
  for (const semente of SEMENTES) {
    const dir = `modelos/${nome}-exp-s${semente}`;
    const { modelo, metadados } = await carregarModelo(dir, regua);
    try {
      if (metadados.fase !== 'exp') throw new Error(`${dir} é da fase ${metadados.fase}; a grade usa modelos da fase exp`);
      if (metadados.sha256Candidatos !== sha256Atual) {
        throw new Error(`${dir} foi treinado com outros candidatos (sha256 ${String(metadados.sha256Candidatos).slice(0, 12)}… ≠ `
          + `${sha256Atual.slice(0, 12)}…): retreine com npm run treinar -- --fase exp --negativos ${metadados.negativos} `
          + `--arquitetura ${metadados.arquitetura}${metadados.semPop ? ' --sem-pop' : ''} --motivo "candidatos regerados"`);
      }
      const scoresPorUsuario = new Map();
      for (const u of usuarios) {
        const scores = pontuarCandidatos({
          modelo, regua, semPop: Boolean(metadados.semPop), usuario: usuariosPorId.get(u),
          curtidos: historico.get(u)?.curtidos ?? [], candidatos: listasCompletas.get(u), filmesPorId,
        });
        for (const [id, s] of scores) {
          if (!Number.isFinite(s)) throw new Error(`score não finito (${s}) do filme ${id} para o usuário ${u} em ${dir}`);
        }
        scoresPorUsuario.set(u, scores);
      }
      celulas.forEach((c, i) => {
        const top10 = new Map();
        for (const u of usuarios) {
          const todos = scoresPorUsuario.get(u);
          top10.set(u, top10PorScore(new Map(c.listas.get(u).map((id) => [id, todos.get(id)]))));
        }
        const r = avaliarSistema(top10, relevantes, regua.contagens);
        ndcgPorSemente[i].push(projetar(r.porUsuario, 'ndcg'));
        mediasPorSemente[i].push(r.ndcg);
      });
      console.log(`  ${nome} s${semente}: grade avaliada (${celulas.length} células)`);
    } finally {
      modelo.dispose();
    }
  }
  const porUsuario = celulas.map((_, i) => mediaEntreSementes(ndcgPorSemente[i]));
  const linhas = celulas.map((c, i) => ({
    nome: c.nome, k: c.k, n: c.n,
    ndcg: media([...porUsuario[i].values()]),
    porSemente: mediasPorSemente[i],
    orcamentoEfetivo: c.orcamentoEfetivo,
  }));
  for (const l of linhas) {
    if (!Number.isFinite(l.ndcg)) throw new Error(`NDCG não finito na linha ${l.nome} de ${nome}`);
  }
  return { linhas, porUsuario };
}

/** Imprime a grade como tabela K × N. */
function imprimirGrade(titulo, linhas) {
  console.log(`\n${titulo}`);
  console.log(`  K\\N  ${NS.map((n) => String(n).padStart(8)).join('')}`);
  for (const k of KS) {
    console.log(`  ${String(k).padStart(4)} ${NS.map((n) => f(linhas.find((l) => l.k === k && l.n === n).ndcg).padStart(8)).join('')}`);
  }
}

console.log(`== Grade (K, N) na validação (passo 3) ==`);
console.log(`régua ${regua.hash.slice(0, 12)}…; candidatos ${sha256Atual.slice(0, 12)}…; ${usuarios.length} usuários com relevantes`);

const escolhido = await avaliarGrade(args.modelo);
imprimirGrade(`${args.modelo}: NDCG@10 (média das sementes)`, escolhido.linhas);
if (new Set(escolhido.linhas.map((l) => l.ndcg)).size === 1) {
  throw new Error('todas as linhas da grade têm o mesmo NDCG: confira candidatosDe e o recorte dos scores');
}

const configs = escolhido.linhas.map((l, i) => ({
  nome: l.nome, porUsuario: escolhido.porUsuario[i], porSemente: l.porSemente, simplicidade: [l.k + l.n, l.n],
}));
const escolha = escolherConfiguracao(configs);
const linhaEscolhida = escolhido.linhas.find((l) => l.nome === escolha.escolhida);
const escolhidaKN = { k: linhaEscolhida.k, n: linhaEscolhida.n };
console.log('\nescolha:');
for (const t of escolha.tabela) {
  console.log(`  ${t.nome}: média ${f(t.media)}, diferença ${f(t.diferenca)}, erro padrão ${f(t.erroPadrao)}${t.empata ? ' (empata)' : ''}`);
}
console.log(`  melhor: ${escolha.melhor}; escolhida: ${escolha.escolhida}${escolha.fragil ? ' (decisão FRÁGIL: faixas por semente se sobrepõem)' : ''}`);

const perdedor = await avaliarGrade(args.perdedor);
imprimirGrade(`${args.perdedor} (perdedor do passo 1, só descritiva): NDCG@10`, perdedor.linhas);

// Grupos mainstream × nicho: média de popEscalada dos curtidos no treino, entre os usuários avaliados.
const valores = new Map();
let semCurtidas = 0;
for (const u of usuarios) {
  const curtidos = historico.get(u)?.curtidos ?? [];
  if (curtidos.length === 0) { semCurtidas++; continue; }
  valores.set(u, media(curtidos.map((filme) => popEscalada(regua.contagens[filme.id] ?? 0, regua))));
}
const ordenados = [...valores.values()].sort((a, b) => a - b);
const meio = Math.floor(ordenados.length / 2);
const mediana = ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
const grupos = grupoMainstream(valores);
const tamanhos = { mainstream: 0, nicho: 0, semCurtidas };
for (const g of grupos.values()) tamanhos[g]++;

// NDCG por usuário da popularidade: os 10 primeiros populares não vistos (início da lista gravada).
const top10Pop = new Map(usuarios.map((u) => [u, entradas.get(u).populares.slice(0, 10)]));
const ndcgPop = projetar(avaliarSistema(top10Pop, relevantes, regua.contagens).porUsuario, 'ndcg');
const ndcgModelo = escolhido.porUsuario[escolhido.linhas.indexOf(linhaEscolhida)];
const mediaGrupo = (porUsuario, g) => media([...grupos].filter(([, x]) => x === g).map(([u]) => porUsuario.get(u)));
const ndcgPorGrupo = {
  popularidade: { mainstream: mediaGrupo(ndcgPop, 'mainstream'), nicho: mediaGrupo(ndcgPop, 'nicho') },
  modelo: { mainstream: mediaGrupo(ndcgModelo, 'mainstream'), nicho: mediaGrupo(ndcgModelo, 'nicho') },
};
console.log(`\ngrupos (mediana ${f(mediana)}): mainstream ${tamanhos.mainstream}, nicho ${tamanhos.nicho}, sem curtidas ${semCurtidas}`);
console.log(`  popularidade (geral ${f(media([...ndcgPop.values()]))}): mainstream ${f(ndcgPorGrupo.popularidade.mainstream)}, nicho ${f(ndcgPorGrupo.popularidade.nicho)}`);
console.log(`  ${args.modelo} ${escolha.escolhida}: mainstream ${f(ndcgPorGrupo.modelo.mainstream)}, nicho ${f(ndcgPorGrupo.modelo.nicho)}`);

const saida = {
  modelo: args.modelo,
  linhas: escolhido.linhas,
  escolha,
  escolhidaKN,
  gruposValidacao: { escala: ESCALA, mediana, tamanhos, ndcgPorGrupo },
  descritivaPerdedorPasso1: { modelo: args.perdedor, linhas: perdedor.linhas },
};
const arquivoSaida = 'resultados/grade-validacao.json';
fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(arquivoSaida, JSON.stringify(saida, null, 2) + '\n');
console.log(`\ngravado: ${arquivoSaida}`);

// Trava R9 sobre a configuração escolhida.
if (linhaEscolhida.ndcg < LIMITES_R9[0] || linhaEscolhida.ndcg > LIMITES_R9[1]) {
  console.error(`TRAVA R9: NDCG@10 de ${args.modelo} em ${escolha.escolhida} = ${f(linhaEscolhida.ndcg)} fora de `
    + `[${f(LIMITES_R9[0], 2)}; ${f(LIMITES_R9[1], 2)}]: pare e investigue antes de seguir`);
  process.exit(3);
}
