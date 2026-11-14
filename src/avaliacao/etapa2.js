// Etapa 2 da avaliação final (spec §9.3): leitura do gabarito do teste-2, uma única vez.
// Ordem: (1) conferências sem o gabarito (congelamento e hashes, hash das previsões e do congelamento
// contra o arquivo commitado, sha256 do código de avaliação, avaliação ainda inexistente); (2) só então
// o gabarito, com o hash conferido; (3) métricas só a partir das previsões gravadas na etapa 1 (sem
// busca no banco nem inferência da rede); (4) comparação principal e secundárias (§8.5); (5) gravação.
//
// Só importa módulos puros. A leitura do gabarito e a gravação chegam como funções injetadas pelo
// script 23, que é o único lugar que pede o gabarito ao contexto; assim a ordem é testada com dados
// sintéticos e este arquivo nunca lê o teste-2 sozinho.
import { hashAvaliacoes } from '../util/hash-avaliacoes.js';
import { popEscalada } from '../features/regua.js';
import { avaliarSistema } from './metricas.js';
import { projetar, mediaEntreSementes } from './escolha.js';
import { bootstrapPareado, grupoMainstream } from './estatistica.js';
import { valoresMainstream, metricasPorGrupo, mediana } from './experimentos.js';
import { diferencaDescritiva } from './sistemas-v2.js';
import { sistemasAvaliados, SEMENTES, USUARIOS_TESTE2 } from './etapa1.js';

export const ARQ_AVALIACAO = 'resultados/avaliacao-v2.json';
export const ARQ_PREVISOES = 'artefatos/previsoes-v2-final.json';
export const ARQ_HASHES = 'resultados/previsoes-v2-final.sha256.json';
export const REAMOSTRAGENS = 5000;
export const SEMENTE_BOOTSTRAP = 2026;
export const TEXTO_SEM_CONFIRMATORIA = 'sem comparação confirmatória: a configuração escolhida é a v1';
const NOTA_SISTEMA_COMPLETO = 'a comparação principal mede o sistema completo (candidatos, negativos de treino, ordenador, HNSW e preenchimento ao mesmo tempo) e não atribui o ganho a um componente; só S3 − S1 isola o ordenador (§8.5)';
const METRICAS = ['ndcg', 'precisao', 'recall'];
const HASHES_CONFERIDOS = ['treino', 'regua', 'vetoresFC'];
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Passo 1 da §9.3, sem ler o gabarito: devolve a lista de problemas (vazia = pode ler).
 * - hashes atuais do treino, da régua e dos vetores FC v2-final contra os congelados;
 * - coerência do congelamento (sistemas avaliados; comparação confirmatória ⇔ v2 ≠ v1);
 * - arquivo de previsões presente e com o sha256 gravado; sha256 do congelamento igual ao gravado;
 * - sha256 atual de cada arquivo de código congelado (e de nenhum arquivo novo) igual ao congelado;
 * - resultados/avaliacao-v2.json ainda não existe.
 * @param gravado conteúdo de resultados/previsoes-v2-final.sha256.json (null se ausente)
 * @param sha256PrevisoesAtual sha256 dos bytes de artefatos/previsoes-v2-final.json (null se ausente)
 * @param sha256CodigoAtual Record caminho → sha256 atual (null se o arquivo sumiu), cobrindo os
 *        arquivos congelados e os de src/avaliacao/ e do script 23 que existem hoje
 * @param hashesAtuais { treino, regua, vetoresFC } da fase v2-final sem o gabarito
 */
