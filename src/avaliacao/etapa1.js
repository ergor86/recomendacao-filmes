// Etapa 1 da avaliação final (spec §9.2): previsões da v2, da v1 e das secundárias congeladas para os
// usuários 1–462, sem ler o gabarito do teste-2. Também mede a fidelidade da FC no teste-2 só com o
// que dispensa gabarito (§5.3) e conta o déficit dos candidatos (§6).
//
// Só importa módulos puros (fc, candidatos, avaliacao, util). O banco (busca e hashes do schema) e a
// rede (treino e pontuação) chegam como funções injetadas pelo script 22, e as gravações também; assim
// a ordem das conferências e o conteúdo dos arquivos são testados com dados sintéticos.
import crypto from 'node:crypto';
import { jsonEstavel } from '../util/json-estavel.js';
import { hashAvaliacoes } from '../util/hash-avaliacoes.js';
import { construirFC, perfilFC, rankingReferencia, escore64De, hashVetoresFC } from '../fc/referencia.js';
import { vistosPorUsuario } from '../candidatos/populares.js';
import {
  gerarCandidatosV2, montarArquivoCandidatosV2, listaDaConfiguracao, fc150DeTodos, sha256FC150, relatorioDeficit,
} from '../candidatos/v2.js';
import {
  TAU, conferirPrecisao, medidas12, tetoImpacto, top10Identicos, entradaReferencia, kNDoSistema,
} from './fidelidade.js';
import { nomeSistema, top10S0, top10S1, conferirFC150, posicoesDoPreenchimento } from './sistemas-v2.js';

export const FASE = 'v2-final';
export const ESQUEMA = 'v2_final';
export const M = 300;
export const NS = [50, 100, 150];
export const SEMENTES = [1, 2, 3];
export const USUARIOS_TESTE2 = Array.from({ length: 462 }, (_, i) => i + 1);
export const FRASE_NAO_MEDIDO = 'o impacto da aproximação sobre o NDCG no teste-2 não foi medido';

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const RECONGELAR = 'confira os dados e o banco; se o código mudou por bug, recongele com npm run congelar-v2 -- --desvio "<motivo>"';

/** Nome do modelo da configuração (K, N), como na grade: v2-<k>-<n> (pasta <nome>-v2-final-s<semente>). */
export function nomeModelo({ k, n }) {
  return `v2-${k}-${n}`;
}

/**
 * Sistemas a avaliar: v2, v1 e secundárias do congelamento, sem repetição, na ordem em que aparecem.
 * Confere cada um contra o próprio nome: S0 e S1 sem rede (S1 = (0, 150)); os demais com rede, (k, n)
 * igual ao do nome e épocas inteiras ≥ 1 nas sementes 1, 2 e 3. A v1 tem de ser S2.
 * @returns Array<{ nome, rede, k, n, epocasPorSemente, usaFC }>
 */
export function sistemasAvaliados(congelamento) {
  if (congelamento.v1 !== 'S2') throw new Error(`congelamento com v1 = ${congelamento.v1}; a v1 é S2 = (150, 0)`);
  if (!Array.isArray(congelamento.secundarias)) throw new Error('congelamento sem a lista de secundárias');
  const nomes = [...new Set([congelamento.v2, congelamento.v1, ...congelamento.secundarias])];
  return nomes.map((nome) => {
    const cfg = congelamento.sistemas?.[nome];
    if (!cfg) throw new Error(`sistema ${nome} sem configuração em congelamento.sistemas`);
    if (nome === 'S0' || nome === 'S1') {
      if (cfg.rede !== false) throw new Error(`${nome} congelado com rede; ${nome} não tem rede`);
      if (nome === 'S1' && (cfg.k !== 0 || cfg.n !== 150)) throw new Error(`S1 congelado com (${cfg.k}, ${cfg.n}); S1 é a FC150 = (0, 150)`);
      return { nome, rede: false, k: cfg.k, n: cfg.n, epocasPorSemente: null, usaFC: nome === 'S1' };
    }
    const kn = kNDoSistema(nome);
    if (cfg.rede !== true || cfg.k !== kn.k || cfg.n !== kn.n || nomeSistema(kn) !== nome) {
      throw new Error(`${nome} congelado como (${cfg.k}, ${cfg.n}, rede ${cfg.rede}); o nome exige (${kn.k}, ${kn.n}) com rede`);
    }
    for (const s of SEMENTES) {
      const e = cfg.epocasPorSemente?.[String(s)];
      if (!Number.isInteger(e) || e < 1) throw new Error(`${nome}: épocas congeladas inválidas na semente ${s} (${e})`);
    }
    return { nome, rede: true, k: kn.k, n: kn.n, epocasPorSemente: cfg.epocasPorSemente, usaFC: kn.n > 0 };
  });
}

