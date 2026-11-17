// Apoio dos testes de integracao. Banco de teste: `app_teste`, criado se faltar.
// Recusa o banco da pesquisa (porta 5433 / banco `recomendacao`).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { SHA256_ARQUIVOS } from '../../integridade.js';

export const BANCO_TESTE = 'app_teste';

export function configSuperusuario() {
  const porta = Number(process.env.TESTE_PGPORT ?? 5434);
  const banco = process.env.TESTE_PGDATABASE ?? BANCO_TESTE;
  if (porta === 5433) {
    throw new Error('TESTE_PGPORT=5433 e o banco da pesquisa; os testes do app usam 5434. Recusado.');
  }
  if (banco === 'recomendacao') {
    throw new Error('TESTE_PGDATABASE=recomendacao e o banco da pesquisa. Recusado.');
  }
  return {
    host: process.env.TESTE_PGHOST ?? '127.0.0.1',
    port: porta,
    user: process.env.TESTE_PGUSER ?? 'recomendacao_app',
    password: process.env.TESTE_PGPASSWORD ?? 'app-local-sem-porta-publicada',
    database: banco,
  };
}

// Cria o banco de teste (se faltar) e devolve a config apontando para ele.
export async function garantirBancoTeste() {
  const cfg = configSuperusuario();
  const admin = new pg.Client({ ...cfg, database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(cfg.database)}`);
  } finally {
    await admin.end();
  }
  return cfg;
}

export function copiarArquivosML(destino) {
  const origem = process.env.ML100K_DIR;
  if (!origem) throw new Error('ML100K_DIR nao definido');
  mkdirSync(destino, { recursive: true });
  for (const [nome, esperado] of Object.entries(SHA256_ARQUIVOS)) {
    const arquivo = path.join(origem, nome);
    const hash = createHash('sha256').update(readFileSync(arquivo)).digest('hex');
    if (hash !== esperado) throw new Error(`sha256 de ${nome} diverge do esperado`);
    copyFileSync(arquivo, path.join(destino, nome));
  }
  return destino;
}

export function poolComo(papel, senha, extra = {}) {
  const { host, port, database } = configSuperusuario();
  return new pg.Pool({ host, port, database, user: papel, password: senha, max: 2, ...extra });
}
