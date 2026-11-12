// Script 05 (npm run verificar-hnsw): mede se o índice HNSW (aproximado) devolve os mesmos vizinhos
// que a busca exata, para cada usuário de validação, com N = 20, 50 e 100.
// Grava resultados/verificacao-hnsw.json e avisa se a concordância ficar abaixo de 99%.

import 'dotenv/config';
import fs from 'node:fs';
import { carregarConfig } from '../src/config.js';
import { criarContexto } from '../src/contexto.js';
import { carregarRegua } from '../src/features/regua.js';
import { perfilUsuario, vetorBuscaUsuario } from '../src/features/codificacao.js';
import { vistosPorUsuario } from '../src/candidatos/populares.js';
import { criarPool, verificarConexao } from '../src/banco/conexao.js';
import { lerHashCarregado } from '../src/banco/carga.js';
import { buscarVizinhos, planoDaBusca, parametrosHnsw, efSearchPara, linhasIniciais, REGRA_EF_SEARCH } from '../src/banco/busca.js';

// O pgvector sorteia o nível de cada nó ao construir o índice: rodar de novo na mesma carga dá o mesmo resultado.
const REPRODUTIBILIDADE = "idêntica por carga do índice HNSW; recarregar o banco reconstrói o grafo e pode alterar levemente os números";
const NS = [20, 50, 100];
const f = (x, d = 4) => x.toFixed(d).replace('.', ',');

const { pg: configPg, dirDados } = carregarConfig();
const regua = carregarRegua('artefatos/regua-exp.json');
const { dataset, treino, alvos, regua: reguaCalculada } = criarContexto({ fase: 'exp', dirDados });
if (reguaCalculada.hash !== regua.hash) {
  throw new Error('régua do arquivo difere da calculada a partir dos dados: rode npm run carregar-filmes (recalcula e regrava artefatos/regua-exp.json e recarrega a tabela filmes)');
}

const filmePorId = new Map(dataset.filmes.map((x) => [x.id, x]));
const vistos = vistosPorUsuario(treino);
// Filmes curtidos (nota ≥ 4) de cada usuário no treino: a base do perfil.
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
  const hashBanco = await lerHashCarregado(pool);
  if (hashBanco === null) throw new Error('banco sem filmes carregados: rode npm run carregar-filmes');
  if (hashBanco !== regua.hash) throw new Error(`régua do banco difere: rode npm run carregar-filmes -- --fase ${regua.fase}`);
  const planoHnsw = await planoDaBusca(pool, 'hnsw');
  const planoExata = await planoDaBusca(pool, 'exata');
  if (!/Index Scan using filmes_embedding_idx/.test(planoHnsw) || !/Seq Scan/.test(planoExata)) {
    throw new Error(`EXPLAIN inesperado: braço hnsw sem Index Scan no índice HNSW (filmes_embedding_idx) ou braço exato sem Seq Scan\n${planoHnsw}\n${planoExata}`);
  }

  const soma = Object.fromEntries(NS.map((n) => [n, 0]));
  const maxLinhas = Object.fromEntries(NS.map((n) => [n, linhasIniciais(n)]));
  let nUsuarios = 0;
  for (const u of usuarios) {
    const perfil = perfilUsuario(curtidas.get(u) ?? [], regua);
    if (!perfil) continue;
    const vetor = vetorBuscaUsuario(perfil, regua);
    const excluir = [...(vistos.get(u) ?? [])].sort((x, y) => x - y);
    nUsuarios++;
    for (const n of NS) {
      const exata = await buscarVizinhos(pool, { vetor, excluir, n, regua, modo: 'exata' });
      const relatorio = {};
      const hnsw = new Set((await buscarVizinhos(pool, { vetor, excluir, n, regua, modo: 'hnsw', relatorio })).map((x) => x.id));
      maxLinhas[n] = Math.max(maxLinhas[n], relatorio.linhasPedidas);
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
    reprodutibilidade: REPRODUTIBILIDADE,
    hashRegua: regua.hash,
    nUsuarios: Object.fromEntries(NS.map((n) => [n, nUsuarios])),
    fracaoMedia,
    parametros,
    regraEfSearch: REGRA_EF_SEARCH,
    efSearchPorN: Object.fromEntries(NS.map((n) => [n, efSearchPara(maxLinhas[n])])),
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
