import { init, parse } from 'es-module-lexer';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const ParserJsx = Parser.extend(jsx());

await init;

/**
 * Lê um texto-fonte e devolve o que importa para o isolamento:
 * - importacoes: especificadores literais de `import`, `export … from` e `import('…')`;
 * - dinamicosNaoLiterais: quantidade de `import(x)` com especificador não literal;
 * - criação de require e uso de require: busca textual.
 */
export function analisarFonte(texto, nome = 'texto.js') {
  try {
    return /\.jsx$/.test(nome) ? analisarComAcorn(texto) : analisarComLexer(texto);
  } catch (e) {
    throw new Error(`${nome} não analisável: ${e.message}`, { cause: e });
  }
}

/** Parser que entende JSX (acorn + acorn-jsx): percorre a AST inteira. */
function analisarComAcorn(texto) {
  const ast = ParserJsx.parse(texto, { ecmaVersion: 'latest', sourceType: 'module' });
  const importacoes = [];
  const exportados = [];
  let dinamicosNaoLiterais = 0;
  const visitar = (no) => {
    if (!no || typeof no.type !== 'string') return;
    if (no.type === 'ImportDeclaration') importacoes.push({ tipo: 'import', especificador: no.source.value });
    else if ((no.type === 'ExportNamedDeclaration' || no.type === 'ExportAllDeclaration') && no.source) {
      importacoes.push({ tipo: 'export-from', especificador: no.source.value });
    } else if (no.type === 'ImportExpression') {
      if (no.source.type === 'Literal' && typeof no.source.value === 'string') {
        importacoes.push({ tipo: 'dinamico', especificador: no.source.value });
      } else dinamicosNaoLiterais += 1;
    }
    for (const v of Object.values(no)) {
      if (Array.isArray(v)) v.forEach(visitar);
      else if (v && typeof v === 'object') visitar(v);
    }
  };
  visitar(ast);
  for (const n of ast.body) {
    if (n.type === 'ExportNamedDeclaration' && !n.source) {
      if (n.declaration?.declarations) for (const d of n.declaration.declarations) exportados.push(d.id.name);
      else if (n.declaration?.id) exportados.push(n.declaration.id.name);
      for (const s of n.specifiers) exportados.push(s.exported.name ?? s.exported.value);
    } else if (n.type === 'ExportDefaultDeclaration') exportados.push('default');
  }
  return { importacoes, exportados, dinamicosNaoLiterais, ...buscaTextual(texto) };
}

function buscaTextual(texto) {
  return {
    criaRequire: new RegExp('\\bcreate' + 'Require\\b').test(texto),
    usaRequire: /(?<![\w$.])require\s*\(/.test(texto),
  };
}

function analisarComLexer(texto) {
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
    ...buscaTextual(texto),
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
