// Rede densa do recomendador: criação com pesos iniciais semeados, treino época a época com
// embaralhamento próprio, parada automática com restauração dos melhores pesos, previsão em
// lotes e persistência (model.json + weights.bin + regua.json + metadados.json).
import fs from 'node:fs';
import path from 'node:path';
import { criarAleatorio, embaralhar } from '../util/aleatorio.js';
import { jsonEstavel } from '../util/json-estavel.js';

// Silencia as linhas de log nativas do TensorFlow (precisa ser definido antes do primeiro import).
process.env.TF_CPP_MIN_LOG_LEVEL ??= '2';
const tf = await import('@tensorflow/tfjs-node');

export { tf };

/** Camadas ocultas de cada arquitetura. */
export const ARQUITETURAS = { '128-64-32': [128, 64, 32], '64-32': [64, 32] };

const TAMANHO_LOTE = 256;
const LOTE_PREVISAO = 8192;
const TAXA_APRENDIZADO = 0.001;

/** Semente do embaralhamento da época `epoca` (1-based) para a semente `semente`. */
export function sementeEmbaralhamento(semente, epoca) {
  return 100_000 * semente + epoca;
}

/** Cria a rede compilada: camadas relu da arquitetura + saída sigmoid, pesos iniciais semeados. */
export function criarRede({ arquitetura, dimEntrada, semente }) {
  const camadas = ARQUITETURAS[arquitetura];
  if (!camadas) {
    throw new Error(`arquitetura desconhecida "${arquitetura}": use ${Object.keys(ARQUITETURAS).join(' ou ')}`);
  }
  const modelo = tf.sequential();
  const init = (indice) => tf.initializers.glorotUniform({ seed: 1000 * semente + indice });
  camadas.forEach((unidades, i) => {
    modelo.add(tf.layers.dense({
      units: unidades, activation: 'relu', kernelInitializer: init(i),
      ...(i === 0 ? { inputShape: [dimEntrada] } : {}),
    }));
  });
  modelo.add(tf.layers.dense({ units: 1, activation: 'sigmoid', kernelInitializer: init(camadas.length) }));
  modelo.compile({ optimizer: tf.train.adam(TAXA_APRENDIZADO), loss: 'binaryCrossentropy' });
  return modelo;
}

// Confere o tamanho de x (n × dim) e devolve n.
function contarLinhas(x, dim, nome) {
  if (!Number.isInteger(dim) || dim <= 0 || x.length % dim !== 0) {
    throw new Error(`${nome}: tamanho ${x.length} não é múltiplo de dim=${dim}; confira a dimensão da entrada`);
  }
  return x.length / dim;
}

// Perda média (binaryCrossentropy) do modelo em { x, y }, como número.
function avaliarPerda(modelo, { x, y }, dim) {
  const n = contarLinhas(x, dim, 'validacao.x');
  const tx = tf.tensor2d(x, [n, dim]);
  const ty = tf.tensor2d(y, [n, 1]);
  try {
    const r = modelo.evaluate(tx, ty, { batchSize: LOTE_PREVISAO, verbose: 0 });
    const v = r.dataSync()[0];
    r.dispose();
    return v;
  } finally {
    tx.dispose();
    ty.dispose();
  }
}

// Copia os pesos atuais do modelo para Float32Array.
const copiarPesos = (modelo) => modelo.getWeights().map((w) => Float32Array.from(w.dataSync()));

/**
 * Treina época a época. Modo parada automática (validacao ou perdaValidacao): guarda os melhores
 * pesos, para após `paciencia` épocas sem melhora ou em `maxEpocas`, e os restaura no fim.
 * Modo épocas fixas (epocas): treina exatamente esse número de épocas.
 */