export function verificarAntesDoGabarito({
  congelamento, gravado, sha256PrevisoesAtual, sha256ConfiguracaoAtual, sha256CodigoAtual, hashesAtuais, avaliacaoExiste,
}) {
  const problemas = [];
  for (const campo of HASHES_CONFERIDOS) {
    const congelado = congelamento.hashes?.[campo];
    if (!congelado || hashesAtuais?.[campo] !== congelado) {
      problemas.push(`hash ${campo} v2-final atual (${hashesAtuais?.[campo]}) diferente do congelado (${congelado}): os dados mudaram depois do congelamento`);
    }
  }
  if (!congelamento.hashes?.teste2) problemas.push('congelamento sem hashes.teste2: não dá para conferir o gabarito');
  try {
    sistemasAvaliados(congelamento);
  } catch (erro) {
    problemas.push(`congelamento incoerente: ${erro.message}`);
  }
  const confirmatoria = congelamento.v2 !== congelamento.v1;
  if (congelamento.comparacaoPrincipal?.confirmatoria !== confirmatoria) {
    problemas.push(`comparacaoPrincipal.confirmatoria = ${congelamento.comparacaoPrincipal?.confirmatoria}, mas v2 = ${congelamento.v2} e v1 = ${congelamento.v1} exigem ${confirmatoria}`);
  }

  if (!gravado) {
    problemas.push(`${ARQ_HASHES} ausente: rode a etapa 1 (npm run etapa1-v2) e commite o hash antes da etapa 2`);
  } else {
    if (!sha256PrevisoesAtual) {
      problemas.push(`${ARQ_PREVISOES} ausente: rode a etapa 1 de novo (npm run etapa1-v2)`);
    } else if (sha256PrevisoesAtual !== gravado.sha256) {
      problemas.push(`sha256 das previsões (${sha256PrevisoesAtual}) diferente do gravado em ${ARQ_HASHES} (${gravado.sha256}): ${ARQ_PREVISOES} mudou depois do hash`);
    }
    if (sha256ConfiguracaoAtual !== gravado.sha256Configuracao) {
      problemas.push(`sha256 do congelamento (${sha256ConfiguracaoAtual}) diferente do gravado em ${ARQ_HASHES} (${gravado.sha256Configuracao}): o congelamento não é o da etapa 1`);
    }
  }

  const congelados = congelamento.sha256Codigo ?? {};
  if (Object.keys(congelados).length === 0) problemas.push('congelamento sem sha256Codigo: não dá para conferir o código de avaliação');
  const caminhos = [...new Set([...Object.keys(congelados), ...Object.keys(sha256CodigoAtual ?? {})])].sort();
  for (const c of caminhos) {
    const atual = sha256CodigoAtual?.[c] ?? null;
    if (!(c in congelados)) problemas.push(`${c} não estava no congelamento (sha256Codigo): código de avaliação novo depois do congelamento`);
    else if (atual === null) problemas.push(`${c} ausente: o código de avaliação congelado sumiu`);
    else if (atual !== congelados[c]) problemas.push(`${c} alterado depois do congelamento (sha256 ${atual} ≠ ${congelados[c]})`);
  }

  if (avaliacaoExiste) problemas.push(`${ARQ_AVALIACAO} já existe (ou já foi commitado): a etapa 2 roda uma única vez`);
  return problemas;
}

/**
 * Passo 2 da §9.3, logo depois da leitura: o hash do gabarito tem de ser o do teste-2 congelado e o
 * treino lido junto, o congelado; usuários do gabarito só entre 1 e 462. Lança erro se divergir.
 */
export function conferirGabarito({ alvos, treino, congelamento }) {
  if (!Array.isArray(alvos) || alvos.length === 0) throw new Error('gabarito do teste-2 vazio ou ausente: o contexto não devolveu as notas escondidas');
  const h = hashAvaliacoes(alvos);
  if (h !== congelamento.hashes.teste2) {
    throw new Error(`hash do teste-2 lido (${h}) diferente do congelado (${congelamento.hashes.teste2}): o gabarito não é o do congelamento`);
  }
  const ht = hashAvaliacoes(treino);
  if (ht !== congelamento.hashes.treino) {
    throw new Error(`hash do treino lido com o gabarito (${ht}) diferente do congelado (${congelamento.hashes.treino}): o gabarito vazou para o treino?`);
  }
  const fora = alvos.find((a) => a.usuario < USUARIOS_TESTE2[0] || a.usuario > USUARIOS_TESTE2.at(-1));
  if (fora) throw new Error(`usuário ${fora.usuario} no gabarito do teste-2, fora de 1–462`);
}

