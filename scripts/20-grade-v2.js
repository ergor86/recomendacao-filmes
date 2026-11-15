// Script 20 (npm run grade-v2): grade e escolha da v2 na validação (fase v2-exp, spec §8.2–§8.5).
// Lê o cenário do portão, treina a rede de cada configuração (K, N) da grade (3 sementes), avalia S0,
// S1 e as configurações nos usuários da validação com ≥ 1 relevante, escolhe a v2 pela regra de 1 EP
// com a ordem de simplicidade fixa e grava resultados/grade-v2-exp.json (jsonEstavel), com as
// contribuições descritivas, as posições vindas do preenchimento e o MDE descritivo de v2 × v1.
// A FC150 é construída uma única vez e o mesmo Map alimenta S1, o treino de S3 e a pontuação de S3.
// Não lê teste-2 nem u1.test; o gabarito é a validação.
//
// Opções de verificação (não gravam a grade oficial): --somente k-n,..., --max-epocas n,
// --saida <arquivo>, --dir-modelos <pasta>. Oficial: sem opções, ou com --cortar-orcamento-variavel.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { lerCandidatosV2, listaDaConfiguracao, fc150DeTodos, sha256FC150 } from '../src/candidatos/v2.js';
import { relevantesPorUsuario, avaliarSistema } from '../src/avaliacao/metricas.js';
import { escolherConfiguracao, projetar, mediaEntreSementes } from '../src/avaliacao/escolha.js';
import { bootstrapPareado } from '../src/avaliacao/estatistica.js';
import { treinarConfiguracao } from '../src/treino/configuracao.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { pontuarCandidatos, top10PorScore } from '../src/modelo/ranqueador.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import {
  configuracoesDaGrade, nomeSistema, grupoOrcamento, simplicidadeV2, top10S1, top10S0, lerArgumentosGrade,
  conferirFC150, posicoesDoPreenchimento, contribuicoesV2, mdeDescritivoV2, pedidosMedida4,
  AVISO_VERIFICACAO, FRASE_OTIMISTA,
} from '../src/avaliacao/sistemas-v2.js';

const FASE = 'v2-exp';
const SEMENTES = [1, 2, 3];
const ARQ_CANDIDATOS = `artefatos/candidatos-v2-${FASE}.json`;
const ARQ_PORTAO = 'resultados/portao-fc-v2-exp.json';
const ARQ_MDE = 'resultados/mde-v2.json';
const ARQ_DIVISOES = 'resultados/divisoes-v2.json';

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const ids10 = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Diz se o arquivo está versionado no git e sem alterações em relação ao HEAD.
function estaCommitado(arq) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', arq], { stdio: 'ignore' });
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', arq], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Avalia um sistema em cada semente (S0/S1: uma só, a semente 0) e monta o resumo do JSON.
function resumirSistema(top10PorSemente, sementes, relevantes, contagens, extra) {
  const avals = top10PorSemente.map((m) => avaliarSistema(m, relevantes, contagens));
  const porUsuario = mediaEntreSementes(avals.map((a) => projetar(a.porUsuario, 'ndcg')));
  const ndcgs = avals.map((a) => a.ndcg);
  const porSemente = {};
  avals.forEach((a, i) => {
    porSemente[String(sementes[i])] = {
      ndcg: a.ndcg, precisao: a.precisao, recall: a.recall, cobertura: a.cobertura,
      popularidadeMediaContagem: a.popularidadeMediaContagem,
    };
  });
  return {
    porUsuario,
    porSementeMedias: ndcgs,
    resumo: {
      ...extra,
      ndcg: media([...porUsuario.values()]),
      precisao: media(avals.map((a) => a.precisao)),
      recall: media(avals.map((a) => a.recall)),
      ndcgMin: Math.min(...ndcgs),
      ndcgMax: Math.max(...ndcgs),
      nUsuarios: avals[0].nUsuarios,
      porSemente,
    },
  };
}

