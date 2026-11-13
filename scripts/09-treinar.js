// Script 09 (npm run treinar): treina a rede densa nas sementes 1, 2 e 3.
//   npm run treinar -- --fase exp|final --negativos uniforme|candidatos --arquitetura 128-64-32|64-32
//                      [--sem-pop] [--epocas-de <arquivo>] [--max-epocas <n>] [--saida <pasta>] [--motivo <texto>]
// - Fase exp: por semente, monta os pares de treino e de validação (os sorteados da validação excluem os
//   do treino da mesma semente), treina com parada automática (paciência 3, teto 50) e restaura os melhores pesos.
// - Fase final: exige --epocas-de resultados/treino-<nome>-exp.json; sem pares de validação; cada semente
//   treina exatamente a sua melhorEpoca da exp.
// Grava modelos/<nome>-<fase>-s<semente>/ e resultados/treino-<nome>-<fase>.json (a cada semente, para que
// uma falha preserve o que já terminou) e acrescenta uma linha a resultados/diario-treinos.jsonl.
// --saida <pasta> troca modelos/ e resultados/ por <pasta>/modelos e <pasta>/resultados e não escreve no diário.
// Retreino (nome e fase já presentes no diário) sem --motivo é recusado antes de qualquer trabalho pesado;
// na primeira execução o motivo padrão é "planejado".
// Não usa o banco e não lê u1.test (criarContexto sem incluirTeste).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua } from '../src/features/regua.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { paresDeTreino, paresDeValidacao } from '../src/features/pares.js';
import { lerCandidatos } from '../src/candidatos/arquivo.js';
import { ARQUITETURAS, criarRede, treinar, prever, salvarModelo } from '../src/modelo/rede.js';
import { auc } from '../src/avaliacao/diagnosticos.js';
import { motivoDoTreino } from '../src/treino/diario.js';

const SEMENTES = [1, 2, 3];
const TAMANHO_LOTE = 256;
const PACIENCIA = 3;
const TETO_EPOCAS = 50;
const f = (x, d = 4) => (x == null ? '-' : x.toFixed(d).replace('.', ','));

/** Lê os argumentos da linha de comando; falha alto com o uso correto se algo estiver errado. */
function lerArgumentos(argv) {
  const uso = 'uso: npm run treinar -- --fase exp|final --negativos uniforme|candidatos --arquitetura 128-64-32|64-32 '
    + '[--sem-pop] [--epocas-de <arquivo>] [--max-epocas <n>] [--saida <pasta>] [--motivo <texto>]';
  const comValor = ['--fase', '--negativos', '--arquitetura', '--epocas-de', '--max-epocas', '--saida', '--motivo'];
  const a = { semPop: false, motivo: null, maxEpocas: TETO_EPOCAS, epocasDe: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    const nome = argv[i];
    if (nome === '--sem-pop') { a.semPop = true; continue; }
    if (!comValor.includes(nome)) throw new Error(`argumento desconhecido "${nome}"\n${uso}`);
    const valor = argv[++i];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`falta o valor de ${nome}\n${uso}`);
    const chave = nome.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    a[chave] = valor;
  }
  if (a.fase !== 'exp' && a.fase !== 'final') throw new Error(`--fase inválida: ${a.fase} (use exp ou final)\n${uso}`);
  if (a.negativos !== 'uniforme' && a.negativos !== 'candidatos') {
    throw new Error(`--negativos inválido: ${a.negativos} (use uniforme ou candidatos)\n${uso}`);
  }
  if (!ARQUITETURAS[a.arquitetura]) {
    throw new Error(`--arquitetura inválida: ${a.arquitetura} (use ${Object.keys(ARQUITETURAS).join(' ou ')})\n${uso}`);
  }
  a.maxEpocas = Number(a.maxEpocas);
  if (!Number.isInteger(a.maxEpocas) || a.maxEpocas < 1) throw new Error(`--max-epocas deve ser um inteiro ≥ 1\n${uso}`);
  if (a.fase === 'exp' && a.epocasDe) throw new Error('--epocas-de só vale na fase final');
  return a;
}

