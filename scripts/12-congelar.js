// Script 12 (npm run congelar): congela a configuração final antes de qualquer contato com o u1.test.
//   npm run congelar -- --modelo <nome> --controle <nome>-sempop
// - Lê resultados/treino-<modelo>-exp.json e resultados/treino-<controle>-exp.json (melhorEpoca de cada
//   semente), resultados/grade-validacao.json (escolhidaKN), resultados/comparacao-passo2.json e
//   comparacao-passo4.json (para conferir a ordem dos passos) e o hash de artefatos/regua-exp.json.
// - Recusa se resultados/avaliacao-final.json já existir: a configuração não pode mudar depois do teste.
// Grava resultados/configuracao-final.json. Não usa o banco e não lê u1.test.

import fs from 'node:fs';
import { carregarRegua } from '../src/features/regua.js';

const SEMENTES = [1, 2, 3];
const ESCALA = 'media de popEscalada dos curtidos no treino';

/** Lê os argumentos da linha de comando; falha alto com o uso correto se algo estiver errado. */
function lerArgumentos(argv) {
  const uso = 'uso: npm run congelar -- --modelo <nome> --controle <nome>-sempop';
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const nome = argv[i];
    if (nome !== '--modelo' && nome !== '--controle') throw new Error(`argumento desconhecido "${nome}"\n${uso}`);
    const valor = argv[++i];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`falta o valor de ${nome}\n${uso}`);
    a[nome.slice(2)] = valor;
  }
  if (!a.modelo || !a.controle) throw new Error(`--modelo e --controle são obrigatórios\n${uso}`);
  if (a.controle !== `${a.modelo}-sempop`) throw new Error(`--controle deve ser ${a.modelo}-sempop (o modelo sem popularidade)\n${uso}`);
  return a;
}

/** Lê um JSON de resultados; ausente é erro com o comando que o produz. */
function lerJson(arq, comando) {
  if (!fs.existsSync(arq)) throw new Error(`${arq} ausente: rode ${comando} antes de congelar`);
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

/** Épocas por semente ({ "1": e, "2": e, "3": e }) de um treino da exp, conferindo o que se espera dele. */
function epocasDoTreino(nome, semPop, hashRegua) {
  const arq = `resultados/treino-${nome}-exp.json`;
  const t = lerJson(arq, `npm run treinar -- --fase exp ...${semPop ? ' --sem-pop' : ''} (modelo ${nome})`);
  if (t.nome !== nome || t.fase !== 'exp') throw new Error(`${arq} não é do modelo ${nome} na fase exp (${t.nome}, ${t.fase})`);
  if (Boolean(t.semPop) !== semPop) throw new Error(`${arq}: semPop=${t.semPop}, esperado ${semPop}`);
  if (t.hashRegua !== hashRegua) throw new Error(`${arq} foi treinado com outra régua: retreine com a régua-exp atual`);
  const epocas = {};
  for (const s of SEMENTES) {
    const e = t.sementes?.find((x) => x.semente === s)?.melhorEpoca;
    if (!Number.isInteger(e) || e < 1) throw new Error(`${arq} sem melhorEpoca válida para a semente ${s}; refaça o treino`);
    epocas[String(s)] = e;
  }
  return { treino: t, epocas };
}

// ---------------------------------------------------------------------------------------------

const args = lerArgumentos(process.argv.slice(2));

if (fs.existsSync('resultados/avaliacao-final.json')) {
  throw new Error('a avaliação final já foi feita; a configuração não pode mudar depois do teste');
}

const regua = carregarRegua('artefatos/regua-exp.json');
if (regua.fase !== undefined && regua.fase !== 'exp') throw new Error(`artefatos/regua-exp.json é da fase ${regua.fase}`);

const p2 = lerJson('resultados/comparacao-passo2.json', 'npm run comparar -- --passo 2');
if (p2.escolha?.escolhida !== args.modelo) {
  throw new Error(`--modelo ${args.modelo} não é o escolhido no passo 2 (${p2.escolha?.escolhida})`);
}
const grade = lerJson('resultados/grade-validacao.json', `npm run grade -- --modelo ${args.modelo} --perdedor-passo1 <nome>`);
if (grade.modelo !== args.modelo) {
  throw new Error(`resultados/grade-validacao.json é do modelo ${grade.modelo}, não de ${args.modelo}: refaça o passo 3`);
}
const { k, n } = grade.escolhidaKN ?? {};
if (![50, 100, 150, 200].includes(k) || ![0, 20, 50, 100].includes(n)) {
  throw new Error('resultados/grade-validacao.json sem escolhidaKN válida; refaça o passo 3');
}
const p4 = lerJson('resultados/comparacao-passo4.json', `npm run comparar -- --passo 4 --modelos ${args.modelo},${args.controle}`);
if (p4.modelos?.[0]?.nome !== args.modelo || p4.controle?.modelo !== args.controle || p4.k !== k || p4.n !== n) {
  throw new Error(`resultados/comparacao-passo4.json não corresponde a ${args.modelo} × ${args.controle} em (K, N) = (${k}, ${n}): refaça o passo 4`);
}

const modelo = epocasDoTreino(args.modelo, false, regua.hash);
const controle = epocasDoTreino(args.controle, true, regua.hash);
const { negativos, arquitetura } = modelo.treino;
if (controle.treino.negativos !== negativos || controle.treino.arquitetura !== arquitetura) {
  throw new Error(`o controle ${args.controle} não tem os mesmos negativos/arquitetura de ${args.modelo}`);
}
if (`${negativos}-${arquitetura}` !== args.modelo) {
  throw new Error(`nome do modelo ${args.modelo} não corresponde a negativos=${negativos}, arquitetura=${arquitetura}`);
}

const configuracao = {
  negativos,
  arquitetura,
  k,
  n,
  modelo: args.modelo,
  controle: args.controle,
  epocasPorSemente: { modelo: modelo.epocas, controle: controle.epocas },
  seed_api: 1,
  escalaMainstream: ESCALA,
  sementeBootstrap: 2026,
  hashReguaExp: regua.hash,
  data: new Date().toISOString(),
};
const arquivoSaida = 'resultados/configuracao-final.json';
fs.writeFileSync(arquivoSaida, JSON.stringify(configuracao, null, 2) + '\n');
console.log(JSON.stringify(configuracao, null, 2));
console.log(`\ngravado: ${arquivoSaida}`);
