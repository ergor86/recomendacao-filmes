// Script 08 (npm run gerar-candidatos -- --fase exp|final): gera os candidatos de TODO usuário do
// treino da fase (200 populares não vistos + 100 vizinhos vetoriais, ou [] sem curtidas) e grava
// artefatos/candidatos-<fase>.json com hash da régua e sha256. O banco precisa estar na régua da fase.
// Na fase exp, confere também a referência aleatória do ruling R9 (ordem aleatória dos 200 populares,
// NDCG@10 esperado ≈ 0,072) e grava resultados/referencia-aleatoria.json; acima de 0,10 sai com código 2.
// Não lê u1.test (não usa incluirTeste).

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua } from '../src/features/regua.js';
import { historicoDoTreino } from '../src/features/entrada.js';
import { rankingPopularidade, popularesNaoVistos } from '../src/candidatos/populares.js';
import { gerarCandidatos } from '../src/candidatos/hibrido.js';
import { montarArquivoCandidatos } from '../src/candidatos/arquivo.js';
import { avaliarSistema, relevantesPorUsuario } from '../src/avaliacao/metricas.js';
import { criarAleatorio, embaralhar } from '../src/util/aleatorio.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';

const i = process.argv.indexOf('--fase');
const fase = i >= 0 ? process.argv[i + 1] : 'exp';
if (fase !== 'exp' && fase !== 'final') {
  console.error(`fase inválida: ${fase} (use --fase exp ou --fase final)`);
  process.exit(1);
}

const { pg: configPg, dirDados } = carregarConfig();
const regua = carregarRegua(`artefatos/regua-${fase}.json`);
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase, dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error(`régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes -- --fase ${fase}`);
}

const filmesPorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const historico = historicoDoTreino(treino, filmesPorId);
const ranking = rankingPopularidade(regua.contagens);
const usuarios = [...historico.keys()].sort((a, b) => a - b);

const porUsuario = {};
const pool = criarPool(configPg);
try {
  await verificarConexao(pool);
  for (const u of usuarios) {
    const { notas, curtidos } = historico.get(u);
    const vistos = new Set(notas.keys());
    const { ids: vizinhos } = await gerarCandidatos({ pool, regua, vistos, filmesCurtidos: curtidos, ranking, k: 0, n: 100 });
    porUsuario[String(u)] = { populares: popularesNaoVistos(ranking, vistos, 200), vizinhos };
  }
} finally {
  await pool.end();
}

const arquivo = montarArquivoCandidatos(fase, regua.hash, porUsuario);
fs.mkdirSync('artefatos', { recursive: true });
fs.writeFileSync(`artefatos/candidatos-${fase}.json`, JSON.stringify(arquivo));

const vals = Object.values(porUsuario);
const minMax = (campo) => [Math.min(...vals.map((v) => v[campo].length)), Math.max(...vals.map((v) => v[campo].length))];
console.log(`== Candidatos (fase ${fase}) ==`);
console.log(`usuários: ${vals.length}`);
console.log(`populares: min/max ${minMax('populares').join('/')}`);
console.log(`vizinhos: min/max ${minMax('vizinhos').join('/')}; sem vizinhos: ${vals.filter((v) => v.vizinhos.length === 0).length}`);
console.log(`sha256: ${arquivo.sha256}`);

// Referência aleatória do R9 (só na exp: usa os alvos da validação).
if (fase === 'exp') {
  const relevantes = relevantesPorUsuario(alvos);
  const top10 = new Map();
  for (const u of relevantes.keys()) {
    top10.set(u, embaralhar(porUsuario[String(u)].populares, criarAleatorio(9_000_000 + u)).slice(0, 10));
  }
  const { ndcg, nUsuarios } = avaliarSistema(top10, relevantes, regua.contagens);
  fs.mkdirSync('resultados', { recursive: true });
  fs.writeFileSync('resultados/referencia-aleatoria.json', JSON.stringify({ ndcg, nUsuarios, semente: '9_000_000 + usuario' }, null, 2) + '\n');
  console.log(`referência aleatória (R9): NDCG@10 = ${ndcg.toFixed(4)} em ${nUsuarios} usuários`);
  if (ndcg > 0.10) {
    console.error('ATENÇÃO: referência aleatória acima de 0,10; o limite inferior de 0,15 do R9 fica perto demais do acaso. Pare e revise o R9 antes da Task 8.');
    process.exit(2);
  }
}