/** Na fase final, lê as épocas por semente do treino da exp e confere que é o mesmo modelo. */
function lerEpocasDaExp(args, nome) {
  const sugestao = `resultados/treino-${nome}-exp.json`;
  if (!args.epocasDe) {
    throw new Error(`a fase final exige --epocas-de ${sugestao} (rode antes o treino da fase exp com os mesmos argumentos)`);
  }
  if (!fs.existsSync(args.epocasDe)) {
    throw new Error(`arquivo de épocas ausente: ${args.epocasDe}; rode npm run treinar -- --fase exp --negativos ${args.negativos} --arquitetura ${args.arquitetura}${args.semPop ? ' --sem-pop' : ''}`);
  }
  const exp = JSON.parse(fs.readFileSync(args.epocasDe, 'utf8'));
  const difere = [];
  if (exp.fase !== 'exp') difere.push(`fase=${exp.fase} (esperado exp)`);
  if (exp.negativos !== args.negativos) difere.push(`negativos=${exp.negativos}`);
  if (exp.arquitetura !== args.arquitetura) difere.push(`arquitetura=${exp.arquitetura}`);
  if (Boolean(exp.semPop) !== args.semPop) difere.push(`semPop=${exp.semPop}`);
  if (difere.length) {
    throw new Error(`--epocas-de ${args.epocasDe} é de outro modelo (${difere.join(', ')}); use ${sugestao}`);
  }
  const epocas = new Map();
  for (const s of SEMENTES) {
    const e = exp.sementes?.find((x) => x.semente === s)?.melhorEpoca;
    if (!Number.isInteger(e) || e < 1) throw new Error(`${args.epocasDe} não tem melhorEpoca válida para a semente ${s}; refaça o treino da exp`);
    epocas.set(s, e);
  }
  return epocas;
}

/** Monta Map<usuario, number[]> = populares seguidos dos vizinhos, sem repetição. */
function listaDeCandidatos(candidatos) {
  const mapa = new Map();
  for (const [u, { populares, vizinhos }] of candidatos) mapa.set(u, [...new Set([...populares, ...vizinhos])]);
  return mapa;
}

/** Menor perda de validação do histórico (null se não houver validação). */
function melhorPerdaValidacao(historico) {
  const vs = historico.map((h) => h.perdaValidacao).filter((v) => v != null);
  return vs.length ? Math.min(...vs) : null;
}

// ---------------------------------------------------------------------------------------------

const args = lerArgumentos(process.argv.slice(2));
const { fase, negativos, arquitetura, semPop } = args;
const nome = `${negativos}-${arquitetura}${semPop ? '-sempop' : ''}`;
const dirModelos = args.saida ? path.join(args.saida, 'modelos') : 'modelos';
const dirResultados = args.saida ? path.join(args.saida, 'resultados') : 'resultados';
const arquivoDiario = path.join(dirResultados, 'diario-treinos.jsonl');
// Antes de qualquer trabalho pesado: retreino (mesmo nome e fase já no diário) exige --motivo.
// Com --saida não há diário nem checagem.
const motivo = args.saida
  ? (args.motivo ?? 'planejado')
  : motivoDoTreino(fs.existsSync(arquivoDiario) ? fs.readFileSync(arquivoDiario, 'utf8') : '', {
    nome, fase, motivoInformado: args.motivo,
  });
const epocasFinais = fase === 'final' ? lerEpocasDaExp(args, nome) : null;

const { dirDados } = carregarConfig();
const regua = carregarRegua(`artefatos/regua-${fase}.json`);
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase, dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error(`régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes -- --fase ${fase}`);
}
// Sempre lê os candidatos da fase (também no esquema uniforme), para registrar o sha256 usado.
const caminhoCandidatos = `artefatos/candidatos-${fase}.json`;
const candidatos = lerCandidatos(caminhoCandidatos, regua);
const sha256Candidatos = JSON.parse(fs.readFileSync(caminhoCandidatos, 'utf8')).sha256;
const candidatosPorUsuario = listaDeCandidatos(candidatos);

const filmesPorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const usuariosPorId = new Map(dataset.usuarios.map((x) => [x.id, x]));
const catalogo = dataset.filmes.map((x) => x.id);
const historico = historicoDoTreino(treino, filmesPorId);
for (const u of historico.keys()) {
  if (!candidatosPorUsuario.has(u)) throw new Error(`usuário ${u} sem candidatos em ${caminhoCandidatos}: rode npm run gerar-candidatos -- --fase ${fase}`);
}
const comuns = { historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema: negativos, semPop };

