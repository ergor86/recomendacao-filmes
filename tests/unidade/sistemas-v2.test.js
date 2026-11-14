// Testes dos sistemas da v2 (Task 11): grade por cenário, nomes, chaves de simplicidade e a ordem que
// elas impõem à escolha, top 10 de S0 e S1, argumentos do script, conferência da FC150, posições do
// preenchimento, contribuições descritivas, MDE descritivo e lista da medida 4.
// Só dados sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherConfiguracao } from '../../src/avaliacao/escolha.js';
import {
  configuracoesDaGrade, nomeSistema, simplicidadeV2, top10S1, top10S0, lerArgumentosGrade,
  conferirFC150, posicoesDoPreenchimento, diferencaDescritiva, contribuicoesV2, mdeDescritivoV2,
  pedidosMedida4, dentroDe, ARQ_GRADE_OFICIAL, FRASE_OTIMISTA,
} from '../../src/avaliacao/sistemas-v2.js';

const perto = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

test('configuracoesDaGrade: 15 células sem (0, 0) no aprovado, só (150, 0) no reprovado, 4 com o corte', () => {
  const g = configuracoesDaGrade('aprovado');
  assert.equal(g.length, 15);
  assert.ok(!g.some(({ k, n }) => k === 0 && n === 0));
  assert.equal(new Set(g.map(({ k, n }) => `${k}-${n}`)).size, 15);
  for (const { k, n } of g) assert.ok([0, 50, 100, 150].includes(k) && [0, 50, 100, 150].includes(n));
  assert.deepEqual(configuracoesDaGrade('reprovado'), [{ k: 150, n: 0 }]);
  assert.deepEqual(configuracoesDaGrade('reprovado', { cortarOrcamentoVariavel: true }), [{ k: 150, n: 0 }]);
  assert.deepEqual(configuracoesDaGrade('aprovado', { cortarOrcamentoVariavel: true }),
    [{ k: 150, n: 0 }, { k: 100, n: 50 }, { k: 50, n: 100 }, { k: 0, n: 150 }]);
  assert.throws(() => configuracoesDaGrade('talvez'), /cenário/);
});

test('nomeSistema: S2, S3 e S4-k-n', () => {
  assert.equal(nomeSistema({ k: 150, n: 0 }), 'S2');
  assert.equal(nomeSistema({ k: 0, n: 150 }), 'S3');
  assert.equal(nomeSistema({ k: 50, n: 0 }), 'S4-50-0');
  assert.equal(nomeSistema({ k: 100, n: 150 }), 'S4-100-150');
});

test('simplicidadeV2: chaves da §8.4', () => {
  assert.deepEqual(simplicidadeV2('S1'), [0]);
  assert.deepEqual(simplicidadeV2('S2'), [1]);
  assert.deepEqual(simplicidadeV2('S0'), [2, 0, 0, 10, 10]);
  assert.deepEqual(simplicidadeV2('S3'), [2, 1, 150, 150, 0]);
  assert.deepEqual(simplicidadeV2('S4-100-50'), [2, 1, 50, 150, 100]);
  assert.throws(() => simplicidadeV2('S9'), /sistema/);
});

