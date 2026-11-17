import { init, parse } from 'es-module-lexer';

await init;

/**
 * Lê um texto-fonte e devolve o que importa para o isolamento:
 * - importacoes: especificadores literais de `import`, `export … from` e `import('…')`;
 * - dinamicosNaoLiterais: quantidade de `import(x)` com especificador não literal;
 * - criação de require e uso de require: busca textual.
 */
export function analisarFonte(texto) {
  const [imports, exports] = parse(texto);
  const importacoes = [];
  let dinamicosNaoLiterais = 0;
  for (const i of imports) {
    if (i.d === -2) continue; // import.meta
    if (i.d > -1) {
      if (i.n === undefined) dinamicosNaoLiterais += 1;
      else importacoes.push({ tipo: 'dinamico', especificador: i.n });
    } else {
      const tipo = texto.slice(i.ss, i.se).trimStart().startsWith('export') ? 'export-from' : 'import';
      importacoes.push({ tipo, especificador: i.n });
    }
  }
  return {
    importacoes,
    exportados: exports.map((e) => e.n),
    dinamicosNaoLiterais,
    criaRequire: new RegExp('\\bcreate' + 'Require\\b').test(texto),
    usaRequire: /(?<![\w$.])require\s*\(/.test(texto),
  };
}

/** Módulos da raiz que nenhum arquivo de app/ pode importar diretamente (§10.1). */
export const PROIBIDOS_RAIZ = [
  /^src\/modelo\//,
  /^src\/avaliacao\//,
  /^src\/dados\/(carregar|leitura|estatisticas|teste2|divisoes)\.js$/,
];

/**
 * Os especificadores relativos de um arquivo (caminho relativo à raiz do repositório,
 * com `/`) que saem de app/ e caem na raiz, como caminhos relativos à raiz.
 */
export function importsDaRaiz(analise, arquivoRel, path) {
  const dir = path.posix.dirname(arquivoRel);
  const saida = [];
  for (const { especificador } of analise.importacoes) {
    if (!especificador.startsWith('.')) continue;
    const alvo = path.posix.normalize(path.posix.join(dir, especificador));
    if (!alvo.startsWith('app/') && !alvo.startsWith('..')) saida.push(alvo);
  }
  return saida;
}
