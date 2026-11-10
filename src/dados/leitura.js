import fs from 'node:fs';

function linhas(caminho, codificacao = 'utf8') {
  return fs
    .readFileSync(caminho, codificacao)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
}

export function lerAvaliacoes(caminho) {
  return linhas(caminho).map((l) => {
    const [usuario, filme, nota, ts] = l.split('\t').map(Number);
    return { usuario, filme, nota, ts };
  });
}

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

export function lerUsuarios(caminho) {
  return linhas(caminho).map((l) => {
    const [id, idade, genero, ocupacao] = l.split('|');
    return { id: Number(id), idade: Number(idade), genero, ocupacao };
  });
}

export function lerLista(caminho) {
  return linhas(caminho).map((l) => l.split('|')[0]);
}
