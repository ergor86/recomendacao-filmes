// Script 22 (npm run etapa1-v2): etapa 1 da avaliação final (spec §9.2), sem ler o gabarito do teste-2.
// Só monta as dependências reais de executarEtapa1 (src/avaliacao/etapa1.js), que faz as conferências
// e os cálculos na ordem da spec:
// - conferir = conferirCongelamento com o commitCodigo de resultados/configuracao-v2.json (fixo);
// - hashes atuais: treino, régua e vetores FC da fase v2-final (sem o teste-2) e sha256 da grade;
// - banco: schema v2_final (search_path v2_final,public), busca 'hnsw' e 'exata';
// - rede: treinarConfiguracao com as épocas congeladas, modelos em modelos/; pontuação com semPop: false.
// Grava artefatos/candidatos-v2-v2-final.json, artefatos/previsoes-v2-final.json,
// resultados/previsoes-v2-final.sha256.json, resultados/fidelidade-fc-v2-final.json e
// resultados/deficit-v2-final.json. Não aceita opções (nem pastas alternativas).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { construirFC, hashVetoresFC } from '../src/fc/referencia.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { buscarColaborativos } from '../src/banco/busca-fc.js';
import { lerHashesFC } from '../src/banco/carga-fc.js';
import { treinarConfiguracao } from '../src/treino/configuracao.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { pontuarCandidatos } from '../src/modelo/ranqueador.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { ARQ_CONGELAMENTO, conferirCongelamento, sha256Arquivos } from '../src/congelamento/git.js';
import { ARQ_GRADE_OFICIAL } from '../src/avaliacao/sistemas-v2.js';
import { executarEtapa1, FASE, ESQUEMA } from '../src/avaliacao/etapa1.js';

const DIR_MODELOS = 'modelos';
const ARQ_DIVISOES = 'resultados/divisoes-v2.json';
const ARQ_CANDIDATOS = `artefatos/candidatos-v2-${FASE}.json`;
const ARQ_PREVISOES = `artefatos/previsoes-${FASE}.json`;
const ARQ_HASHES = `resultados/previsoes-${FASE}.sha256.json`;
const ARQ_FIDELIDADE = `resultados/fidelidade-fc-${FASE}.json`;
const ARQ_DEFICIT = `resultados/deficit-${FASE}.json`;

// Grava um arquivo criando a pasta, se preciso.
function gravar(arq, texto) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, texto);
}

