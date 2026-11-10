// Script 03 (npm run eda): análise exploratória dos dados.
// Mostra a distribuição das notas, os filmes por época, as notas por usuário e por filme, e compara
// os usuários de validação com os de teste (precisam ser parecidos para a validação valer).
// Só imprime no terminal: não grava arquivos e não calcula métricas no teste.

import 'dotenv/config';
import { carregarConfig } from '../src/config.js';
import { carregarDataset } from '../src/dados/carregar.js';
import { criarDivisoes } from '../src/dados/divisoes.js';
import { calcularRegua, popEscalada } from '../src/features/regua.js';
import { distribuicaoNotas, resumoPopulacao, resumoLista } from '../src/dados/estatisticas.js';

const f = (x, d = 1) => x.toFixed(d).replace('.', ',');
const { dirDados } = carregarConfig();
const { base, teste, filmes, usuarios, generos, ocupacoes } = carregarDataset(dirDados);
const { treinoExp, validacao } = criarDivisoes({ base, teste }, { semente: 42 });

console.log('== Distribuição das notas (u.data = base + teste) ==');
const dist = distribuicaoNotas([...base, ...teste]);
for (const k of [1, 2, 3, 4, 5]) console.log(`  nota ${k}: ${dist[k]}`);

console.log('\n== Filmes por época ==');
const faixas = { 'antes de 1980': 0, 'anos 80': 0, 'anos 90': 0, 'sem data': 0 };
for (const fm of filmes) {
  if (fm.ano == null) faixas['sem data']++;
  else if (fm.ano < 1980) faixas['antes de 1980']++;
  else if (fm.ano < 1990) faixas['anos 80']++;
  else faixas['anos 90']++;
}
for (const [k, v] of Object.entries(faixas)) console.log(`  ${k}: ${v} (${f((100 * v) / filmes.length)}%)`);

console.log('\n== Notas por usuário e por filme (base + teste) ==');
const todas = [...base, ...teste];
const contar = (chave) => {
  const m = new Map();
  for (const a of todas) m.set(a[chave], (m.get(a[chave]) ?? 0) + 1);
  return [...m.values()];
};
for (const [nome, chave] of [['por usuário', 'usuario'], ['por filme', 'filme']]) {
  const r = resumoLista(contar(chave));
  console.log(`  ${nome}: min ${r.min} / mediana ${f(r.mediana)} / média ${f(r.media)} / max ${r.max}`);
}

const idsTeste = [...new Set(teste.map((a) => a.usuario))].sort((a, b) => a - b);
const idsVal = [...new Set(validacao.map((a) => a.usuario))].sort((a, b) => a - b);
const t = resumoPopulacao(base, idsTeste, usuarios);
const v = resumoPopulacao(treinoExp, idsVal, usuarios);

console.log('\n== Comparabilidade validação × teste (spec §3) ==');
console.log(`  usuários: teste ${idsTeste.length} (histórico u1.base) | validação ${idsVal.length} (histórico treino-exp)`);
const linha = (nome, a, b) => console.log(`  ${nome.padEnd(38)} ${a.padEnd(12)} ${b}`);
linha('', 'Teste', 'Validação');
linha('Notas por usuário (média / mediana)', `${f(t.notasMedia)} / ${f(t.notasMediana, 0)}`, `${f(v.notasMedia)} / ${f(v.notasMediana, 0)}`);
linha('Curtidas por usuário (média / mediana)', `${f(t.curtidasMedia)} / ${f(t.curtidasMediana, 0)}`, `${f(v.curtidasMedia)} / ${f(v.curtidasMediana, 0)}`);
linha('Idade média', f(t.idadeMedia), f(v.idadeMedia));
linha('Mulheres', `${f(100 * t.fracaoMulheres)}%`, `${f(100 * v.fracaoMulheres)}%`);

// Popularidade média dos curtidos (spec §3): só dados de treino. Régua exp para a validação,
// régua final (treino = u1.base) para o teste; popEscalada de cada filme curtido, média por usuário e depois entre usuários.
const popMediaCurtidos = (treino, ids) => {
  const regua = calcularRegua({ treino, filmes, usuarios, generos, ocupacoes });
  const pops = new Map(ids.map((id) => [id, []]));
  for (const a of treino) {
    if (a.nota >= 4 && pops.has(a.usuario)) pops.get(a.usuario).push(popEscalada(regua.contagens[a.filme] ?? 0, regua));
  }
  const medias = [...pops.values()].filter((p) => p.length > 0).map((p) => p.reduce((s, x) => s + x, 0) / p.length);
  return medias.reduce((s, x) => s + x, 0) / medias.length;
};
linha('Popularidade média dos curtidos (0-1)', f(popMediaCurtidos(base, idsTeste), 3), f(popMediaCurtidos(treinoExp, idsVal), 3));
console.log('  P@10 da popularidade no conjunto de teste não é calculado de propósito: o teste é lido uma única vez, na avaliação final (regra do teste único).');
