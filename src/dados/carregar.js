import path from 'node:path';
import { lerAvaliacoes, lerFilmes, lerUsuarios, lerLista } from './leitura.js';

/**
 * Lê os arquivos do MovieLens 100K usados pelo projeto e devolve tudo em memória:
 * - base: notas de u1.base (treino oficial da divisão u1)
 * - teste: notas de u1.test (usuários 1 a 462; só para a avaliação final)
 * - filmes, usuarios: cadastros de u.item e u.user
 * - generos, ocupacoes: nomes das 19 categorias de gênero e das ocupações
 * @param dir pasta com os arquivos (ex.: data/ml-100k)
 */
export function carregarDataset(dir) {
  const p = (n) => path.join(dir, n);
  return {
    base: lerAvaliacoes(p('u1.base')),
    teste: lerAvaliacoes(p('u1.test')),
    filmes: lerFilmes(p('u.item')),
    usuarios: lerUsuarios(p('u.user')),
    generos: lerLista(p('u.genre')),
    ocupacoes: lerLista(p('u.occupation')),
  };
}
