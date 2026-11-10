import { validarVetor } from '../features/codificacao.js';

const TAMANHO_LOTE = 500;

export async function carregarFilmes(pool, filmes, vetores, regua) {
  const dim = regua.dimensoes.busca;
  if (filmes.length !== vetores.length) {
    throw new Error(`quantidade divergente: ${filmes.length} filmes e ${vetores.length} vetores; recalcule os vetores`);
  }
  for (const v of vetores) validarVetor(v, dim); // antes do BEGIN: nada é gravado se algo estiver errado

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS filmes');
    await client.query(
      `CREATE TABLE filmes (id int PRIMARY KEY, titulo text NOT NULL, ano int, embedding vector(${Number(dim)}) NOT NULL)`,
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
      await client.query(`INSERT INTO filmes (id, titulo, ano, embedding) VALUES ${valores.join(', ')}`, params);
    }
    await client.query('CREATE INDEX filmes_embedding_idx ON filmes USING hnsw (embedding vector_cosine_ops)');
    await client.query('CREATE TABLE IF NOT EXISTS metadados (chave text PRIMARY KEY, valor text NOT NULL)');
    await client.query(
      `INSERT INTO metadados (chave, valor) VALUES ('hash_regua', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [regua.hash],
    );
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

export async function lerHashCarregado(pool) {
  const { rows } = await pool.query("SELECT valor FROM metadados WHERE chave = 'hash_regua'");
  return rows[0]?.valor ?? null;
}
