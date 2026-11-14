// Testes da etapa 1 da avaliação final (Task 13, spec §9.2): conferência do congelamento e dos hashes
// antes de qualquer busca ou treino, ordem das gravações, formato das previsões, sha256 devolvidos,
// FC150 única, fidelidade no teste-2 sem gabarito (teto e "zero por construção") e o teste estático
// de que a etapa 1 não importa o banco nem a rede. Congelamento, contexto, banco e rede sintéticos,
// coerentes entre si, montados aqui mesmo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { criarAleatorio } from '../../src/util/aleatorio.js';
import { hashAvaliacoes } from '../../src/util/hash-avaliacoes.js';
import { construirFC, hashVetoresFC } from '../../src/fc/referencia.js';
import { listaDaConfiguracao, sha256FC150 } from '../../src/candidatos/v2.js';
import { executarEtapa1, FRASE_NAO_MEDIDO } from '../../src/avaliacao/etapa1.js';

const raiz = path.resolve(import.meta.dirname, '../..');
const N_USUARIOS = 470;
const N_FILMES = 220;
const SEM_CURTIDAS = 7; // usuário só com notas baixas
const sha = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

// Treino sintético: cada usuário avalia 12 filmes distintos, com viés para ids baixos (populares).
function montarTreino() {
  const treino = [];
  for (let u = 1; u <= N_USUARIOS; u++) {
    const r = criarAleatorio(1000 + u);
    const filmes = new Set();
    while (filmes.size < 12) filmes.add(1 + Math.floor(N_FILMES * r() * r()));
    [...filmes].forEach((filme, i) => {
      let nota = 1 + Math.floor(5 * r());
      if (u === SEM_CURTIDAS) nota = Math.min(nota, 3);
      else if (i === 0) nota = 5; // todo outro usuário curte ao menos um filme
      treino.push({ usuario: u, filme, nota });
    });
  }
  return treino;
}

const treino = montarTreino();
const contagens = {};
for (let id = 1; id <= N_FILMES; id++) contagens[id] = 0;
for (const { filme } of treino) contagens[filme]++;
const ctx = {
  fase: 'v2-final',
  dataset: {
    filmes: Array.from({ length: N_FILMES }, (_, i) => ({ id: i + 1 })),
    usuarios: Array.from({ length: N_USUARIOS }, (_, i) => ({ id: i + 1 })),
  },
  treino,
  alvos: null,
  regua: { hash: 'regua-sintetica', contagens },
};
const fc = construirFC(treino, N_USUARIOS);
const HASHES = { treino: hashAvaliacoes(treino), regua: 'regua-sintetica', vetoresFC: hashVetoresFC(fc) };
const SHA_GRADE = 'b'.repeat(64);
const SHA_CONFIG = 'c'.repeat(64);

// Congelamento sintético no formato da Task 12.
function congelamentoCom(v2) {
  return {
    fase: 'v2-final',
    v2,
    v1: 'S2',
    secundarias: ['S0', 'S1', 'S2', 'S3'],
    sistemas: {
      S0: { rede: false, k: 10, n: 0, totalCandidatos: 10 },
      S1: { rede: false, k: 0, n: 150, totalCandidatos: 150 },
      S2: { rede: true, k: 150, n: 0, totalCandidatos: 150, epocasPorSemente: { 1: 2, 2: 3, 3: 4 } },
      S3: { rede: true, k: 0, n: 150, totalCandidatos: 150, epocasPorSemente: { 1: 5, 2: 6, 3: 7 } },
    },
    hashes: { teste2: 't'.repeat(64), ...HASHES },
    sha256Grade: SHA_GRADE,
    commitCodigo: 'a'.repeat(40),
    mde: { nt: 445 },
  };
}

// Busca sintética: cosseno exato entre o vetor e o vetor FC de cada filme, escore oficial > 0, ordem
// (escore desc, id asc). No modo 'hnsw', os usuários de `perder` perdem o primeiro filme da lista.
// No modo 'exata', os usuários de `inverter` recebem a lista invertida (erro além da precisão).
function bancoFalso({ perder = new Set(), inverter = new Set() } = {}) {
  return (modo, vetor, excluir, m) => {
    const fora = new Set(excluir);
    const itens = [];
    for (const [id, fas] of fc.fasPorFilme) {
      if (fora.has(id)) continue;
      let s = 0;
      for (const u of fas) s += vetor[u - 1];
      const escore = Math.round((s / Math.sqrt(fas.length)) * 1e6) / 1e6;
      if (escore > 0) itens.push({ id, escore });
    }
    itens.sort((a, b) => b.escore - a.escore || a.id - b.id);
    // Identifica o usuário pelo vetor: os vistos (excluir) são únicos por usuário no treino sintético.
    const u = usuarioDe(excluir);
    let lista = modo === 'hnsw' && perder.has(u) ? itens.slice(1, m + 1) : itens.slice(0, m);
    if (modo === 'exata' && inverter.has(u)) lista = [...lista].reverse();
    return { lista, empateNaoResolvido: false };
  };
}
const vistosTexto = new Map();
for (let u = 1; u <= N_USUARIOS; u++) {
  vistosTexto.set(treino.filter((a) => a.usuario === u).map((a) => a.filme).sort((a, b) => a - b).join(','), u);
}
const usuarioDe = (excluir) => vistosTexto.get(excluir.join(','));

