import pg from 'pg';

export function criarPool(configPg, { searchPath } = {}) {
  const config = { ...configPg };
  if (searchPath) config.options = `-c search_path=${searchPath}`;
  return new pg.Pool(config);
}

const CODIGOS_FORA_DO_AR = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);

function foraDoAr(erro) {
  if (CODIGOS_FORA_DO_AR.has(erro?.code)) return true;
  return Array.isArray(erro?.errors) && erro.errors.some((e) => CODIGOS_FORA_DO_AR.has(e?.code));
}

export async function verificarConexao(pool) {
  try {
    await pool.query('SELECT 1');
  } catch (erro) {
    if (foraDoAr(erro)) throw new Error('banco fora do ar: rode docker compose up -d');
    throw erro;
  }
}
