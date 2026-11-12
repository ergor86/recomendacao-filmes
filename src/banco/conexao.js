// Conexão com o Postgres.

import pg from 'pg';

/**
 * Cria um pool de conexões (conexões reaproveitadas entre consultas).
 * searchPath (opcional) define o schema padrão; os testes de integração usam isso para
 * trabalhar num schema próprio e nunca tocar public.filmes.
 */
export function criarPool(configPg, { searchPath } = {}) {
  const config = { ...configPg };
  if (searchPath) config.options = [config.options, `-c search_path=${searchPath}`].filter(Boolean).join(' ');
  return new pg.Pool(config);
}

// Códigos de erro de rede que indicam banco desligado ou inalcançável.
const CODIGOS_FORA_DO_AR = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);

// Verdadeiro se o erro (ou um dos erros agrupados dentro dele) for de banco fora do ar.
function foraDoAr(erro) {
  if (CODIGOS_FORA_DO_AR.has(erro?.code)) return true;
  return Array.isArray(erro?.errors) && erro.errors.some((e) => CODIGOS_FORA_DO_AR.has(e?.code));
}

/** Faz uma consulta trivial; se o banco estiver fora do ar, troca o erro técnico por uma instrução clara. */
export async function verificarConexao(pool) {
  try {
    await pool.query('SELECT 1');
  } catch (erro) {
    if (foraDoAr(erro)) throw new Error('banco fora do ar: rode docker compose up -d');
    throw erro;
  }
}
