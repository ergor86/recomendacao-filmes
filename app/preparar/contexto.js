// Contexto da pesquisa congelada para a preparacao (spec 4.2 passo 6).
// `dirMl100k` e a pasta `ml-100k/`, que contem os 5 arquivos permitidos do ML-100K.
import assert from 'node:assert/strict';
import { criarContexto } from '../../src/contexto.js';

export function carregarContextoV2Final(dirMl100k) {
  const ctx = criarContexto({ fase: 'v2-final', dirDados: dirMl100k });
  assert(ctx.alvos === null, 'o contexto da preparacao nao pode carregar alvos');
  return ctx;
}
