// Busca colaborativa no pgvector: dado o perfil normalizado de um usuário, devolve os m filmes
// com maior escore oficial (cosseno arredondado em 6 casas, spec §5.2), sem os já vistos.
//
// Garantias:
// - Determinística: empates de escore são desfeitos pelo id, no código (não no SQL, para o
//   Postgres manter o índice HNSW).
// - Segura: recusa rodar se os hashes de régua e de treino do banco não forem os da fase em uso.
// - Completa: pede m + 50 linhas e dobra até 1.000 se o corte cair no meio de um empate; no teto,
//   devolve as m primeiras e marca empateNaoResolvido.

import { citar } from './carga.js';
import { prepararTransacao } from './busca.js';
import { lerHashesFC } from './carga-fc.js';
import { escoreOficial } from '../fc/referencia.js';

const M_MAXIMO = 300; // maior m aceito por consulta
const FOLGA = 50; // linhas extras pedidas além de m
const LIMITE_LINHAS = 1000; // teto ao dobrar o pedido
const MSG_SEM_FC = 'banco sem filmes_fc carregada: rode npm run carregar-v2 -- --fase <v2-exp|v2-final>';

/**
 * Devolve até m filmes por (escore oficial desc, id asc), só com escore oficial > 0.
 * @param pool conexão com o banco
 * @param vetor perfil já normalizado (p / ‖p‖)
 * @param excluir ids que não podem aparecer
 * @param m quantos filmes (1 a 300)
 * @param hashes { regua, treino } da fase em uso; precisam bater com os gravados no banco
 * @param modo 'hnsw' (índice aproximado) ou 'exata' (compara com todos)
 * @returns { lista: [{ id, escore }], empateNaoResolvido, linhasPedidas }
 */
export async function buscarColaborativos(pool, { vetor, excluir, m, hashes, modo = 'hnsw' }) {
  if (!Number.isInteger(m) || m < 1) throw new Error(`m inválido: ${m}; use um inteiro entre 1 e ${M_MAXIMO}`);
  if (m > M_MAXIMO) throw new Error(`m = ${m} excede o máximo de ${M_MAXIMO}; reduza m`);
  if (!Array.isArray(excluir) || !excluir.every(Number.isInteger)) {
    throw new Error('excluir inválido: passe um array de ids inteiros (use [] para não excluir nenhum)');
  }
  if (!Array.isArray(vetor) || vetor.length === 0 || !vetor.every(Number.isFinite)) {
    throw new Error('vetor inválido: use um array não vazio de números finitos');
  }

  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    // REPEATABLE READ: a conferência dos hashes e a busca enxergam o mesmo retrato do banco.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { esquema, hashRegua, hashTreino } = await lerHashesFC(client);
    if (hashRegua === null || hashTreino === null) throw new Error(MSG_SEM_FC);
    if (hashRegua !== hashes.regua) throw new Error('régua do banco difere da fase em uso: rode npm run carregar-v2');
    if (hashTreino !== hashes.treino) throw new Error('treino do banco difere da fase em uso: rode npm run carregar-v2');
    const sql = `SELECT id, embedding <=> $1::vector AS distancia FROM ${citar(esquema)}.filmes_fc
                 WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT $3`;
    const params = [JSON.stringify(vetor), excluir];

    let pedir = m + FOLGA;
    for (;;) {
      await prepararTransacao(client, modo, pedir);
      const { rows } = await client.query(sql, [...params, pedir]);
      const todas = rows
        .map((r) => ({ id: r.id, escore: escoreOficial(1 - Number(r.distancia)) }))
        .sort((a, b) => b.escore - a.escore || a.id - b.id);
      const lista = todas.filter((x) => x.escore > 0); // escore decresce: o filtro é um corte
      const cortou = lista.length < todas.length;
      const completo = rows.length < pedir || cortou;
      if (completo || lista[m - 1].escore > lista[lista.length - 1].escore) {
        await client.query('COMMIT');
        return { lista: lista.slice(0, m), empateNaoResolvido: false, linhasPedidas: pedir };
      }
      if (pedir >= LIMITE_LINHAS) {
        await client.query('COMMIT');
        return { lista: lista.slice(0, m), empateNaoResolvido: true, linhasPedidas: pedir };
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

/** Plano de execução (EXPLAIN) da consulta de busca FC no modo pedido ('hnsw' usa o índice, 'exata' não). */
export async function planoDaBuscaFC(pool, modo) {
  const client = await pool.connect();
  let descartar; // erro → a conexão é descartada em vez de devolvida ao pool
  try {
    await client.query('BEGIN');
    const { esquema, hashRegua } = await lerHashesFC(client);
    if (hashRegua === null) throw new Error(MSG_SEM_FC);
    const tabela = `${citar(esquema)}.filmes_fc`;
    const { rows: amostra } = await client.query(`SELECT embedding::text AS v FROM ${tabela} ORDER BY id LIMIT 1`);
    if (amostra.length === 0) throw new Error('tabela filmes_fc vazia: rode npm run carregar-v2');
    await prepararTransacao(client, modo, M_MAXIMO + FOLGA);
    const { rows } = await client.query(
      `EXPLAIN SELECT id, embedding <=> $1::vector AS distancia FROM ${tabela}
       WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT $3`,
      [amostra[0].v, [], M_MAXIMO + FOLGA],
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
