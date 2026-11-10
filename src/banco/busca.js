// Busca de vizinhos no pgvector: dado o vetor de um usuário, devolve os N filmes mais próximos
// pela distância cosseno, excluindo os que ele já viu.
//
// Garantias:
// - Determinística: empates de distância são desfeitos pelo id, no código. Não no SQL, porque
//   um ORDER BY com segundo critério faria o Postgres deixar de usar o índice HNSW.
// - Segura: recusa rodar se o hash da régua gravado no banco não for o da régua em uso.
// - Completa: pede N + 50 linhas; se houver empate exatamente no corte, dobra o pedido até 1000.

import { citar, lerHashCarregado } from './carga.js';
import { validarVetor } from '../features/codificacao.js';

const N_MAXIMO = 100; // maior N aceito por consulta
const FOLGA = 50; // linhas extras pedidas além de N, para detectar empates no corte
const LIMITE_LINHAS = 1000; // teto ao dobrar o pedido
const EF_MINIMO = 40; // padrão do pgvector; a busca nunca usa menos
const MSG_SEM_FILMES = 'banco sem filmes carregados: rode npm run carregar-filmes';

// ef_search = quantos candidatos o HNSW explora numa consulta. Precisa ser pelo menos o
// número de linhas pedidas, senão o índice devolve menos linhas que o LIMIT.
// REGRA_EF_SEARCH é o texto gravado em resultados/verificacao-hnsw.json.
export const REGRA_EF_SEARCH = `max(linhas pedidas, ${EF_MINIMO}); linhas pedidas = n + ${FOLGA}, dobrando até ${LIMITE_LINHAS} em empate no limite`;
export const efSearchPara = (linhasPedidas) => Math.max(linhasPedidas, EF_MINIMO);
export const linhasIniciais = (n) => n + FOLGA;

// Converte o modo num comando SQL: 'hnsw' desliga a varredura completa (força o índice);
// 'exata' desliga o índice (força comparar com todos os filmes, resultado exato).
function configurarModo(modo) {
  if (modo === 'hnsw') return 'SET LOCAL enable_seqscan = off';
  if (modo === 'exata') return 'SET LOCAL enable_indexscan = off';
  throw new Error(`modo inválido: ${modo} (use 'hnsw' ou 'exata')`);
}

// Dentro de uma transação aberta: ajusta o ef_search, liga a varredura iterativa em ordem estrita
// (strict_order: o índice continua buscando quando o filtro remove linhas demais) e aplica o modo.
// As configurações valem só até o fim da transação, então não afetam outras consultas do pool.
async function prepararTransacao(client, modo, pedidas) {
  const comandoModo = configurarModo(modo);
  await client.query("SELECT set_config('hnsw.ef_search', $1, true)", [String(efSearchPara(pedidas))]);
  await client.query('SET LOCAL hnsw.iterative_scan = strict_order');
  await client.query(comandoModo);
}

/**
 * Devolve os n filmes mais próximos do vetor, em ordem de (distância, id).
 * @param pool conexão com o banco
 * @param vetor vetor de busca do usuário (23 dimensões)
 * @param excluir ids que não podem aparecer (os filmes que ele já viu)
 * @param n quantos vizinhos (1 a 100)
 * @param regua régua em uso; o hash precisa bater com o gravado no banco
 * @param modo 'hnsw' (índice aproximado, rápido) ou 'exata' (compara com todos)
 * @param relatorio objeto opcional que recebe linhasPedidas (para registrar o ef_search usado)
 * @returns lista de { id, distancia }
 */
export async function buscarVizinhos(pool, { vetor, excluir, n, regua, modo = 'hnsw', relatorio }) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n inválido: ${n}; use um inteiro entre 1 e ${N_MAXIMO}`);
  if (n > N_MAXIMO) throw new Error(`n = ${n} excede o máximo de ${N_MAXIMO}; reduza N`);
  configurarModo(modo);
  validarVetor(vetor, regua.dimensoes.busca);

  const hashBanco = await lerHashCarregado(pool);
  if (hashBanco === null) throw new Error(MSG_SEM_FILMES);
  if (hashBanco !== regua.hash) {
    throw new Error(`régua do banco difere: rode npm run carregar-filmes -- --fase ${regua.fase ?? '<fase>'}`);
  }

  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    await client.query('BEGIN');
    const { rows: [{ s }] } = await client.query('SELECT current_schema() AS s');
    const tabela = `${citar(s)}.filmes`;
    const sql = `SELECT id, embedding <=> $1::vector AS distancia FROM ${tabela}
                 WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT $3`;
    const params = [JSON.stringify(vetor), excluir];

    let pedir = linhasIniciais(n);
    for (;;) {
      await prepararTransacao(client, modo, pedir);
      if (relatorio) relatorio.linhasPedidas = pedir; // última (maior) requisição
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
    descartar = erro;
    throw erro;
  } finally {
    client.release(descartar);
  }
}

/**
 * Devolve o plano de execução (EXPLAIN) da consulta de busca no modo pedido.
 * O script 05 usa isso para provar que 'hnsw' usa o índice (Index Scan) e 'exata' não (Seq Scan).
 */
export async function planoDaBusca(pool, modo) {
  if ((await lerHashCarregado(pool)) === null) throw new Error(MSG_SEM_FILMES);
  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
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
    descartar = erro;
    throw erro;
  } finally {
    client.release(descartar);
  }
}

/**
 * Lê os parâmetros do HNSW como a busca os configura, para registro em resultados/.
 * iterative_scan sai como a busca usa (strict_order); ef_search sai como o piso (40),
 * já que cada busca usa max(linhas pedidas, 40).
 */
export async function parametrosHnsw(pool) {
  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('hnsw.ef_search', $1, true)", [String(EF_MINIMO)]);
    await client.query('SET LOCAL hnsw.iterative_scan = strict_order');
    const { rows } = await client.query(
      `SELECT current_setting('hnsw.ef_search') AS ef_search,
              current_setting('hnsw.iterative_scan') AS iterative_scan,
              current_setting('hnsw.max_scan_tuples') AS max_scan_tuples,
              current_setting('hnsw.scan_mem_multiplier') AS scan_mem_multiplier`,
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    descartar = erro;
    throw erro;
  } finally {
    client.release(descartar);
  }
}
