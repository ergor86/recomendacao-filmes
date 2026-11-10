// Script 06 (npm run linha-de-base): avalia a linha de base por popularidade na validação.
// Para cada usuário, recomenda os 10 filmes mais populares que ele não viu e mede NDCG@10, P@10,
// R@10 e cobertura. Grava resultados/linha-de-base-validacao.json.
// É o número que a rede neural precisa superar.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { avaliarSistema, relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { rankingPopularidade, popularesNaoVistos, vistosPorUsuario } from '../src/candidatos/populares.js';

const f = (x, d = 4) => x.toFixed(d).replace('.', ',');
const { dirDados } = carregarConfig();
const { treino, alvos, regua } = criarContexto({ fase: 'exp', dirDados });

const ranking = rankingPopularidade(regua.contagens);
const vistos = vistosPorUsuario(treino);
const relevantes = relevantesPorUsuario(alvos);
// Top 10 de cada usuário com relevantes: os 10 filmes mais populares que ele não viu.
const top10 = new Map();
for (const usuario of relevantes.keys()) {
  top10.set(usuario, popularesNaoVistos(ranking, vistos.get(usuario) ?? new Set(), 10));
}
const r = avaliarSistema(top10, relevantes, regua.contagens);

console.log('== Linha de base: popularidade (validação) ==');
console.log(`  NDCG@10: ${f(r.ndcg)}`);
console.log(`  P@10: ${f(r.precisao)}`);
console.log(`  R@10: ${f(r.recall)}`);
console.log(`  cobertura: ${r.cobertura}`);
console.log(`  popularidade média (contagem de avaliações no treino): ${f(r.popularidadeMediaContagem, 2)}`);
console.log(`  nUsuarios: ${r.nUsuarios}`);

const { ndcg, precisao, recall, cobertura, popularidadeMediaContagem, nUsuarios } = r;
const saida = { fase: 'exp', hashRegua: regua.hash, semente: 42, ndcg, precisao, recall, cobertura, popularidadeMediaContagem, nUsuarios };
fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync('resultados/linha-de-base-validacao.json', JSON.stringify(saida, null, 2) + '\n');
