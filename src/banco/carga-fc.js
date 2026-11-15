// Carga dos vetores da filtragem colaborativa (FC) na tabela filmes_fc do Postgres (pgvector).
// Cada filme com curtidas tem um vetor de dimensão = número de usuários (spec §5.1).

import { citar } from './carga.js';

const TAMANHO_LOTE = 200; // filmes por INSERT (vetores de 943 posições são grandes)

/**
 * Recria a tabela filmes_fc do schema atual e cria o índice HNSW de cosseno.
 * Tudo numa transação. Os hashes da régua e do treino são gravados por último em metadados,
 * como selo de que a carga terminou e de quais dados geraram os vetores.
 * @param pool conexão com o banco
 * @param vetores Map<id do filme, vetor>; só os filmes que têm vetor
 * @param dim dimensão dos vetores (número de usuários)
 * @param hashRegua hash da régua da fase
 * @param hashTreino hash do conjunto de treino da fase
 */
export async function carregarFilmesFC(pool, { vetores, dim, hashRegua, hashTreino }) {
  if (!Number.isInteger(dim) || dim < 1) throw new Error(`dim inválida: ${dim}`);
  for (const [id, v] of vetores) {
    if (!Array.isArray(v) || v.length !== dim || !v.every(Number.isFinite)) {
      throw new Error(`vetor FC inválido para o filme ${id}: esperado ${dim} números finitos`);
    }
  }
  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    await client.query('BEGIN');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector SCHEMA public').catch((erro) => {
      throw new Error(`não consegui criar a extensão pgvector (${erro.message}): rode npm run ambiente ou confira a imagem no docker-compose.yml`);
    });
    const { rows: [{ s: esquema }] } = await client.query('SELECT current_schema() AS s');
    const q = citar(esquema);
    await client.query(`DROP TABLE IF EXISTS ${q}.filmes_fc`);
    await client.query(`CREATE TABLE ${q}.filmes_fc (id int PRIMARY KEY, embedding vector(${dim}) NOT NULL)`);
    const itens = [...vetores.entries()]; // ordem de inserção do Map (a busca não depende dela)
    for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
      const valores = [];
      const params = [];
      itens.slice(i, i + TAMANHO_LOTE).forEach(([id, v], j) => {
        valores.push(`($${j * 2 + 1}, $${j * 2 + 2}::vector)`);
        params.push(id, JSON.stringify(v));
      });
      await client.query(`INSERT INTO ${q}.filmes_fc (id, embedding) VALUES ${valores.join(', ')}`, params);
    }
    await client.query(`CREATE INDEX filmes_fc_embedding_idx ON ${q}.filmes_fc USING hnsw (embedding vector_cosine_ops)`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${q}.metadados (chave text PRIMARY KEY, valor text NOT NULL)`);
    for (const [chave, valor] of [['hash_regua', hashRegua], ['hash_treino', hashTreino]]) {
      await client.query(
        `INSERT INTO ${q}.metadados (chave, valor) VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [chave, valor],
      );
    }
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    descartar = erro;
    throw erro;
  } finally {
    client.release(descartar);
  }
}

/**
 * Lê o schema atual e os hashes da régua e do treino gravados na última carga da FC.
 * Cada hash é null se ainda não foi gravado.
 * @param executor um pool ou uma conexão (client); dentro de uma transação, use a conexão dela
 * @returns { esquema, hashRegua, hashTreino }
 */
export async function lerHashesFC(executor) {
  const { rows: [{ s, existe }] } = await executor.query(
    "SELECT current_schema() AS s, to_regclass(quote_ident(current_schema()) || '.metadados') IS NOT NULL AS existe",
  );
  if (s === null) {
    throw new Error('nenhum schema válido no search_path; confira PGOPTIONS/search_path do banco e se o schema public existe');
  }
  if (!existe) return { esquema: s, hashRegua: null, hashTreino: null };
  const { rows } = await executor.query(
    `SELECT chave, valor FROM ${citar(s)}.metadados WHERE chave IN ('hash_regua', 'hash_treino')`,
  );
  const por = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  return { esquema: s, hashRegua: por.hash_regua ?? null, hashTreino: por.hash_treino ?? null };
}
