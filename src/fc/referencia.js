// Filtragem colaborativa item-item em memória (referência float64) do Plano 3 (spec §4.1–§4.2).
// Cada filme j tem o vetor c_j[u] = 1 (nota >= 4 no treino da fase), normalizado: v_j = c_j / ‖c_j‖.
// A dimensão é o número de usuários e o usuário u fica na posição u − 1. O perfil é p = Σ v_i dos
// filmes curtidos e o escore oficial é round(cos(p, v_j), 6). Tudo usa listas esparsas de fãs.

import crypto from 'node:crypto';
import { jsonEstavel } from '../util/json-estavel.js';

/**
 * Constrói a FC a partir do treino da fase: fãs de cada filme e curtidos de cada usuário (ordenados).
 * @param treino array de { usuario, filme, nota }
 * @param nUsuarios dimensão dos vetores (943 nos dados reais)
 * @returns { nUsuarios, fasPorFilme: Map<filme, number[]>, curtidosPorUsuario: Map<u, number[]> }
 */
export function construirFC(treino, nUsuarios) {
  const fasPorFilme = new Map();
  const curtidosPorUsuario = new Map();
  for (const { usuario, filme, nota } of treino) {
    if (nota < 4) continue;
    if (!fasPorFilme.has(filme)) fasPorFilme.set(filme, []);
    fasPorFilme.get(filme).push(usuario);
    if (!curtidosPorUsuario.has(usuario)) curtidosPorUsuario.set(usuario, []);
    curtidosPorUsuario.get(usuario).push(filme);
  }
  const asc = (a, b) => a - b;
  for (const l of fasPorFilme.values()) l.sort(asc);
  for (const l of curtidosPorUsuario.values()) l.sort(asc);
  return { nUsuarios, fasPorFilme, curtidosPorUsuario };
}

/**
 * Vetor unitário denso do filme (1/√|fãs| nas posições u − 1), ou null se o filme não tem curtidas.
 */
export function vetorFilme(fc, filme) {
  const fas = fc.fasPorFilme.get(filme);
  if (!fas || fas.length === 0) return null;
  const v = new Array(fc.nUsuarios).fill(0);
  const x = 1 / Math.sqrt(fas.length);
  for (const u of fas) v[u - 1] = x;
  return v;
}

/**
 * Perfil p = Σ v_i dos filmes curtidos (filmes sem vetor não contribuem).
 * @returns Float64Array, ou null se a lista é vazia ou o perfil resultante é todo zero
 */
export function perfilFC(fc, curtidos) {
  const p = new Float64Array(fc.nUsuarios);
  let algum = false;
  for (const i of curtidos) {
    const fas = fc.fasPorFilme.get(i);
    if (!fas || fas.length === 0) continue;
    const x = 1 / Math.sqrt(fas.length);
    for (const u of fas) p[u - 1] += x;
    algum = true;
  }
  return algum ? p : null;
}

/** Escore oficial: arredonda a 6 casas, meio para cima (sem arredondamento bancário). */
export function escoreOficial(x) {
  return Math.round(x * 1e6) / 1e6;
}

// Norma euclidiana do perfil.
function normaPerfil(perfil) {
  let s = 0;
  for (const x of perfil) s += x * x;
  return Math.sqrt(s);
}

// Pontua todos os filmes com vetor e não vistos; mantém só escore oficial > 0.
function pontuar(fc, perfil, vistos) {
  const norma = normaPerfil(perfil);
  const itens = [];
  if (norma === 0) return itens;
  for (const [id, fas] of fc.fasPorFilme) {
    if (fas.length === 0 || vistos.has(id)) continue;
    let soma = 0;
    for (const u of fas) soma += perfil[u - 1];
    const escore64 = soma / Math.sqrt(fas.length) / norma;
    const escore = escoreOficial(escore64);
    if (escore > 0) itens.push({ id, escore, escore64 });
  }
  return itens;
}

/**
 * Ranking de referência: só escore oficial > 0, ordem (escore desc, id asc), no máximo m itens.
 * escore64 é o cosseno sem arredondar.
 * @returns Array<{ id, escore, escore64 }>
 */
export function rankingReferencia(fc, perfil, vistos, m) {
  const itens = pontuar(fc, perfil, vistos);
  itens.sort((a, b) => b.escore - a.escore || a.id - b.id);
  return itens.slice(0, m);
}

/** Conjunto dos filmes não vistos com escore oficial > 0. */
export function elegiveisReferencia(fc, perfil, vistos) {
  return new Set(pontuar(fc, perfil, vistos).map((x) => x.id));
}

/** Hash sha256 (hex) dos vetores: jsonEstavel de { filme: fãs ordenados }, só filmes com curtidas. */
export function hashVetoresFC(fc) {
  const obj = {};
  for (const [filme, fas] of fc.fasPorFilme) {
    if (fas.length > 0) obj[filme] = [...fas].sort((a, b) => a - b);
  }
  return crypto.createHash('sha256').update(jsonEstavel(obj)).digest('hex');
}