async function principal() {
  if (process.argv.length > 2) throw new Error(`npm run etapa1-v2 não aceita opções (recebido: ${process.argv.slice(2).join(' ')})`);
  if (!fs.existsSync(ARQ_CONGELAMENTO)) throw new Error(`${ARQ_CONGELAMENTO} ausente: rode npm run congelar-v2 e commite o congelamento antes da etapa 1`);
  const bytesCongelamento = fs.readFileSync(ARQ_CONGELAMENTO);
  const congelamento = JSON.parse(bytesCongelamento.toString('utf8'));
  const sha256Configuracao = crypto.createHash('sha256').update(bytesCongelamento).digest('hex');
  const conferir = () => conferirCongelamento({ commitCodigo: congelamento.commitCodigo });

  if (!fs.existsSync(ARQ_DIVISOES)) throw new Error(`${ARQ_DIVISOES} ausente: rode npm run divisoes-v2`);
  const nt = JSON.parse(fs.readFileSync(ARQ_DIVISOES, 'utf8')).teste2?.avaliaveis;
  if (congelamento.mde?.nt !== undefined && congelamento.mde.nt !== nt) {
    throw new Error(`nt de ${ARQ_DIVISOES} (${nt}) diferente do congelado (${congelamento.mde.nt}): o Passo 0 mudou depois do congelamento`);
  }

  const { pg: configPg, dirDados } = carregarConfig();
  const ctx = criarContexto({ fase: FASE, dirDados });
  const hashesAtuais = {
    treino: hashAvaliacoes(ctx.treino),
    regua: ctx.regua.hash,
    vetoresFC: hashVetoresFC(construirFC(ctx.treino, ctx.dataset.usuarios.length)),
    sha256Grade: sha256Arquivos([ARQ_GRADE_OFICIAL])[ARQ_GRADE_OFICIAL],
  };

  const filmesPorId = new Map(ctx.dataset.filmes.map((x) => [x.id, x]));
  const usuariosPorId = new Map(ctx.dataset.usuarios.map((x) => [x.id, x]));
  const historico = historicoDoTreino(ctx.treino, filmesPorId);

  // Treino: confere as épocas treinadas contra as congeladas e guarda o sha256 dos pares por semente.
  const treinos = new Map();
  const treinar = async (nome, candidatosPorUsuario, epocasPorSemente) => {
    const t0 = Date.now();
    const r = await treinarConfiguracao({ ctx, candidatosPorUsuario, nome, fase: FASE, epocasPorSemente, dirModelos: DIR_MODELOS });
    for (const s of r.sementes) {
      if (s.epocasTreinadas !== epocasPorSemente[String(s.semente)]) {
        throw new Error(`${nome} semente ${s.semente}: treinou ${s.epocasTreinadas} épocas, mas o congelamento manda ${epocasPorSemente[String(s.semente)]}`);
      }
    }
    treinos.set(nome, r);
    console.log(`  ${nome} treinada em ${((Date.now() - t0) / 1000).toFixed(0)} s (épocas ${r.sementes.map((s) => s.epocasTreinadas).join('/')})`);
  };

  // Pontuação: um modelo carregado por vez (a etapa 1 pontua sistema → semente → usuário).
  let atual = null;
  const pontuar = async (nome, semente, u, ids) => {
    if (!atual || atual.nome !== nome || atual.semente !== semente) {
      atual?.modelo.dispose();
      atual = null;
      const dir = path.join(DIR_MODELOS, `${nome}-${FASE}-s${semente}`);
      const { modelo, metadados } = await carregarModelo(dir, ctx.regua);
      const treino = treinos.get(nome)?.sementes.find((s) => s.semente === semente);
      if (metadados.semPop || metadados.nome !== nome || metadados.fase !== FASE || metadados.semente !== semente
        || !treino || metadados.sha256Pares !== treino.sha256Pares) {
        modelo.dispose();
        throw new Error(`modelo ${dir} não corresponde ao treino desta execução (nome ${metadados.nome}, fase ${metadados.fase}, semente ${metadados.semente}, semPop ${metadados.semPop}): apague a pasta e rode a etapa 1 de novo`);
      }
      atual = { nome, semente, modelo };
    }
    const usuario = usuariosPorId.get(u);
    if (!usuario) throw new Error(`usuário ${u} não existe no dataset`);
    return pontuarCandidatos({
      modelo: atual.modelo, regua: ctx.regua, semPop: false, usuario,
      curtidos: historico.get(u)?.curtidos ?? [], candidatos: ids, filmesPorId,
    });
  };

  const pool = criarPool(configPg, { searchPath: `${ESQUEMA},public` });
  try {
    await verificarConexao(pool);
    const hashesBanco = { regua: hashesAtuais.regua, treino: hashesAtuais.treino };
    const r = await executarEtapa1({
      conferir, ctx, congelamento, hashesAtuais, nt, sha256Configuracao,
      lerHashesSchema: () => lerHashesFC(pool),
      buscar: (modo, vetor, excluir, m) => buscarColaborativos(pool, { vetor, excluir, m, hashes: hashesBanco, modo }),
      treinar,
      pontuar,
      gravarCandidatos: async (arq) => gravar(ARQ_CANDIDATOS, JSON.stringify(arq)),
      gravarRelatorios: async ({ fidelidade, deficit }) => {
        gravar(ARQ_FIDELIDADE, jsonEstavel(fidelidade) + '\n');
        gravar(ARQ_DEFICIT, jsonEstavel(deficit) + '\n');
        const f = fidelidade;
        console.log(`fidelidade: S1 top 10 idêntico ${f.top10Identicos.S1.iguais}/${f.usuarios}; v2 (${f.top10Identicos.v2.sistema}) ${f.top10Identicos.v2.iguais ?? '-'}/${f.usuarios}; impacto: ${f.impacto.conclusao}${f.impacto.teto !== undefined ? ` ${f.impacto.teto.toFixed(5)} (${f.impacto.frase})` : ''}`);
        console.log(`precisão: ${f.precisao.divergenciasPrecisao} divergências aceitas (${f.precisao.usuariosComDivergencia} usuários); empates não resolvidos HNSW ${f.empateNaoResolvido.hnsw}, exata ${f.empateNaoResolvido.exata}`);
      },
      gravarPrevisoes: async (texto) => gravar(ARQ_PREVISOES, texto),
      gravarHashes: async (h) => gravar(ARQ_HASHES, jsonEstavel(h) + '\n'),
    });
    console.log(`previsões: ${ARQ_PREVISOES} (sha256 ${r.sha256}); congelamento ${r.sha256Configuracao}; FC150 ${r.sha256FC150}`);
    console.log(`commite ${ARQ_HASHES}, ${ARQ_FIDELIDADE} e ${ARQ_DEFICIT} antes da etapa 2 (chore: previsões da v2 e hash antes do gabarito)`);
  } finally {
    atual?.modelo.dispose();
    await pool.end();
  }
}

try {
  await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