/**
 * Passo 2: hashes atuais (treino, régua, vetores FC, sha256 da grade) contra os congelados, e depois
 * contra o próprio contexto (os hashes informados têm de ser os do treino e da régua em uso).
 * @returns a FC de referência do contexto (já construída para o hash dos vetores)
 */
export function conferirHashes({ congelamento, hashesAtuais, ctx }) {
  const rotulos = { treino: 'do treino v2-final', regua: 'da régua v2-final', vetoresFC: 'dos vetores FC v2-final' };
  for (const [campo, rotulo] of Object.entries(rotulos)) {
    const congelado = congelamento.hashes?.[campo];
    if (!congelado || hashesAtuais[campo] !== congelado) {
      throw new Error(`hash ${rotulo} atual (${hashesAtuais[campo]}) diferente do congelado (${congelado}): ${RECONGELAR}`);
    }
  }
  if (!congelamento.sha256Grade || hashesAtuais.sha256Grade !== congelamento.sha256Grade) {
    throw new Error(`sha256 atual de resultados/grade-v2-exp.json (${hashesAtuais.sha256Grade}) diferente do congelado (${congelamento.sha256Grade}): a grade mudou depois do congelamento`);
  }
  const fc = construirFC(ctx.treino, ctx.dataset.usuarios.length);
  const doContexto = { treino: hashAvaliacoes(ctx.treino), regua: ctx.regua.hash, vetoresFC: hashVetoresFC(fc) };
  for (const campo of Object.keys(rotulos)) {
    if (doContexto[campo] !== hashesAtuais[campo]) {
      throw new Error(`hashesAtuais.${campo} (${hashesAtuais[campo]}) não é o do contexto em uso (${doContexto[campo]}): calcule os hashes a partir do mesmo contexto`);
    }
  }
  return fc;
}

/** Passo 3: o schema lido é v2_final e guarda a régua e o treino congelados. */
export function conferirHashesSchema({ esquema, hashRegua, hashTreino }, congelamento) {
  if (esquema !== ESQUEMA) throw new Error(`schema em uso é ${esquema}, não ${ESQUEMA}: use o search_path ${ESQUEMA},public`);
  if (hashRegua !== congelamento.hashes.regua) {
    throw new Error(`régua do schema ${ESQUEMA} (${hashRegua}) diferente da congelada: rode npm run carregar-v2 -- --fase v2-final`);
  }
  if (hashTreino !== congelamento.hashes.treino) {
    throw new Error(`treino do schema ${ESQUEMA} (${hashTreino}) diferente do congelado: rode npm run carregar-v2 -- --fase v2-final`);
  }
}

// Os 10 ids de maior score; empates pelo id crescente (mesma regra de top10PorScore da rede).
function top10DosScores(scores, ids, quem) {
  if (!(scores instanceof Map) || scores.size !== ids.length || ids.some((id) => !Number.isFinite(scores.get(id)))) {
    throw new Error(`${quem}: pontuar tem de devolver um Map com um score finito para cada um dos ${ids.length} candidatos`);
  }
  if (scores.size < 10) throw new Error(`${quem}: só ${scores.size} candidatos, mas a avaliação exige 10`);
  return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10).map(([id]) => id);
}

// Vetor de busca p/‖p‖ (mesma conta de gerarCandidatosV2) e vistos ordenados para o excluir.
function vetorDeBusca(perfil) {
  const norma = Math.sqrt(perfil.reduce((s, x) => s + x * x, 0));
  return Array.from(perfil, (x) => x / norma);
}

