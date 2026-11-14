// Hash sha256 de um conjunto de avaliações (usado como selo do treino de cada fase).

import crypto from 'node:crypto';
import { jsonEstavel } from './json-estavel.js';

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