test('top10S1 e top10S0: os 10 primeiros, na mesma ordem', () => {
  assert.deepEqual(top10S1([9, 3, 7, 1, 2, 4, 5, 6, 8, 10, 11]), [9, 3, 7, 1, 2, 4, 5, 6, 8, 10]);
  assert.deepEqual(top10S0([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]), [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
});

// Todos empatam: a melhor (S4-150-150) difere das demais por 0,001 ± 0,1 alternados por usuário,
// média 0,001 bem abaixo do EP (~0,03); as demais são constantes 0,5.
function sistemaEmpatado(nome, melhor = false) {
  const porUsuario = new Map();
  for (let u = 1; u <= 10; u++) porUsuario.set(u, melhor ? 0.501 + (u % 2 ? 0.1 : -0.1) : 0.5);
  const media = [...porUsuario.values()].reduce((s, x) => s + x, 0) / 10;
  return { nome, porUsuario, porSemente: [media], simplicidade: simplicidadeV2(nome) };
}

test('ordem das chaves na escolha: S1, depois S2, depois S0, depois S4-50-0 antes de S3', () => {
  const casos = [
    [['S0', 'S1', 'S2', 'S3', 'S4-50-0'], 'S1'],
    [['S0', 'S2', 'S3', 'S4-50-0'], 'S2'],
    [['S0', 'S3', 'S4-50-0'], 'S0'],
    [['S3', 'S4-50-0'], 'S4-50-0'],
  ];
  for (const [nomes, esperado] of casos) {
    const configs = [...nomes.map((n) => sistemaEmpatado(n)), sistemaEmpatado('S4-150-150', true)];
    for (const ordem of [configs, [...configs].reverse()]) {
      const r = escolherConfiguracao(ordem);
      assert.equal(r.melhor, 'S4-150-150');
      assert.ok(r.tabela.every((t) => t.empata), `todos devem empatar (${nomes})`);
      assert.equal(r.escolhida, esperado);
    }
  }
});

test('lerArgumentosGrade: oficial sem opções; verificação com opções; recusa o arquivo oficial', () => {
  const oficial = lerArgumentosGrade([]);
  assert.equal(oficial.verificacao, false);
  assert.equal(oficial.saida, ARQ_GRADE_OFICIAL);
  assert.equal(oficial.dirModelos, 'modelos');
  assert.equal(oficial.maxEpocas, 50);
  assert.equal(oficial.somente, null);
  assert.equal(lerArgumentosGrade(['--cortar-orcamento-variavel']).cortarOrcamentoVariavel, true);
  assert.equal(lerArgumentosGrade(['--cortar-orcamento-variavel']).verificacao, false);

  const v = lerArgumentosGrade(['--somente', '150-0,0-150', '--max-epocas', '1', '--saida', 'tmp/g.json', '--dir-modelos', 'tmp/m']);
  assert.equal(v.verificacao, true);
  assert.deepEqual(v.somente, [{ k: 150, n: 0 }, { k: 0, n: 150 }]);
  assert.equal(v.maxEpocas, 1);
  assert.equal(v.saida, 'tmp/g.json');
  assert.equal(v.dirModelos, 'tmp/m');

  assert.throws(() => lerArgumentosGrade(['--max-epocas', '1']), /não é a grade oficial/);
  assert.throws(() => lerArgumentosGrade(['--somente', '150-0', '--saida', './resultados/grade-v2-exp.json']), /não é a grade oficial/);
  assert.throws(() => lerArgumentosGrade(['--saida', 'x.json', '--dir-modelos', 'modelos']), /modelos/);
  assert.throws(() => lerArgumentosGrade(['--somente', '0-0', '--saida', 'x.json']), /0-0/);
  assert.throws(() => lerArgumentosGrade(['--max-epocas', '0', '--saida', 'x.json']), /max-epocas/);
  assert.throws(() => lerArgumentosGrade(['--outra']), /desconhecid/);
});

test('conferirFC150: tamanho 150 e contenção dos top 10 de S1 e S3', () => {
  const fc = Array.from({ length: 150 }, (_, i) => i + 1);
  const fc150 = new Map([[1, fc], [2, fc]]);
  const ok = new Map([[1, fc.slice(0, 10)], [2, fc.slice(5, 15)]]);
  conferirFC150(fc150, [1, 2], ok, [ok, ok, ok]);
  assert.throws(() => conferirFC150(new Map([[1, fc.slice(0, 149)], [2, fc]]), [1, 2], ok, [ok]), /150/);
  assert.throws(() => conferirFC150(fc150, [1, 3], ok, [ok]), /usuário 3/);
  const fora = new Map([[1, [...fc.slice(0, 9), 999]], [2, fc.slice(0, 10)]]);
  assert.throws(() => conferirFC150(fc150, [1, 2], ok, [ok, fora]), /S3.*999/);
  assert.throws(() => conferirFC150(fc150, [1, 2], fora, [ok]), /S1.*999/);
});

test('posicoesDoPreenchimento: total de posições e usuários afetados', () => {
  const top10 = new Map([[1, [1, 2, 3]], [2, [4, 5, 6]], [3, [7, 8, 9]]]);
  const fontes = new Map([
    [1, new Map([[1, 'fc'], [2, 'preenchimento'], [3, 'preenchimento']])],
    [2, new Map([[4, 'pop'], [5, 'fc'], [6, 'fc']])],
    [3, new Map([[7, 'preenchimento'], [8, 'fc'], [9, 'fc']])],
  ]);
  assert.deepEqual(posicoesDoPreenchimento(top10, fontes), { posicoes: 3, usuarios: 2, nUsuarios: 3 });
  assert.throws(() => posicoesDoPreenchimento(new Map([[1, [42]]]), fontes), /42/);
});

test('diferencaDescritiva: média, EP e IC de a − b, rotulada descritiva', () => {
  const a = new Map([[1, 0.5], [2, 0.7], [3, 0.2], [4, 0.4]]);
  const b = new Map([[1, 0.4], [2, 0.7], [3, 0.1], [4, 0.6]]);
  const d = diferencaDescritiva(a, b);
  assert.ok(perto(d.media, 0.0)); // 0,1 + 0 + 0,1 − 0,2 = 0
  assert.equal(d.rotulo, 'descritiva');
  assert.equal(d.nUsuarios, 4);
  assert.ok(d.erroPadrao > 0);
  assert.equal(d.ic95.length, 2);
  assert.throws(() => diferencaDescritiva(a, new Map([[1, 0]])), /usuários/);
});

test('contribuicoesV2: as cinco contas; melhores escolhidos pela média; não rodadas com o motivo', () => {
  const sis = (v) => new Map([[1, v + 0.1], [2, v - 0.1], [3, v]]);
  const porUsuario = new Map([
    ['S0', sis(0.1)], ['S1', sis(0.4)], ['S2', sis(0.3)], ['S3', sis(0.35)],
    ['S4-100-50', sis(0.38)], ['S4-50-100', sis(0.33)], ['S4-50-0', sis(0.45)],
  ]);
  const c = contribuicoesV2(porUsuario, { motivoAusente: 'não rodada: portão reprovado' });
  assert.ok(perto(c['S1 - S0'].media, 0.3));
  assert.ok(perto(c['S3 - S1'].media, -0.05));
  assert.equal(c['melhor de (100, 50), (50, 100), (0, 150) - S2'].melhor, 'S4-100-50');
  assert.ok(perto(c['melhor de (100, 50), (50, 100), (0, 150) - S2'].media, 0.08));
  assert.equal(c['melhor S4 - S3'].melhor, 'S4-50-0');
  assert.ok(perto(c['melhor S4 - S3'].media, 0.1));
  assert.equal(c['melhor S4 - S2'].melhor, 'S4-50-0');
  for (const v of Object.values(c)) assert.equal(v.rotulo, 'descritiva');

  const reprovado = contribuicoesV2(new Map([['S0', sis(0.1)], ['S1', sis(0.4)], ['S2', sis(0.3)]]), { motivoAusente: 'não rodada: portão reprovado' });
  assert.ok(perto(reprovado['S1 - S0'].media, 0.3));
  for (const k of ['S3 - S1', 'melhor de (100, 50), (50, 100), (0, 150) - S2', 'melhor S4 - S3', 'melhor S4 - S2']) {
    assert.equal(reprovado[k], 'não rodada: portão reprovado');
  }
});

test('mdeDescritivoV2: σ e ganho sob subamostragem (q = 1 mantém tudo)', () => {
  // Relevante {1} para todos; v2 acerta na 1ª posição nos usuários pares, v1 nunca.
  const relevantes = new Map();
  const v2 = new Map();
  const v1 = new Map();
  const outros = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let u = 1; u <= 6; u++) {
    relevantes.set(u, new Set([1]));
    v2.set(u, u % 2 === 0 ? [1, ...outros] : [11, ...outros]);
    v1.set(u, [11, ...outros]);
  }
  const r = mdeDescritivoV2({ top10V2: [v2], top10V1: [v1, v1, v1], relevantes, q: 1, nt: 100 });
  assert.equal(r.sigmaPorRepeticao.length, 20);
  assert.deepEqual(r.nPorRepeticao, Array(20).fill(6));
  assert.ok(perto(r.ganhoSobSubamostragem, 0.5));
  const sigma = Math.sqrt((6 * 0.25) / 5);
  assert.ok(perto(r.sigmaD, sigma));
  assert.ok(perto(r.mde, (1.959963985 + 0.841621234) * sigma / 10, 1e-6));
  assert.equal(r.otimista, true);
  assert.equal(r.nota, FRASE_OTIMISTA);
  assert.equal(FRASE_OTIMISTA, 'escolha e parada usam a validação; não é estimativa imparcial');
});

test('pedidosMedida4: S3 e v2 no aprovado, só v2 no reprovado; v2 sai se for S0 ou S1', () => {
  assert.deepEqual(pedidosMedida4('aprovado', 'S4-100-50'), ['S3', 'v2']);
  assert.deepEqual(pedidosMedida4('aprovado', 'S1'), ['S3']);
  assert.deepEqual(pedidosMedida4('aprovado', 'S0'), ['S3']);
  assert.deepEqual(pedidosMedida4('reprovado', 'S2'), ['v2']);
  assert.deepEqual(pedidosMedida4('reprovado', 'S1'), []);
});

test('lerArgumentosGrade recusa qualquer arquivo em resultados/ e qualquer pasta em modelos/', () => {
  const ok = ['--dir-modelos', 'tmp/m'];
  for (const saida of ['resultados/mde-v2.json', 'resultados/portao-fc-v2-exp.json', 'resultados/sub/x.json', 'resultados']) {
    assert.throws(() => lerArgumentosGrade(['--saida', saida, ...ok]), /fora de resultados/, saida);
  }
  for (const dir of ['modelos/sub', 'modelos/v2-150-0-v2-exp-s1']) {
    assert.throws(() => lerArgumentosGrade(['--saida', 'tmp/g.json', '--dir-modelos', dir]), /fora de modelos/, dir);
  }
  // Nomes que só começam igual não estão dentro.
  assert.equal(lerArgumentosGrade(['--saida', 'resultados-tmp/g.json', '--dir-modelos', 'modelos-tmp']).verificacao, true);
});

test('dentroDe: variantes de maiúsculas contam no Windows', () => {
  assert.equal(dentroDe('resultados', 'Resultados/grade-v2-exp.json', 'win32'), true);
  assert.equal(dentroDe('resultados', 'RESULTADOS/Grade-V2-Exp.json', 'win32'), true);
  assert.equal(dentroDe('modelos', 'Modelos', 'win32'), true);
  assert.equal(dentroDe('modelos', 'MODELOS/x', 'win32'), true);
  assert.equal(dentroDe('modelos', 'modelos2', 'win32'), false);
  assert.equal(dentroDe('modelos', '../modelos', 'win32'), false);
  if (process.platform === 'win32') {
    assert.throws(() => lerArgumentosGrade(['--saida', 'Resultados/grade-v2-exp.json', '--dir-modelos', 'tmp/m']), /fora de resultados/);
    assert.throws(() => lerArgumentosGrade(['--saida', 'tmp/g.json', '--dir-modelos', 'Modelos']), /fora de modelos/);
  }
});