// Top 10 de um sistema numa semente, como Map<u, ids>, para os usuários 1–462; confere que cada lista
// tem 10 filmes do catálogo, distintos e não vistos no treino v2-final.
function top10DaSemente(previsoes, nome, semente, vistos, catalogo) {
  const porU = previsoes.sistemas[nome].porSemente?.[String(semente)];
  if (!porU) throw new Error(`previsões de ${nome} sem a semente ${semente}: a etapa 1 não gravou este sistema inteiro`);
  const m = new Map();
  for (const u of USUARIOS_TESTE2) {
    const ids = porU[String(u)];
    if (!Array.isArray(ids) || ids.length !== 10 || new Set(ids).size !== 10 || !ids.every((id) => catalogo.has(id))) {
      throw new Error(`previsão de ${nome}/semente ${semente}/usuário ${u} não é um top 10 de filmes distintos do catálogo`);
    }
    const visto = ids.find((id) => vistos.get(u)?.has(id));
    if (visto !== undefined) throw new Error(`previsão de ${nome}/semente ${semente}/usuário ${u} traz o filme ${visto}, já visto no treino`);
    m.set(u, ids);
  }
  return m;
}

// Resultado de avaliarSistema sem o Map porUsuario.
function semPorUsuario(r) {
  return { ndcg: r.ndcg, precisao: r.precisao, recall: r.recall, cobertura: r.cobertura, popularidadeMediaContagem: r.popularidadeMediaContagem };
}

// Métricas de um sistema: sem rede, a semente 0; com rede, cada semente e a média por usuário entre
// as sementes (métricas por usuário, cobertura e popularidade média da média das sementes).
function avaliarUmSistema(s, previsoes, relevantes, contagens, vistos, catalogo) {
  const sementes = s.rede ? SEMENTES : [0];
  const esperadas = sementes.map(String).sort();
  const gravadas = Object.keys(previsoes.sistemas[s.nome].porSemente ?? {}).sort();
  if (esperadas.join(',') !== gravadas.join(',')) {
    throw new Error(`previsões de ${s.nome} com as sementes ${gravadas.join(', ')}; esperadas ${esperadas.join(', ')}`);
  }
  const porSemente = sementes.map((semente) => ({
    semente, r: avaliarSistema(top10DaSemente(previsoes, s.nome, semente, vistos, catalogo), relevantes, contagens),
  }));
  const base = { rede: s.rede, k: s.k, n: s.n };
  if (!s.rede) {
    const { r } = porSemente[0];
    return { porUsuario: r.porUsuario, saida: { ...base, ...semPorUsuario(r), nUsuarios: r.nUsuarios } };
  }
  const medias = Object.fromEntries(METRICAS.map((m) => [m, mediaEntreSementes(porSemente.map(({ r }) => projetar(r.porUsuario, m)))]));
  const porUsuario = new Map([...medias.ndcg.keys()].map((u) => [u, Object.fromEntries(METRICAS.map((m) => [m, medias[m].get(u)]))]));
  const linhas = porSemente.map(({ semente, r }) => ({ semente, ...semPorUsuario(r) }));
  const minMax = Object.fromEntries([...METRICAS, 'cobertura', 'popularidadeMediaContagem']
    .map((m) => [m, [Math.min(...linhas.map((l) => l[m])), Math.max(...linhas.map((l) => l[m]))]]));
  return {
    porUsuario,
    saida: {
      ...base,
      ...Object.fromEntries(METRICAS.map((m) => [m, media([...medias[m].values()])])),
      cobertura: media(linhas.map((l) => l.cobertura)),
      popularidadeMediaContagem: media(linhas.map((l) => l.popularidadeMediaContagem)),
      nota: 'métricas por usuário = média das sementes 1, 2 e 3; cobertura e popularidade média = média entre as sementes',
      porSemente: linhas,
      minMax,
      nUsuarios: porUsuario.size,
    },
  };
}

