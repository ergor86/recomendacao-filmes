// Script 23 (npm run etapa2-v2): etapa 2 da avaliação final (spec §9.3), a ÚNICA leitura do gabarito
// do teste-2. Só monta as dependências reais de executarEtapa2 (src/avaliacao/etapa2.js):
// - verificar: conferirCongelamento (commitCodigo de resultados/configuracao-v2.json) e
//   verificarAntesDoGabarito com os hashes atuais do treino, da régua e dos vetores FC v2-final (sem o
//   gabarito), o sha256 de artefatos/previsoes-v2-final.json e do congelamento contra
//   resultados/previsoes-v2-final.sha256.json, o sha256 do código de avaliação e a avaliação inexistente;
// - lerGabarito: criarContexto da fase v2-final com incluirTeste2: true (único lugar do projeto) e a
//   conferência do hash do teste-2 e do treino contra o congelamento;
// - avaliar: avaliarPrevisoes sobre as previsões gravadas na etapa 1 (sem banco nem rede);
// - gravar: resultados/avaliacao-v2.json com flag 'wx' (nunca sobrescreve).
// Não aceita opções. Qualquer que seja o resultado, ele é reportado como saiu (sem segunda rodada).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { construirFC, hashVetoresFC } from '../src/fc/referencia.js';
import { relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { ARQ_CONGELAMENTO, executarGit, conferirCongelamento } from '../src/congelamento/git.js';
import {
  ARQ_AVALIACAO, ARQ_PREVISOES, ARQ_HASHES, verificarAntesDoGabarito, conferirGabarito, avaliarPrevisoes, executarEtapa2,
} from '../src/avaliacao/etapa2.js';

const FASE = 'v2-final';
const ARQ_ETAPA2 = 'scripts/23-etapa2-v2.js';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const f = (x) => (x == null ? '-' : x.toFixed(4).replace('.', ','));

// sha256 atual dos arquivos congelados e dos que existem hoje em src/avaliacao/ e no script 23
// (null para o que sumiu), para verificarAntesDoGabarito apontar alterados, ausentes e novos.
function sha256CodigoAtual(congelados) {
  const hoje = fs.readdirSync('src/avaliacao').filter((x) => x.endsWith('.js')).map((x) => `src/avaliacao/${x}`);
  const caminhos = [...new Set([...Object.keys(congelados ?? {}), ...hoje, ARQ_ETAPA2])].sort();
  return Object.fromEntries(caminhos.map((c) => [c, fs.existsSync(c) ? sha256(fs.readFileSync(c)) : null]));
}

async function principal() {
  if (process.argv.length > 2) throw new Error(`npm run etapa2-v2 não aceita opções (recebido: ${process.argv.slice(2).join(' ')})`);
  if (!fs.existsSync(ARQ_CONGELAMENTO)) throw new Error(`${ARQ_CONGELAMENTO} ausente: congele e rode a etapa 1 antes da etapa 2`);
  const bytesCongelamento = fs.readFileSync(ARQ_CONGELAMENTO);
  const congelamento = JSON.parse(bytesCongelamento.toString('utf8'));

  // Entradas da verificação, todas sem o gabarito.
  const { dirDados } = carregarConfig();
  const ctx = criarContexto({ fase: FASE, dirDados });
  const hashesAtuais = {
    treino: hashAvaliacoes(ctx.treino),
    regua: ctx.regua.hash,
    vetoresFC: hashVetoresFC(construirFC(ctx.treino, ctx.dataset.usuarios.length)),
  };
  const textoPrevisoes = fs.existsSync(ARQ_PREVISOES) ? fs.readFileSync(ARQ_PREVISOES) : null;
  const gravado = fs.existsSync(ARQ_HASHES) ? JSON.parse(fs.readFileSync(ARQ_HASHES, 'utf8')) : null;
  const avaliacaoExiste = fs.existsSync(ARQ_AVALIACAO) || executarGit(['log', '--format=%H', '--', ARQ_AVALIACAO]) !== '';
  const sha256Previsoes = textoPrevisoes ? sha256(textoPrevisoes) : null;
  const sha256Configuracao = sha256(bytesCongelamento);

  const verificar = () => {
    const problemas = [];
    try {
      conferirCongelamento({ commitCodigo: congelamento.commitCodigo });
    } catch (erro) {
      problemas.push(erro.message);
    }
    problemas.push(...verificarAntesDoGabarito({
      congelamento, gravado, sha256PrevisoesAtual: sha256Previsoes, sha256ConfiguracaoAtual: sha256Configuracao,
      sha256CodigoAtual: sha256CodigoAtual(congelamento.sha256Codigo), hashesAtuais, avaliacaoExiste,
    }));
    return problemas;
  };

  const lerGabarito = () => {
    console.log('conferências aprovadas: lendo o gabarito do teste-2 (única vez)');
    const comGabarito = criarContexto({ fase: FASE, dirDados, incluirTeste2: true });
    conferirGabarito({ alvos: comGabarito.alvos, treino: comGabarito.treino, congelamento });
    return comGabarito.alvos;
  };

  const avaliar = (gabarito) => ({
    data: new Date().toISOString(),
    sha256Previsoes,
    sha256Configuracao,
    sha256FC150: gravado.sha256FC150,
    commitCodigo: congelamento.commitCodigo,
    ...avaliarPrevisoes({
      previsoes: JSON.parse(textoPrevisoes.toString('utf8')),
      relevantes: relevantesPorUsuario(gabarito),
      contagens: ctx.regua.contagens,
      congelamento,
      regua: ctx.regua,
      treino: ctx.treino,
      filmes: ctx.dataset.filmes,
    }),
  });

  const gravar = (resultado) => {
    fs.mkdirSync(path.dirname(ARQ_AVALIACAO), { recursive: true });
    fs.writeFileSync(ARQ_AVALIACAO, jsonEstavel(resultado) + '\n', { flag: 'wx' }); // 'wx': nunca sobrescreve
  };

  const r = await executarEtapa2({ verificar, lerGabarito, avaliar, gravar });

  console.log(`usuários avaliados: ${r.usuarios.avaliados}; sem relevantes: ${r.usuarios.semRelevantes.length}`);
  for (const [nome, s] of Object.entries(r.sistemas)) {
    console.log(`  ${nome}: NDCG ${f(s.ndcg)}, P@10 ${f(s.precisao)}, R@10 ${f(s.recall)}, cobertura ${f(s.cobertura)}, popularidade ${f(s.popularidadeMediaContagem)}`);
  }
  const c = r.comparacaoPrincipal;
  if (c.confirmatoria) {
    console.log(`comparação principal (${c.v2} − ${c.v1}): ${f(c.media)}, IC95 [${f(c.ic95[0])}; ${f(c.ic95[1])}] → ${c.suportada ? 'SUPORTADA' : 'não suportada'}`);
  } else {
    console.log(c.texto);
  }
  console.log(`gravado: ${ARQ_AVALIACAO}; commite em seguida (chore: resultado da avaliação final da v2)`);
}

try {
  await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
