// Congelamento da v2 (spec §9.1): commit do código com a árvore limpa, conferência do congelamento
// por git (usada pelas etapas 1 e 2), sha256 de arquivos, montagem de resultados/configuracao-v2.json
// a partir da grade (a v2, as épocas e os sistemas vêm só de resultados/grade-v2-exp.json) e a regra
// do --desvio (recongelar depois de um bug, com a mesma configuração). O git é injetado para os testes.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { jsonEstavel } from '../util/json-estavel.js';

export const ARQ_CONGELAMENTO = 'resultados/configuracao-v2.json';
const CAMINHOS_CODIGO = ['src', 'scripts', 'package.json', 'package-lock.json'];
const SEMENTES = ['1', '2', '3'];
const FIXO_COM_FC = ['S4-100-50', 'S4-50-100', 'S3'];

/** Ressalva histórica da §3.4 da spec, por extenso; é copiada para o resultado final. */
export const RESSALVA = 'O teste-2 é uma **avaliação retrospectiva com isolamento implementado no Plano 3**. Suas avaliações pertenciam ao `u1.base`, que foi usado como treino no Plano 2, inclusive no cálculo de popularidade e no treino do modelo avaliado no `u1.test`. Elas nunca serviram de gabarito para escolhas. No Plano 3, foram excluídas do treino, dos candidatos e dos vetores, mas **não são dados inéditos** para o projeto. Além disso, a direção de pesquisa (tentar FC) foi informada pelos resultados do `u1.test`, que são dos mesmos usuários 1–462. O resultado deve ser lido como uma nova avaliação sob protocolo de isolamento, e não como uma validação externa independente.';

const COMPARACAO_PRINCIPAL = 'NDCG@10(v2) − NDCG@10(v1) por usuário, média das 3 sementes por usuário nos sistemas com rede, bootstrap pareado com 5.000 reamostragens e semente 2026; suportada se o IC 95% exclui zero';

const REGRAS_AVALIACAO = {
  relevancia: 'nota ≥ 4 no teste-2 vale 1; qualquer outro filme vale 0 (relevância binária)',
  exclusao: 'usuários sem nenhuma curtida escondida ficam fora de todas as métricas; os já vistos no treino v2-final saem das recomendações',
  metricas: 'v3.2 §9.3, para o top 10 com relevantes R: precision@10 = acertos / 10; recall@10 = acertos / |R|; NDCG@10 = DCG / IDCG, ganho binário, DCG = Σ rel_i / log₂(i + 1) nas posições 1..10, IDCG sobre min(|R|, 10) acertos nas primeiras posições; cobertura = filmes distintos em algum top 10 / 1.682; popularidade média do top 10',
  agregacaoSementes: 'nos sistemas com rede, o valor de cada usuário é a média das 3 sementes (1, 2, 3); a variação entre sementes é reportada à parte (mínimo e máximo); sistemas sem rede usam a semente 0',
  mainstreamNicho: 'v3.2 §9.4: média de popEscalada (régua v2-final) dos filmes curtidos no treino de cada usuário; corte na mediana do conjunto avaliado, entre os usuários que entram nas métricas, na escala da régua; quem cai na mediana vai para mainstream; usuários sem curtidas ficam fora do corte, com a contagem informada',
  unidade: 'o usuário; usuários × sementes nunca são observações independentes',
};

const REDE = { arquitetura: '64-32', negativos: 'candidatos', semPop: false, entradas: 70, sementes: [1, 2, 3], lote: 256, paciencia: 3, tetoEpocas: 50 };

/** Executa o git com os argumentos dados e devolve a saída sem espaços nas pontas. */
export function executarGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Roda um comando git de resposta sim/não: código 0 → true, código 1 → false; outro código é erro real.
function gitSimNao(args, git) {
  try {
    git(args);
    return true;
  } catch (erro) {
    if (erro.status === 1) return false;
    throw new Error(`git ${args.join(' ')} falhou: ${erro.message}`);
  }
}

/** `git diff --quiet ...` como booleano: true sem diferença (código 0), false com diferença (código 1). */
export function gitSemDiferenca(args, git = executarGit) {
  return gitSimNao(args, git);
}

// Falha se a árvore de trabalho tiver qualquer alteração ou arquivo não versionado.
function exigirArvoreLimpa(git) {
  const status = git(['status', '--porcelain']);
  if (status !== '') {
    throw new Error(`a árvore de trabalho não está limpa (git status --porcelain):\n${status}\ncommite ou descarte as alterações antes`);
  }
}

/** Commit do código para o congelamento: erro se a árvore não estiver limpa; devolve o HEAD. */
export function commitAtualLimpo({ git = executarGit } = {}) {
  exigirArvoreLimpa(git);
  return git(['rev-parse', 'HEAD']);
}

/**
 * Conferência do congelamento (§9.1), usada pelas etapas 1 e 2. Cada falha lança um erro com a causa:
 * árvore suja; arquivo não versionado ou diferente do HEAD; commitCodigo não ancestral do HEAD; código
 * (src, scripts, package.json, package-lock.json) alterado depois de commitCodigo; arquivo alterado por
 * um número de commits diferente de um depois de commitCodigo.
 */
