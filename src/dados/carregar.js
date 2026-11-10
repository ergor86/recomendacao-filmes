import path from 'node:path';
import { lerAvaliacoes, lerFilmes, lerUsuarios, lerLista } from './leitura.js';

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