// Comparação principal (§9.1): NDCG@10(v2) − NDCG@10(v1) por usuário (média das sementes), bootstrap
// pareado 5.000/2026; suportada se o limite inferior do IC 95% é > 0. Sem ela quando v2 = v1.
function comparacaoPrincipal(congelamento, ndcg) {
  const { v2, v1 } = congelamento;
  if (v2 === v1) return { confirmatoria: false, texto: TEXTO_SEM_CONFIRMATORIA };
  const a = ndcg.get(v2);
  const b = ndcg.get(v1);
  const usuarios = [...a.keys()].sort((x, y) => x - y);
  const difs = usuarios.map((u) => a.get(u) - b.get(u));
  const { media: m, ic95 } = bootstrapPareado(difs, { reamostragens: REAMOSTRAGENS, semente: SEMENTE_BOOTSTRAP });
  return {
    confirmatoria: true,
    texto: congelamento.comparacaoPrincipal.texto,
    v2, v1, metrica: 'ndcg',
    media: m, ic95, suportada: ic95[0] > 0, nUsuarios: difs.length,
    reamostragens: REAMOSTRAGENS, semente: SEMENTE_BOOTSTRAP,
    nota: NOTA_SISTEMA_COMPLETO,
  };
}

// Secundárias da §8.5, todas descritivas, com os "melhores" congelados (escolhidos na validação,
// depois de ver a grade). Conta com sistema não avaliado → objeto com o motivo.
function secundarias(congelamento, ndcg) {
  const { orcamentoFixoComFC: melhorFixo, S4: melhorS4 } = congelamento.melhores ?? {};
  const conta = (a, b, melhor) => {
    if (!a || !b || !ndcg.has(a) || !ndcg.has(b)) {
      return { rotulo: 'descritiva', calculada: false, motivo: `não avaliada: ${!a ? 'sem "melhor" congelado' : `${ndcg.has(a) ? b : a} não rodado no cenário ${congelamento.cenario}`}` };
    }
    // diferencaDescritiva compara mapas na mesma ordem de usuários; ordena por id para o bootstrap.
    const ordem = (m) => new Map([...m].sort((x, y) => x[0] - y[0]));
    const r = diferencaDescritiva(ordem(ndcg.get(a)), ordem(ndcg.get(b)));
    return { ...(melhor ? { melhor, escolhidoDepoisDeVer: true } : {}), sistemas: [a, b], metrica: 'ndcg', ...r };
  };
  return {
    'S1 - S0': conta('S1', 'S0'),
    'S3 - S1': conta('S3', 'S1'),
    'melhor de (100, 50), (50, 100), (0, 150) - S2': conta(melhorFixo, 'S2', melhorFixo),
    'melhor S4 - S3': conta(melhorS4, 'S3', melhorS4),
    'melhor S4 - S2': conta(melhorS4, 'S2', melhorS4),
  };
}

/**
 * Passos 3 e 4 da §9.3: métricas de todos os sistemas só a partir das previsões gravadas (NDCG, P@10,
 * R@10, cobertura, popularidade média; com rede, por semente e na média), mainstream × nicho (v3.2
 * §9.4: média de popEscalada dos curtidos no treino, corte na mediana dos usuários avaliados), a
 * comparação principal, as secundárias descritivas da §8.5 e a ressalva copiada do congelamento.
 * @param previsoes conteúdo de artefatos/previsoes-v2-final.json
 * @param relevantes Map<u, Set<filme>> (relevantesPorUsuario do gabarito: só usuários com relevantes)
 * @param contagens contagens da régua v2-final; @param regua régua v2-final (escala do corte)
 * @param treino treino v2-final (vistos e curtidos); @param filmes catálogo [{ id }]
 */
