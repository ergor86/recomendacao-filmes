import 'dotenv/config';
import { carregarConfig } from '../src/config.js';
import { carregarDataset } from '../src/dados/carregar.js';
import { criarDivisoes } from '../src/dados/divisoes.js';
import { distribuicaoNotas, resumoPopulacao, resumoLista } from '../src/dados/estatisticas.js';

const f = (x, d = 1) => x.toFixed(d).replace('.', ',');
const { dirDados } = carregarConfig();
const { base, teste, filmes, usuarios } = carregarDataset(dirDados);
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
console.log('  (popularidade média dos curtidos e P@10 da popularidade dependem da régua: Task 6)');
