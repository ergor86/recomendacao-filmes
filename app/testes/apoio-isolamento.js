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
export function importsDaRaiz(analise, arquivoRel) {
  const saida = [];
  for (const { especificador } of analise.importacoes) {
    const alvo = resolverRelativo(especificador, arquivoRel);
    if (alvo && !alvo.startsWith('app/') && !alvo.startsWith('..')) saida.push(alvo);
  }
  return saida;
}

const RELATIVO = /^\.\.?[\\/]/;
// nome de pacote: sem esquema, barra invertida, % nem ponto inicial
const PACOTE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.-]+)*$/i;

/**
 * Resolve um especificador relativo (./ ou ../) contra o arquivo importador, ambos relativos à raiz
 * do repositório: decodifica %xx, trata a barra invertida como /, e normaliza com URL. Devolve null se não for
 * relativo ou não resolver (percent-encoding inválido).
 */
export function resolverRelativo(especificador, arquivoRel) {
  if (!RELATIVO.test(especificador)) return null;
  try {
    const decodificado = decodeURIComponent(especificador).replaceAll('\\', '/');
    const url = new URL(decodificado, 'file:///' + arquivoRel);
    return url.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

/** Especificadores que o verificador não sabe interpretar: só ./, ../, node: e nomes de pacote valem. */
export function especificadoresInvalidos(analise) {
  return analise.importacoes.map((i) => i.especificador).filter((e) => {
    if (ABSOLUTO.test(e)) return false; // acusado por especificadoresAbsolutos
    if (RELATIVO.test(e)) return resolverRelativo(e, 'app/x.js') === null;
    if (e.startsWith('node:')) return !/^node:[a-z0-9_/]+$/.test(e);
    return !PACOTE.test(e);
  });
}

/** Especificador absoluto: caminho absoluto POSIX ou Windows, ou `file:`. */
const ABSOLUTO = /^(\/|[A-Za-z]:[\\/]|\\\\|file:)/;
export const especificadoresAbsolutos = (analise) =>
  analise.importacoes.map((i) => i.especificador).filter((e) => ABSOLUTO.test(e));

const dentroDe = (rel, pastas) => pastas.some((p) => rel.startsWith(p));

/**
 * Fecho transitivo dentro de app/ a partir de cada arquivo das pastas de origem.
 * `textos`: Map caminho-relativo-à-raiz → texto. Arquivos não analisáveis são ignorados aqui
 * (outro teste os acusa). Devolve as violações:
 * - origem alcança arquivo de uma pasta proibida (preparar/testes);
 * - arquivo do fecho importa da raiz algo que a pasta de origem não permite.
 */
export function violacoesDeFecho({ textos, origens, proibidos, permitidosPara, existentes }) {
  const analises = new Map();
  const analise = (rel) => {
    if (!analises.has(rel)) {
      let a = null;
      try { a = analisarFonte(textos.get(rel), rel); } catch { /* acusado por outro teste */ }
      analises.set(rel, a);
    }
    return analises.get(rel);
  };
  const violacoes = [];
  for (const origem of [...textos.keys()].filter((r) => dentroDe(r, origens))) {
    const pastaOrigem = origens.find((p) => origem.startsWith(p));
    const permitidos = permitidosPara(origem);
    const pai = new Map([[origem, null]]);
    const fila = [origem];
    const cadeia = (rel) => {
      const c = [];
      for (let r = rel; r; r = pai.get(r)) c.unshift(r);
      return c.join(' → ');
    };
    while (fila.length) {
      const atual = fila.shift();
      const a = analise(atual);
      if (!a) continue;
      for (const alvo of importsDaRaiz(a, atual)) {
        if (permitidos.includes(alvo)) continue;
        violacoes.push(`${origem}: alcança import da raiz não permitido ${alvo} (${cadeia(atual)} → ${alvo})`);
      }
      for (const { especificador } of a.importacoes) {
        if (!RELATIVO.test(especificador)) continue;
        const alvo = resolverRelativo(especificador, atual);
        if (alvo === null) {
          violacoes.push(`${origem}: ${atual} importa ${especificador}, que não pôde ser resolvido`);
          continue;
        }
        if (!alvo.startsWith('app/') || pai.has(alvo)) continue;
        if (!textos.has(alvo) && !(existentes?.has(alvo))) {
          violacoes.push(`${origem}: ${atual} importa ${especificador}, que não resolve para um arquivo listado (${alvo})`);
          continue;
        }
        if (!textos.has(alvo)) continue;
        pai.set(alvo, atual);
        if (dentroDe(alvo, proibidos) && !alvo.startsWith(pastaOrigem)) {
          violacoes.push(`${origem}: alcança ${alvo}, pasta proibida (${cadeia(alvo)})`);
        }
        fila.push(alvo);
      }
    }
  }
  return violacoes;
}