// Rede sintética: semente 1 pontua pela posição na lista (top 10 = os 10 primeiros); 2 e 3, por um
// hash determinístico de (id, semente, usuário).
function pontuarFalso(_nome, semente, usuario, ids) {
  return new Map(ids.map((id, i) => [id, semente === 1 ? ids.length - i : ((id * 7919 + semente * 104729 + usuario * 31) % 1000) / 1000]));
}

// Monta as dependências com espiões que registram a ordem das chamadas.
function deps({ congelamento = congelamentoCom('S3'), hashesAtuais = { ...HASHES, sha256Grade: SHA_GRADE },
  conferir = () => {}, schema = { esquema: 'v2_final', hashRegua: HASHES.regua, hashTreino: HASHES.treino },
  perder, inverter, nt = 445, sha256Configuracao = SHA_CONFIG } = {}) {
  const ordem = [];
  const contagem = { buscar: 0, treinar: 0, pontuar: 0, gravarPrevisoes: 0 };
  const gravado = {};
  const buscarBanco = bancoFalso({ perder, inverter });
  const marcar = (nome) => { if (ordem.at(-1) !== nome) ordem.push(nome); };
  return {
    ordem, contagem, gravado,
    args: {
      conferir: () => { marcar('conferir'); return conferir(); },
      ctx, congelamento, hashesAtuais, nt, sha256Configuracao,
      lerHashesSchema: async () => { marcar('lerHashesSchema'); return schema; },
      buscar: async (...a) => { contagem.buscar++; marcar('buscar'); return buscarBanco(...a); },
      treinar: async (nome, cand, epocas) => {
        contagem.treinar++; marcar('treinar');
        (gravado.treinos ??= []).push({ nome, cand, epocas });
        return { nome };
      },
      pontuar: async (...a) => { contagem.pontuar++; marcar('pontuar'); return pontuarFalso(...a); },
      gravarCandidatos: async (arq) => { marcar('gravarCandidatos'); gravado.candidatos = arq; },
      gravarPrevisoes: async (texto) => { contagem.gravarPrevisoes++; marcar('gravarPrevisoes'); gravado.previsoes = texto; },
      gravarHashes: async (h) => { marcar('gravarHashes'); gravado.hashes = h; },
      gravarRelatorios: async (r) => { marcar('gravarRelatorios'); gravado.relatorios = r; },
    },
  };
}

test('conferir que lança: rejeita sem buscar, treinar nem gravar previsões', async () => {
  const d = deps({ conferir: () => { throw new Error('árvore suja'); } });
  await assert.rejects(executarEtapa1(d.args), /árvore suja/);
  assert.equal(d.contagem.buscar, 0);
  assert.equal(d.contagem.treinar, 0);
  assert.equal(d.contagem.gravarPrevisoes, 0);
});

for (const [campo, re] of [['treino', /treino/], ['regua', /régua/], ['vetoresFC', /vetores FC/], ['sha256Grade', /grade/]]) {
  test(`hashesAtuais.${campo} diferente do congelado: rejeita antes de buscar`, async () => {
    const d = deps({ hashesAtuais: { ...HASHES, sha256Grade: SHA_GRADE, [campo]: 'x'.repeat(64) } });
    await assert.rejects(executarEtapa1(d.args), re);
    assert.equal(d.contagem.buscar, 0);
    assert.equal(d.contagem.treinar, 0);
    assert.equal(d.contagem.gravarPrevisoes, 0);
  });
}

test('hashesAtuais iguais ao congelamento, mas de outro contexto: rejeita antes de buscar', async () => {
  const outro = { ...HASHES, treino: 'y'.repeat(64) };
  const congelamento = { ...congelamentoCom('S3'), hashes: { teste2: 't'.repeat(64), ...outro } };
  const d = deps({ congelamento, hashesAtuais: { ...outro, sha256Grade: SHA_GRADE } });
  await assert.rejects(executarEtapa1(d.args), /contexto/);
  assert.equal(d.contagem.buscar, 0);
});

