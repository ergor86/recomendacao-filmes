// Script 21 (npm run congelar-v2): congela a configuração da v2 antes da etapa 1 (spec §9.1).
//   npm run congelar-v2                       primeiro congelamento
//   npm run congelar-v2 -- --desvio "<motivo>" recongelar depois de corrigir um bug (antes do gabarito)
// - Exige a árvore de trabalho limpa; commitCodigo = HEAD (o commit imediatamente anterior ao do congelamento).
// - A v2, as épocas, o cenário e os sistemas vêm só de resultados/grade-v2-exp.json (com o sha256 dela).
// - Hashes v2-final calculados aqui, sem ler o gabarito: teste-2 (resumoDivisoesV2, conferido contra
//   resultados/divisoes-v2.json), treino, régua e vetores FC. Mais o portão, os MDE, as regras de
//   avaliação, a ressalva da §3.4 e o sha256 de src/avaliacao/*.js e de scripts/23-etapa2-v2.js.
// - Recusa se resultados/avaliacao-v2.json existir ou já tiver sido commitado. Sem --desvio, recusa se o congelamento já existir.
// Grava resultados/configuracao-v2.json (jsonEstavel), que é commitado sozinho em seguida.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { resumoDivisoesV2 } from '../src/dados/teste2.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { construirFC, hashVetoresFC } from '../src/fc/referencia.js';
import { ARQ_GRADE_OFICIAL } from '../src/avaliacao/sistemas-v2.js';
import {
  ARQ_CONGELAMENTO, executarGit, commitAtualLimpo, sha256Arquivos, montarCongelamento, aplicarDesvio, conferirPermissaoCongelar,
} from '../src/congelamento/git.js';

const ARQ_AVALIACAO = 'resultados/avaliacao-v2.json';
const ARQ_PORTAO = 'resultados/portao-fc-v2-exp.json';
const ARQ_MDE = 'resultados/mde-v2.json';
const ARQ_DIVISOES = 'resultados/divisoes-v2.json';
const ARQ_ETAPA2 = 'scripts/23-etapa2-v2.js';

/** Lê os argumentos: só --desvio "<motivo>"; qualquer outra coisa é erro com o uso correto. */
function lerArgumentos(argv) {
  const uso = 'uso: npm run congelar-v2 [-- --desvio "<motivo>"]';
  if (argv.length === 0) return { desvio: null };
  if (argv[0] !== '--desvio' || argv.length !== 2 || argv[1].startsWith('--') || argv[1].trim() === '') {
    throw new Error(`argumentos inválidos: ${argv.join(' ')}\n${uso}`);
  }
  return { desvio: argv[1] };
}

/** Lê um JSON de resultados; ausente é erro com o comando que o produz. */
function lerJson(arq, comando) {
  if (!fs.existsSync(arq)) throw new Error(`${arq} ausente: rode ${comando} antes de congelar`);
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

/** Exige que o arquivo esteja versionado (com a árvore limpa, isso garante que está commitado). */
function exigirVersionado(arq) {
  try {
    executarGit(['ls-files', '--error-unmatch', arq]);
  } catch {
    throw new Error(`${arq} não está versionado: commite-o antes de congelar`);
  }
}

function principal() {
  const args = lerArgumentos(process.argv.slice(2));
  conferirPermissaoCongelar({
    desvio: args.desvio, existeCongelamento: fs.existsSync(ARQ_CONGELAMENTO), existeAvaliacao: fs.existsSync(ARQ_AVALIACAO),
    arquivoAvaliacao: ARQ_AVALIACAO,
  });

  const commitCodigo = commitAtualLimpo();

  const grade = lerJson(ARQ_GRADE_OFICIAL, 'npm run grade-v2 (grade oficial)');
  const portao = lerJson(ARQ_PORTAO, 'npm run portao-v2');
  const mde = lerJson(ARQ_MDE, 'npm run mde-v2');
  const divisoes = lerJson(ARQ_DIVISOES, 'npm run divisoes-v2');
  for (const arq of [ARQ_GRADE_OFICIAL, ARQ_PORTAO, ARQ_MDE, ARQ_DIVISOES]) exigirVersionado(arq);

  const { dirDados } = carregarConfig();
  const resumo = resumoDivisoesV2(dirDados);
  for (const h of ['teste2', 'treinoV2Final']) {
    if (resumo.hashes[h] !== divisoes.hashes?.[h]) {
      throw new Error(`hash ${h} atual (${resumo.hashes[h]}) diferente do registrado em ${ARQ_DIVISOES} (${divisoes.hashes?.[h]}): os dados mudaram desde o Passo 0`);
    }
  }
  const ctx = criarContexto({ fase: 'v2-final', dirDados });
  const hashes = {
    treino: hashAvaliacoes(ctx.treino),
    regua: ctx.regua.hash,
    vetoresFC: hashVetoresFC(construirFC(ctx.treino, ctx.dataset.usuarios.length)),
  };

  const arquivosCodigo = fs.readdirSync('src/avaliacao').filter((f) => f.endsWith('.js')).sort().map((f) => `src/avaliacao/${f}`);
  const sha256Codigo = sha256Arquivos([...arquivosCodigo, ARQ_ETAPA2]);
  const sha256Grade = sha256Arquivos([ARQ_GRADE_OFICIAL])[ARQ_GRADE_OFICIAL];

  let congelamento = montarCongelamento({ grade, portao, mde, resumo, hashes, commitCodigo, sha256Codigo, sha256Grade });
  const data = new Date().toISOString();
  if (args.desvio) {
    const anterior = JSON.parse(fs.readFileSync(ARQ_CONGELAMENTO, 'utf8'));
    congelamento = aplicarDesvio({ anterior, novo: congelamento, motivo: args.desvio, data });
  }
  congelamento.data = data;

  fs.writeFileSync(ARQ_CONGELAMENTO, jsonEstavel(congelamento) + '\n');
  console.log(`congelamento da v2: cenário ${congelamento.cenario}; v2 = ${congelamento.v2}; v1 = ${congelamento.v1}`);
  console.log(`secundárias: ${congelamento.secundarias.join(', ')}`);
  for (const [nome, s] of Object.entries(congelamento.sistemas)) {
    console.log(`  ${nome}: (${s.k}, ${s.n})${s.rede ? `, épocas ${Object.values(s.epocasPorSemente).join('/')}` : ', sem rede'}`);
  }
  console.log(`commitCodigo ${commitCodigo}; sha256 da grade ${sha256Grade}`);
  if (congelamento.desvios.length) console.log(`desvios: ${congelamento.desvios.length} (último: ${congelamento.desvios.at(-1).motivo})`);
  console.log(`\ngravado: ${ARQ_CONGELAMENTO}; commite só este arquivo: git add ${ARQ_CONGELAMENTO} && git commit -m "chore: congela a configuração da v2"`);
}

try {
  principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
