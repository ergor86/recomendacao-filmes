// Testes do congelamento da v2 (spec §9.1): conferência por git com um git falso (função que responde
// por argumentos), sha256 de arquivos, montagem do congelamento a partir da grade e regra do --desvio.
// Só dados sintéticos; nenhum git real nem dado do MovieLens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  commitAtualLimpo, conferirCongelamento, gitSemDiferenca, sha256Arquivos, montarCongelamento, aplicarDesvio, RESSALVA,
  conferirPermissaoCongelar,
} from '../../src/congelamento/git.js';

const COMMIT = 'a'.repeat(40);
const ARQ = 'resultados/configuracao-v2.json';

// Erro como o do execFileSync quando o git sai com código diferente de zero.
function erroGit(status) {
  const e = new Error(`git saiu com código ${status}`);
  e.status = status;
  return e;
}

// Git falso de um repositório congelado corretamente; `mudar` sobrescreve respostas por argumentos.
function gitFalso(mudar = {}) {
  const respostas = {
    'status --porcelain': '',
    'rev-parse HEAD': 'b'.repeat(40),
    [`ls-files --error-unmatch ${ARQ}`]: ARQ,
    [`diff --quiet HEAD -- ${ARQ}`]: '',
    [`merge-base --is-ancestor ${COMMIT} HEAD`]: '',
    [`diff --quiet ${COMMIT} HEAD -- src scripts package.json package-lock.json`]: '',
    [`log --format=%H ${COMMIT}..HEAD -- ${ARQ}`]: 'c'.repeat(40),
    ...mudar,
  };
  const chamadas = [];
  const git = (args) => {
    const chave = args.join(' ');
    chamadas.push(chave);
    if (!(chave in respostas)) throw new Error(`git falso: comando inesperado "${chave}"`);
    const r = respostas[chave];
    if (r instanceof Error) throw r;
    return r;
  };
  git.chamadas = chamadas;
  return git;
}

test('commitAtualLimpo devolve o HEAD com a árvore limpa e recusa árvore suja', () => {
  assert.equal(commitAtualLimpo({ git: gitFalso() }), 'b'.repeat(40));
  assert.throws(() => commitAtualLimpo({ git: gitFalso({ 'status --porcelain': ' M src/x.js' }) }), /árvore de trabalho não está limpa/);
});

test('gitSemDiferenca: código 0 → true, código 1 → false, outro código → erro', () => {
  assert.equal(gitSemDiferenca(['diff', '--quiet', 'HEAD', '--', ARQ], gitFalso()), true);
  assert.equal(gitSemDiferenca(['diff', '--quiet', 'HEAD', '--', ARQ], gitFalso({ [`diff --quiet HEAD -- ${ARQ}`]: erroGit(1) })), false);
  assert.throws(() => gitSemDiferenca(['diff', '--quiet', 'HEAD', '--', ARQ], gitFalso({ [`diff --quiet HEAD -- ${ARQ}`]: erroGit(128) })), /128/);
});

test('conferirCongelamento aceita um commit só em resultados/ que não toca o congelamento', () => {
  // HEAD = commit do hash das previsões (só resultados/); o congelamento foi alterado por um único commit.
  const git = gitFalso();
  assert.doesNotThrow(() => conferirCongelamento({ commitCodigo: COMMIT, git }));
  assert.ok(git.chamadas.includes(`log --format=%H ${COMMIT}..HEAD -- ${ARQ}`));
});

test('conferirCongelamento recusa árvore suja', () => {
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: gitFalso({ 'status --porcelain': '?? lixo.txt' }) }), /árvore de trabalho não está limpa/);
});

test('conferirCongelamento recusa congelamento não versionado ou alterado em relação ao HEAD', () => {
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: gitFalso({ [`ls-files --error-unmatch ${ARQ}`]: erroGit(1) }) }), /não está versionado/);
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: gitFalso({ [`diff --quiet HEAD -- ${ARQ}`]: erroGit(1) }) }), /difere do HEAD/);
});