for (const [desc, schema, re] of [
  ['régua', { esquema: 'v2_final', hashRegua: 'outra', hashTreino: HASHES.treino }, /régua/],
  ['treino', { esquema: 'v2_final', hashRegua: HASHES.regua, hashTreino: 'outro' }, /treino/],
  ['esquema', { esquema: 'v2_exp', hashRegua: HASHES.regua, hashTreino: HASHES.treino }, /v2_final/],
]) {
  test(`hashes do schema (${desc}) diferentes: rejeita antes de buscar`, async () => {
    const d = deps({ schema });
    await assert.rejects(executarEtapa1(d.args), re);
    assert.deepEqual(d.ordem, ['conferir', 'lerHashesSchema']);
    assert.equal(d.contagem.buscar, 0);
    assert.equal(d.contagem.treinar, 0);
  });
}

test('caminho feliz: ordem, previsões, sha256 e FC150 única', async () => {
  const d = deps();
  const r = await executarEtapa1(d.args);

  assert.deepEqual(d.ordem.slice(0, 2), ['conferir', 'lerHashesSchema']);
  assert.deepEqual(d.ordem.slice(-2), ['gravarPrevisoes', 'gravarHashes']);
  assert.ok(d.ordem.indexOf('gravarRelatorios') < d.ordem.indexOf('gravarPrevisoes'));

  // Previsões: v2, v1 e secundárias sem repetição; sem rede na semente 0, com rede nas 1, 2, 3.
  const prev = JSON.parse(d.gravado.previsoes);
  assert.deepEqual(Object.keys(prev.sistemas).sort(), ['S0', 'S1', 'S2', 'S3']);
  for (const [nome, s] of Object.entries(prev.sistemas)) {
    const sementes = nome === 'S0' || nome === 'S1' ? ['0'] : ['1', '2', '3'];
    assert.deepEqual(Object.keys(s.porSemente).sort(), sementes, nome);
    for (const sem of sementes) {
      const porU = s.porSemente[sem];
      assert.equal(Object.keys(porU).length, 462, `${nome}/${sem}`);
      for (let u = 1; u <= 462; u++) {
        const l = porU[String(u)];
        assert.equal(l.length, 10, `${nome}/${sem}/${u}`);
        assert.equal(new Set(l).size, 10, `${nome}/${sem}/${u} repetido`);
        assert.ok(l.every(Number.isInteger));
      }
    }
  }

  // sha256 devolvidos = conteúdo gravado.
  assert.equal(r.sha256, sha(d.gravado.previsoes));
  assert.equal(r.sha256Configuracao, SHA_CONFIG);
  const cand = d.gravado.candidatos;
  assert.equal(cand.fase, 'v2-final');
  assert.equal(cand.M, 300);
  assert.equal(Object.keys(cand.porUsuario).length, N_USUARIOS); // todos os usuários do treino
  // sha256 da FC150 de TODOS os usuários do treino (a mesma lista de S1 e do treino de S3).
  const fc150 = new Map(Object.entries(cand.porUsuario).map(([u, e]) => [Number(u), listaDaConfiguracao(e, 0, 150).ids]));
  assert.equal(fc150.size, N_USUARIOS);
  assert.equal(r.sha256FC150, sha256FC150(fc150));
  assert.deepEqual(d.gravado.hashes, r);

  // Top 10 de S1 e de S3 (cada semente) contidos na FC150; S1 = início da FC150.
  for (let u = 1; u <= 462; u++) {
    const f = new Set(fc150.get(u));
    assert.deepEqual(prev.sistemas.S1.porSemente['0'][u], fc150.get(u).slice(0, 10));
    for (const s of ['1', '2', '3']) assert.ok(prev.sistemas.S3.porSemente[s][u].every((id) => f.has(id)), `S3/${s}/${u}`);
  }

  // Treino: S2 e S3 com as épocas congeladas; S3 recebe a FC150 (todos os usuários do treino).
  const treinos = new Map(d.gravado.treinos.map((t) => [t.nome, t]));
  assert.deepEqual([...treinos.keys()].sort(), ['v2-0-150', 'v2-150-0']);
  assert.deepEqual(treinos.get('v2-0-150').epocas, { 1: 5, 2: 6, 3: 7 });
  assert.equal(treinos.get('v2-0-150').cand.size, N_USUARIOS);
  assert.deepEqual(treinos.get('v2-0-150').cand.get(1), fc150.get(1));

  // Fidelidade sem perturbação: HNSW = referência = exata; v2 (S3) idêntica em 100%: zero por construção.
  const fid = d.gravado.relatorios.fidelidade;
  assert.equal(fid.nt, 445);
  assert.equal(fid.medidas12.hnswXreferencia['150'].fracaoIdenticas, 1);
  assert.equal(fid.precisao.divergenciasPrecisao, 0);
  assert.equal(fid.top10Identicos.S1.iguais, 462);
  assert.equal(fid.top10Identicos.v2.sistema, 'S3');
  assert.equal(fid.top10Identicos.v2.diferentes, 0);
  assert.match(fid.impacto.conclusao, /zero por construção/);
  assert.equal(fid.usuariosSemPerfil.includes(SEM_CURTIDAS), true);

  // Déficit dos sistemas com lista composta, só usuários 1–462.
  const def = d.gravado.relatorios.deficit;
  assert.deepEqual(Object.keys(def.configuracoes).sort(), ['0-150', '150-0']);
  assert.equal(def.usuarios, 462);
  assert.ok(def.configuracoes['0-150'].usuariosSemCurtidas >= 1);
  assert.ok('S1' in def.posicoesPreenchimento && 'S3' in def.posicoesPreenchimento && 'v2' in def.posicoesPreenchimento);
});