export function avaliarPrevisoes({ previsoes, relevantes, contagens, congelamento, regua, treino, filmes }) {
  const sistemas = sistemasAvaliados(congelamento);
  const nomes = sistemas.map((s) => s.nome);
  const gravados = Object.keys(previsoes?.sistemas ?? {});
  const faltam = nomes.filter((n) => !gravados.includes(n));
  const sobram = gravados.filter((n) => !nomes.includes(n));
  if (faltam.length || sobram.length) {
    throw new Error(`previsões não correspondem ao congelamento (faltam: ${faltam.join(', ') || '-'}; sobram: ${sobram.join(', ') || '-'})`);
  }
  const usuarios = [...relevantes.keys()].sort((a, b) => a - b);
  const fora = usuarios.find((u) => u < USUARIOS_TESTE2[0] || u > USUARIOS_TESTE2.at(-1));
  if (fora !== undefined) throw new Error(`usuário ${fora} com relevantes fora de 1–462`);
  if (usuarios.length !== congelamento.mde?.nt) {
    throw new Error(`nº de usuários avaliados (${usuarios.length}) diferente do nt congelado (${congelamento.mde?.nt}): o gabarito não é o do Passo 0`);
  }
  const relevantesOrdenados = new Map(usuarios.map((u) => [u, relevantes.get(u)]));

  const vistos = new Map();
  const curtidos = new Map();
  for (const { usuario, filme, nota } of treino) {
    if (!vistos.has(usuario)) vistos.set(usuario, new Set());
    vistos.get(usuario).add(filme);
    if (nota >= 4) {
      if (!curtidos.has(usuario)) curtidos.set(usuario, []);
      curtidos.get(usuario).push(filme);
    }
  }
  const catalogo = new Set(filmes.map((f) => f.id));

  const saidaSistemas = {};
  const porUsuario = new Map();
  for (const s of sistemas) {
    const r = avaliarUmSistema(s, previsoes, relevantesOrdenados, contagens, vistos, catalogo);
    porUsuario.set(s.nome, r.porUsuario);
    saidaSistemas[s.nome] = { ...r.saida, ndcgPorUsuario: Object.fromEntries([...projetar(r.porUsuario, 'ndcg')].map(([u, v]) => [String(u), v])) };
  }
  const ndcg = new Map([...porUsuario].map(([nome, m]) => [nome, projetar(m, 'ndcg')]));

  const { valores, semCurtidas } = valoresMainstream(usuarios, curtidos, (id) => popEscalada(contagens[id] ?? 0, regua));
  const grupos = grupoMainstream(valores);
  const tamanhos = { mainstream: 0, nicho: 0, semCurtidas };
  for (const g of grupos.values()) tamanhos[g]++;
  const mainstreamNicho = {
    escala: 'média de popEscalada (régua v2-final) dos filmes curtidos no treino v2-final',
    corte: 'mediana dos usuários avaliados com curtidas; quem cai na mediana vai para mainstream',
    mediana: valores.size === 0 ? null : mediana([...valores.values()]),
    tamanhos,
    porSistema: Object.fromEntries([...porUsuario].map(([nome, m]) => [nome, metricasPorGrupo(m, grupos)])),
  };

  return {
    fase: 'v2-final',
    cenario: congelamento.cenario,
    v2: congelamento.v2,
    v1: congelamento.v1,
    usuarios: {
      avaliados: usuarios.length,
      semRelevantes: USUARIOS_TESTE2.filter((u) => !relevantes.has(u)),
      nota: 'usuários 1–462 sem nenhuma curtida escondida (nota ≥ 4) ficam fora de todas as métricas',
    },
    sistemas: saidaSistemas,
    mainstreamNicho,
    comparacaoPrincipal: comparacaoPrincipal(congelamento, ndcg),
    secundarias: secundarias(congelamento, ndcg),
    notaSecundarias: 'contribuições da §8.5: todas descritivas, com IC (bootstrap 5.000, semente 2026), nenhuma é descoberta independente (comparações múltiplas); os "melhores" foram escolhidos na validação, depois de ver a grade',
    regrasAvaliacao: congelamento.regrasAvaliacao,
    ressalva: congelamento.ressalva,
  };
}

/**
 * Executa a etapa 2 na ordem da §9.3: verificar() → se houver problema (ou erro), rejeita SEM chamar
 * lerGabarito; senão lerGabarito() → avaliar(gabarito) → gravar(resultado). Sem segunda rodada.
 * @returns o resultado gravado
 */
export async function executarEtapa2({ verificar, lerGabarito, avaliar, gravar }) {
  const problemas = await verificar();
  if (!Array.isArray(problemas)) throw new Error('verificar tem de devolver a lista de problemas (string[])');
  if (problemas.length > 0) {
    throw new Error(`etapa 2 recusada antes de ler o gabarito (${problemas.length} problema(s)):\n- ${problemas.join('\n- ')}`);
  }
  const gabarito = await lerGabarito();
  const resultado = await avaliar(gabarito);
  await gravar(resultado);
  return resultado;
}