test('conferirCongelamento recusa commitCodigo que não é ancestral do HEAD', () => {
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: gitFalso({ [`merge-base --is-ancestor ${COMMIT} HEAD`]: erroGit(1) }) }), /não é ancestral/);
});

test('conferirCongelamento recusa código alterado depois do congelamento', () => {
  const git = gitFalso({ [`diff --quiet ${COMMIT} HEAD -- src scripts package.json package-lock.json`]: erroGit(1) });
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git }), /código mudou/);
});

test('conferirCongelamento recusa dois commits tocando o congelamento depois de commitCodigo (e nenhum)', () => {
  const dois = gitFalso({ [`log --format=%H ${COMMIT}..HEAD -- ${ARQ}`]: `${'d'.repeat(40)}\n${'c'.repeat(40)}` });
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: dois }), /exatamente um commit.*2/s);
  const nenhum = gitFalso({ [`log --format=%H ${COMMIT}..HEAD -- ${ARQ}`]: '' });
  assert.throws(() => conferirCongelamento({ commitCodigo: COMMIT, git: nenhum }), /exatamente um commit.*0/s);
});

test('conferirCongelamento recusa commitCodigo malformado sem chamar o git', () => {
  const git = gitFalso();
  assert.throws(() => conferirCongelamento({ commitCodigo: 'HEAD~1', git }), /commitCodigo inválido/);
  assert.deepEqual(git.chamadas, []);
});

