import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ARQ_ESTADO = 'estado.json';
const ARQ_CRED = 'credenciais.json';

function semSenha(v) {
  if (Array.isArray(v)) return v.map(semSenha);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'senha').map(([k, x]) => [k, semSenha(x)]));
  }
  return v;
}

function lerJson(arquivo) {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function gravarEstado(dir, estado) {
  mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, ARQ_ESTADO);
  const temp = `${destino}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(semSenha(estado), null, 2) + '\n');
    renameSync(temp, destino);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}

export function lerEstado(dir) {
  return lerJson(path.join(dir, ARQ_ESTADO));
}

export function lerCredenciais(dir) {
  return lerJson(path.join(dir, ARQ_CRED));
}

export function garantirCredenciais(dir) {
  mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQ_CRED);
  const novas = {
    app_leitura: randomBytes(24).toString('base64url'),
    app_escrita: randomBytes(24).toString('base64url'),
  };
  try {
    // 'wx': só cria se não existir
    writeFileSync(arquivo, JSON.stringify(novas, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return novas;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return lerCredenciais(dir);
  }
}
