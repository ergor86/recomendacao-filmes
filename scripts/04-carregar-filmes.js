// Script 04 (npm run carregar-filmes -- --fase exp|final): calcula a régua da fase, grava em
// artefatos/regua-<fase>.json, gera o vetor de busca de cada filme e carrega tudo na tabela filmes
// do Postgres, com o índice HNSW e o hash da régua. Rode de novo ao trocar de fase.

import 'dotenv/config';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { salvarRegua } from '../src/features/regua.js';
import { vetorBuscaFilme, validarVetor } from '../src/features/codificacao.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { carregarFilmes } from '../src/banco/carga.js';

const i = process.argv.indexOf('--fase');
const fase = i >= 0 ? process.argv[i + 1] : 'exp';
if (fase !== 'exp' && fase !== 'final') {
  console.error(`fase inválida: ${fase} (use --fase exp ou --fase final)`);
  process.exit(1);
}

const { pg: configPg, dirDados } = carregarConfig();
const { dataset, regua } = criarContexto({ fase, dirDados });

const vetores = dataset.filmes.map((f) => {
  const v = vetorBuscaFilme(f, regua);
  validarVetor(v, regua.dimensoes.busca);
  return v;
});

const pool = criarPool(configPg);
try {
  await verificarConexao(pool);
  salvarRegua(regua, `artefatos/regua-${fase}.json`);
  await carregarFilmes(pool, dataset.filmes, vetores, regua);
  console.log(`${dataset.filmes.length} filmes carregados`);
  console.log(`hash da régua (${fase}): ${regua.hash}`);
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