/**
 * Passo 6 (parte da busca): busca exata no banco e referência em memória dos usuários 1–462 com perfil,
 * conferência busca exata = referência (§5.3; para com erro fora da precisão) e medidas 1 e 2 sobre a
 * parte FC (antes do preenchimento).
 * @returns { referencia: Map<u, ids>, relatorio }
 */
async function fidelidadeDaBusca({ fc, vistosPorU, candidatos, buscar }) {
  const referencia = new Map();
  const listas = { hnsw: new Map(), exata: new Map(), referencia: new Map() };
  const usuariosSemPerfil = [];
  let divergenciasPrecisao = 0;
  let usuariosComDivergencia = 0;
  let empatesExata = 0;
  for (const u of USUARIOS_TESTE2) {
    const entrada = candidatos.get(u);
    const perfil = perfilFC(fc, fc.curtidosPorUsuario.get(u) ?? []);
    if (perfil === null) {
      if (entrada.colab.length > 0) throw new Error(`usuário ${u} sem perfil FC com colab nos candidatos: os candidatos não são desta FC`);
      usuariosSemPerfil.push(u);
      referencia.set(u, []);
      continue;
    }
    const vistos = vistosPorU.get(u) ?? new Set();
    const ref = rankingReferencia(fc, perfil, vistos, M);
    const refIds = ref.map((x) => x.id);
    const excluir = [...vistos].sort((a, b) => a - b);
    const { lista, empateNaoResolvido } = await buscar('exata', vetorDeBusca(perfil), excluir, M);
    if (empateNaoResolvido) empatesExata++;
    const exata = lista.map((x) => x.id);
    const escore64 = new Map(ref.map((x) => [x.id, x.escore64]));
    for (const id of exata) if (!escore64.has(id)) escore64.set(id, escore64De(fc, perfil, id));
    const escoreM = ref.length >= M ? ref[M - 1].escore64 : null; // lista curta: só vale a regra do corte
    const c = conferirPrecisao({ exata, referencia: refIds, escore64, escoreM, tau: TAU });
    if (!c.ok) throw new Error(`busca exata difere da referência no usuário ${u} além da precisão (τ = ${TAU}): ${c.erros.slice(0, 5).join('; ')}`);
    divergenciasPrecisao += c.divergenciasPrecisao;
    if (c.divergenciasPrecisao > 0) usuariosComDivergencia++;
    referencia.set(u, refIds);
    listas.hnsw.set(u, entrada.colab);
    listas.exata.set(u, exata);
    listas.referencia.set(u, refIds);
  }
  return {
    referencia,
    relatorio: {
      nUsuariosComPerfil: listas.hnsw.size,
      usuariosSemPerfil,
      empateNaoResolvido: {
        hnsw: USUARIOS_TESTE2.filter((u) => candidatos.get(u).empateNaoResolvido).length,
        exata: empatesExata,
      },
      precisao: {
        conferencia: 'busca exata = referência: aprovada',
        divergenciasPrecisao,
        usuariosComDivergencia,
        nota: 'busca exata no banco × referência float64; divergências aceitas pelas regras da §5.3 (τ = 1e-5)',
      },
      medidas12: {
        nota: 'parte FC (H_M), antes do preenchimento; usuários 1–462 com perfil; listas idênticas = mesmos ids na mesma ordem',
        hnswXreferencia: medidas12(listas.hnsw, listas.referencia, NS),
        hnswXexata: medidas12(listas.hnsw, listas.exata, NS),
        exataXreferencia: medidas12(listas.exata, listas.referencia, NS),
      },
    },
  };
}

// Conclusão do impacto da aproximação sobre a comparação principal (§5.3).
function impactoDaAproximacao(v2, nDiferentes, nt) {
  if (!v2.usaFC) {
    return {
      conclusao: 'zero por construção',
      motivo: `a v2 (${v2.nome}) não usa a FC (N = 0 ou S0): nem a v2 nem a v1 passam pelo HNSW da FC`,
    };
  }
  if (nDiferentes === 0) {
    return {
      conclusao: 'zero por construção',
      motivo: `top 10 idêntico (HNSW × referência) em 100% dos usuários 1–462 na v2 (${v2.nome}); a v1 não usa a FC`,
    };
  }
  return {
    conclusao: 'teto',
    teto: tetoImpacto(nDiferentes, nt),
    nDiferentes,
    nt,
    nota: 'min(1, nº de usuários 1–462 com top 10 diferente em alguma semente / n_t), contado sobre todos os usuários 1–462',
    frase: FRASE_NAO_MEDIDO,
  };
}

