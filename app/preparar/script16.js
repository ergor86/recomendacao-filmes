// Executa o script 16 congelado (carga de v2_final) num subprocesso, sem importá-lo.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', '16-carregar-v2.js');

// `dirDados` é a pasta que contém `ml-100k/`. O cwd é `dirTrabalho`, onde cai `artefatos/`.
export function rodarScript16({ pg, dirDados, dirTrabalho }) {
  mkdirSync(dirTrabalho, { recursive: true });
  const env = {
    PGHOST: String(pg.host),
    PGPORT: String(pg.port),
    PGUSER: pg.user,
    PGPASSWORD: pg.password,
    PGDATABASE: pg.database,
    DIR_DADOS: path.join(dirDados, 'ml-100k'),
    PATH: process.env.PATH ?? '',
  };
  if (process.platform === 'win32') {
    for (const k of ['SYSTEMROOT', 'WINDIR']) if (process.env[k]) env[k] = process.env[k];
  }
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [SCRIPT, '--fase', 'v2-final'], {
      cwd: dirTrabalho,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    filho.stderr.on('data', (d) => { stderr += d; });
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      if (codigo === 0) return resolve();
      const linhas = stderr.trim().split(/\r?\n/).filter(Boolean);
      reject(new Error(linhas.at(-1) ?? `script 16 terminou com código ${codigo}`));
    });
  });
}