console.log(`== Treino ${nome} (fase ${fase}) ==`);
console.log(`régua ${regua.hash.slice(0, 12)}…; candidatos ${sha256Candidatos.slice(0, 12)}…; teto ${args.maxEpocas} épocas`);

const saida = {
  nome, fase, negativos, arquitetura, semPop, hashRegua: regua.hash, sha256Candidatos, sementes: [],
};
const arquivoSaida = path.join(dirResultados, `treino-${nome}-${fase}.json`);
fs.mkdirSync(dirResultados, { recursive: true });

for (const semente of SEMENTES) {
  const inicio = Date.now();
  const pt = paresDeTreino({ ...comuns, semente });
  const pv = fase === 'exp'
    ? paresDeValidacao({ ...comuns, validacao: alvos, negativosSorteadosNoTreino: pt.negativosSorteados, semente })
    : null;
  console.log(`\n-- semente ${semente} --`);
  console.log(`pares de treino: ${pt.n} (sha256 ${pt.sha256.slice(0, 12)}…); validação: ${pv ? pv.n : '-'}`);

  const modelo = criarRede({ arquitetura, dimEntrada: pt.dim, semente });
  try {
    modelo.summary();
    const r = await treinar({
      modelo, x: pt.x, y: pt.y, dim: pt.dim, semente,
      ...(pv
        ? { validacao: { x: pv.x, y: pv.y }, maxEpocas: args.maxEpocas, paciencia: PACIENCIA }
        : { epocas: epocasFinais.get(semente) }),
    });
    for (const h of r.historico) {
      console.log(`  época ${h.epoca}: perda ${f(h.perda)}${h.perdaValidacao == null ? '' : `, validação ${f(h.perdaValidacao)}`}`);
    }
    const aucTreino = auc(prever(modelo, pt.x, pt.dim), pt.y);
    const aucValidacao = pv ? auc(prever(modelo, pv.x, pv.dim), pv.y) : null;
    const perdaValidacaoMelhor = melhorPerdaValidacao(r.historico);
    const segundos = (Date.now() - inicio) / 1000;
    const passosDeGradiente = Math.ceil(pt.n / TAMANHO_LOTE) * r.epocasTreinadas;

    await salvarModelo(modelo, path.join(dirModelos, `${nome}-${fase}-s${semente}`), {
      regua,
      metadados: {
        nome, fase, negativos, arquitetura, semPop, semente,
        epocas: r.epocasTreinadas, melhorEpoca: r.melhorEpoca,
        hashRegua: regua.hash, sha256Candidatos, sha256Pares: pt.sha256,
        data: new Date().toISOString(), perdaValidacaoMelhor,
      },
    });

    saida.sementes.push({
      semente, melhorEpoca: r.melhorEpoca, epocasTreinadas: r.epocasTreinadas, atingiuTeto: r.atingiuTeto,
      segundos, sha256Pares: pt.sha256, passosDeGradiente, aucTreino, aucValidacao,
      historico: r.historico,
      resumoPares: { treino: { n: pt.n, ...pt.resumo }, validacao: pv ? { n: pv.n, ...pv.resumo } : null },
    });
    fs.writeFileSync(arquivoSaida, JSON.stringify(saida, null, 2) + '\n');

    console.log(`melhor época ${r.melhorEpoca} de ${r.epocasTreinadas}${r.atingiuTeto ? ' (ATINGIU O TETO)' : ''}; `
      + `perda de validação ${f(perdaValidacaoMelhor)}; AUC treino ${f(aucTreino)}, validação ${f(aucValidacao)}; `
      + `${passosDeGradiente} passos; ${segundos.toFixed(1)} s`);
    if (r.atingiuTeto) console.warn(`ATENÇÃO: a semente ${semente} atingiu o teto de ${args.maxEpocas} épocas sem parar pela paciência.`);
  } finally {
    modelo.dispose();
  }
}

if (!args.saida) {
  const linha = {
    data: new Date().toISOString(), argumentos: process.argv.slice(2), motivo, nome, fase,
    sha256Pares: Object.fromEntries(saida.sementes.map((s) => [String(s.semente), s.sha256Pares])),
  };
  fs.appendFileSync(arquivoDiario, JSON.stringify(linha) + '\n');
}
console.log(`\ngravado: ${arquivoSaida}`);
