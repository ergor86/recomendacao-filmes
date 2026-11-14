// Teste-2: notas escondidas dos usuários 1–462 dentro do próprio u1.base, para avaliar o Plano 3
// sem tocar no u1.test. O acesso fica restrito a este módulo e a src/contexto.js (spec §3.2).

import crypto from 'node:crypto';
import { criarAleatorio, embaralhar } from '../util/aleatorio.js';
import { jsonEstavel } from '../util/json-estavel.js';

export const FRACAO_TESTE2 = 0.2;
export const SEMENTE_TESTE2 = 20_000_000;
export const USUARIOS_TESTE2 = [1, 462];

/**
 * Separa o teste-2 do u1.base. Para cada usuário de 1 a 462: ordena as notas por filme,
 * embaralha com criarAleatorio(SEMENTE_TESTE2 + usuario) e esconde as primeiras
 * Math.round(FRACAO_TESTE2 × n) (mesmo algoritmo de criarDivisoes).
 * @param base avaliações de u1.base ({ usuario, filme, nota, timestamp })
 * @returns { teste2, semTeste2 } (semTeste2 mantém a ordem original da base)
 */
export function dividirTeste2(base) {
  const [minimo, maximo] = USUARIOS_TESTE2;
  const porUsuario = new Map();
  for (const a of base) {
    if (a.usuario < minimo || a.usuario > maximo) continue;
    if (!porUsuario.has(a.usuario)) porUsuario.set(a.usuario, []);
    porUsuario.get(a.usuario).push(a);
  }

  const escondidas = new Set();
  const teste2 = [];
  const ids = [...porUsuario.keys()].sort((x, y) => x - y);
  for (const id of ids) {
    const ordenadas = [...porUsuario.get(id)].sort((x, y) => x.filme - y.filme);
    const mistura = embaralhar(ordenadas, criarAleatorio(SEMENTE_TESTE2 + id));
    const k = Math.round(FRACAO_TESTE2 * mistura.length);
    for (const a of mistura.slice(0, k)) {
      escondidas.add(a);
      teste2.push(a);
    }
  }
  return { teste2, semTeste2: base.filter((a) => !escondidas.has(a)) };
}

/**
 * Hash sha256 (hex) das avaliações: jsonEstavel dos triplos [usuario, filme, nota]
 * ordenados por usuário e filme; não depende da ordem de entrada.
 */
export function hashAvaliacoes(avaliacoes) {
  const triplos = avaliacoes
    .map((a) => [a.usuario, a.filme, a.nota])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return crypto.createHash('sha256').update(jsonEstavel(triplos)).digest('hex');
}
