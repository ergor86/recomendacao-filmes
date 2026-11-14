// Script 17 (npm run candidatos-v2 -- --fase v2-exp): gera os candidatos v2 de TODO usuário do treino
// da fase (uma busca HNSW com M = 300 + 600 populares não vistos) e grava
// artefatos/candidatos-v2-<fase>.json e resultados/deficit-<fase>.json. O banco (schema v2_exp)
// precisa estar carregado na fase (npm run carregar-v2). Não lê teste-2 nem u1.test.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { construirFC } from '../src/fc/referencia.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { buscarColaborativos } from '../src/banco/busca-fc.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';
import { jsonEstavel } from '../src/util/json-estavel.js';
import { gerarCandidatosV2, montarArquivoCandidatosV2, relatorioDeficit } from '../src/candidatos/v2.js';

const i = process.argv.indexOf('--fase');
const fase = i >= 0 ? process.argv[i + 1] : undefined;
if (fase !== 'v2-exp') {
  console.error(`fase inválida: ${fase} (use --fase v2-exp)`);
  process.exit(1);
}
const esquema = fase.replace('-', '_');

const { pg: configPg, dirDados } = carregarConfig();
const ctx = criarContexto({ fase, dirDados });
const fc = construirFC(ctx.treino, ctx.dataset.usuarios.length);
const hashes = { regua: ctx.regua.hash, treino: hashAvaliacoes(ctx.treino) };
const usuarios = [...new Set(ctx.treino.map((a) => a.usuario))].sort((a, b) => a - b);

const configuracoes = [];
for (const k of [0, 50, 100, 150]) for (const n of [0, 50, 100, 150]) if (k + n > 0) configuracoes.push([k, n]);

const pool = criarPool(configPg, { searchPath: `${esquema},public` });
try {
  await verificarConexao(pool);
  const buscar = async (vetor, excluir, m) => {
    const { lista, empateNaoResolvido } = await buscarColaborativos(pool, { vetor, excluir, m, hashes, modo: 'hnsw' });
    return { lista, empateNaoResolvido };
  };
  const porUsuario = await gerarCandidatosV2({
    buscar, fc, treino: ctx.treino, contagens: ctx.regua.contagens, usuarios,
  });

  const arquivo = montarArquivoCandidatosV2(fase, hashes.regua, hashes.treino, porUsuario);
  fs.mkdirSync('artefatos', { recursive: true });
  fs.writeFileSync(`artefatos/candidatos-v2-${fase}.json`, JSON.stringify(arquivo));

  const relatorio = relatorioDeficit(porUsuario, configuracoes);
  fs.mkdirSync('resultados', { recursive: true });
  fs.writeFileSync(`resultados/deficit-${fase}.json`, jsonEstavel({ fase, M: 300, usuarios: usuarios.length, configuracoes: relatorio }) + '\n');

  const semCurtidas = Object.values(porUsuario).filter((e) => e.nElegiveis === 0).length;
  console.log(`== Candidatos v2 (fase ${fase}) ==`);
  console.log(`usuários: ${usuarios.length}; sem curtidas: ${semCurtidas}; sha256: ${arquivo.sha256}`);
  for (const c of ['0-150', '100-50']) {
    const r = relatorio[c];
    console.log(`(${c}) déficit real: ${r.usuariosDeficitReal}; recuperação: ${r.usuariosDeficitRecuperacao}; empate não resolvido: ${r.usuariosEmpateNaoResolvido}`);
  }
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