export function conferirCongelamento({ arquivo = ARQ_CONGELAMENTO, commitCodigo, git = executarGit } = {}) {
  if (typeof commitCodigo !== 'string' || !/^[0-9a-f]{40}$/.test(commitCodigo)) {
    throw new Error(`commitCodigo inválido (${commitCodigo}): esperado o sha de 40 caracteres gravado em ${arquivo}`);
  }
  exigirArvoreLimpa(git);
  if (!gitSimNao(['ls-files', '--error-unmatch', arquivo], git)) {
    throw new Error(`${arquivo} não está versionado: commite o congelamento antes (chore: congela a configuração da v2)`);
  }
  if (!gitSemDiferenca(['diff', '--quiet', 'HEAD', '--', arquivo], git)) {
    throw new Error(`${arquivo} difere do HEAD: o congelamento não pode ser alterado sem commit (use npm run congelar-v2 -- --desvio "<motivo>")`);
  }
  if (!gitSimNao(['merge-base', '--is-ancestor', commitCodigo, 'HEAD'], git)) {
    throw new Error(`commitCodigo ${commitCodigo} não é ancestral do HEAD: o congelamento é de outro histórico`);
  }
  if (!gitSemDiferenca(['diff', '--quiet', commitCodigo, 'HEAD', '--', ...CAMINHOS_CODIGO], git)) {
    throw new Error(`o código mudou depois do congelamento (git diff ${commitCodigo} HEAD -- ${CAMINHOS_CODIGO.join(' ')}): recongele com npm run congelar-v2 -- --desvio "<motivo>"`);
  }
  const log = git(['log', '--format=%H', `${commitCodigo}..HEAD`, '--', arquivo]);
  const commits = log === '' ? [] : log.split(/\r?\n/).filter(Boolean);
  if (commits.length !== 1) {
    throw new Error(`${arquivo} deveria ter sido alterado por exatamente um commit depois de ${commitCodigo}, mas foi por ${commits.length}: um commit posterior não pode mudar o congelamento`);
  }
}

/** sha256 (hex) do conteúdo de cada arquivo, na ordem dada; arquivo ausente é erro. */
export function sha256Arquivos(caminhos) {
  const saida = {};
  for (const c of caminhos) {
    if (!fs.existsSync(c)) throw new Error(`${c} ausente: não dá para calcular o sha256 do código congelado`);
    saida[c] = crypto.createHash('sha256').update(fs.readFileSync(c)).digest('hex');
  }
  return saida;
}

// Melhor por NDCG médio da grade entre os nomes rodados (só S3 e S4, todos com rede). Empate vai para o
// mais simples pela chave da §8.4 restrita aos sistemas com rede, [N, K + N, K], como na grade.
function melhorPorNdcg(sistemas, nomes) {
  const presentes = nomes.filter((n) => n in sistemas);
  if (presentes.length === 0) return null;
  const chave = (nome) => [sistemas[nome].n, sistemas[nome].k + sistemas[nome].n, sistemas[nome].k];
  const maisSimples = (a, b) => {
    const ca = chave(a);
    const cb = chave(b);
    const i = ca.findIndex((x, j) => x !== cb[j]);
    return i >= 0 && ca[i] < cb[i];
  };
  return presentes.reduce((b, c) => {
    const d = sistemas[c].ndcg - sistemas[b].ndcg;
    if (d !== 0) return d > 0 ? c : b;
    return maisSimples(c, b) ? c : b;
  });
}

// Confere o "melhor" calculado contra o registrado nas contribuições da grade, quando houver.
function conferirMelhor(grade, conta, nome) {
  const registrado = grade.contribuicoes?.[conta]?.melhor;
  if (registrado !== undefined && registrado !== nome) {
    throw new Error(`grade inconsistente: "${conta}" registra ${registrado}, mas o maior NDCG é de ${nome}`);
  }
}

/**
 * Monta o congelamento (§9.1). A v2, as épocas, o cenário e os sistemas vêm só de `grade`; erro se a
 * escolhida não estiver entre os sistemas rodados, se faltar a v1 (S2) ou épocas de algum sistema com
 * rede, se a grade for de verificação, se o cenário divergir do portão ou o treino do resumo do Passo 0.
 * Secundárias: S0, S1, S2, S3 (se rodado), o melhor de orçamento fixo com FC e o melhor S4.
 */
