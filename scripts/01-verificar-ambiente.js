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

const cliente = new pg.Client(carregarConfig().pg);
try {
  await cliente.connect();
} catch {
  console.error('banco fora do ar: rode docker compose up -d');
  process.exit(1);
}
try {
  await cliente.query('CREATE EXTENSION IF NOT EXISTS vector');
  const { rows } = await cliente.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  console.log(`pgvector extversion: ${rows[0].extversion}`);
} finally {
  await cliente.end();
}
