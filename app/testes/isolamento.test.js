import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analisarFonte, importsDaRaiz, PROIBIDOS_RAIZ } from './apoio-isolamento.js';
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
    else if (EXT.test(e.name)) out.push(rel);
  }
  return out;
}
const arquivos = listar('app').map((rel) => ({ rel, texto: readFileSync(path.join(raiz, rel), 'utf8') }));
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
  const a = analisarFonte(texto);
  for (const { especificador } of a.importacoes) {
    if (/^@tensorflow\//.test(especificador)) v.push(`${rel}: importa ${especificador}`);
  }
  const permitidos = permitidosPara(rel);
  for (const alvo of importsDaRaiz(a, rel, path)) {
    if (permitidos.includes(alvo)) continue;
    const sempre = PROIBIDOS_RAIZ.some((r) => r.test(alvo));
    v.push(`${rel}: import da raiz não permitido: ${alvo}${sempre ? ' (proibido)' : ''}`);
  }
  return v;
}

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

  test('imports dentro de app/ e pacotes não contam como raiz', () => {
    const texto = "import a from '../comum/estado.js'; import b from 'pg'; import c from 'node:fs';";
    assert.deepEqual(violacoesImports('app/servidor/x.js', texto), []);
  });

  test('os padrões de strings proibidas detectam o que devem e poupam a prosa', () => {
    const casos = [`x = '${INCLUIR}2'`, NOMES_PROIBIDOS[0], NOMES_PROIBIDOS[1], "'x.test'", NOMES_PROIBIDOS[6], NOMES_PROIBIDOS[7], "'ua.base'"];
    for (const c of casos) assert.ok(PADROES_PRODUCAO.some(([, re]) => re.test(c)), c);
    assert.ok(!PADROES_PRODUCAO.some(([, re]) => re.test('o filme continua. Atua. Aqui.')));
  });
});

test('isolamento: sem import() dinâmico não literal', () => {
  const ruins = arquivos.filter((a) => analisarFonte(a.texto).dinamicosNaoLiterais > 0).map((a) => a.rel);
  assert.deepEqual(ruins, []);
});

test('isolamento: sem create' + 'Require', () => {
  const ruins = arquivos
    .filter((a) => {
      const r = analisarFonte(a.texto);
      return r.criaRequire || r.usaRequire;
    })
    .map((a) => a.rel);
  assert.deepEqual(ruins, []);
});

test('isolamento: imports da raiz só os permitidos', () => {
  assert.deepEqual(arquivos.flatMap((a) => violacoesImports(a.rel, a.texto)), []);
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
  const a = analisarFonte(arquivos.find((x) => x.rel === FIXTURE).texto);
  assert.deepEqual(a.importacoes, []);
  assert.equal(a.dinamicosNaoLiterais, 0);
  assert.equal(a.criaRequire || a.usaRequire, false);
  assert.deepEqual(a.exportados, ['NOMES_PROIBIDOS']);
});

test('isolamento: recomendacao não importa midia', () => {
  const alvosMidia = (rel, texto) =>
    analisarFonte(texto)
      .importacoes.filter((i) => i.especificador.startsWith('.'))
      .map((i) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), i.especificador)))
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
