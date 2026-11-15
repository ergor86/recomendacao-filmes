// Testes da etapa 2 da avaliação final (Task 14, spec §9.3): conferências antes do gabarito (cada
// divergência vira um problema), a ordem verificar → lerGabarito → avaliar → gravar (o gabarito nunca
// é lido se houver problema), as métricas calculadas só das previsões gravadas, a comparação principal
// (suportada só com o IC acima de zero; sem comparação confirmatória quando v2 = v1), as secundárias
// descritivas da §8.5, a ressalva copiada do congelamento e o teste estático de que a etapa 2 não
// importa o banco nem a rede. Congelamento, previsões, treino e gabarito sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashAvaliacoes } from '../../src/util/hash-avaliacoes.js';
import {
  verificarAntesDoGabarito, validarPrevisoes, avaliarPrevisoes, executarEtapa2, conferirGabarito, gravarResultado,
  TEXTO_SEM_CONFIRMATORIA,
} from '../../src/avaliacao/etapa2.js';

const raiz = path.resolve(import.meta.dirname, '../..');
const U = 462;
const N_FILMES = 220;
const SHA = (c) => c.repeat(64);

// Treino sintético: cada usuário viu os filmes 201 + (u % 10) e 211; os pares curtem só o primeiro
// (nota 5) e os ímpares só o 211 (nota 4), o filme mais popular: ímpares mainstream, pares nicho.
const treino = [];
for (let u = 1; u <= U; u++) {
  treino.push({ usuario: u, filme: 201 + (u % 10), nota: u % 2 === 0 ? 5 : 2 });
  treino.push({ usuario: u, filme: 211, nota: u % 2 === 0 ? 2 : 4 });
}
const contagens = {};
for (let id = 1; id <= N_FILMES; id++) contagens[id] = (id * 37) % 300;
contagens[211] = 299;
const regua = { hash: 'regua-sintetica', contagens, logPop: { min: 0, max: Math.log1p(300) } };
const filmes = Array.from({ length: N_FILMES }, (_, i) => ({ id: i + 1 }));

// Gabarito: relevante de u = filme 1 + (u % 40) (nota 5); usuários múltiplos de 50 só com nota baixa.
const gabarito = [];
for (let u = 1; u <= U; u++) gabarito.push({ usuario: u, filme: 1 + (u % 40), nota: u % 50 === 0 ? 3 : 5 });
const relevantes = new Map();
for (const { usuario, filme, nota } of gabarito) if (nota >= 4) relevantes.set(usuario, new Set([filme]));
const NT = relevantes.size; // 453

// Lista de 10 filmes de 41..200 (nunca relevante), deslocada por d.
const semAcerto = (u, d) => Array.from({ length: 10 }, (_, i) => 41 + ((u * 3 + d + i * 17) % 160));
// Lista com o relevante de u na posição `pos` (1..10).
const comAcerto = (u, d, pos) => {
  const l = semAcerto(u, d).filter((x) => x !== 1 + (u % 40)).slice(0, 9);
  l.splice(pos - 1, 0, 1 + (u % 40));
  return l;
};

const SECUNDARIAS = ['S0', 'S1', 'S2', 'S3', 'S4-100-50'];
const EPOCAS = { 1: 2, 2: 3, 3: 4 };

// Congelamento sintético no formato da Task 12.
function congelamentoCom(v2 = 'S3') {
  return {
    fase: 'v2-final',
    cenario: 'aprovado',
    v2,
    v1: 'S2',
    secundarias: SECUNDARIAS,
    melhores: { orcamentoFixoComFC: 'S4-100-50', S4: 'S4-100-50', escolhidosDepoisDeVer: true },
    sistemas: {
      S0: { rede: false, k: 10, n: 0 },
      S1: { rede: false, k: 0, n: 150 },
      S2: { rede: true, k: 150, n: 0, epocasPorSemente: EPOCAS },
      S3: { rede: true, k: 0, n: 150, epocasPorSemente: EPOCAS },
      'S4-100-50': { rede: true, k: 100, n: 50, epocasPorSemente: EPOCAS },
    },
    hashes: { teste2: hashAvaliacoes(gabarito), treino: hashAvaliacoes(treino), regua: 'regua-sintetica', vetoresFC: SHA('f') },
    comparacaoPrincipal: { texto: 'NDCG@10(v2) − NDCG@10(v1) por usuário', confirmatoria: v2 !== 'S2' },
    regrasAvaliacao: { relevancia: 'nota ≥ 4' },
    ressalva: 'ressalva histórica sintética',
    mde: { nt: NT },
    commitCodigo: 'a'.repeat(40),
    sha256Codigo: { 'src/avaliacao/etapa2.js': SHA('1'), 'scripts/23-etapa2-v2.js': SHA('2') },
  };
}

