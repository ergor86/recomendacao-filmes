// Leitura dos arquivos de texto do MovieLens 100K.
// u.item é lido em latin-1 porque alguns títulos têm acentos nessa codificação.

import fs from 'node:fs';

// Lê um arquivo e devolve as linhas não vazias (aceita fim de linha do Linux e do Windows).
function linhas(caminho, codificacao = 'utf8') {
  return fs
    .readFileSync(caminho, codificacao)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
}

/** Lê u1.base ou u1.test: cada linha é "usuário TAB filme TAB nota TAB timestamp". */
export function lerAvaliacoes(caminho) {
  return linhas(caminho).map((l) => {
    const [usuario, filme, nota, ts] = l.split('\t').map(Number);
    return { usuario, filme, nota, ts };
  });
}

/**
 * Lê u.item (separado por |): id, título, data de lançamento e 19 colunas 0/1 de gênero.
 * O ano sai do fim da data de lançamento (ex.: "01-Jan-1995" vira 1995); fica null quando
 * a data falta (filme 267).
 */
export function lerFilmes(caminho) {
  return linhas(caminho, 'latin1').map((l) => {
    const c = l.split('|');
    const m = /(\d{4})$/.exec(c[2] ?? '');
    return {
      id: Number(c[0]),
      titulo: c[1],
      ano: m ? Number(m[1]) : null,
      generos: c.slice(-19).map(Number),
    };
  });
}

/** Lê u.user (separado por |): id, idade, gênero (M/F) e ocupação. */
export function lerUsuarios(caminho) {
  return linhas(caminho).map((l) => {
    const [id, idade, genero, ocupacao] = l.split('|');
    return { id: Number(id), idade: Number(idade), genero, ocupacao };
  });
}

/** Lê u.genre ou u.occupation e devolve só a primeira coluna de cada linha (o nome). */
export function lerLista(caminho) {
  return linhas(caminho).map((l) => l.split('|')[0]);
}
