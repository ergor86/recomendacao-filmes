// Arquivo de candidatos por fase (artefatos/candidatos-<fase>.json): a única fonte de candidatos
// de treino e avaliação. Traz o hash da régua e o sha256 do conteúdo; todo leitor confere os dois.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { jsonEstavel } from '../util/json-estavel.js';

/** sha256 (hex) do conteúdo de porUsuario em JSON estável. */
export function sha256Candidatos(porUsuario) {
  return crypto.createHash('sha256').update(jsonEstavel(porUsuario)).digest('hex');
}

/** Monta o objeto do arquivo: { fase, hashRegua, k, n, sha256, porUsuario }. */
export function montarArquivoCandidatos(fase, hashRegua, porUsuario) {
  return { fase, hashRegua, k: 200, n: 100, sha256: sha256Candidatos(porUsuario), porUsuario };
}

/**
 * Lê e valida o arquivo de candidatos. Falha alto se o arquivo não existe, se o sha256 não
 * confere com o conteúdo ou se o hash da régua difere da régua em uso.
 * @returns Map<usuario numérico, { populares, vizinhos }>
 */
export function lerCandidatos(caminho, regua) {
  const fase = /candidatos-(\w+)\.json$/.exec(path.basename(caminho))?.[1] ?? '<fase>';
  const comando = `rode npm run gerar-candidatos -- --fase ${fase}`;
  if (!fs.existsSync(caminho)) throw new Error(`arquivo de candidatos ausente (${caminho}): ${comando}`);
  const arq = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  if (!arq.porUsuario || sha256Candidatos(arq.porUsuario) !== arq.sha256 || arq.hashRegua !== regua.hash) {
    throw new Error(`candidatos de outra régua ou alterados: ${comando}`);
  }
  return new Map(Object.entries(arq.porUsuario).map(([u, v]) => [Number(u), v]));
}