/**
 * Executa a etapa 1 na ordem da §9.2. Antes de qualquer busca ou treino: (1) conferir(); (2) hashes
 * atuais contra o congelamento; (3) hashes do schema v2_final. Depois: candidatos v2-final de todos os
 * usuários do treino (uma busca HNSW por usuário) e a gravação deles; a busca exata e a conferência de
 * precisão; o retreino das redes congeladas (as listas de treino vêm dos candidatos); o top 10 de todos
 * os sistemas, sementes e usuários 1–462, com a FC150 única; fidelidade e déficit; previsões; hashes.
 * @param buscar (modo, vetor, excluir, m) → Promise<{ lista: [{ id, escore }], empateNaoResolvido }>
 * @param treinar (nomeModelo, candidatosPorUsuario, epocasPorSemente) → Promise
 * @param pontuar (nomeModelo, semente, usuario, ids) → Promise<Map<id, score>> | Map<id, score>
 * @param nt nº de usuários avaliáveis do teste-2 (Passo 0); @param sha256Configuracao sha256 dos bytes do congelamento
 * @returns { sha256, sha256Configuracao, sha256FC150 }
 */
export async function executarEtapa1({
  conferir, ctx, congelamento, hashesAtuais, nt, sha256Configuracao, lerHashesSchema,
  buscar, treinar, pontuar, gravarCandidatos, gravarPrevisoes, gravarHashes, gravarRelatorios,
}) {
  // (1) Congelamento.
  await conferir();

  // (2) Hashes atuais × congelados, e a lista de sistemas (falha antes de tocar no banco).
  const fc = conferirHashes({ congelamento, hashesAtuais, ctx });
  if (!Number.isInteger(nt) || nt < 1) throw new Error(`nt inválido (${nt}): use teste2.avaliaveis de resultados/divisoes-v2.json`);
  if (!/^[0-9a-f]{64}$/.test(sha256Configuracao ?? '')) throw new Error(`sha256Configuracao inválido: ${sha256Configuracao}`);
  const sistemas = sistemasAvaliados(congelamento);
  const v2 = sistemas.find((s) => s.nome === congelamento.v2);

  // (3) Schema v2_final.
  conferirHashesSchema(await lerHashesSchema(), congelamento);

  // Usuários: todos os do treino (o treino da rede exige candidatos de todos); 1–462 têm de estar lá.
  const usuarios = [...new Set(ctx.treino.map((a) => a.usuario))].sort((a, b) => a - b);
  const noTreino = new Set(usuarios);
  const noDataset = new Set(ctx.dataset.usuarios.map((x) => x.id));
  for (const u of USUARIOS_TESTE2) {
    if (!noTreino.has(u) || !noDataset.has(u)) throw new Error(`usuário ${u} do teste-2 ausente do treino v2-final ou do dataset: o contexto não é o da fase v2-final`);
  }

  // (5) Candidatos v2-final: uma busca HNSW (M = 300) por usuário do treino; gravados com sha256.
  const porUsuario = await gerarCandidatosV2({
    buscar: (vetor, excluir, m) => buscar('hnsw', vetor, excluir, m),
    fc, treino: ctx.treino, contagens: ctx.regua.contagens, usuarios,
  });
  const arquivoCandidatos = montarArquivoCandidatosV2(FASE, ctx.regua.hash, hashesAtuais.treino, porUsuario);
  await gravarCandidatos(arquivoCandidatos);
  const candidatos = new Map(Object.entries(porUsuario).map(([u, e]) => [Number(u), e]));

  // (6, parte da busca) Busca exata e conferência de precisão antes do treino, que é o passo longo.
  const vistosPorU = vistosPorUsuario(ctx.treino);
  const busca = await fidelidadeDaBusca({ fc, vistosPorU, candidatos, buscar });

  // FC150 única: o mesmo Map alimenta S1, o treino de S3 e a pontuação de S3.
  const fc150 = fc150DeTodos(candidatos);
  const fc150Teste2 = new Map(USUARIOS_TESTE2.map((u) => [u, fc150.get(u)]));
  const listaDe = (k, n) => (k === 0 && n === 150
    ? fc150
    : new Map([...candidatos].map(([u, e]) => [u, listaDaConfiguracao(e, k, n).ids])));
  const fontesDe = (k, n) => new Map(USUARIOS_TESTE2.map((u) => [u, listaDaConfiguracao(candidatos.get(u), k, n).fonte]));

  // Listas da referência (colab trocado), só para o top 10 de fidelidade de S1 e da v2.
  const entradasRef = new Map(USUARIOS_TESTE2.map((u) => [u, entradaReferencia(candidatos.get(u), busca.referencia.get(u))]));
  const listaRef = (u, k, n) => listaDaConfiguracao(entradasRef.get(u), k, n).ids;

  // (4) Retreino das redes congeladas, com as épocas congeladas.
  const comRede = sistemas.filter((s) => s.rede);
  const listas = new Map();
  for (const s of comRede) {
    const lista = listaDe(s.k, s.n);
    listas.set(s.nome, lista);
    await treinar(nomeModelo(s), lista, s.epocasPorSemente);
  }

  // (5) Top 10 de todos os sistemas, sementes e usuários 1–462.
  const top10 = new Map(); // nome → Map<semente, Map<u, ids>>
  const v2Ref = new Map(); // semente → Map<u, ids> (v2 com rede e FC, sobre a lista da referência)
  for (const s of sistemas) {
    if (s.nome === 'S0') top10.set('S0', new Map([[0, new Map(USUARIOS_TESTE2.map((u) => [u, top10S0(candidatos.get(u).populares)]))]]));
    if (s.nome === 'S1') top10.set('S1', new Map([[0, new Map(USUARIOS_TESTE2.map((u) => [u, top10S1(fc150.get(u))]))]]));
    if (!s.rede) continue;
    const porSemente = new Map();
    const lista = listas.get(s.nome);
    const medirRef = s.nome === v2.nome && v2.usaFC;
    for (const semente of SEMENTES) {
      const m = new Map();
      const mRef = new Map();
      for (const u of USUARIOS_TESTE2) {
        const ids = lista.get(u);
        m.set(u, top10DosScores(await pontuar(nomeModelo(s), semente, u, ids), ids, `${s.nome}/semente ${semente}/usuário ${u}`));
        if (medirRef) {
          const idsRef = listaRef(u, s.k, s.n);
          mRef.set(u, top10DosScores(await pontuar(nomeModelo(s), semente, u, idsRef), idsRef, `${s.nome} (referência)/semente ${semente}/usuário ${u}`));
        }
      }
      porSemente.set(semente, m);
      if (medirRef) v2Ref.set(semente, mRef);
    }
    top10.set(s.nome, porSemente);
  }
  for (const [nome, porSemente] of top10) {
    for (const [semente, m] of porSemente) {
      for (const [u, ids] of m) {
        if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error(`top 10 de ${nome}/semente ${semente}/usuário ${u} não tem 10 ids distintos`);
      }
    }
  }
  // Asserções de contenção da FC150 única (Task 11).
  const s1 = top10.get('S1')?.get(0) ?? new Map(USUARIOS_TESTE2.map((u) => [u, top10S1(fc150.get(u))]));
  conferirFC150(fc150, USUARIOS_TESTE2, s1, top10.has('S3') ? [...top10.get('S3').values()] : []);

  // (6) Fidelidade no teste-2 sem gabarito.
  const fc150Ref = new Map(USUARIOS_TESTE2.map((u) => [u, listaRef(u, 0, 150)]));
  const s1Hnsw = new Map(USUARIOS_TESTE2.map((u) => [u, top10S1(fc150.get(u))]));
  const s1Ref = new Map(USUARIOS_TESTE2.map((u) => [u, top10S1(fc150Ref.get(u))]));
  const idS1 = top10Identicos(s1Hnsw, s1Ref);
  const fracao = (x) => ({ ...x, fracao: x.iguais / USUARIOS_TESTE2.length });
  let idV2;
  let nDiferentesV2 = 0;
  if (!v2.usaFC) {
    idV2 = { sistema: v2.nome, usaFC: false, nota: 'a v2 não usa a FC: o top 10 não passa pelo HNSW' };
  } else if (!v2.rede) {
    idV2 = { sistema: v2.nome, usaFC: true, ...fracao(idS1) };
    nDiferentesV2 = idS1.diferentes;
  } else {
    const porSemente = {};
    const diferentes = new Set();
    for (const semente of SEMENTES) {
      const h = top10.get(v2.nome).get(semente);
      const r = v2Ref.get(semente);
      porSemente[String(semente)] = fracao(top10Identicos(h, r));
      for (const u of USUARIOS_TESTE2) if (h.get(u).some((id, i) => id !== r.get(u)[i])) diferentes.add(u);
    }
    nDiferentesV2 = diferentes.size;
    idV2 = {
      sistema: v2.nome, usaFC: true, porSemente,
      nota: 'mesmas redes, sem retreino, sobre a lista final da referência; diferente = top 10 diferente em alguma semente',
      ...fracao({ iguais: USUARIOS_TESTE2.length - nDiferentesV2, diferentes: nDiferentesV2 }),
    };
  }
  const sha256Candidatos = arquivoCandidatos.sha256;
  const shaFC150 = sha256FC150(fc150Teste2);
  const fidelidade = {
    fase: FASE,
    M,
    tau: TAU,
    Ns: NS,
    nt,
    usuarios: USUARIOS_TESTE2.length,
    hashRegua: ctx.regua.hash,
    hashTreino: hashesAtuais.treino,
    sha256Candidatos,
    sha256FC150: shaFC150,
    ...busca.relatorio,
    top10Identicos: {
      nota: 'lista final com preenchimento, HNSW × referência, usuários 1–462',
      S1: fracao(idS1),
      v2: idV2,
    },
    impacto: impactoDaAproximacao(v2, nDiferentesV2, nt),
    naoCalculados: 'recall e NDCG de fidelidade não são calculados no teste-2 (§5.3)',
  };

  // Déficit (§6) nos usuários 1–462, para cada lista composta congelada, e posições do preenchimento.
  const configuracoes = [...new Map(sistemas.filter((s) => s.nome !== 'S0').map((s) => [`${s.k}-${s.n}`, [s.k, s.n]])).values()];
  const porUsuarioTeste2 = Object.fromEntries(USUARIOS_TESTE2.map((u) => [String(u), porUsuario[String(u)]]));
  const preenchimento = (nome) => {
    const s = sistemas.find((x) => x.nome === nome);
    if (!s) return 'não congelado';
    if (s.nome === 'S0') return 'não se aplica: S0 é o top 10 dos populares, sem lista composta';
    const fontes = fontesDe(s.k, s.n);
    return Object.fromEntries([...top10.get(nome)].map(([semente, m]) => [String(semente), posicoesDoPreenchimento(m, fontes)]));
  };
  const deficit = {
    fase: FASE,
    M,
    usuarios: USUARIOS_TESTE2.length,
    nota: 'usuários 1–462 (teste-2), sem gabarito; usuariosSemCurtidas conta nElegiveis = 0',
    usuariosSemPerfil: busca.relatorio.usuariosSemPerfil.length,
    configuracoes: relatorioDeficit(porUsuarioTeste2, configuracoes),
    posicoesPreenchimento: { S1: preenchimento('S1'), S3: preenchimento('S3'), v2: { sistema: v2.nome, porSemente: preenchimento(v2.nome) } },
  };
  await gravarRelatorios({ fidelidade, deficit });

  // (7) Previsões em JSON estável.
  const previsoes = { sistemas: {} };
  for (const [nome, porSemente] of top10) {
    const obj = {};
    for (const [semente, m] of porSemente) obj[String(semente)] = Object.fromEntries([...m].map(([u, ids]) => [String(u), ids]));
    previsoes.sistemas[nome] = { porSemente: obj };
  }
  const texto = jsonEstavel(previsoes);
  await gravarPrevisoes(texto);

  // (8) Hashes: previsões, congelamento e FC150 dos usuários 1–462.
  const hashes = { sha256: sha256(texto), sha256Configuracao, sha256FC150: shaFC150 };
  await gravarHashes(hashes);
  return hashes;
}