// Previsões no formato da etapa 1: `lista(nome, semente, u)` dá o top 10.
function previsoesCom(lista, nomes = SECUNDARIAS) {
  const sistemas = {};
  for (const nome of nomes) {
    const sementes = nome === 'S0' || nome === 'S1' ? ['0'] : ['1', '2', '3'];
    const porSemente = {};
    for (const s of sementes) {
      porSemente[s] = {};
      for (let u = 1; u <= U; u++) porSemente[s][String(u)] = lista(nome, Number(s), u);
    }
    sistemas[nome] = { porSemente };
  }
  return { sistemas };
}

// Padrão: S0 nunca acerta; S1 acerta na posição 1; os com rede acertam numa posição que varia.
const padrao = (nome, s, u) => {
  if (nome === 'S0') return semAcerto(u, 0);
  if (nome === 'S1') return comAcerto(u, 1, 1);
  return (u + s) % 3 === 0 ? semAcerto(u, s) : comAcerto(u, s + nome.length, 1 + ((u + s) % 10));
};

const avaliar = (opcoes = {}) => avaliarPrevisoes({
  previsoes: previsoesCom(padrao), relevantes, contagens, congelamento: congelamentoCom(), regua, treino, filmes, ...opcoes,
});

// ---------- verificarAntesDoGabarito ----------

const entradaOk = () => {
  const congelamento = congelamentoCom();
  return {
    congelamento,
    gravado: { sha256: SHA('p'), sha256Configuracao: SHA('c'), sha256FC150: SHA('d') },
    sha256PrevisoesAtual: SHA('p'),
    sha256ConfiguracaoAtual: SHA('c'),
    sha256CodigoAtual: { ...congelamento.sha256Codigo },
    hashesAtuais: { treino: congelamento.hashes.treino, regua: congelamento.hashes.regua, vetoresFC: congelamento.hashes.vetoresFC },
    avaliacaoExiste: false,
    previsoes: previsoesCom(padrao),
    treino,
    filmes,
  };
};

test('verificarAntesDoGabarito: tudo conferido → nenhum problema', () => {
  assert.deepEqual(verificarAntesDoGabarito(entradaOk()), []);
});

for (const [desc, mudar, re] of [
  ['hash das previsões diferente', (e) => { e.sha256PrevisoesAtual = SHA('q'); }, /previsões/],
  ['arquivo de previsões ausente', (e) => { e.sha256PrevisoesAtual = null; }, /previsoes-v2-final\.json ausente/],
  ['sha256 do congelamento diferente do gravado', (e) => { e.sha256ConfiguracaoAtual = SHA('e'); }, /congelamento/],
  ['hash gravado ausente', (e) => { e.gravado = null; }, /previsoes-v2-final\.sha256\.json/],
  ['código de avaliação alterado', (e) => { e.sha256CodigoAtual['src/avaliacao/etapa2.js'] = SHA('9'); }, /src\/avaliacao\/etapa2\.js/],
  ['arquivo de código congelado ausente', (e) => { e.sha256CodigoAtual['scripts/23-etapa2-v2.js'] = null; }, /scripts\/23-etapa2-v2\.js/],
  ['arquivo de avaliação novo, fora do congelamento', (e) => { e.sha256CodigoAtual['src/avaliacao/novo.js'] = SHA('8'); }, /src\/avaliacao\/novo\.js/],
  ['avaliação já existe', (e) => { e.avaliacaoExiste = true; }, /avaliacao-v2\.json/],
  ['hash do treino atual diferente do congelado', (e) => { e.hashesAtuais.treino = SHA('t'); }, /treino/],
  ['comparação principal incoerente com a v2', (e) => { e.congelamento.comparacaoPrincipal.confirmatoria = false; }, /confirmatoria/],
]) {
  test(`verificarAntesDoGabarito: ${desc} → um problema`, () => {
    const e = entradaOk();
    mudar(e);
    const problemas = verificarAntesDoGabarito(e);
    assert.equal(problemas.length, 1, problemas.join('\n'));
    assert.match(problemas[0], re);
  });
}

