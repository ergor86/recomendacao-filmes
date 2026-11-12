// Testes da rede densa: sementes, parada automática, restauração dos melhores pesos,
// previsão sem vazamento de tensores e salvar/carregar. Só dados sintéticos (200 linhas × 6 colunas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  criarRede, treinar, prever, salvarModelo, carregarModelo, sementeEmbaralhamento, tf,
} from '../../src/modelo/rede.js';
import { criarAleatorio, embaralhar } from '../../src/util/aleatorio.js';

const N = 200;
const DIM = 6;

// Dados sintéticos: o rótulo depende de uma combinação linear das colunas.
function dados() {
  const a = criarAleatorio(7);
  const x = new Float32Array(N * DIM);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < DIM; j++) x[i * DIM + j] = a() * 2 - 1;
    y[i] = x[i * DIM] + x[i * DIM + 1] > 0 ? 1 : 0;
  }
  return { x, y };
}

// Treina uma rede pequena com perdaValidacao injetada e coleta os pesos de cada época.
async function treinarCom(semente, extra = {}) {
  const { x, y } = dados();
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: DIM, semente });
  const porEpoca = [];
  const r = await treinar({
    modelo, x, y, dim: DIM, semente,
    aoFimDaEpoca: (info) => porEpoca.push(info),
    ...extra,
  });
  return { modelo, r, porEpoca };
}

const pesosDe = (m) => m.getWeights().map((w) => Array.from(w.dataSync()));

test('restaura os pesos da melhor época', async () => {
  const perdas = [0.5, 0.3, 0.4, 0.45, 0.5];
  let i = 0;
  const { modelo, r, porEpoca } = await treinarCom(1, { perdaValidacao: () => perdas[i++] });
  assert.equal(r.melhorEpoca, 2);
  assert.equal(r.epocasTreinadas, 5);
  assert.equal(r.atingiuTeto, false);
  assert.equal(r.historico.length, 5);
  const finais = pesosDe(modelo);
  const naEpoca2 = porEpoca[1].pesos.map((p) => Array.from(p));
  assert.deepEqual(finais, naEpoca2);
  assert.notDeepEqual(finais, porEpoca[4].pesos.map((p) => Array.from(p)));
});

test('modo de épocas fixas treina exatamente o pedido', async () => {
  const { r, porEpoca } = await treinarCom(1, { epocas: 3 });
  assert.equal(r.epocasTreinadas, 3);
  assert.equal(r.melhorEpoca, 3);
  assert.equal(r.atingiuTeto, false);
  assert.deepEqual(porEpoca.map((p) => p.epoca), [1, 2, 3]);
});

test('maxEpocas com perda sempre caindo marca atingiuTeto', async () => {
  let p = 1;
  const { r } = await treinarCom(1, { maxEpocas: 4, perdaValidacao: () => (p -= 0.1) });
  assert.equal(r.epocasTreinadas, 4);
  assert.equal(r.melhorEpoca, 4);
  assert.equal(r.atingiuTeto, true);
});

test('exige exatamente um dos modos', async () => {
  const { x, y } = dados();
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: DIM, semente: 1 });
  await assert.rejects(treinar({ modelo, x, y, dim: DIM, semente: 1 }), /validacao|epocas/);
  await assert.rejects(
    treinar({ modelo, x, y, dim: DIM, semente: 1, epocas: 1, perdaValidacao: () => 1 }),
    /validacao|epocas/,
  );
});

test('mesma semente dá pesos idênticos; sementes diferentes, diferentes', async () => {
  const a = await treinarCom(1, { epocas: 2 });
  const b = await treinarCom(1, { epocas: 2 });
  const c = await treinarCom(2, { epocas: 2 });
  assert.deepEqual(pesosDe(a.modelo), pesosDe(b.modelo));
  assert.notDeepEqual(pesosDe(a.modelo), pesosDe(c.modelo));
});

test('fluxos de embaralhamento por semente e época são distintos', () => {
  const idx = Array.from({ length: 20 }, (_, i) => i);
  const vistos = new Set();
  for (let s = 1; s <= 3; s++) {
    for (let e = 1; e <= 50; e++) {
      assert.equal(sementeEmbaralhamento(s, e), 100_000 * s + e);
      vistos.add(embaralhar(idx, criarAleatorio(sementeEmbaralhamento(s, e))).join(','));
    }
  }
  assert.equal(vistos.size, 150);
});

test('prever não vaza tensores e valida a entrada', async () => {
  const { x } = dados();
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: DIM, semente: 1 });
  const antes = tf.memory().numTensors;
  const p = prever(modelo, x, DIM);
  assert.equal(tf.memory().numTensors, antes);
  assert.equal(p.length, N);
  assert.ok(p.every((v) => v > 0 && v < 1));
  assert.throws(() => prever(modelo, x, DIM + 1), /dim/i);
  const ruim = Float32Array.from(x);
  ruim[3] = NaN;
  assert.throws(() => prever(modelo, ruim, DIM), /NaN/);
});

test('treinar não vaza tensores', async () => {
  const modelo = criarRede({ arquitetura: '64-32', dimEntrada: DIM, semente: 1 });
  const { x, y } = dados();
  await treinar({ modelo, x, y, dim: DIM, semente: 1, epocas: 1 });
  const antes = tf.memory().numTensors;
  await treinar({ modelo, x, y, dim: DIM, semente: 1, epocas: 2 });
  assert.equal(tf.memory().numTensors, antes);
});

test('salvar e carregar dá as mesmas previsões; régua de outro hash dá erro', async () => {
  const { modelo } = await treinarCom(1, { epocas: 1 });
  const { x } = dados();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-'));
  try {
    const regua = { hash: 'abc', fase: 'validacao' };
    await salvarModelo(modelo, dir, { regua, metadados: { fase: 'validacao', hashRegua: 'abc' } });
    for (const f of ['model.json', 'weights.bin', 'regua.json', 'metadados.json']) {
      assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
    const { modelo: m2, metadados } = await carregarModelo(dir, regua);
    assert.equal(metadados.hashRegua, 'abc');
    assert.deepEqual(Array.from(prever(m2, x, DIM)), Array.from(prever(modelo, x, DIM)));
    await assert.rejects(
      carregarModelo(dir, { hash: 'outro', fase: 'validacao' }),
      /modelo treinado com outra régua: retreine com npm run treinar -- --fase validacao/,
    );
    await assert.rejects(carregarModelo(path.join(dir, 'nao-existe'), regua), /npm run treinar/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
