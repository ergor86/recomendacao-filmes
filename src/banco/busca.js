import { citar } from './carga.js';
import { lerHashCarregado } from './carga.js';
import { validarVetor } from '../features/codificacao.js';

const N_MAXIMO = 100;
const FOLGA = 50;
const LIMITE_LINHAS = 1000;
const EF_MINIMO = 40;

function configurarModo(modo) {
  if (modo === 'hnsw') return 'SET LOCAL enable_seqscan = off';
  if (modo === 'exata') return 'SET LOCAL enable_indexscan = off';
  throw new Error(`modo inválido: ${modo} (use 'hnsw' ou 'exata')`);
}

// Dentro de uma transação aberta: configura a sessão para a consulta do modo.
async function prepararTransacao(client, modo, pedidas) {
  const comandoModo = configurarModo(modo);
  await client.query("SELECT set_config('hnsw.ef_search', $1, true)", [String(Math.max(pedidas, EF_MINIMO))]);
  await client.query('SET LOCAL hnsw.iterative_scan = strict_order');
  await client.query(comandoModo);
}

export async function buscarVizinhos(pool, { vetor, excluir, n, regua, modo = 'hnsw' }) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n inválido: ${n}; use um inteiro entre 1 e ${N_MAXIMO}`);
  if (n > N_MAXIMO) throw new Error(`n = ${n} excede o máximo de ${N_MAXIMO}; reduza N`);
  configurarModo(modo);
  validarVetor(vetor, regua.dimensoes.busca);

  const hashBanco = await lerHashCarregado(pool);
  if (hashBanco !== regua.hash) {
    throw new Error('régua do banco difere: rode npm run carregar-filmes -- --fase <fase>');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ s }] } = await client.query('SELECT current_schema() AS s');
    const tabela = `${citar(s)}.filmes`;
    const sql = `SELECT id, embedding <=> $1::vector AS distancia FROM ${tabela}
                 WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT $3`;
    const params = [JSON.stringify(vetor), excluir];

    let pedir = n + FOLGA;
    for (;;) {
      await prepararTransacao(client, modo, pedir);
      const { rows } = await client.query(sql, [...params, pedir]);
      const linhas = rows
        .map((r) => ({ id: r.id, distancia: Number(r.distancia) }))
        .sort((a, b) => a.distancia - b.distancia || a.id - b.id);
      if (linhas.length < n) {
        throw new Error(`a busca devolveu ${linhas.length} linhas, menos que as ${n} pedidas; confira o banco e os filtros`);
      }
      const completo = linhas.length < pedir; // não há mais linhas elegíveis
      if (completo || linhas[n - 1].distancia < linhas[linhas.length - 1].distancia) {
        await client.query('COMMIT');
        return linhas.slice(0, n);
      }
      if (pedir >= LIMITE_LINHAS) {
        throw new Error(`empate no corte de N = ${n} não cabe em ${LIMITE_LINHAS} linhas; reduza N`);
      }
      pedir = Math.min(pedir * 2, LIMITE_LINHAS);
    }
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

export async function planoDaBusca(pool, modo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ s }] } = await client.query('SELECT current_schema() AS s');
    const tabela = `${citar(s)}.filmes`;
    const { rows: amostra } = await client.query(`SELECT embedding::text AS v FROM ${tabela} ORDER BY id LIMIT 1`);
    if (amostra.length === 0) throw new Error('tabela filmes vazia: rode npm run carregar-filmes');
    await prepararTransacao(client, modo, 100);
    const { rows } = await client.query(
      `EXPLAIN SELECT id, embedding <=> $1::vector AS distancia FROM ${tabela}
       WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT 100`,
      [amostra[0].v, []],
    );
    await client.query('COMMIT');
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

export async function parametrosHnsw(pool) {
  const { rows } = await pool.query(
    `SELECT current_setting('hnsw.ef_search') AS ef_search,
            current_setting('hnsw.iterative_scan') AS iterative_scan,
            current_setting('hnsw.max_scan_tuples') AS max_scan_tuples,
            current_setting('hnsw.scan_mem_multiplier') AS scan_mem_multiplier`,
  );
  return rows[0];
}