// Previsões inválidas que se detectam sem o gabarito.
const invalidas = [
  ['sistema faltando', (p) => { delete p.sistemas['S4-100-50']; }, /faltam: S4-100-50/],
  ['sistema a mais', (p) => { p.sistemas.S9 = p.sistemas.S0; }, /sobram: S9/],
  ['semente faltando', (p) => { delete p.sistemas.S3.porSemente['2']; }, /S3 com as sementes \[1, 3\]/],
  ['usuário faltando', (p) => { delete p.sistemas.S1.porSemente['0']['7']; }, /S1\/semente 0\/usuário 7 não é um top 10/],
  ['lista com 9 filmes', (p) => { p.sistemas.S2.porSemente['1']['8'].pop(); }, /S2\/semente 1\/usuário 8 não é um top 10/],
  ['filme repetido', (p) => { const l = p.sistemas.S0.porSemente['0']['9']; l[1] = l[0]; }, /usuário 9 não é um top 10/],
  ['filme fora do catálogo', (p) => { p.sistemas.S0.porSemente['0']['10'][0] = 999; }, /usuário 10 não é um top 10/],
  ['filme visto no treino', (p) => { p.sistemas.S0.porSemente['0']['5'][0] = 211; }, /usuário 5 traz o filme 211, já visto/],
];

test('validarPrevisoes: previsões da etapa 1 válidas → nenhum problema', () => {
  assert.deepEqual(validarPrevisoes({ previsoes: previsoesCom(padrao), congelamento: congelamentoCom(), treino, filmes }), []);
});

for (const [desc, estragar, re] of invalidas) {
  test(`verificarAntesDoGabarito: previsão inválida (${desc}) → um problema`, () => {
    const e = entradaOk();
    estragar(e.previsoes);
    const problemas = verificarAntesDoGabarito(e);
    assert.equal(problemas.length, 1, problemas.join('\n'));
    assert.match(problemas[0], re);
  });
}

test('validarPrevisoes: muitas listas inválidas → 20 por extenso e a contagem do resto', () => {
  const p = previsoesCom(padrao);
  for (let u = 1; u <= 30; u++) p.sistemas.S0.porSemente['0'][String(u)] = [];
  const problemas = validarPrevisoes({ previsoes: p, congelamento: congelamentoCom(), treino, filmes });
  assert.equal(problemas.length, 21);
  assert.match(problemas[20], /e mais 10 listas inválidas/);
});

test('executarEtapa2: previsão inválida bloqueia a leitura (lerGabarito com 0 chamadas)', async () => {
  const e = entradaOk();
  e.previsoes.sistemas.S0.porSemente['0']['5'][0] = 211;
  let lidas = 0;
  await assert.rejects(executarEtapa2({
    verificar: () => verificarAntesDoGabarito(e),
    lerGabarito: () => { lidas++; return gabarito; },
    avaliar: () => ({}),
    gravar: () => {},
  }), /já visto no treino/);
  assert.equal(lidas, 0);
});

test('verificarAntesDoGabarito: várias divergências → todas listadas', () => {
  const e = entradaOk();
  e.sha256PrevisoesAtual = SHA('q');
  e.avaliacaoExiste = true;
  assert.equal(verificarAntesDoGabarito(e).length, 2);
});

