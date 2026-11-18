import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analisarFonte, especificadoresAbsolutos, especificadoresInvalidos, importsDaRaiz, PROIBIDOS_RAIZ, resolverRelativo,
  violacoesDeFecho,
} from './apoio-isolamento.js';
import { NOMES_PROIBIDOS } from './fixtures/nomes-proibidos.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = execFileSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const FIXTURE = 'app/testes/fixtures/nomes-proibidos.js';

// ---- permissões de import da raiz, por pasta (§10.1 e §10.3 + rulings do controlador) ----
const POPULARES = 'src/candidatos/populares.js';
const REFERENCIA = 'src/fc/referencia.js';
const BUSCA_FC = 'src/banco/busca-fc.js';
// a pasta mais específica vence: a lista vai do específico ao geral
const PERMISSOES = [
  ['app/servidor/', [BUSCA_FC, REFERENCIA, POPULARES]],
  ['app/preparar/', ['src/contexto.js', 'src/dados/download.js', REFERENCIA, POPULARES]],
  ['app/comum/', [REFERENCIA, POPULARES]],
  ['app/web/src/', []],
  ['app/testes/referencia/', ['src/contexto.js', 'src/avaliacao/fidelidade.js', REFERENCIA, POPULARES, BUSCA_FC]],
  ['app/testes/determinismo/', ['src/contexto.js', 'src/util/hash-avaliacoes.js', REFERENCIA, POPULARES, BUSCA_FC]],
  ['app/testes/', []], // demais testes: nada da raiz
  ['app/', []], // qualquer outro arquivo de app/
];
const permitidosPara = (rel) => PERMISSOES.find(([pasta]) => rel.startsWith(pasta))[1];