export function montarCongelamento({ grade, portao, mde, resumo, hashes, commitCodigo, sha256Codigo, sha256Grade }) {
  if (grade.execucao !== undefined) throw new Error(`a grade é uma execução de verificação (${grade.execucao}); rode a grade oficial`);
  if (grade.cenario !== portao.cenario) throw new Error(`cenário da grade (${grade.cenario}) diferente do portão (${portao.cenario}): refaça a grade`);
  if (!/^[0-9a-f]{40}$/.test(commitCodigo ?? '')) throw new Error(`commitCodigo inválido: ${commitCodigo}`);
  if (resumo.hashes.treinoV2Final !== hashes.treino) {
    throw new Error(`hash do treino v2-final (${hashes.treino}) diferente do resumo do Passo 0 (${resumo.hashes.treinoV2Final})`);
  }
  const rodados = Object.keys(grade.sistemas).sort();
  const v2 = grade.escolha?.escolhida;
  if (!rodados.includes(v2)) throw new Error(`a escolhida da grade (${v2}) não está entre os sistemas rodados (${rodados.join(', ')})`);
  if (!rodados.includes('S2')) throw new Error('a v1 (S2) não foi rodada na grade');

  const melhorFixo = melhorPorNdcg(grade.sistemas, FIXO_COM_FC);
  const melhorS4 = melhorPorNdcg(grade.sistemas, rodados.filter((n) => n.startsWith('S4-')));
  conferirMelhor(grade, 'melhor de (100, 50), (50, 100), (0, 150) - S2', melhorFixo);
  conferirMelhor(grade, 'melhor S4 - S3', melhorS4);
  const secundarias = [...new Set(['S0', 'S1', 'S2', 'S3', melhorFixo, melhorS4].filter((n) => n && rodados.includes(n)))];

  const sistemas = {};
  for (const nome of [...new Set([v2, 'S2', ...secundarias])]) {
    const s = grade.sistemas[nome];
    const cfg = { rede: s.rede, k: s.k, n: s.n, totalCandidatos: s.totalCandidatos };
    if (s.rede) {
      const ep = grade.epocasPorSistema?.[nome];
      if (!ep || !SEMENTES.every((x) => Number.isInteger(ep[x]) && ep[x] >= 1)) {
        throw new Error(`épocas por semente ausentes ou inválidas para ${nome} na grade`);
      }
      cfg.epocasPorSemente = Object.fromEntries(SEMENTES.map((x) => [x, ep[x]]));
    }
    sistemas[nome] = cfg;
  }

  const par = (p) => ({ mde: mde.pares[p].mde, sigmaD: mde.pares[p].sigmaD });
  return {
    fase: 'v2-final',
    cenario: grade.cenario,
    sistemasRodados: rodados,
    v2,
    v1: 'S2',
    secundarias,
    melhores: { orcamentoFixoComFC: melhorFixo, S4: melhorS4, escolhidosDepoisDeVer: true },
    sistemas,
    rede: REDE,
    seed_api: 1,
    hashes: { teste2: resumo.hashes.teste2, treino: hashes.treino, regua: hashes.regua, vetoresFC: hashes.vetoresFC },
    sha256Grade,
    portao,
    mde: { nt: mde.nt, q: mde.q, frase: mde.frase, S0xS1: par('S0xS1'), S1xHeuristica: par('S1xHeuristica') },
    mdeDescritivo: {
      mde: grade.mdeDescritivo ?? null,
      ganhoSobSubamostragem: grade.ganhoSobSubamostragem ?? null,
      detalhe: grade.mdeDescritivoDetalhe ?? null,
      nota: 'só descritivo, nunca justificativa do resultado (§8.3)',
    },
    comparacaoPrincipal: {
      texto: COMPARACAO_PRINCIPAL,
      confirmatoria: v2 !== 'S2',
      ...(v2 === 'S2' ? { nota: 'v2 = v1 (150, 0) com a mesma rede: não há comparação confirmatória (§8.4)' } : {}),
    },
    regrasAvaliacao: REGRAS_AVALIACAO,
    ressalva: RESSALVA,
    commitCodigo,
    sha256Codigo,
    desvios: [],
  };
}

/**
 * Recongelamento por --desvio (§9.1, bug antes do gabarito): exige o mesmo cenário, a mesma v2 e v1,
 * as mesmas secundárias, sistemas (configurações e épocas) e rede do congelamento anterior, um novo
 * commitCodigo e um motivo; acrescenta { commitCodigoAnterior, motivo, data } aos desvios anteriores.
 */
export function aplicarDesvio({ anterior, novo, motivo, data }) {
  if (typeof motivo !== 'string' || motivo.trim() === '') throw new Error('--desvio exige um motivo não vazio');
  for (const campo of ['cenario', 'v2', 'v1', 'secundarias', 'sistemas', 'rede', 'seed_api']) {
    if (jsonEstavel(anterior[campo]) !== jsonEstavel(novo[campo])) {
      throw new Error(`desvio recusado: "${campo}" mudou em relação ao congelamento anterior (${jsonEstavel(anterior[campo])} → ${jsonEstavel(novo[campo])}); o --desvio só cobre correção de bug, não troca de configuração`);
    }
  }
  if (novo.commitCodigo === anterior.commitCodigo) {
    throw new Error(`desvio recusado: mesmo commitCodigo do congelamento anterior (${anterior.commitCodigo}); commite a correção antes`);
  }
  return { ...novo, desvios: [...(anterior.desvios ?? []), { commitCodigoAnterior: anterior.commitCodigo, motivo: motivo.trim(), data }] };
}
