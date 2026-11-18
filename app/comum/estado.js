import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, linkSync } from 'node:fs';
import path from 'node:path';

const ARQ_ESTADO = 'estado.json';
const ARQ_CRED = 'credenciais.json';
const CHAVES_SECRETAS = new Set(['senha', 'password', 'app_leitura', 'app_escrita']);

// Procura, em qualquer nível, uma chave de segredo; devolve o caminho (ex.: estado.a.senha) ou null.
function acharSegredo(v, caminho) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = acharSegredo(v[i], `${caminho}[${i}]`);
      if (r) return r;
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (CHAVES_SECRETAS.has(k)) return `${caminho}.${k}`;
      const r = acharSegredo(x, `${caminho}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

const AUSENTE = Symbol('ausente');

function lerJson(arquivo) {
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return AUSENTE;
    if (e instanceof SyntaxError) {
      throw Object.assign(new Error(`arquivo inválido (${arquivo}): ${e.message}`), { code: 'JSON_INVALIDO' });
    }
    throw e;
  }
}

export function gravarEstado(dir, estado) {
  const segredo = acharSegredo(estado, 'estado');
  if (segredo) throw new Error(`o estado não pode conter segredos: chave ${segredo}`);
  mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, ARQ_ESTADO);
  const temp = `${destino}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(estado, null, 2) + '\n');
    renameSync(temp, destino);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}

export function lerEstado(dir) {
  const e = lerJson(path.join(dir, ARQ_ESTADO));
  return e === AUSENTE ? null : e;
}

function validarCredenciais(c, arquivo) {
  const ok = (s) => typeof s === 'string' && s.length > 0;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !ok(c.app_leitura) || !ok(c.app_escrita)) {
    throw Object.assign(
      new Error(`credenciais inválidas em ${arquivo}: app_leitura e app_escrita devem ser strings não vazias; corrija ou remova o arquivo`),
      { code: 'CREDENCIAIS_INVALIDAS' },
    );
  }
  return { app_leitura: c.app_leitura, app_escrita: c.app_escrita };
}

export function lerCredenciais(dir) {
  const arquivo = path.join(dir, ARQ_CRED);
  const c = lerJson(arquivo);
  return c === AUSENTE ? null : validarCredenciais(c, arquivo);
}

export function garantirCredenciais(dir) {
  mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQ_CRED);
  const existente = lerCredenciais(dir);
  if (existente) return existente;
  const novas = {
    app_leitura: randomBytes(24).toString('base64url'),
    app_escrita: randomBytes(24).toString('base64url'),
  };
  // temporário completo, publicado com link (falha atomicamente com EEXIST)
  const temp = `${arquivo}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(novas, null, 2) + '\n', { mode: 0o600 });
    linkSync(temp, arquivo);
    return novas;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return lerCredenciais(dir);
  } finally {
    rmSync(temp, { force: true });
  }
}
