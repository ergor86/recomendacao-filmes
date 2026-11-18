// Executa o script 16 congelado (carga de v2_final) num subprocesso, sem importá-lo.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', '16-carregar-v2.js');

// Caminho real: resolve links no trecho que ja existe e acrescenta o resto (que ainda sera criado).
function caminhoReal(caminho) {
  let existente = path.resolve(caminho);
  const resto = [];
  while (!existsSync(existente)) {
    resto.unshift(path.basename(existente));
    const pai = path.dirname(existente);
    if (pai === existente) break;
    existente = pai;
  }
  return path.join(realpathSync(existente), ...resto);
}

const TIMEOUT_MS = 120_000;

// Primeira linha de erro; senão, a última linha útil (sem "Node.js v" nem frames "at ...").
function causaDoErro(stderr) {
  const linhas = stderr.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const erro = linhas.find((l) => /^\w*Error\b/.test(l) || /Error:/.test(l));
  if (erro) return erro.trim();
  const util = linhas.filter((l) => !l.startsWith('Node.js v') && !/^\s+at /.test(l));
  return util.at(-1)?.trim();
}

// `dirDados` é a pasta que contém `ml-100k/`. O cwd é `dirTrabalho`, onde cai `artefatos/`.
export function rodarScript16({ pg, dirDados, dirTrabalho }) {
  // o script grava artefatos/ no cwd: nunca dentro do repositório (poluiria a árvore congelada)
  const rel = path.relative(realpathSync(RAIZ), caminhoReal(dirTrabalho));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return Promise.reject(new Error(
      `dirTrabalho (${dirTrabalho}) está dentro do repositório (${RAIZ}); use uma pasta fora dele para os artefatos do script 16`,
    ));
  }
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
    let excedeu = false;
    const relogio = setTimeout(() => { excedeu = true; filho.kill('SIGKILL'); }, TIMEOUT_MS);
    filho.stderr.on('data', (d) => { stderr += d; });
    filho.on('error', (e) => { clearTimeout(relogio); reject(e); });
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      if (excedeu) return reject(new Error('script 16 excedeu 120 s'));
      if (codigo === 0) return resolve();
      reject(new Error(causaDoErro(stderr) ?? `script 16 terminou com código ${codigo}`));
    });
  });
}