// ---------- executarEtapa2 ----------

test('executarEtapa2: verificar com problema rejeita sem chamar lerGabarito, avaliar nem gravar', async () => {
  const chamadas = { lerGabarito: 0, avaliar: 0, gravar: 0 };
  await assert.rejects(executarEtapa2({
    verificar: () => ['x'],
    lerGabarito: () => { chamadas.lerGabarito++; return []; },
    avaliar: () => { chamadas.avaliar++; return {}; },
    gravar: () => { chamadas.gravar++; },
  }), /x/);
  assert.deepEqual(chamadas, { lerGabarito: 0, avaliar: 0, gravar: 0 });
});

test('executarEtapa2: verificar que lança também rejeita sem ler o gabarito', async () => {
  let lidas = 0;
  await assert.rejects(executarEtapa2({
    verificar: () => { throw new Error('árvore suja'); },
    lerGabarito: () => { lidas++; return []; },
    avaliar: () => ({}),
    gravar: () => {},
  }), /árvore suja/);
  assert.equal(lidas, 0);
});

test('executarEtapa2: sem problemas, ordem verificar → lerGabarito → avaliar → gravar', async () => {
  const ordem = [];
  const resultado = { ok: true };
  let recebido;
  let gravado;
  const r = await executarEtapa2({
    verificar: () => { ordem.push('verificar'); return []; },
    lerGabarito: () => { ordem.push('lerGabarito'); return gabarito; },
    avaliar: (g) => { ordem.push('avaliar'); recebido = g; return resultado; },
    gravar: (o) => { ordem.push('gravar'); gravado = o; },
  });
  assert.deepEqual(ordem, ['verificar', 'lerGabarito', 'avaliar', 'gravar']);
  assert.equal(recebido, gabarito);
  assert.equal(gravado, resultado);
  assert.equal(r, resultado);
});

// ---------- conferirGabarito ----------

test('conferirGabarito: hash do teste-2 ou do treino diferente do congelado → erro', () => {
  const c = congelamentoCom();
  conferirGabarito({ alvos: gabarito, treino, congelamento: c });
  assert.throws(() => conferirGabarito({ alvos: gabarito.slice(1), treino, congelamento: c }), /teste-2/);
  assert.throws(() => conferirGabarito({ alvos: gabarito, treino: treino.slice(1), congelamento: c }), /treino/);
});

// ---------- avaliarPrevisoes ----------

test('avaliarPrevisoes: NDCG = 1 com o relevante na posição 1; métricas de todos os sistemas', () => {
  const r = avaliar();
  assert.equal(r.sistemas.S1.ndcgPorUsuario['1'], 1);
  assert.equal(r.sistemas.S1.ndcg, 1);
  assert.ok(Math.abs(r.sistemas.S1.precisao - 0.1) < 1e-12);
  assert.equal(r.sistemas.S1.recall, 1);
  assert.equal(r.sistemas.S0.ndcg, 0);
  assert.deepEqual(Object.keys(r.sistemas).sort(), [...SECUNDARIAS].sort());
  for (const s of Object.values(r.sistemas)) {
    assert.equal(s.nUsuarios, NT);
    assert.ok(Number.isFinite(s.ndcg) && Number.isFinite(s.precisao) && Number.isFinite(s.recall));
    assert.ok(s.cobertura !== undefined && s.popularidadeMediaContagem !== undefined);
  }
  // Com rede: cada semente separada e a média.
  assert.deepEqual(r.sistemas.S3.porSemente.map((x) => x.semente), [1, 2, 3]);
  const mediaSementes = r.sistemas.S3.porSemente.reduce((s, x) => s + x.ndcg, 0) / 3;
  assert.ok(Math.abs(r.sistemas.S3.ndcg - mediaSementes) < 1e-12);
  assert.equal(r.usuarios.avaliados, NT);
  assert.equal(r.usuarios.semRelevantes.length, U - NT);
});

