// Testes dos candidatos v2: ordem do HNSW preservada, validação do arquivo (sha256 e hashes),
// populares sem vistos, usuário sem curtidas, relatório de déficit e sha256 da FC150.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { construirFC } from '../../src/fc/referencia.js';
import {
  gerarCandidatosV2, montarArquivoCandidatosV2, lerCandidatosV2, listaDaConfiguracao,
  fc150DeTodos, sha256FC150, relatorioDeficit,
} from '../../src/candidatos/v2.js';

// 3 usuários: 1 e 2 curtem filmes; 3 só tem nota baixa (sem curtidas). 1000 filmes com contagem decrescente.
const treino = [
  { usuario: 1, filme: 1, nota: 5 }, { usuario: 1, filme: 2, nota: 2 },
  { usuario: 2, filme: 1, nota: 4 }, { usuario: 2, filme: 9, nota: 5 },
  { usuario: 3, filme: 2, nota: 1 },
];
const contagens = {};
for (let id = 1; id <= 1000; id++) contagens[id] = 2000 - id;
const fc = construirFC(treino, 3);

async function gerar(buscar) {
  return gerarCandidatosV2({ buscar, fc, treino, contagens, usuarios: [1, 2, 3] });
}
const buscarFalso = async (_vetor, excluir) => ({ lista: [9, 3, 7].map((id, i) => ({ id, escore: 1 - i / 10 })), empateNaoResolvido: false, excluir });

function gravar(arq) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cand-v2-'));
  const caminho = path.join(dir, 'candidatos-v2-v2-exp.json');
  fs.writeFileSync(caminho, JSON.stringify(arq));
  return { dir, caminho };
}

test('colab preserva a ordem do buscar, também depois de gravar e ler', async () => {
  const por = await gerar(buscarFalso);
  assert.deepEqual(por[1].colab, [9, 3, 7]);
  const { dir, caminho } = gravar(montarArquivoCandidatosV2('v2-exp', 'hr', 'ht', por));
  try {
    const m = lerCandidatosV2(caminho, { hashRegua: 'hr', hashTreino: 'ht' });
    assert.deepEqual(m.get(1).colab, [9, 3, 7]);
    assert.deepEqual([...m.keys()], [1, 2, 3]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('buscar recebe excluir como array ordenado dos vistos e vetor unitário', async () => {
  const chamadas = [];
  await gerar(async (vetor, excluir, m) => {
    chamadas.push({ vetor, excluir, m });
    return { lista: [], empateNaoResolvido: false };
  });
  assert.equal(chamadas.length, 2); // usuário 3 não busca
  assert.deepEqual(chamadas[0].excluir, [1, 2]);
  assert.equal(chamadas[0].m, 300);
  assert.equal(chamadas[0].vetor.length, 3);
  assert.ok(Math.abs(Math.hypot(...chamadas[0].vetor) - 1) < 1e-12);
});

test('lerCandidatosV2 recusa sha256 alterado e hash de treino diferente', async () => {
  const por = await gerar(buscarFalso);
  const arq = montarArquivoCandidatosV2('v2-exp', 'hr', 'ht', por);
  arq.porUsuario[1].colab = [1, 2];
  let g = gravar(arq);
  try { assert.throws(() => lerCandidatosV2(g.caminho, { hashRegua: 'hr', hashTreino: 'ht' }), /alterados/); }
  finally { fs.rmSync(g.dir, { recursive: true, force: true }); }
  g = gravar(montarArquivoCandidatosV2('v2-exp', 'hr', 'ht', por));
  try {
    assert.throws(() => lerCandidatosV2(g.caminho, { hashRegua: 'hr', hashTreino: 'outro' }), /outro treino|outra régua/);
    assert.throws(() => lerCandidatosV2(g.caminho, { hashRegua: 'x', hashTreino: 'ht' }), /outra régua/);
  } finally { fs.rmSync(g.dir, { recursive: true, force: true }); }
});

test('populares tem 600 itens e nenhum visto; sem curtidas → colab vazio e nElegiveis 0', async () => {
  const por = await gerar(buscarFalso);
  assert.equal(por[1].populares.length, 600);
  assert.ok(!por[1].populares.includes(1) && !por[1].populares.includes(2));
  assert.equal(por[1].populares[0], 3);
  assert.deepEqual(por[3].colab, []);
  assert.equal(por[3].nElegiveis, 0);
  assert.deepEqual(por[3].elegiveisEntrePopulares, []);
  assert.equal(por[3].empateNaoResolvido, false);
  assert.equal(por[3].populares.length, 600);
});

test('elegíveis reais: usuário 1 tem o filme 9 elegível (compartilha o fã 2) e ele está entre os populares', async () => {
  const por = await gerar(buscarFalso);
  assert.equal(por[1].nElegiveis, 1);
  assert.deepEqual(por[1].elegiveisEntrePopulares, [9]);
});

test('listaDaConfiguracao compõe K + N e fc150DeTodos usa (0, 150)', async () => {
  const por = await gerar(buscarFalso);
  const r = listaDaConfiguracao(por[1], 5, 2);
  assert.equal(r.ids.length, 7);
  assert.deepEqual(r.ids, [3, 4, 5, 6, 7, 9, 8]); // colab fora de P_5: só o 9; depois preenchimento
  const mapa = fc150DeTodos(new Map([[1, por[1]]]));
  assert.equal(mapa.get(1).length, 150);
  assert.deepEqual(mapa.get(1).slice(0, 3), [9, 3, 7]);
});

test('sha256FC150 muda se a ordem de uma lista mudar', () => {
  const a = sha256FC150(new Map([[1, [1, 2, 3]], [2, [4, 5]]]));
  const b = sha256FC150(new Map([[1, [1, 3, 2]], [2, [4, 5]]]));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(a, sha256FC150(new Map([[2, [4, 5]], [1, [1, 2, 3]]])));
});

test('relatorioDeficit soma corretamente num caso montado à mão', () => {
  const populares = Array.from({ length: 600 }, (_, i) => i + 1);
  const porUsuario = {
    // 2 colab fora de P_0, só 2 elegíveis: pedir N = 5 → completa 3, todo real (elegK = 2).
    1: { populares, colab: [1001, 1002], nElegiveis: 2, elegiveisEntrePopulares: [], empateNaoResolvido: false },
    // 0 colab, 10 elegíveis: completa 5, recuperação (elegK ≥ N).
    2: { populares, colab: [], nElegiveis: 10, elegiveisEntrePopulares: [], empateNaoResolvido: true },
    // sem curtidas.
    3: { populares, colab: [], nElegiveis: 0, elegiveisEntrePopulares: [], empateNaoResolvido: false },
    // colab cheio: sem déficit.
    4: { populares, colab: [1001, 1002, 1003, 1004, 1005, 1006], nElegiveis: 6, elegiveisEntrePopulares: [], empateNaoResolvido: false },
  };
  const rel = relatorioDeficit(porUsuario, [[0, 5]]);
  assert.deepEqual(rel['0-5'], {
    usuariosDeficitReal: 2, // usuários 1 e 3 (3: elegK 0 → completa 5, real 5)
    usuariosDeficitRecuperacao: 1, // usuário 2
    usuariosSemCurtidas: 1,
    vagasReal: 3 + 5,
    vagasRecuperacao: 5,
    usuariosDevKMaiorQueElegK: 0,
    usuariosEmpateNaoResolvido: 1,
  });
});
