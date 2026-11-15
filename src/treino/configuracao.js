// Treino da rede por configuração de candidatos (v2): o mesmo laço por semente do scripts/09-treinar.js
// (que fica intocado para manter a v1 reproduzível), com arquitetura 64-32, negativos "candidatos",
// 70 entradas (semPop: false), sementes 1, 2, 3, lote 256, paciência 3 e teto de 50 épocas.
import path from 'node:path';
import { historicoDoTreino } from '../features/entrada.js';
import { paresDeTreino, paresDeValidacao } from '../features/pares.js';
import { criarRede, treinar, salvarModelo } from '../modelo/rede.js';

const SEMENTES = [1, 2, 3];
const ARQUITETURA = '64-32';
const PACIENCIA = 3;

/** Menor perda de validação do histórico (null se não houver validação). */
function melhorPerdaValidacao(historico) {
  const vs = historico.map((h) => h.perdaValidacao).filter((v) => v != null);
  return vs.length ? Math.min(...vs) : null;
}

/** Épocas da semente em um Map ou em um objeto simples (chaves '1', '2', '3'). */
function epocasDaSemente(epocasPorSemente, semente) {
  const e = epocasPorSemente instanceof Map ? epocasPorSemente.get(semente) : epocasPorSemente?.[String(semente)];
  if (!Number.isInteger(e) || e < 1) throw new Error(`épocas inválidas para a semente ${semente}: ${e}`);
  return e;
}

/**
 * Treina a rede de uma configuração nas sementes 1, 2 e 3 e salva em `${dirModelos}/${nome}-${fase}-s${semente}/`.
 * Em `v2-exp`: pares de validação de ctx.alvos e parada automática (paciência 3, teto `maxEpocas`).
 * Em `v2-final`: `epocasPorSemente` obrigatório, sem validação, treino de exatamente essas épocas.
 * Devolve { nome, sementes: [{ semente, melhorEpoca, epocasTreinadas, atingiuTeto, sha256Pares }] }.
 */
export async function treinarConfiguracao({
  ctx, candidatosPorUsuario, nome, fase, epocasPorSemente = null, dirModelos = 'modelos', maxEpocas = 50,
}) {
  if (fase !== 'v2-exp' && fase !== 'v2-final') throw new Error(`fase inválida: ${fase} (use v2-exp ou v2-final)`);
  if (fase === 'v2-final' && !epocasPorSemente) {
    throw new Error('a fase v2-final exige epocasPorSemente (as melhores épocas da v2-exp)');
  }
  if (fase === 'v2-exp' && !ctx.alvos) throw new Error('a fase v2-exp exige ctx.alvos (ratings de validação)');

  const { dataset, treino, alvos, regua } = ctx;
  const filmesPorId = new Map(dataset.filmes.map((x) => [x.id, x]));
  const usuariosPorId = new Map(dataset.usuarios.map((x) => [x.id, x]));
  const catalogo = dataset.filmes.map((x) => x.id);
  const historico = historicoDoTreino(treino, filmesPorId);
  for (const u of historico.keys()) {
    if (!candidatosPorUsuario.has(u)) throw new Error(`usuário ${u} sem candidatos na configuração ${nome}`);
  }
  const comuns = { historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema: 'candidatos', semPop: false };

  const sementes = [];
  for (const semente of SEMENTES) {
    const epocasFinais = fase === 'v2-final' ? epocasDaSemente(epocasPorSemente, semente) : null;
    const pt = paresDeTreino({ ...comuns, semente });
    const pv = fase === 'v2-exp'
      ? paresDeValidacao({ ...comuns, validacao: alvos, negativosSorteadosNoTreino: pt.negativosSorteados, semente })
      : null;
    const modelo = criarRede({ arquitetura: ARQUITETURA, dimEntrada: pt.dim, semente });
    try {
      const r = await treinar({
        modelo, x: pt.x, y: pt.y, dim: pt.dim, semente,
        ...(pv
          ? { validacao: { x: pv.x, y: pv.y }, maxEpocas, paciencia: PACIENCIA }
          : { epocas: epocasFinais }),
      });
      await salvarModelo(modelo, path.join(dirModelos, `${nome}-${fase}-s${semente}`), {
        regua,
        metadados: {
          nome, fase, negativos: 'candidatos', arquitetura: ARQUITETURA, semPop: false, semente,
          epocas: r.epocasTreinadas, melhorEpoca: r.melhorEpoca,
          hashRegua: regua.hash, sha256Pares: pt.sha256,
          data: new Date().toISOString(), perdaValidacaoMelhor: melhorPerdaValidacao(r.historico),
        },
      });
      sementes.push({
        semente, melhorEpoca: r.melhorEpoca, epocasTreinadas: r.epocasTreinadas,
        atingiuTeto: r.atingiuTeto, sha256Pares: pt.sha256,
      });
    } finally {
      modelo.dispose();
    }
  }
  return { nome, sementes };
}
