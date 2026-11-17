// Contexto da pesquisa congelada para a preparacao (spec 4.2 passo 6).
// `dirDados` e a pasta que contem os 5 arquivos do ML-100K.
import assert from 'node:assert/strict';
import { criarContexto } from '../../src/contexto.js';

export function carregarContextoV2Final(dirDados) {
  const ctx = criarContexto({ fase: 'v2-final', dirDados });
  assert(ctx.alvos === null, 'o contexto da preparacao nao pode carregar alvos');
  return ctx;
}
