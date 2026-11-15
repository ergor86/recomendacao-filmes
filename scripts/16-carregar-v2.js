// Script 16 (npm run carregar-v2 -- --fase v2-exp|v2-final): carrega o banco do Plano 3 num schema
// próprio (v2_exp ou v2_final), sem tocar em public. Grava a tabela filmes (vetores de conteúdo,
// régua da fase) e a tabela filmes_fc (vetores colaborativos do treino da fase), com os hashes da
// régua e do treino, e salva a régua em artefatos/regua-v2-<exp|final>.json.

import 'dotenv/config';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { salvarRegua } from '../src/features/regua.js';
import { vetorBuscaFilme, validarVetor } from '../src/features/codificacao.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { carregarFilmes, citar } from '../src/banco/carga.js';
import { carregarFilmesFC } from '../src/banco/carga-fc.js';
import { construirFC, vetorFilme } from '../src/fc/referencia.js';
import { hashAvaliacoes } from '../src/util/hash-avaliacoes.js';

const i = process.argv.indexOf('--fase');
const fase = i >= 0 ? process.argv[i + 1] : undefined;
if (fase !== 'v2-exp' && fase !== 'v2-final') {
  console.error(`fase inválida: ${fase} (use --fase v2-exp ou --fase v2-final)`);
  process.exit(1);
}
const esquema = fase.replace('-', '_'); // v2_exp | v2_final

const { pg: configPg, dirDados } = carregarConfig();
const { dataset, treino, regua } = criarContexto({ fase, dirDados });

const vetoresConteudo = dataset.filmes.map((f) => {
  const v = vetorBuscaFilme(f, regua);
  validarVetor(v, regua.dimensoes.busca);
  return v;
});
const dim = dataset.usuarios.length;
const fc = construirFC(treino, dim);
const vetoresFC = new Map();
for (const f of dataset.filmes) {
  const v = vetorFilme(fc, f.id);
  if (v) vetoresFC.set(f.id, v);
}
const hashTreino = hashAvaliacoes(treino);

// Cria o schema antes, numa conexão sem search_path especial; depois todo o resto roda dentro dele.
const admin = criarPool(configPg);
try {
  await verificarConexao(admin);
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${citar(esquema)}`);
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
await admin.end();

if (!process.exitCode) {
  const pool = criarPool(configPg, { searchPath: `${citar(esquema)},public` });
  try {
    await carregarFilmes(pool, dataset.filmes, vetoresConteudo, regua);
    await carregarFilmesFC(pool, { vetores: vetoresFC, dim, hashRegua: regua.hash, hashTreino });
    // Só depois das cargas confirmadas: se falharem, o arquivo continua igual ao banco.
    salvarRegua(regua, `artefatos/regua-${fase}.json`);
    console.log(`schema ${esquema}: ${dataset.filmes.length} filmes, ${vetoresFC.size} em filmes_fc (dim ${dim})`);
    console.log(`hash da régua (${fase}): ${regua.hash}`);
    console.log(`hash do treino (${fase}): ${hashTreino}`);
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