test('avaliarPrevisoes: ressalva, regras e rótulo descritivo das secundárias', () => {
  const r = avaliar();
  assert.equal(r.ressalva, 'ressalva histórica sintética');
  assert.deepEqual(r.regrasAvaliacao, congelamentoCom().regrasAvaliacao);
  assert.deepEqual(Object.keys(r.secundarias).sort(), [
    'S1 - S0', 'S3 - S1', 'melhor S4 - S2', 'melhor S4 - S3', 'melhor de (100, 50), (50, 100), (0, 150) - S2',
  ].sort());
  for (const c of Object.values(r.secundarias)) assert.equal(c.rotulo, 'descritiva');
  assert.equal(r.secundarias['S1 - S0'].media, 1);
  assert.equal(r.secundarias['melhor S4 - S3'].melhor, 'S4-100-50');
});

test('avaliarPrevisoes: IC contendo zero → suportada = false', () => {
  // v2 (S3) e v1 (S2) com o mesmo top 10: todas as diferenças são 0.
  const iguais = (nome, s, u) => (nome === 'S3' ? padrao('S2', s, u) : padrao(nome, s, u));
  const r = avaliar({ previsoes: previsoesCom(iguais) });
  const c = r.comparacaoPrincipal;
  assert.equal(c.confirmatoria, true);
  assert.ok(c.ic95[0] <= 0 && c.ic95[1] >= 0);
  assert.equal(c.suportada, false);
  assert.equal(c.reamostragens, 5000);
  assert.equal(c.semente, 2026);
  assert.equal(c.nUsuarios, NT);
});

test('avaliarPrevisoes: IC que atravessa o zero → suportada = false', () => {
  // v2 acerta na posição 1 nos pares e a v1 nos ímpares: diferenças ±1, média perto de zero.
  const lista = (nome, s, u) => {
    if (nome === 'S3') return u % 2 === 0 ? comAcerto(u, s, 1) : semAcerto(u, s);
    if (nome === 'S2') return u % 2 === 1 ? comAcerto(u, s, 1) : semAcerto(u, s);
    return padrao(nome, s, u);
  };
  const c = avaliar({ previsoes: previsoesCom(lista) }).comparacaoPrincipal;
  assert.ok(c.ic95[0] < 0 && c.ic95[1] > 0, `IC ${c.ic95}`);
  assert.equal(c.suportada, false);
});

test('avaliarPrevisoes: IC inteiro abaixo de zero (v2 pior) → suportada = false, média negativa', () => {
  const lista = (nome, s, u) => (nome === 'S3' ? semAcerto(u, s) : nome === 'S2' ? comAcerto(u, s, 1) : padrao(nome, s, u));
  const c = avaliar({ previsoes: previsoesCom(lista) }).comparacaoPrincipal;
  assert.equal(c.media, -1);
  assert.ok(c.ic95[1] < 0);
  assert.equal(c.suportada, false);
});

test('avaliarPrevisoes: secundária sem "melhor" congelado ou com sistema fora do congelamento → motivo exato', () => {
  const semMelhor = congelamentoCom();
  semMelhor.melhores = { orcamentoFixoComFC: 'S4-100-50', S4: null };
  const r1 = avaliar({ congelamento: semMelhor });
  assert.equal(r1.secundarias['melhor S4 - S3'].calculada, false);
  assert.match(r1.secundarias['melhor S4 - S3'].motivo, /congelamento\.melhores não registra/);

  // Sem S3 no congelamento (v2 = S4-100-50): S3 − S1 não é avaliada, e o motivo nomeia S3.
  const semS3 = congelamentoCom('S4-100-50');
  const nomes = SECUNDARIAS.filter((n) => n !== 'S3');
  semS3.secundarias = nomes;
  delete semS3.sistemas.S3;
  const r2 = avaliar({ congelamento: semS3, previsoes: previsoesCom(padrao, nomes) });
  assert.equal(r2.secundarias['S3 - S1'].rotulo, 'descritiva');
  assert.match(r2.secundarias['S3 - S1'].motivo, /^não avaliada: S3 fora dos sistemas congelados \(cenário aprovado\)/);
  assert.match(r2.secundarias['melhor S4 - S3'].motivo, /^não avaliada: S3 fora/);
});