test('sha256Arquivos devolve o sha256 de cada arquivo e falha alto se faltar algum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'congelamento-'));
  const a = path.join(dir, 'a.js');
  fs.writeFileSync(a, 'conteúdo a');
  const r = sha256Arquivos([a]);
  assert.deepEqual(r, { [a]: crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex') });
  assert.throws(() => sha256Arquivos([path.join(dir, 'falta.js')]), /ausente/);
});

// Grade sintética do cenário aprovado: S0, S1 e as 15 células (as não citadas com NDCG 0,3).
function gradeSintetica(mudar = {}) {
  const rede = (k, n, ndcg) => ({ rede: true, k, n, totalCandidatos: k + n, grupo: k + n === 150 ? 'fixo' : 'variavel', ndcg });
  const ep = (a, b, c) => ({ 1: a, 2: b, 3: c });
  const sistemas = {};
  const epocasPorSistema = {};
  for (const k of [0, 50, 100, 150]) {
    for (const n of [0, 50, 100, 150]) {
      if (k + n === 0) continue;
      const nome = k === 150 && n === 0 ? 'S2' : k === 0 && n === 150 ? 'S3' : `S4-${k}-${n}`;
      sistemas[nome] = rede(k, n, 0.3);
      epocasPorSistema[nome] = ep(2, 2, 2);
    }
  }
  Object.assign(sistemas, {
    S0: { rede: false, k: 10, n: 0, totalCandidatos: 10, ndcg: 0.2 },
    S1: { rede: false, k: 0, n: 150, totalCandidatos: 150, ndcg: 0.36 },
    S2: rede(150, 0, 0.33),
    S3: rede(0, 150, 0.35),
    'S4-100-50': rede(100, 50, 0.355),
    'S4-50-100': rede(50, 100, 0.351),
    'S4-150-150': rede(150, 150, 0.37),
  });
  Object.assign(epocasPorSistema, { S2: ep(5, 6, 7), S3: ep(4, 4, 5), 'S4-100-50': ep(3, 3, 3), 'S4-50-100': ep(6, 5, 4), 'S4-150-150': ep(8, 9, 7) });
  return {
    fase: 'v2-exp',
    cenario: 'aprovado',
    sistemas,
    escolha: { escolhida: 'S1', melhor: 'S4-150-150', fragil: false, tabela: [] },
    epocasPorSistema,
    contribuicoes: {
      'melhor de (100, 50), (50, 100), (0, 150) - S2': { melhor: 'S4-100-50' },
      'melhor S4 - S3': { melhor: 'S4-150-150' },
    },
    mdeDescritivo: 0.02,
    ganhoSobSubamostragem: 0.01,
    mdeDescritivoDetalhe: { par: 'S1 x S2', mde: 0.02 },
    otimista: true,
    ...mudar,
  };
}

const entradas = (grade = gradeSintetica()) => ({
  grade,
  portao: { cenario: grade.cenario, criterioA: { aprovado: true }, criterioB: { aprovado: true } },
  mde: { nt: 445, q: 0.36, frase: 'frase', pares: { S0xS1: { mde: 0.029, sigmaD: 0.21 }, S1xHeuristica: { mde: 0.019, sigmaD: 0.14 } } },
  resumo: { hashes: { teste2: 'h-teste2', treinoV2Final: 'h-treino' } },
  hashes: { treino: 'h-treino', regua: 'h-regua', vetoresFC: 'h-fc' },
  commitCodigo: COMMIT,
  sha256Codigo: { 'src/avaliacao/metricas.js': 'x' },
  sha256Grade: 'h-grade',
});

test('montarCongelamento: a v2 é a escolhida da grade, com sistemas, épocas e secundárias da grade', () => {
  const c = montarCongelamento(entradas());
  assert.equal(c.v2, 'S1');
  assert.equal(c.v1, 'S2');
  assert.equal(c.cenario, 'aprovado');
  assert.equal(c.sistemasRodados.length, 17);
  assert.deepEqual(c.secundarias, ['S0', 'S1', 'S2', 'S3', 'S4-100-50', 'S4-150-150']);
  assert.deepEqual(c.sistemas.S2.epocasPorSemente, { 1: 5, 2: 6, 3: 7 });
  assert.equal(c.sistemas.S1.epocasPorSemente, undefined);
  assert.deepEqual(Object.keys(c.sistemas).sort(), ['S0', 'S1', 'S2', 'S3', 'S4-100-50', 'S4-150-150']);
  assert.equal(c.seed_api, 1);
  assert.deepEqual(c.hashes, { teste2: 'h-teste2', treino: 'h-treino', regua: 'h-regua', vetoresFC: 'h-fc' });
  assert.equal(c.sha256Grade, 'h-grade');
  assert.equal(c.commitCodigo, COMMIT);
  assert.equal(c.ressalva, RESSALVA);
  assert.match(c.comparacaoPrincipal.texto, /bootstrap pareado com 5\.000 reamostragens e semente 2026/);
  assert.equal(c.comparacaoPrincipal.confirmatoria, true);
  assert.equal(c.mde.S0xS1.mde, 0.029);
  assert.equal(c.mdeDescritivo.mde, 0.02);
  assert.deepEqual(c.desvios, []);
});

test('montarCongelamento recusa grade cuja escolhida não está entre os sistemas rodados', () => {
  const g = gradeSintetica({ escolha: { escolhida: 'S4-0-60', melhor: 'S4-150-150', fragil: false, tabela: [] } });
  assert.throws(() => montarCongelamento(entradas(g)), /S4-0-60.*não está entre os sistemas rodados/);
});

test('montarCongelamento recusa cenário diferente do portão, épocas faltando, grade de verificação e hash de treino divergente', () => {
  const e1 = entradas();
  e1.portao.cenario = 'reprovado';
  assert.throws(() => montarCongelamento(e1), /cenário/);
  const g = gradeSintetica();
  delete g.epocasPorSistema.S3;
  assert.throws(() => montarCongelamento(entradas(g)), /épocas.*S3/);
  assert.throws(() => montarCongelamento(entradas(gradeSintetica({ execucao: 'verificação' }))), /verificação/);
  const e2 = entradas();
  e2.hashes.treino = 'outro';
  assert.throws(() => montarCongelamento(e2), /treino/);
});

test('montarCongelamento no cenário reprovado: só S0, S1 e S2; v2 = v1 sem comparação confirmatória', () => {
  const g = gradeSintetica({
    cenario: 'reprovado',
    escolha: { escolhida: 'S2', melhor: 'S2', fragil: false, tabela: [] },
    contribuicoes: {},
  });
  g.sistemas = { S0: g.sistemas.S0, S1: g.sistemas.S1, S2: g.sistemas.S2 };
  g.epocasPorSistema = { S2: g.epocasPorSistema.S2 };
  const c = montarCongelamento(entradas(g));
  assert.deepEqual(c.secundarias, ['S0', 'S1', 'S2']);
  assert.equal(c.v2, 'S2');
  assert.equal(c.comparacaoPrincipal.confirmatoria, false);
});

test('aplicarDesvio acrescenta o desvio com a mesma configuração e recusa outra configuração escolhida', () => {
  const anterior = montarCongelamento(entradas());
  const novo = montarCongelamento({ ...entradas(), commitCodigo: 'e'.repeat(40) });
  const r = aplicarDesvio({ anterior, novo, motivo: 'bug na etapa 1', data: '2026-11-15T00:00:00.000Z' });
  assert.deepEqual(r.desvios, [{ commitCodigoAnterior: COMMIT, motivo: 'bug na etapa 1', data: '2026-11-15T00:00:00.000Z' }]);
  assert.equal(r.commitCodigo, 'e'.repeat(40));

  const outraEscolha = gradeSintetica({ escolha: { escolhida: 'S3', melhor: 'S4-150-150', fragil: false, tabela: [] } });
  const novoOutro = montarCongelamento({ ...entradas(outraEscolha), commitCodigo: 'e'.repeat(40) });
  assert.throws(() => aplicarDesvio({ anterior, novo: novoOutro, motivo: 'bug', data: 'x' }), /desvio.*v2/s);

  const outrasEpocas = gradeSintetica();
  outrasEpocas.epocasPorSistema.S2 = { 1: 9, 2: 6, 3: 7 };
  const novoEpocas = montarCongelamento({ ...entradas(outrasEpocas), commitCodigo: 'e'.repeat(40) });
  assert.throws(() => aplicarDesvio({ anterior, novo: novoEpocas, motivo: 'bug', data: 'x' }), /desvio.*sistemas/s);

  assert.throws(() => aplicarDesvio({ anterior, novo: anterior, motivo: 'bug', data: 'x' }), /mesmo commitCodigo/);
  assert.throws(() => aplicarDesvio({ anterior, novo, motivo: '  ', data: 'x' }), /motivo/);
});

test('a ressalva é a da §3.4 da spec, por extenso', () => {
  const spec = fs.readFileSync(path.resolve(import.meta.dirname, '../../docs/superpowers/specs/2026-11-13-plano3-filtragem-colaborativa-design.md'), 'utf8');
  const secao = spec.split('### 3.4')[1].split('\n## ')[0];
  const citacao = secao.split('\n').find((l) => l.startsWith('> ')).slice(2);
  assert.equal(RESSALVA, citacao);
});

test('montarCongelamento: empate no melhor de orçamento fixo vai para o mais simples e confere a grade', () => {
  const g = gradeSintetica();
  g.sistemas['S4-50-100'].ndcg = 0.355; // empata com S4-100-50; menor N vence
  assert.equal(montarCongelamento(entradas(g)).melhores.orcamentoFixoComFC, 'S4-100-50');
  g.contribuicoes['melhor de (100, 50), (50, 100), (0, 150) - S2'].melhor = 'S4-50-100';
  assert.throws(() => montarCongelamento(entradas(g)), /grade inconsistente/);
});

test('montarCongelamento recusa conjunto de sistemas que não corresponde ao cenário', () => {
  const falta = gradeSintetica();
  delete falta.sistemas['S4-50-50'];
  assert.throws(() => montarCongelamento(entradas(falta)), /não correspondem ao cenário "aprovado"/);
  const corte = gradeSintetica({ cortarOrcamentoVariavel: true });
  assert.throws(() => montarCongelamento(entradas(corte)), /corte do orçamento variável/);
  for (const nome of Object.keys(corte.sistemas)) {
    if (!['S0', 'S1', 'S2', 'S3', 'S4-100-50', 'S4-50-100'].includes(nome)) delete corte.sistemas[nome];
  }
  corte.escolha.escolhida = 'S1';
  corte.contribuicoes = {};
  assert.deepEqual(montarCongelamento(entradas(corte)).sistemasRodados, ['S0', 'S1', 'S2', 'S3', 'S4-100-50', 'S4-50-100']);
  const reprovadoComS3 = gradeSintetica({ cenario: 'reprovado' });
  const e = entradas(reprovadoComS3);
  assert.throws(() => montarCongelamento(e), /não correspondem ao cenário "reprovado"/);
});

test('aplicarDesvio recusa regras de avaliação, sha256Grade ou hash do teste-2 alterados', () => {
  const anterior = { ...montarCongelamento(entradas()), data: '2026-11-15T00:00:00.000Z' };
  const novo = montarCongelamento({ ...entradas(), commitCodigo: 'e'.repeat(40) });
  const regras = { ...novo, regrasAvaliacao: { ...novo.regrasAvaliacao, relevancia: 'nota ≥ 3' } };
  assert.throws(() => aplicarDesvio({ anterior, novo: regras, motivo: 'bug', data: 'x' }), /"regrasAvaliacao" mudou/);
  const grade = { ...novo, sha256Grade: 'outra-grade' };
  assert.throws(() => aplicarDesvio({ anterior, novo: grade, motivo: 'bug', data: 'x' }), /"sha256Grade" mudou/);
  const comparacao = { ...novo, comparacaoPrincipal: { ...novo.comparacaoPrincipal, texto: 'outra' } };
  assert.throws(() => aplicarDesvio({ anterior, novo: comparacao, motivo: 'bug', data: 'x' }), /"comparacaoPrincipal" mudou/);
  const teste2 = { ...novo, hashes: { ...novo.hashes, teste2: 'outro' } };
  assert.throws(() => aplicarDesvio({ anterior, novo: teste2, motivo: 'bug', data: 'x' }), /hash teste2 mudou/);
});

test('aplicarDesvio aceita hash de treino alterado e o registra no desvio', () => {
  const anterior = montarCongelamento(entradas());
  const e = { ...entradas(), commitCodigo: 'e'.repeat(40) };
  e.hashes = { ...e.hashes, treino: 'h-treino-2' };
  e.resumo = { hashes: { ...e.resumo.hashes, treinoV2Final: 'h-treino-2' } };
  const r = aplicarDesvio({ anterior, novo: montarCongelamento(e), motivo: 'bug no treino', data: 'd' });
  assert.equal(r.hashes.treino, 'h-treino-2');
  assert.deepEqual(r.desvios, [{
    commitCodigoAnterior: COMMIT, motivo: 'bug no treino', data: 'd',
    hashesAlterados: { treino: { anterior: 'h-treino', novo: 'h-treino-2' } },
  }]);
});

test('conferirPermissaoCongelar recusa avaliação existente ou já commitada e combinações erradas de --desvio', () => {
  const git = (hist) => (args) => {
    assert.deepEqual(args, ['log', '--format=%H', '--', 'resultados/avaliacao-v2.json']);
    return hist;
  };
  const base = { desvio: null, existeCongelamento: false, existeAvaliacao: false, git: git('') };
  assert.doesNotThrow(() => conferirPermissaoCongelar(base));
  assert.doesNotThrow(() => conferirPermissaoCongelar({ ...base, desvio: 'bug', existeCongelamento: true }));
  assert.throws(() => conferirPermissaoCongelar({ ...base, existeAvaliacao: true }), /existe: o gabarito já foi lido/);
  assert.throws(() => conferirPermissaoCongelar({ ...base, git: git('f'.repeat(40)) }), /já foi commitado/);
  assert.throws(() => conferirPermissaoCongelar({ ...base, existeCongelamento: true }), /use --desvio/);
  assert.throws(() => conferirPermissaoCongelar({ ...base, desvio: 'bug' }), /sem congelamento anterior/);
});
