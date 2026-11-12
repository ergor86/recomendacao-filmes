// Carga dos filmes e dos seus vetores de busca na tabela filmes do Postgres (pgvector).

import { validarVetor } from '../features/codificacao.js';

const TAMANHO_LOTE = 500; // filmes por INSERT (menos idas e voltas ao banco)

// Põe um nome de schema ou tabela entre aspas duplas, escapando aspas internas (evita SQL quebrado ou injeção).
export const citar = (id) => '"' + id.replace(/"/g, '""') + '"';

/**
 * Recria a tabela filmes do schema atual (id, título, ano e vetor de busca) e cria o índice HNSW.
 * Tudo numa transação: se algo falhar no meio, nada muda no banco.
 * O hash da régua é gravado por último, na tabela metadados, como selo de que a carga terminou
 * e de qual régua gerou os vetores.
 */
export async function carregarFilmes(pool, filmes, vetores, regua) {
  const dim = regua.dimensoes.busca;
  if (filmes.length !== vetores.length) {
    throw new Error(`quantidade divergente: ${filmes.length} filmes e ${vetores.length} vetores; recalcule os vetores`);
  }
  for (const v of vetores) validarVetor(v, dim); // antes do BEGIN: nada é gravado se algo estiver errado

  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    await client.query('BEGIN');
    // Garante a extensão pgvector (o tipo vector) num banco novo, sem depender do script 01.
    // SCHEMA public: num schema de teste, ela seria apagada junto com o schema.
    await client.query('CREATE EXTENSION IF NOT EXISTS vector SCHEMA public').catch((erro) => {
      throw new Error(`não consegui criar a extensão pgvector (${erro.message}): rode npm run ambiente ou confira a imagem no docker-compose.yml`);
    });
    const { rows: [{ s: esquema }] } = await client.query('SELECT current_schema() AS s');
    const q = citar(esquema);
    await client.query(`DROP TABLE IF EXISTS ${q}.filmes`);
    await client.query(
      `CREATE TABLE ${q}.filmes (id int PRIMARY KEY, titulo text NOT NULL, ano int, embedding vector(${Number(dim)}) NOT NULL)`,
    );
    for (let i = 0; i < filmes.length; i += TAMANHO_LOTE) {
      const lote = filmes.slice(i, i + TAMANHO_LOTE);
      const valores = [];
      const params = [];
      lote.forEach((f, j) => {
        const b = j * 4;
        valores.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::vector)`);
        params.push(f.id, f.titulo, f.ano, JSON.stringify(vetores[i + j]));
      });
      await client.query(`INSERT INTO ${q}.filmes (id, titulo, ano, embedding) VALUES ${valores.join(', ')}`, params);
    }
    await client.query(`CREATE INDEX filmes_embedding_idx ON ${q}.filmes USING hnsw (embedding vector_cosine_ops)`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${q}.metadados (chave text PRIMARY KEY, valor text NOT NULL)`);
    await client.query(
      `INSERT INTO ${q}.metadados (chave, valor) VALUES ('hash_regua', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [regua.hash],
    );
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
 * Lê o schema atual e o hash da régua gravado na última carga nesse schema.
 * hash = null se a tabela metadados não existir (banco ainda não carregado).
 * @param executor um pool ou uma conexão (client); dentro de uma transação, use a conexão dela
 * @returns { esquema, hash }
 */
export async function lerEsquemaEHash(executor) {
  const { rows: [{ s, existe }] } = await executor.query(
    "SELECT current_schema() AS s, to_regclass(quote_ident(current_schema()) || '.metadados') IS NOT NULL AS existe",
  );
  if (s === null) {
    throw new Error('nenhum schema válido no search_path; confira PGOPTIONS/search_path do banco e se o schema public existe');
  }
  if (!existe) return { esquema: s, hash: null };
  const { rows } = await executor.query(`SELECT valor FROM ${citar(s)}.metadados WHERE chave = 'hash_regua'`);
  return { esquema: s, hash: rows[0]?.valor ?? null };
}

/** Só o hash da régua gravado na última carga (null se o banco ainda não foi carregado). */
export async function lerHashCarregado(executor) {
  return (await lerEsquemaEHash(executor)).hash;
}