async function principal() {
  const args = lerArgumentosGrade(process.argv.slice(2));
  if (args.verificacao) console.log(`== ${AVISO_VERIFICACAO} ==`);

  for (const arq of [ARQ_MDE, ARQ_DIVISOES]) {
    if (!estaCommitado(arq)) throw new Error(`${arq} não está commitado ou foi alterado depois do commit: o MDE e o Passo 0 têm de ser commitados antes da grade (rode npm run divisoes-v2 / mde-v2 e commite)`);
  }
  if (!fs.existsSync(ARQ_PORTAO)) throw new Error(`${ARQ_PORTAO} ausente: rode npm run portao-v2 antes da grade`);
  const { cenario } = JSON.parse(fs.readFileSync(ARQ_PORTAO, 'utf8'));
  const { nt, q } = JSON.parse(fs.readFileSync(ARQ_MDE, 'utf8'));
  let configuracoes = configuracoesDaGrade(cenario, { cortarOrcamentoVariavel: args.cortarOrcamentoVariavel });
  if (args.somente) {
    const permitidas = new Set(configuracoes.map(({ k, n }) => `${k}-${n}`));
    for (const { k, n } of args.somente) {
      if (!permitidas.has(`${k}-${n}`)) throw new Error(`--somente ${k}-${n}: fora da grade do cenário "${cenario}"`);
    }
    const pedidas = new Set(args.somente.map(({ k, n }) => `${k}-${n}`));
    configuracoes = configuracoes.filter(({ k, n }) => pedidas.has(`${k}-${n}`));
  }
  console.log(`cenário do portão: ${cenario}; configurações com rede: ${configuracoes.map(({ k, n }) => `(${k}, ${n})`).join(' ')}`);

  const { dirDados } = carregarConfig();
  const ctx = criarContexto({ fase: FASE, dirDados });
  const hashes = { regua: ctx.regua.hash, treino: hashAvaliacoes(ctx.treino) };
  const candidatos = lerCandidatosV2(ARQ_CANDIDATOS, { hashRegua: hashes.regua, hashTreino: hashes.treino });
  const sha256Candidatos = JSON.parse(fs.readFileSync(ARQ_CANDIDATOS, 'utf8')).sha256;
  const relevantes = relevantesPorUsuario(ctx.alvos);
  const contagens = ctx.regua.contagens;
  const filmesPorId = new Map(ctx.dataset.filmes.map((x) => [x.id, x]));
  const usuariosPorId = new Map(ctx.dataset.usuarios.map((x) => [x.id, x]));
  const historico = historicoDoTreino(ctx.treino, filmesPorId);
  const avaliados = [...relevantes.keys()].sort((a, b) => a - b);
  for (const u of avaliados) {
    if (!candidatos.has(u)) throw new Error(`usuário ${u} da validação sem candidatos v2: rode npm run candidatos-v2 -- --fase ${FASE}`);
    if (!usuariosPorId.has(u)) throw new Error(`usuário ${u} da validação não existe no dataset`);
  }

  // FC150 única: construída uma vez; o mesmo Map vai para S1, o treino de S3 e a pontuação de S3.
  const fc150 = fc150DeTodos(candidatos);
  const shaFC150 = sha256FC150(fc150);
  const fontesFC150 = new Map();
  for (const u of avaliados) {
    const l = listaDaConfiguracao(candidatos.get(u), 0, 150);
    if (!ids10(l.ids, fc150.get(u))) throw new Error(`FC150 do usuário ${u} difere da lista (0, 150): a FC150 não é única`);
    fontesFC150.set(u, l.fonte);
  }

  const top10 = new Map(); // nome → Map<u, ids>[] (uma por semente)
  const fontes = new Map(); // nome → Map<u, Map<id, fonte>>
  const resultadosTreino = new Map(); // nome → { k, n, sementes }
  top10.set('S0', [new Map(avaliados.map((u) => [u, top10S0(candidatos.get(u).populares)]))]);
  top10.set('S1', [new Map(avaliados.map((u) => [u, top10S1(fc150.get(u))]))]);
  fontes.set('S1', fontesFC150);

  const inicio = Date.now();
  for (const { k, n } of configuracoes) {
    const nome = nomeSistema({ k, n });
    const ehS3 = k === 0 && n === 150;
    const candidatosPorUsuario = ehS3
      ? fc150
      : new Map([...candidatos].map(([u, e]) => [u, listaDaConfiguracao(e, k, n).ids]));
    fontes.set(nome, ehS3 ? fontesFC150 : new Map(avaliados.map((u) => [u, listaDaConfiguracao(candidatos.get(u), k, n).fonte])));
    const t0 = Date.now();
    const treino = await treinarConfiguracao({
      ctx, candidatosPorUsuario, nome: `v2-${k}-${n}`, fase: FASE, dirModelos: args.dirModelos, maxEpocas: args.maxEpocas,
    });
    resultadosTreino.set(nome, { k, n, sementes: treino.sementes });
    const porSemente = [];
    for (const [i, semente] of SEMENTES.entries()) {
      const dir = path.join(args.dirModelos, `v2-${k}-${n}-${FASE}-s${semente}`);
      const { modelo, metadados } = await carregarModelo(dir, ctx.regua);
      try {
        if (metadados.semPop) throw new Error(`modelo ${dir} treinado sem popularidade; a v2 usa semPop: false`);
        const treinoSemente = treino.sementes[i];
        if (metadados.nome !== `v2-${k}-${n}` || metadados.fase !== FASE || metadados.semente !== semente
          || treinoSemente?.semente !== semente || metadados.sha256Pares !== treinoSemente.sha256Pares) {
          throw new Error(`modelo ${dir} não corresponde ao treino que acabou de rodar (nome ${metadados.nome}, fase ${metadados.fase}, semente ${metadados.semente}, sha256Pares ${metadados.sha256Pares}): apague a pasta e rode a grade de novo`);
        }
        const m = new Map();
        for (const u of avaliados) {
          const scores = pontuarCandidatos({
            modelo, regua: ctx.regua, semPop: false, usuario: usuariosPorId.get(u),
            curtidos: historico.get(u)?.curtidos ?? [], candidatos: candidatosPorUsuario.get(u), filmesPorId,
          });
          m.set(u, top10PorScore(scores));
        }
        porSemente.push(m);
      } finally {
        modelo.dispose();
      }
    }
    top10.set(nome, porSemente);
    const epocas = treino.sementes.map((s) => s.melhorEpoca).join('/');
    console.log(`  ${nome} (${k}, ${n}) treinada e pontuada em ${((Date.now() - t0) / 1000).toFixed(0)} s; melhores épocas ${epocas}`);
  }
  console.log(`treino + pontuação: ${((Date.now() - inicio) / 60000).toFixed(1)} min`);

  conferirFC150(fc150, avaliados, top10.get('S1')[0], top10.get('S3') ?? []);

  // Avaliação de cada sistema, nos mesmos usuários.
  const sistemas = {};
  const configsEscolha = [];
  const porUsuarioNdcg = new Map();
  for (const nome of top10.keys()) {
    const comRede = resultadosTreino.has(nome);
    const t = resultadosTreino.get(nome);
    const extra = comRede
      ? { rede: true, k: t.k, n: t.n, totalCandidatos: t.k + t.n, grupo: grupoOrcamento(t) }
      : { rede: false, ...(nome === 'S1' ? { k: 0, n: 150, totalCandidatos: 150 } : { k: 10, n: 0, totalCandidatos: 10 }) };
    const r = resumirSistema(top10.get(nome), comRede ? SEMENTES : [0], relevantes, contagens, extra);
    sistemas[nome] = r.resumo;
    porUsuarioNdcg.set(nome, r.porUsuario);
    configsEscolha.push({ nome, porUsuario: r.porUsuario, porSemente: r.porSementeMedias, simplicidade: simplicidadeV2(nome) });
  }

  // Escolha (§8.4), com o IC por bootstrap de NDCG(melhor) − NDCG(c) em cada linha.
  const escolhaBruta = escolherConfiguracao(configsEscolha);
  const melhorPU = porUsuarioNdcg.get(escolhaBruta.melhor);
  const tabela = escolhaBruta.tabela.map((linha) => {
    const c = porUsuarioNdcg.get(linha.nome);
    const difs = [...melhorPU].map(([u, v]) => v - c.get(u));
    return { ...linha, ic95: bootstrapPareado(difs, { reamostragens: 5000, semente: 2026 }).ic95, simplicidade: simplicidadeV2(linha.nome) };
  });
  const escolhida = escolhaBruta.escolhida;
  const v2IgualV1 = escolhida === 'S2';
  const escolha = {
    escolhida, melhor: escolhaBruta.melhor, fragil: escolhaBruta.fragil, tabela,
    v2IgualV1,
    resultado: v2IgualV1
      ? 'v2 = v1: a configuração escolhida é (150, 0) com a mesma rede; o Plano 3 não introduziu nova versão e não há comparação confirmatória'
      : `v2 = ${escolhida}; segue para a comparação v2 − v1 no teste-2`,
    nSistemas: configsEscolha.length,
    otimista: true,
    nota: FRASE_OTIMISTA,
  };

  const motivoAusente = args.verificacao ? 'não rodada: fora de --somente (execução de verificação)' : 'não rodada: portão reprovado';
  const contribuicoes = contribuicoesV2(porUsuarioNdcg, { motivoAusente });

  // Posições do top 10 vindas do preenchimento: S1, S3 e a v2 (por semente nos sistemas com rede).
  const preenchimentoDe = (nome) => {
    if (nome === 'S0') return 'não se aplica: S0 é o top 10 dos populares, sem lista composta';
    if (!top10.has(nome)) return motivoAusente;
    const sementes = resultadosTreino.has(nome) ? SEMENTES : [0];
    return Object.fromEntries(top10.get(nome).map((m, i) => [String(sementes[i]), posicoesDoPreenchimento(m, fontes.get(nome))]));
  };
  const posicoesPreenchimento = { S1: preenchimentoDe('S1'), S3: preenchimentoDe('S3'), v2: { sistema: escolhida, porSemente: preenchimentoDe(escolhida) } };

  // MDE descritivo de v2 × v1 e ganho sob a mesma subamostragem.
  let mdeDetalhe;
  if (v2IgualV1) mdeDetalhe = { mde: null, ganhoSobSubamostragem: null, motivo: 'v2 = v1 (S2): sem par v2 × v1' };
  else if (!top10.has('S2')) mdeDetalhe = { mde: null, ganhoSobSubamostragem: null, motivo: `${motivoAusente} (S2)` };
  else {
    mdeDetalhe = {
      par: `${escolhida} x S2`,
      descritivo: 'só descritivo, nunca justificativa do resultado (§8.3)',
      ...mdeDescritivoV2({ top10V2: top10.get(escolhida), top10V1: top10.get('S2'), relevantes, q, nt }),
    };
  }

  const epocasPorSistema = {};
  for (const [nome, t] of resultadosTreino) {
    epocasPorSistema[nome] = Object.fromEntries(t.sementes.map((s) => [String(s.semente), s.melhorEpoca]));
    sistemas[nome].treino = t.sementes;
  }

  const saida = {
    ...(args.verificacao ? { execucao: AVISO_VERIFICACAO, maxEpocas: args.maxEpocas } : {}),
    fase: FASE,
    cenario,
    cortarOrcamentoVariavel: args.cortarOrcamentoVariavel,
    configuracoes: configuracoes.map(({ k, n }) => ({ k, n, nome: nomeSistema({ k, n }), totalCandidatos: k + n, grupo: grupoOrcamento({ k, n }) })),
    hashRegua: hashes.regua,
    hashTreino: hashes.treino,
    sha256Candidatos,
    sha256FC150: shaFC150,
    nUsuariosAvaliados: avaliados.length,
    sistemas,
    escolha,
    epocasPorSistema,
    contribuicoes,
    contribuicoesNota: 'todas descritivas (comparações múltiplas); v2 − v1 mede o sistema completo, só S3 − S1 isola o ordenador (§8.5)',
    posicoesPreenchimento,
    mdeDescritivo: mdeDetalhe.mde,
    ganhoSobSubamostragem: mdeDetalhe.ganhoSobSubamostragem,
    mdeDescritivoDetalhe: mdeDetalhe,
    otimista: true,
    notaOtimista: FRASE_OTIMISTA,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.saida)), { recursive: true });
  fs.writeFileSync(args.saida, jsonEstavel(saida) + '\n');

  // Resumo.
  console.log(`\n== Grade v2 (${FASE}), cenário ${cenario}; ${avaliados.length} usuários avaliados ==`);
  console.log('sistema       K+N  NDCG@10  P@10    R@10    [mín, máx] por semente   Δ melhor   EP       empata');
  for (const linha of tabela) {
    const s = sistemas[linha.nome];
    console.log(`${linha.nome.padEnd(12)} ${String(s.totalCandidatos).padStart(4)}  ${s.ndcg.toFixed(4)}   ${s.precisao.toFixed(4)}  ${s.recall.toFixed(4)}  [${s.ndcgMin.toFixed(4)}, ${s.ndcgMax.toFixed(4)}]         ${linha.diferenca.toFixed(4)}    ${linha.erroPadrao.toFixed(4)}   ${linha.empata ? 'sim' : 'não'}`);
  }
  console.log(`melhor: ${escolha.melhor}; escolhida (v2): ${escolhida}; frágil: ${escolha.fragil}${v2IgualV1 ? ' — v2 = v1' : ''}`);
  for (const [conta, c] of Object.entries(contribuicoes)) {
    console.log(typeof c === 'string'
      ? `  ${conta}: ${c}`
      : `  ${conta}${c.melhor ? ` [${c.melhor}]` : ''}: ${c.media.toFixed(4)} EP ${c.erroPadrao.toFixed(4)} IC [${c.ic95.map((x) => x.toFixed(4)).join(', ')}] (descritiva)`);
  }
  console.log(`MDE descritivo v2 × v1: ${mdeDetalhe.mde === null ? mdeDetalhe.motivo : `${mdeDetalhe.mde.toFixed(4)} (σ ${mdeDetalhe.sigmaD.toFixed(4)}); ganho sob subamostragem ${mdeDetalhe.ganhoSobSubamostragem.toFixed(4)}`} (${FRASE_OTIMISTA})`);
  console.log(`épocas: ${Object.entries(epocasPorSistema).map(([n, e]) => `${n} ${Object.values(e).join('/')}`).join('; ')}`);
  console.log(`gravado em ${args.saida}`);
  if (args.verificacao) {
    console.log(`== ${AVISO_VERIFICACAO} ==`);
  } else {
    const pedidos = pedidosMedida4(cenario, escolhida);
    console.log(pedidos.length
      ? `próximo passo (medida 4 de fidelidade): npm run fidelidade-v2 -- --fase ${FASE} --medida4 ${pedidos.join(',')}`
      : 'medida 4 de fidelidade: nada a acrescentar (a v2 é S0 ou S1)');
  }
}

try {
  await principal();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
