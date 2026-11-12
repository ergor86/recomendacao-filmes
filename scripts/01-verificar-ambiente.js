// Script 01 (npm run ambiente): confere se o ambiente está pronto.
// 1. Mostra a versão do Node e treina uma rede minúscula com dados aleatórios (prova que o tfjs-node funciona).
// 2. Conecta no Postgres e confere se a extensão pgvector está na versão 0.8.x.

import 'dotenv/config';
import * as tf from '@tensorflow/tfjs-node';
import pg from 'pg';
import { carregarConfig } from '../src/config.js';

console.log(`Node ${process.version}`);
await tf.ready();
console.log(`Backend do TensorFlow.js: ${tf.getBackend()}`);

const x = tf.randomUniform([1000, 70]);
const y = tf.randomUniform([1000, 1]).round();
const modelo = tf.sequential({
  layers: [
    tf.layers.dense({ units: 8, activation: 'relu', inputShape: [70] }),
    tf.layers.dense({ units: 1, activation: 'sigmoid' }),
  ],
});
modelo.compile({ optimizer: 'adam', loss: 'binaryCrossentropy' });
const inicio = performance.now();
await modelo.fit(x, y, { epochs: 2, verbose: 0 });
console.log(`Treino de 2 épocas em 1000 linhas: ${(performance.now() - inicio).toFixed(0)} ms`);

let config;
try {
  config = carregarConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const INALCANCAVEL = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'];
const cliente = new pg.Client(config.pg);
try {
  await cliente.connect();
} catch (err) {
  const inalcancavel = INALCANCAVEL.includes(err.code) || err.errors?.some((e) => INALCANCAVEL.includes(e.code));
  console.error(inalcancavel ? 'banco fora do ar: rode docker compose up -d' : err.message);
  process.exit(1);
}
try {
  await cliente.query('CREATE EXTENSION IF NOT EXISTS vector');
  const { rows } = await cliente.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  const versao = rows[0]?.extversion;
  if (!versao || !versao.startsWith('0.8')) {
    console.error(`pgvector esperado 0.8.x, encontrado: ${versao ?? 'extensão ausente'}. Confira a tag da imagem no docker-compose.yml.`);
    process.exit(1);
  }
  console.log(`pgvector extversion: ${versao}`);
} finally {
  await cliente.end();
}
