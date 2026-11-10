import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua } from '../src/features/regua.js';
import { perfilUsuario, vetorBuscaUsuario, validarVetor } from '../src/features/codificacao.js';
import { vistosPorUsuario } from '../src/candidatos/populares.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { buscarVizinhos, planoDaBusca, parametrosHnsw } from '../src/banco/busca.js';

const NS = [20, 50, 100];
const f = (x, d = 4) => x.toFixed(d).replace('.', ',');

const { pg: configPg, dirDados } = carregarConfig();
const regua = carregarRegua('artefatos/regua-exp.json');
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase: 'exp', dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error('régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes');
}

const filmePorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const vistos = vistosPorUsuario(treino);
const curtidas = new Map();
for (const a of treino) {
  if (a.nota >= 4) {
    if (!curtidas.has(a.usuario)) curtidas.set(a.usuario, []);
    curtidas.get(a.usuario).push(filmePorId.get(a.filme));
  }
}
const usuarios = [...new Set(alvos.map((a) => a.usuario))].sort((x, y) => x - y);

const pool = criarPool(configPg);
try {
  await verificarConexao(pool);
  const planoHnsw = await planoDaBusca(pool, 'hnsw');
  const planoExata = await planoDaBusca(pool, 'exata');
  if (!/Index Scan/.test(planoHnsw) || !/Seq Scan/.test(planoExata)) {
    throw new Error(`EXPLAIN inesperado: braço hnsw sem Index Scan ou braço exato sem Seq Scan\n${planoHnsw}\n${planoExata}`);
  }

  const soma = Object.fromEntries(NS.map((n) => [n, 0]));
  let nUsuarios = 0;
  for (const u of usuarios) {
    const perfil = perfilUsuario(curtidas.get(u) ?? [], regua);
    if (!perfil) continue;
    const vetor = vetorBuscaUsuario(perfil, regua);
    validarVetor(vetor, regua.dimensoes.busca);
    const excluir = [...(vistos.get(u) ?? [])].sort((x, y) => x - y);
    nUsuarios++;
    for (const n of NS) {
      const exata = await buscarVizinhos(pool, { vetor, excluir, n, regua, modo: 'exata' });
      const hnsw = new Set((await buscarVizinhos(pool, { vetor, excluir, n, regua, modo: 'hnsw' })).map((x) => x.id));
      soma[n] += exata.filter((x) => hnsw.has(x.id)).length / n;
    }
  }
  if (nUsuarios === 0) throw new Error('nenhum usuário de validação com perfil; confira os dados em data/');

  const parametros = await parametrosHnsw(pool);
  const fracaoMedia = Object.fromEntries(NS.map((n) => [n, soma[n] / nUsuarios]));
  console.log('== Verificação do HNSW (fase exp, validação) ==');
  console.log(`  usuários: ${nUsuarios}`);
  for (const n of NS) console.log(`  N = ${n}: fração média dos vizinhos exatos recuperada = ${f(fracaoMedia[n])}`);
  console.log(`  parâmetros: ${JSON.stringify(parametros)}`);

  const saida = {
    fase: 'exp',
    hashRegua: regua.hash,
    nUsuarios: Object.fromEntries(NS.map((n) => [n, nUsuarios])),
    fracaoMedia,
    parametros,
  };
  fs.mkdirSync('resultados', { recursive: true });
  fs.writeFileSync('resultados/verificacao-hnsw.json', JSON.stringify(saida, null, 2) + '\n');
  if (NS.some((n) => fracaoMedia[n] < 0.99)) {
    console.error('ATENÇÃO: fração abaixo de 0,99 em algum N; não ajuste para encaixar, leve os números ao responsável.');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