test('fidelidade: HNSW diferente da referência em 3 usuários → teto min(1, 3/nt) e a frase obrigatória', async () => {
  const d = deps({ perder: new Set([1, 2, 3]) });
  await executarEtapa1(d.args);
  const fid = d.gravado.relatorios.fidelidade;
  assert.equal(fid.top10Identicos.S1.diferentes, 3);
  assert.equal(fid.top10Identicos.v2.diferentes, 3); // semente 1 segue a ordem da lista
  assert.equal(fid.impacto.teto, Math.min(1, 3 / 445));
  assert.equal(fid.impacto.nDiferentes, 3);
  assert.equal(fid.impacto.frase, FRASE_NAO_MEDIDO);
  assert.equal(FRASE_NAO_MEDIDO, 'o impacto da aproximação sobre o NDCG no teste-2 não foi medido');
  assert.ok(fid.medidas12.hnswXreferencia['150'].fracaoIdenticas < 1);
  assert.equal(fid.medidas12.exataXreferencia['150'].fracaoIdenticas, 1);
});

test('fidelidade: v2 congelada = S0 → "zero por construção", mesmo com HNSW diferente', async () => {
  const d = deps({ congelamento: congelamentoCom('S0'), perder: new Set([1, 2, 3]) });
  await executarEtapa1(d.args);
  const fid = d.gravado.relatorios.fidelidade;
  assert.match(fid.impacto.conclusao, /zero por construção/);
  assert.equal(fid.impacto.teto, undefined);
  assert.equal(fid.top10Identicos.S1.diferentes, 3); // a fidelidade continua reportada à parte
  assert.equal(fid.top10Identicos.v2.sistema, 'S0');
});

test('sistema congelado com nome e (k, n) incoerentes: rejeita antes de buscar', async () => {
  const c = congelamentoCom('S3');
  c.sistemas.S3 = { ...c.sistemas.S3, k: 50, n: 100 };
  const d = deps({ congelamento: c });
  await assert.rejects(executarEtapa1(d.args), /S3/);
  assert.equal(d.contagem.buscar, 0);
});

test('nt diferente do congelado, mde.nt ausente, nt inválido ou sha256Configuracao inválido: rejeita antes de buscar', async () => {
  const semMde = congelamentoCom('S3');
  delete semMde.mde;
  for (const [opcoes, re] of [
    [{ nt: 444 }, /nt atual \(444\) diferente do congelado \(445\)/],
    [{ congelamento: semMde }, /congelamento sem mde\.nt/],
    [{ nt: 0 }, /nt inválido/],
    [{ nt: null }, /nt inválido/],
    [{ sha256Configuracao: 'abc' }, /sha256Configuracao inválido/],
  ]) {
    const d = deps(opcoes);
    await assert.rejects(executarEtapa1(d.args), re);
    assert.equal(d.contagem.buscar, 0);
    assert.equal(d.contagem.treinar, 0);
  }
});

test('busca exata diferente da referência além de τ: rejeita sem treinar nem gravar previsões', async () => {
  const d = deps({ inverter: new Set([2]) });
  await assert.rejects(executarEtapa1(d.args), /busca exata difere da referência no usuário 2 além da precisão/);
  assert.equal(d.contagem.treinar, 0);
  assert.equal(d.contagem.pontuar, 0);
  assert.equal(d.contagem.gravarPrevisoes, 0);
  assert.equal(d.gravado.relatorios, undefined);
});

test('estático: src/avaliacao/etapa1.js não importa src/banco nem src/modelo', () => {
  const texto = fs.readFileSync(path.join(raiz, 'src/avaliacao/etapa1.js'), 'utf8');
  const imports = texto.match(/^\s*import\s[^;]*?from\s+['"][^'"]+['"]/gm) ?? [];
  const dinamicos = texto.match(/import\(\s*['"][^'"]+['"]\s*\)/g) ?? [];
  assert.ok(imports.length > 0);
  for (const linha of [...imports, ...dinamicos]) {
    assert.doesNotMatch(linha, /\/(banco|modelo)\//, `etapa1.js não pode importar banco nem rede: ${linha}`);
  }
});