test('gravarResultado: grava JSON estável e recusa sobrescrever (EEXIST)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapa2-'));
  try {
    const arq = path.join(dir, 'avaliacao-v2.json');
    gravarResultado(arq, { b: 1, a: 2 });
    assert.equal(fs.readFileSync(arq, 'utf8'), '{"a":2,"b":1}\n');
    assert.throws(() => gravarResultado(arq, { c: 3 }), (e) => e.code === 'EEXIST');
    assert.equal(fs.readFileSync(arq, 'utf8'), '{"a":2,"b":1}\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('avaliarPrevisoes: v2 sempre acerta na posição 1 e v1 nunca → suportada = true', () => {
  const lista = (nome, s, u) => (nome === 'S3' ? comAcerto(u, s, 1) : nome === 'S2' ? semAcerto(u, s) : padrao(nome, s, u));
  const c = avaliar({ previsoes: previsoesCom(lista) }).comparacaoPrincipal;
  assert.equal(c.media, 1);
  assert.ok(c.ic95[0] > 0);
  assert.equal(c.suportada, true);
});

test('avaliarPrevisoes: v2 = S2 → sem comparação confirmatória', () => {
  const r = avaliar({ congelamento: congelamentoCom('S2') });
  assert.deepEqual(r.comparacaoPrincipal, { confirmatoria: false, texto: TEXTO_SEM_CONFIRMATORIA });
  assert.equal(TEXTO_SEM_CONFIRMATORIA, 'sem comparação confirmatória: a configuração escolhida é a v1');
});

test('avaliarPrevisoes: mainstream × nicho com a mediana do conjunto avaliado', () => {
  const r = avaliar();
  const m = r.mainstreamNicho;
  // Avaliados: 231 ímpares (curtem o 211, o mais popular) e 222 pares (os múltiplos de 50 não têm
  // relevantes). A mediana cai num ímpar: ímpares mainstream (na mediana), pares nicho.
  assert.equal(m.tamanhos.semCurtidas, 0);
  assert.equal(m.tamanhos.mainstream, 231);
  assert.equal(m.tamanhos.nicho, 222);
  assert.equal(m.mediana, Math.log1p(299) / Math.log1p(300));
  assert.equal(m.porSistema.S1.mainstream.n, 231);
  assert.equal(m.porSistema.S1.nicho.ndcg, 1);
  for (const nome of SECUNDARIAS) assert.ok(m.porSistema[nome].mainstream && m.porSistema[nome].nicho, nome);
});

test('avaliarPrevisoes: previsão com filme visto no treino, sistema faltando ou nt diferente → erro', () => {
  const comVisto = (nome, s, u) => (nome === 'S0' && u === 5 ? [211, ...semAcerto(u, 0).slice(0, 9)] : padrao(nome, s, u));
  assert.throws(() => avaliar({ previsoes: previsoesCom(comVisto) }), /visto/);
  const p = previsoesCom(padrao);
  delete p.sistemas['S4-100-50'];
  assert.throws(() => avaliar({ previsoes: p }), /S4-100-50/);
  const c = congelamentoCom();
  c.mde.nt = NT + 1;
  assert.throws(() => avaliar({ congelamento: c }), /nt/);
});

// ---------- estático ----------

for (const arq of ['src/avaliacao/etapa2.js', 'scripts/23-etapa2-v2.js']) {
  test(`estático: ${arq} não importa src/banco nem src/modelo`, () => {
    const texto = fs.readFileSync(path.join(raiz, arq), 'utf8');
    const imports = texto.match(/^\s*import\s[^;]*?from\s+['"][^'"]+['"]/gm) ?? [];
    const dinamicos = texto.match(/import\(\s*['"][^'"]+['"]\s*\)/g) ?? [];
    assert.ok(imports.length > 0);
    for (const linha of [...imports, ...dinamicos]) {
      assert.doesNotMatch(linha, /\/(banco|modelo)\//, `${arq} não pode importar banco nem rede: ${linha}`);
    }
  });
}
