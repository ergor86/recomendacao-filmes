// Script 19 (npm run fidelidade-v2 -- --fase v2-exp): fidelidade da FC na validação (spec §5.3).
// Compara três versões da busca FC de cada usuário do treino: HNSW (oficial, do arquivo de candidatos
// v2), busca exata no banco (controle) e referência em memória (float64). Calcula as medidas 1–2
// (antes do preenchimento) e 3 para N ∈ {50, 100, 150}, a conferência busca exata = referência
// (para com erro em divergência que não seja de precisão), os planos EXPLAIN, os empates não
// resolvidos e a medida 4 de S1 (top 10 da lista final (0, 150), com preenchimento). Grava
// resultados/fidelidade-fc-v2-exp.json.
//
// Com --medida4 S3,v2 (depois da grade, Task 11): sem banco, acrescenta ao arquivo a medida 4 dos
// sistemas com rede, com as 3 redes já treinadas (sem retreino). Não lê teste-2 nem u1.test.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { construirFC, perfilFC, rankingReferencia, escore64De } from '../src/fc/referencia.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { buscarColaborativos, planoDaBuscaFC } from '../src/banco/busca-fc.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { lerCandidatosV2, listaDaConfiguracao, fc150DeTodos, sha256FC150 } from '../src/candidatos/v2.js';
import { vistosPorUsuario } from '../src/candidatos/populares.js';
import { relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { carregarModelo } from '../src/modelo/rede.js';
import { pontuarCandidatos, top10PorScore } from '../src/modelo/ranqueador.js';
import {
  TAU, conferirPrecisao, medidas12, medida3, resumoMedida4, entradaReferencia,
  lerArgumentosFidelidade, resolverSistemasMedida4, mesclarMedida4,
} from '../src/avaliacao/fidelidade.js';

const M = 300;
const NS = [50, 100, 150];
const SEMENTES = [1, 2, 3];
const ARQ_SAIDA = 'resultados/fidelidade-fc-v2-exp.json';
const ARQ_GRADE = 'resultados/grade-v2-exp.json';

const { fase, medida4: pedidosMedida4 } = lerArgumentosFidelidade(process.argv.slice(2));
const esquema = fase.replace('-', '_');
const arqCandidatos = `artefatos/candidatos-v2-${fase}.json`;

const { pg: configPg, dirDados } = carregarConfig();
const ctx = criarContexto({ fase, dirDados });
const fc = construirFC(ctx.treino, ctx.dataset.usuarios.length);
const hashes = { regua: ctx.regua.hash, treino: hashAvaliacoes(ctx.treino) };
const candidatos = lerCandidatosV2(arqCandidatos, { hashRegua: hashes.regua, hashTreino: hashes.treino });
const sha256Candidatos = JSON.parse(fs.readFileSync(arqCandidatos, 'utf8')).sha256;
const relevantes = relevantesPorUsuario(ctx.alvos);
const vistosPorU = vistosPorUsuario(ctx.treino);
const usuarios = [...new Set(ctx.treino.map((a) => a.usuario))].sort((a, b) => a - b);
for (const u of usuarios) {
  if (!candidatos.has(u)) throw new Error(`usuário ${u} do treino sem candidatos v2: rode npm run candidatos-v2 -- --fase ${fase}`);
}
for (const u of relevantes.keys()) {
  if (!candidatos.has(u)) throw new Error(`usuário ${u} da validação sem candidatos v2: rode npm run candidatos-v2 -- --fase ${fase}`);
}

// Perfil e lista de referência (M = 300) de cada usuário; usuários sem perfil ficam com lista vazia.
const perfis = new Map();
const referencia = new Map(); // u → [{ id, escore, escore64 }]
const semPerfil = [];
for (const u of usuarios) {
  const perfil = perfilFC(fc, fc.curtidosPorUsuario.get(u) ?? []);
  if (perfil === null) {
    semPerfil.push(u);
    if (candidatos.get(u).colab.length > 0) throw new Error(`usuário ${u} sem perfil FC tem colab no arquivo de candidatos: rode npm run candidatos-v2 -- --fase ${fase}`);
    continue;
  }
  perfis.set(u, perfil);
  referencia.set(u, rankingReferencia(fc, perfil, vistosPorU.get(u) ?? new Set(), M));
}

// Entradas da referência (colab trocado) e FC150 das duas versões, construídas uma única vez.
const entradasRef = new Map([...candidatos].map(([u, e]) => [u, entradaReferencia(e, (referencia.get(u) ?? []).map((x) => x.id))]));
const fc150Hnsw = fc150DeTodos(candidatos);
const fc150Ref = fc150DeTodos(entradasRef);

// Lista final (k, n) da versão 'hnsw' ou 'referencia'; (0, 150) vem sempre da FC150 já construída.
function listaFinal(versao, u, k, n) {
  if (k === 0 && n === 150) return (versao === 'hnsw' ? fc150Hnsw : fc150Ref).get(u);
  return listaDaConfiguracao((versao === 'hnsw' ? candidatos : entradasRef).get(u), k, n).ids;
}

// Medida 4 de S1: o ordenador é o próprio escore FC, então o top 10 é o início da FC150.
function medida4S1() {
  const top10 = (fc150) => new Map([...relevantes.keys()].map((u) => [u, fc150.get(u).slice(0, 10)]));
  return { ordenador: 'escore FC', k: 0, n: 150, ...resumoMedida4({ relevantes, porSemente: [{ hnsw: top10(fc150Hnsw), referencia: top10(fc150Ref) }] }) };
}

// Medida 4 de um sistema com rede: as 3 redes da grade pontuam as duas listas finais.
async function medida4ComRede({ nome, k, n }) {
  const dirs = SEMENTES.map((s) => path.join('modelos', `v2-${k}-${n}-${fase}-s${s}`));
  const faltando = dirs.filter((d) => !fs.existsSync(d));
  if (faltando.length > 0) throw new Error(`modelos de ${nome} ausentes (${faltando.join(', ')}): rode npm run grade-v2 antes de --medida4`);
  const filmesPorId = new Map(ctx.dataset.filmes.map((x) => [x.id, x]));
  const usuariosPorId = new Map(ctx.dataset.usuarios.map((x) => [x.id, x]));
  const historico = historicoDoTreino(ctx.treino, filmesPorId);
  const porSemente = [];
  for (const dir of dirs) {
    const { modelo, metadados } = await carregarModelo(dir, ctx.regua);
    if (metadados.semPop) throw new Error(`modelo ${dir} treinado sem popularidade; a v2 usa semPop: false: rode npm run grade-v2`);
    const s = { hnsw: new Map(), referencia: new Map() };
    for (const u of relevantes.keys()) {
      const usuario = usuariosPorId.get(u);
      if (!usuario) throw new Error(`usuário ${u} da validação não existe no dataset`);
      const curtidos = historico.get(u)?.curtidos ?? [];
      for (const versao of ['hnsw', 'referencia']) {
        const ids = listaFinal(versao, u, k, n);
        const scores = pontuarCandidatos({ modelo, regua: ctx.regua, semPop: false, usuario, curtidos, candidatos: ids, filmesPorId });
        s[versao].set(u, top10PorScore(scores));
      }
    }
    modelo.dispose();
    porSemente.push(s);
  }
  return { ordenador: 'rede (3 sementes, sem retreino)', k, n, sementes: SEMENTES, ...resumoMedida4({ relevantes, porSemente }) };
}

// Modo --medida4: acrescenta os sistemas com rede ao arquivo já gravado.
async function rodarMedida4() {
  if (!fs.existsSync(ARQ_SAIDA)) throw new Error(`${ARQ_SAIDA} ausente: rode npm run fidelidade-v2 -- --fase ${fase} antes de --medida4`);
  if (!fs.existsSync(ARQ_GRADE)) throw new Error(`${ARQ_GRADE} ausente: rode npm run grade-v2 antes de --medida4`);
  const existente = JSON.parse(fs.readFileSync(ARQ_SAIDA, 'utf8'));
  const grade = JSON.parse(fs.readFileSync(ARQ_GRADE, 'utf8'));
  if (grade.sha256FC150 !== undefined && grade.sha256FC150 !== sha256FC150(fc150Hnsw)) {
    throw new Error('FC150 da grade difere da dos candidatos atuais: rode npm run grade-v2 de novo');
  }
  const sistemas = resolverSistemasMedida4(pedidosMedida4, grade);
  const novos = {};
  const pulados = {};
  for (const s of sistemas) {
    if (s.pulado) { pulados[s.nome] = s.pulado; console.log(`${s.nome}: pulado (${s.pulado})`); continue; }
    novos[s.nome] = await medida4ComRede(s);
    const d = novos[s.nome].diferenca;
    console.log(`${s.nome} (${s.k}, ${s.n}): dif NDCG ${d.media.toFixed(5)} IC [${d.ic95[0].toFixed(5)}, ${d.ic95[1].toFixed(5)}]`);
  }
  const saida = mesclarMedida4(existente, novos, { sha256Candidatos, v2Escolhida: grade.escolha.escolhida, pulados });
  fs.writeFileSync(ARQ_SAIDA, jsonEstavel(saida) + '\n');
}

// Modo completo: medidas 1–3, conferência de precisão, planos e medida 4 de S1.
async function rodarCompleto() {
  const pool = criarPool(configPg, { searchPath: `${esquema},public` });
  try {
    await verificarConexao(pool);
    const planos = { hnsw: await planoDaBuscaFC(pool, 'hnsw'), exata: await planoDaBuscaFC(pool, 'exata') };

    const listasHnsw = new Map();
    const listasExata = new Map();
    const listasRef = new Map();
    let divergenciasPrecisao = 0;
    let usuariosComDivergencia = 0;
    let empatesExata = 0;
    let feitos = 0;
    for (const [u, perfil] of perfis) {
      const vistos = vistosPorU.get(u) ?? new Set();
      const norma = Math.sqrt(perfil.reduce((s, x) => s + x * x, 0));
      const vetor = Array.from(perfil, (x) => x / norma);
      const excluir = [...vistos].sort((a, b) => a - b);
      const { lista, empateNaoResolvido } = await buscarColaborativos(pool, { vetor, excluir, m: M, hashes, modo: 'exata' });
      if (empateNaoResolvido) empatesExata++;
      const exata = lista.map((x) => x.id);
      const ref = referencia.get(u);
      const refIds = ref.map((x) => x.id);
      const escore64 = new Map(ref.map((x) => [x.id, x.escore64]));
      for (const id of exata) if (!escore64.has(id)) escore64.set(id, escore64De(fc, perfil, id));
      const escoreM = ref.length >= M ? ref[M - 1].escore64 : null; // lista curta: só vale a regra do corte
      const c = conferirPrecisao({ exata, referencia: refIds, escore64, escoreM, tau: TAU });
      if (!c.ok) throw new Error(`busca exata difere da referência no usuário ${u} além da precisão (τ = ${TAU}): ${c.erros.slice(0, 5).join('; ')}`);
      divergenciasPrecisao += c.divergenciasPrecisao;
      if (c.divergenciasPrecisao > 0) usuariosComDivergencia++;
      listasHnsw.set(u, candidatos.get(u).colab);
      listasExata.set(u, exata);
      listasRef.set(u, refIds);
      if (++feitos % 200 === 0) console.log(`  ${feitos}/${perfis.size} usuários conferidos`);
    }

    const saida = {
      fase,
      M,
      tau: TAU,
      Ns: NS,
      hashRegua: hashes.regua,
      hashTreino: hashes.treino,
      sha256Candidatos,
      sha256FC150: sha256FC150(fc150Hnsw),
      nUsuarios: usuarios.length,
      nUsuariosComPerfil: perfis.size,
      usuariosSemPerfil: semPerfil,
      planos,
      empateNaoResolvido: {
        hnsw: [...candidatos.values()].filter((e) => e.empateNaoResolvido).length,
        exata: empatesExata,
      },
      precisao: {
        divergenciasPrecisao,
        usuariosComDivergencia,
        nota: 'busca exata no banco × referência float64; divergências aceitas pelas regras da §5.3 (τ = 1e-5)',
      },
      medidas12: {
        nota: 'parte FC (H_M), antes do preenchimento; listas idênticas = mesmos ids na mesma ordem',
        hnswXreferencia: medidas12(listasHnsw, listasRef, NS),
        hnswXexata: medidas12(listasHnsw, listasExata, NS),
        exataXreferencia: medidas12(listasExata, listasRef, NS),
      },
      medida3: { nota: 'diferença = HNSW − referência', ...medida3(listasHnsw, listasRef, relevantes, NS) },
      medida4: { S1: medida4S1() },
      medida4Nota: 'lista final com preenchimento; diferença = HNSW − referência; S3 e v2 entram com --medida4 depois da grade',
    };
    fs.mkdirSync('resultados', { recursive: true });
    fs.writeFileSync(ARQ_SAIDA, jsonEstavel(saida) + '\n');

    console.log(`== Fidelidade da FC (${fase}); usuários com perfil: ${perfis.size}; sem perfil: ${semPerfil.join(', ') || 'nenhum'} ==`);
    for (const n of NS) {
      const r = saida.medidas12.hnswXreferencia[n];
      const e = saida.medidas12.hnswXexata[n];
      const m3 = saida.medida3.porN[n];
      console.log(`N=${n}: HNSW×ref sobrep ${r.sobreposicaoMedia.toFixed(5)} idênt ${r.fracaoIdenticas.toFixed(4)} | HNSW×exata sobrep ${e.sobreposicaoMedia.toFixed(5)} idênt ${e.fracaoIdenticas.toFixed(4)} | dif recall ${m3.diferenca.media.toExponential(3)}`);
    }
    console.log(`divergências de precisão: ${divergenciasPrecisao} (${usuariosComDivergencia} usuários); empates não resolvidos: HNSW ${saida.empateNaoResolvido.hnsw}, exata ${empatesExata}`);
    const s1 = saida.medida4.S1;
    console.log(`medida 4 S1: NDCG HNSW ${s1.ndcgHnsw.toFixed(5)} ref ${s1.ndcgReferencia.toFixed(5)} dif ${s1.diferenca.media.toExponential(3)} IC [${s1.diferenca.ic95.map((x) => x.toExponential(3)).join(', ')}]; top 10 iguais ${s1.top10Identicos[0].iguais}/${s1.nUsuarios}`);
  } finally {
    await pool.end();
  }
}

try {
  if (pedidosMedida4) await rodarMedida4();
  else await rodarCompleto();
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