export async function treinar({
  modelo, x, y, dim, semente, validacao = null, perdaValidacao = null, epocas = null,
  maxEpocas = 50, paciencia = 3, aoFimDaEpoca = null,
}) {
  const automatico = Boolean(validacao || perdaValidacao);
  if (automatico === (epocas != null)) {
    throw new Error('treinar: informe validacao (ou perdaValidacao) para parada automática, ou epocas para treino fixo, mas não os dois nem nenhum');
  }
  const n = contarLinhas(x, dim, 'x');
  if (y.length !== n) throw new Error(`treinar: y tem ${y.length} linhas e x tem ${n}`);
  const calcularValidacao = perdaValidacao ?? (() => avaliarPerda(modelo, validacao, dim));
  const limite = automatico ? maxEpocas : epocas;
  const indices = Array.from({ length: n }, (_, i) => i);
  const historico = [];
  let melhorPerda = Infinity;
  let melhorEpoca = 0;
  let melhoresPesos = null; // tf.Tensor[] clonados
  let semMelhora = 0;
  let paradaPorPaciencia = false;

  try {
    for (let epoca = 1; epoca <= limite; epoca++) {
      const ordem = embaralhar(indices, criarAleatorio(sementeEmbaralhamento(semente, epoca)));
      const ex = new Float32Array(n * dim);
      const ey = new Float32Array(n);
      ordem.forEach((origem, k) => {
        ex.set(x.subarray(origem * dim, (origem + 1) * dim), k * dim);
        ey[k] = y[origem];
      });
      const tx = tf.tensor2d(ex, [n, dim]);
      const ty = tf.tensor2d(ey, [n, 1]);
      let perda;
      try {
        const h = await modelo.fit(tx, ty, { epochs: 1, batchSize: TAMANHO_LOTE, shuffle: false, verbose: 0 });
        perda = h.history.loss[0];
      } finally {
        tx.dispose();
        ty.dispose();
      }
      if (!Number.isFinite(perda)) throw new Error(`perda não finita na época ${epoca}: confira a entrada e a taxa de aprendizado`);
      const pv = automatico ? await calcularValidacao(modelo) : null;
      if (automatico && !Number.isFinite(pv)) throw new Error(`perda de validação não finita na época ${epoca}`);
      historico.push({ epoca, perda, perdaValidacao: pv });
      if (aoFimDaEpoca) aoFimDaEpoca({ epoca, perda, perdaValidacao: pv, pesos: copiarPesos(modelo) });

      if (!automatico) { melhorEpoca = epoca; continue; }
      if (pv < melhorPerda) {
        melhorPerda = pv;
        melhorEpoca = epoca;
        semMelhora = 0;
        if (melhoresPesos) melhoresPesos.forEach((t) => t.dispose());
        melhoresPesos = modelo.getWeights().map((w) => w.clone());
      } else if (++semMelhora >= paciencia) {
        paradaPorPaciencia = true;
        break;
      }
    }
    if (automatico && melhoresPesos) modelo.setWeights(melhoresPesos);
  } finally {
    if (melhoresPesos) melhoresPesos.forEach((t) => t.dispose());
  }
  return {
    melhorEpoca,
    epocasTreinadas: historico.length,
    atingiuTeto: automatico && !paradaPorPaciencia && historico.length === maxEpocas,
    historico,
  };
}

/** Probabilidades da rede para cada linha de x (n × dim), em lotes; NaN gera erro. */
export function prever(modelo, x, dim) {
  const esperado = modelo.inputs[0].shape[1];
  if (dim !== esperado) throw new Error(`prever: dim=${dim}, mas o modelo espera ${esperado} colunas`);
  const n = contarLinhas(x, dim, 'x');
  const saida = new Float32Array(n);
  for (let ini = 0; ini < n; ini += LOTE_PREVISAO) {
    const fim = Math.min(n, ini + LOTE_PREVISAO);
    const lote = tf.tidy(() => {
      const t = tf.tensor2d(x.subarray(ini * dim, fim * dim), [fim - ini, dim]);
      return modelo.predict(t, { batchSize: LOTE_PREVISAO }).dataSync();
    });
    saida.set(lote, ini);
  }
  if (saida.some(Number.isNaN)) throw new Error('prever: o modelo devolveu NaN; confira se a entrada tem NaN ou valores fora da escala');
  return saida;
}

/** Salva model.json + weights.bin + regua.json + metadados.json em `dir`. */
export async function salvarModelo(modelo, dir, { regua, metadados }) {
  const pasta = path.resolve(dir);
  fs.mkdirSync(pasta, { recursive: true });
  await modelo.save('file://' + pasta);
  fs.writeFileSync(path.join(pasta, 'regua.json'), jsonEstavel(regua));
  fs.writeFileSync(path.join(pasta, 'metadados.json'), JSON.stringify(metadados, null, 2));
}

/** Carrega o modelo de `dir`; erro se faltar arquivo ou se a régua salva tiver outro hash. */
export async function carregarModelo(dir, reguaEmUso) {
  const pasta = path.resolve(dir);
  const fase = reguaEmUso.fase;
  for (const f of ['model.json', 'weights.bin', 'regua.json', 'metadados.json']) {
    if (!fs.existsSync(path.join(pasta, f))) {
      throw new Error(`modelo ausente: falta ${path.join(pasta, f)}; rode npm run treinar -- --fase ${fase}`);
    }
  }
  const metadados = JSON.parse(fs.readFileSync(path.join(pasta, 'metadados.json'), 'utf8'));
  const reguaSalva = JSON.parse(fs.readFileSync(path.join(pasta, 'regua.json'), 'utf8'));
  if (reguaSalva.hash !== reguaEmUso.hash) {
    throw new Error(`modelo treinado com outra régua: retreine com npm run treinar -- --fase ${metadados.fase ?? fase}`);
  }
  const modelo = await tf.loadLayersModel('file://' + path.join(pasta, 'model.json'));
  return { modelo, metadados };
}