// ---- varredura de app/ (menos node_modules e dist) ----
const EXT = /\.(js|jsx|mjs|cjs)$/;
// TypeScript não é analisado: a presença de qualquer arquivo assim faz um teste falhar
const EXT_TS = /\.(ts|tsx|mts|cts)$/;
function listarTodos(dirRel) {
  const out = [];
  let ents = [];
  try {
    ents = readdirSync(path.join(raiz, dirRel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const rel = `${dirRel}/${e.name}`;
    if (e.isDirectory()) out.push(...listarTodos(rel));
    else out.push(rel);
  }
  return out;
}
function listar(dirRel) {
  const out = [];
  let ents = [];
  try {
    ents = readdirSync(path.join(raiz, dirRel), { withFileTypes: true });
  } catch {
    return out; // pasta ainda não existe
  }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const rel = `${dirRel}/${e.name}`;
    if (e.isDirectory()) out.push(...listar(rel));
    else if (EXT.test(e.name) || EXT_TS.test(e.name)) out.push(rel);
  }
  return out;
}
const todosOsArquivos = listarTodos('app');
const todos = listar('app').map((rel) => ({ rel, texto: readFileSync(path.join(raiz, rel), 'utf8') }));
const arquivosTs = todos.filter((a) => EXT_TS.test(a.rel));
const arquivos = todos.filter((a) => EXT.test(a.rel));
// cada arquivo é analisado uma vez; o que não puder ser analisado é acusado por um teste próprio
for (const a of arquivos) {
  try {
    a.analise = analisarFonte(a.texto, a.rel);
  } catch (e) {
    a.erro = e.message;
  }
}
const analisaveis = arquivos.filter((a) => a.analise);
const emPastas = (pastas) => arquivos.filter((a) => pastas.some((p) => a.rel.startsWith(p)));
const ehTesteJsx = (a) => a.rel.endsWith('.test.jsx');

// as strings proibidas são montadas por concatenação para que este arquivo não as contenha
const INCLUIR = 'incluir' + 'Teste';
const PADROES_PRODUCAO = [
  [INCLUIR, new RegExp(INCLUIR)],
  ['u1.' + 'test', /u1\.test/],
  ['u.' + 'data', /u\.data/],
  ['.test' + "'", new RegExp('\\.test' + "'")],
  // `ua.` e `ub.` como início de nome de arquivo, não dentro de palavras como "continua."
  ['ua.', /(?<![\w])ua\./],
  ['ub.', /(?<![\w])ub\./],
];

function violacoesImports(rel, texto) {
  const v = [];
  const a = analisarFonte(texto, rel);
  for (const { especificador } of a.importacoes) {
    if (/^@tensorflow\//.test(especificador)) v.push(`${rel}: importa ${especificador}`);
  }
  const permitidos = permitidosPara(rel);
  for (const alvo of importsDaRaiz(a, rel)) {
    if (permitidos.includes(alvo)) continue;
    const sempre = PROIBIDOS_RAIZ.some((r) => r.test(alvo));
    v.push(`${rel}: import da raiz não permitido: ${alvo}${sempre ? ' (proibido)' : ''}`);
  }
  return v;
}

const ORIGENS_FECHO = ['app/servidor/', 'app/comum/'];
const PROIBIDOS_FECHO = ['app/preparar/', 'app/testes/'];
const violacoesFecho = (textos, existentes = new Set()) =>
  violacoesDeFecho({
    textos, origens: ORIGENS_FECHO, proibidos: PROIBIDOS_FECHO, permitidosPara,
    existentes,
  });
const violacoesAbsolutos = (rel, texto) =>
  especificadoresAbsolutos(analisarFonte(texto, rel)).map((e) => `${rel}: especificador absoluto ${e}`);

describe('isolamento: verificador (textos sintéticos)', () => {
  test('detecta import() não literal e aceita o literal', () => {
    assert.equal(analisarFonte('const m = await import(nome);').dinamicosNaoLiterais, 1);
    assert.equal(analisarFonte('const m = await import("a" + b);').dinamicosNaoLiterais, 1);
    const ok = analisarFonte('const m = await import("./x.js");');
    assert.equal(ok.dinamicosNaoLiterais, 0);
    assert.deepEqual(ok.importacoes, [{ tipo: 'dinamico', especificador: './x.js' }]);
  });

  test('detecta criação de require e uso de require', () => {
    const CR = 'create' + 'Require';
    assert.equal(analisarFonte(`import { ${CR} } from 'node:module';`).criaRequire, true);
    assert.equal(analisarFonte("const x = req" + "uire('y');").usaRequire, true);
    assert.equal(analisarFonte("import x from 'y';").criaRequire, false);
    assert.equal(analisarFonte("import x from 'y';").usaRequire, false);
  });

  test('detecta export … from', () => {
    const a = analisarFonte("export { a } from '../../src/modelo/rede.js';\nexport * from './b.js';");
    assert.deepEqual(a.importacoes, [
      { tipo: 'export-from', especificador: '../../src/modelo/rede.js' },
      { tipo: 'export-from', especificador: './b.js' },
    ]);
  });

  test('detecta import proibido e import da raiz fora da lista', () => {
    const v = violacoesImports('app/servidor/x.js', "import { f } from '../../src/modelo/rede.js';");
    assert.equal(v.length, 1);
    assert.match(v[0], /src\/modelo\/rede\.js \(proibido\)/);
    assert.equal(violacoesImports('app/servidor/x.js', "import { f } from '../../src/dados/leitura.js';").length, 1);
    assert.equal(violacoesImports('app/servidor/x.js', "import * as tf from '@tensorflow/tfjs';").length, 1);
    assert.equal(violacoesImports('app/servidor/x.js', "export { f } from '../../src/contexto.js';").length, 1);
    assert.equal(violacoesImports('app/web/src/x.js', "import { f } from '../../../src/fc/referencia.js';").length, 1);
  });

  test('aceita o que a pasta permite e nega fora dela', () => {
    assert.deepEqual(violacoesImports('app/servidor/x.js', "import { f } from '../../src/fc/referencia.js';"), []);
    assert.deepEqual(violacoesImports('app/comum/x.js', "import { f } from '../../src/candidatos/populares.js';"), []);
    assert.deepEqual(violacoesImports('app/preparar/x.js', "import { f } from '../../src/dados/download.js';"), []);
    assert.equal(violacoesImports('app/comum/x.js', "import { f } from '../../src/banco/busca-fc.js';").length, 1);
    assert.deepEqual(
      violacoesImports('app/testes/referencia/x.js', "import { f } from '../../../src/avaliacao/fidelidade.js';"),
      [],
    );
    assert.equal(
      violacoesImports('app/testes/referencia/x.js', "import { f } from '../../../src/avaliacao/metricas.js';").length,
      1,
    );
    assert.deepEqual(
      violacoesImports('app/testes/determinismo/x.js', "import { f } from '../../../src/util/hash-avaliacoes.js';"),
      [],
    );
    assert.equal(violacoesImports('app/testes/unidade/x.js', "import { f } from '../../../src/contexto.js';").length, 1);
  });

  test('JSX: o import depois do JSX é detectado (o lexer sozinho errava)', () => {
    const texto = ['import x from "y"; export const A = () => (<div>{1}</div>);', 'import z from "../../../src/modelo/rede.js";'].join('\n');
    assert.deepEqual(
      analisarFonte(texto, 'app/web/src/A.jsx').importacoes.map((i) => i.especificador),
      ['y', '../../../src/modelo/rede.js'],
    );
    const antes = ['const a = <div/>;', 'import z from "../../../src/contexto.js";'].join('\n');
    assert.deepEqual(analisarFonte(antes, 'app/web/src/B.jsx').importacoes.map((i) => i.especificador), [
      '../../../src/contexto.js',
    ]);
  });

  test('JSX: import proibido num .jsx é acusado; import() não literal também', () => {
    const texto = ['export const A = () => <p/>;', 'export { f } from "../../../src/modelo/rede.js";'].join('\n');
    const v = violacoesImports('app/web/src/A.jsx', texto);
    assert.equal(v.length, 1);
    assert.match(v[0], /src\/modelo\/rede\.js \(proibido\)/);
    assert.equal(analisarFonte('export const A = () => <p>{import(nome)}</p>;', 'app/web/src/C.jsx').dinamicosNaoLiterais, 1);
  });

  test('arquivo não analisável vira erro claro, nunca é ignorado', () => {
    assert.throws(() => analisarFonte('const = <div', 'app/web/src/D.jsx'), /app\/web\/src\/D\.jsx não analisável: /);
    assert.throws(() => analisarFonte('import {', 'app/servidor/x.js'), /app\/servidor\/x\.js não analisável: /);
  });

  test('imports dentro de app/ e pacotes não contam como raiz', () => {
    const texto = "import a from '../comum/estado.js'; import b from 'pg'; import c from 'node:fs';";
    assert.deepEqual(violacoesImports('app/servidor/x.js', texto), []);
  });

  test('fecho: a cadeia servidor → preparar → src/contexto.js é acusada', () => {
    const v = violacoesFecho(new Map([
      ['app/servidor/a.js', "import p from '../preparar/p.js';"],
      ['app/preparar/p.js', "import c from '../../src/contexto.js';"],
    ]));
    assert.ok(v.some((x) => x.includes('app/servidor/a.js: alcança app/preparar/p.js, pasta proibida')), v.join('\n'));
    assert.ok(v.some((x) => x.includes('src/contexto.js') && x.includes('app/servidor/a.js → app/preparar/p.js')), v.join('\n'));
  });

  test('fecho: transitivo por vários saltos e por testes/', () => {
    const v = violacoesFecho(new Map([
      ['app/comum/a.js', "import b from './b.js';"],
      ['app/comum/b.js', "import t from '../testes/apoio.js';"],
      ['app/testes/apoio.js', "import m from '../../src/modelo/rede.js';"],
    ]));
    assert.ok(v.some((x) => x.includes('alcança app/testes/apoio.js, pasta proibida')));
    assert.ok(v.some((x) => x.includes('src/modelo/rede.js')));
  });

  test('fecho: o que é permitido passa, inclusive servidor → comum → populares', () => {
    assert.deepEqual(violacoesFecho(new Map([
      ['app/servidor/a.js', "import c from '../comum/c.js'; import r from '../../src/fc/referencia.js';"],
      ['app/comum/c.js', "import p from '../../src/candidatos/populares.js'; import e from './d.js';"],
      ['app/comum/d.js', "import pg from 'pg';"],
    ])), []);
  });

  test('fecho: busca-fc só vale na origem que a permite (servidor sim, comum não)', () => {
    const textos = (origem) => new Map([[`app/${origem}/a.js`, "import b from '../../src/banco/busca-fc.js';"]]);
    assert.deepEqual(violacoesFecho(textos('servidor')), []);
    assert.equal(violacoesFecho(textos('comum')).length, 1);
  });

  test('especificador absoluto é acusado (POSIX, Windows e file:)', () => {
    assert.equal(violacoesAbsolutos('app/servidor/x.js', "import a from '/etc/x.js';").length, 1);
    assert.equal(violacoesAbsolutos('app/servidor/x.js', "import a from 'C:\\\\dev\\\\x.js';").length, 1);
    assert.equal(violacoesAbsolutos('app/servidor/x.js', "import a from 'C:/dev/x.js';").length, 1);
    assert.equal(violacoesAbsolutos('app/servidor/x.js', "import a from 'file:///c:/x.js';").length, 1);
    assert.deepEqual(violacoesAbsolutos('app/servidor/x.js', "import a from './x.js'; import b from 'node:fs'; import c from 'pg';"), []);
  });

  test('fecho: barra invertida e percent-encoding não escondem preparar/', () => {
    const casos = [
      "import y from './..\\\\preparar\\\\y.js';",
      "import y from './%2e%2e/%70reparar/x.js';",
      "import y from '../preparar/../preparar/x.js';",
    ];
    for (const texto of casos) {
      const v = violacoesFecho(new Map([['app/servidor/a.js', texto], ['app/preparar/y.js', ''], ['app/preparar/x.js', '']]));
      assert.ok(v.some((x) => x.includes('pasta proibida')), texto + ' => ' + v.join('|'));
    }
  });

  test('fecho: relativo que não resolve para arquivo listado é acusado', () => {
    const v = violacoesFecho(new Map([['app/servidor/a.js', "import y from './nao-existe.js';"]]));
    assert.equal(v.length, 1);
    assert.ok(v[0].includes('não resolve para um arquivo listado'));
    const ruim = violacoesFecho(new Map([['app/servidor/a.js', "import y from './%E0%A4%A.js';"]]));
    assert.ok(ruim[0].includes('não pôde ser resolvido'));
    assert.deepEqual(violacoesFecho(new Map([['app/servidor/a.js', "import d from './d.json';"]]), new Set(['app/servidor/d.json'])), []);
  });

  test('resolverRelativo e especificadores aceitos', () => {
    assert.equal(resolverRelativo('./..\\preparar\\y.js', 'app/servidor/a.js'), 'app/preparar/y.js');
    assert.equal(resolverRelativo('./%2e%2e/%70reparar/x.js', 'app/servidor/a.js'), 'app/preparar/x.js');
    assert.equal(resolverRelativo('../../src/contexto.js', 'app/servidor/a.js'), 'src/contexto.js');
    assert.equal(resolverRelativo('pg', 'app/servidor/a.js'), null);
    const ruins = (texto) => especificadoresInvalidos(analisarFonte(texto, 'app/servidor/x.js'));
    assert.deepEqual(ruins("import a from './x.js'; import b from '../y.js'; import c from 'node:fs'; import d from 'pg'; import e from '@scope/pkg/sub';"), []);
    for (const e of ['data:text/javascript,1', 'http://x.org/a.js', 'https://x.org/a.js', 'node:../x', 'a%5Cb','%2e%2e/x.js']) {
      assert.deepEqual(ruins(`import a from '${e}';`), [e], e);
    }
  });

  test('os padrões de strings proibidas detectam o que devem e poupam a prosa', () => {
    const casos = [`x = '${INCLUIR}2'`, NOMES_PROIBIDOS[0], NOMES_PROIBIDOS[1], "'x.test'", NOMES_PROIBIDOS[6], NOMES_PROIBIDOS[7], "'ua.base'"];
    for (const c of casos) assert.ok(PADROES_PRODUCAO.some(([, re]) => re.test(c)), c);
    assert.ok(!PADROES_PRODUCAO.some(([, re]) => re.test('o filme continua. Atua. Aqui.')));
  });
});

test('isolamento: todos os arquivos são analisáveis e não há TypeScript', () => {
  assert.deepEqual(
    arquivos.filter((a) => a.erro).map((a) => a.erro),
    [],
  );
  assert.deepEqual(
    arquivosTs.map((a) => `${a.rel}: TypeScript não é analisado pelo verificador`),
    [],
  );
});

test('isolamento: sem import() dinâmico não literal', () => {
  const ruins = analisaveis.filter((a) => a.analise.dinamicosNaoLiterais > 0).map((a) => a.rel);
  assert.deepEqual(ruins, []);
});

test('isolamento: sem create' + 'Require', () => {
  const ruins = analisaveis.filter((a) => a.analise.criaRequire || a.analise.usaRequire).map((a) => a.rel);
  assert.deepEqual(ruins, []);
});

test('isolamento: imports da raiz só os permitidos', () => {
  assert.deepEqual(analisaveis.flatMap((a) => violacoesImports(a.rel, a.texto)), []);
});

test('isolamento: todos os especificadores de app/ são interpretáveis (./, ../, node: ou pacote)', () => {
  assert.deepEqual(analisaveis.flatMap((a) => especificadoresInvalidos(a.analise).map((e) => `${a.rel}: ${e}`)), []);
});

test('isolamento: nenhum especificador absoluto em app/', () => {
  assert.deepEqual(analisaveis.flatMap((a) => violacoesAbsolutos(a.rel, a.texto)), []);
});

test('isolamento: servidor/ e comum/ não alcançam preparar/ nem testes/ e o fecho respeita as permissões', () => {
  assert.deepEqual(violacoesFecho(new Map(arquivos.map((a) => [a.rel, a.texto])), new Set(todosOsArquivos)), []);
});

test('isolamento: strings proibidas ausentes no código de produção', () => {
  const prod = emPastas(['app/servidor/', 'app/preparar/', 'app/comum/', 'app/web/src/']).filter((a) => !ehTesteJsx(a));
  const achados = [];
  for (const a of prod) for (const [nome, re] of PADROES_PRODUCAO) if (re.test(a.texto)) achados.push(`${a.rel}: ${nome}`);
  assert.deepEqual(achados, []);
});

test('isolamento: nos testes, nomes proibidos só no fixture declarado', () => {
  const testes = arquivos.filter((a) => a.rel.startsWith('app/testes/') || ehTesteJsx(a));
  const achados = [];
  for (const a of testes) {
    if (a.texto.includes(INCLUIR)) achados.push(`${a.rel}: ${INCLUIR}`);
    if (a.rel === FIXTURE) continue;
    for (const nome of NOMES_PROIBIDOS) if (a.texto.includes(nome)) achados.push(`${a.rel}: ${nome}`);
  }
  assert.deepEqual(achados, []);
  assert.equal(NOMES_PROIBIDOS.length, 8);
  assert.equal(new Set(NOMES_PROIBIDOS).size, 8);
  const formato = new RegExp('^(u[1-5ab]\\.test|u\\.da' + 'ta)$');
  assert.ok(NOMES_PROIBIDOS.every((n) => formato.test(n)));
});

test('isolamento: o fixture não lê arquivos', () => {
  const a = analisarFonte(arquivos.find((x) => x.rel === FIXTURE).texto, FIXTURE);
  assert.deepEqual(a.importacoes, []);
  assert.equal(a.dinamicosNaoLiterais, 0);
  assert.equal(a.criaRequire || a.usaRequire, false);
  assert.deepEqual(a.exportados, ['NOMES_PROIBIDOS']);
});

test('isolamento: recomendacao não importa midia', () => {
  const alvosMidia = (rel, texto) =>
    analisarFonte(texto, rel)
      .importacoes.map((i) => resolverRelativo(i.especificador, rel))
      .filter(Boolean)
      .filter((alvo) => alvo === 'app/servidor/midia' || alvo.startsWith('app/servidor/midia/'));
  // o verificador, sobre texto sintético
  assert.deepEqual(alvosMidia('app/servidor/recomendacao/s1.js', "import m from '../midia/index.js';"), [
    'app/servidor/midia/index.js',
  ]);
  assert.deepEqual(alvosMidia('app/servidor/recomendacao/s1.js', "import m from '../comum/x.js';"), []);
  // o código real
  const ruins = emPastas(['app/servidor/recomendacao/']).flatMap((a) => alvosMidia(a.rel, a.texto).map((t) => `${a.rel}: ${t}`));
  assert.deepEqual(ruins, []);
});
