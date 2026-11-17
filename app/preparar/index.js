// Ponto de entrada da preparacao (spec 4.2). Le o ambiente, prepara e sai com 1 em caso de erro.
import { readFileSync } from 'node:fs';
import { prepararTudo } from './preparar.js';

const { version: versaoApp } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = process.env;

try {
  await prepararTudo({
    pg: {
      host: env.PGHOST,
      port: Number(env.PGPORT ?? 5432),
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
    },
    dirDados: env.APP_DIR_DADOS ?? '/var/app/dados',
    dirTrabalho: env.APP_DIR_TRABALHO ?? '/var/app/trabalho',
    dirEstado: env.APP_DIR_ESTADO ?? '/var/app/estado',
    zipLocal: env.ML100K_ZIP || undefined,
    versaoApp,
    porta: Number(env.APP_PORTA ?? 3000),
    modoDev: env.APP_MODO === 'dev',
  });
} catch (e) {
  console.error(`Preparação falhou: ${e.message}`);
  process.exit(1);
}
