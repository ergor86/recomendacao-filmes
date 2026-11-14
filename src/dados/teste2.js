// Teste-2: notas escondidas dos usuários 1–462 dentro do próprio u1.base, para avaliar o Plano 3
// sem tocar no u1.test. O acesso fica restrito a este módulo e a src/contexto.js (spec §3.2).

import crypto from 'node:crypto';
import { criarAleatorio, embaralhar } from '../util/aleatorio.js';
import { jsonEstavel } from '../util/json-estavel.js';
import { carregarDataset } from './carregar.js';
import { criarDivisoes } from './divisoes.js';
import { mediana } from './estatisticas.js';

export const FRACAO_TESTE2 = 0.2;
export const SEMENTE_TESTE2 = 20_000_000;
export const USUARIOS_TESTE2 = [1, 462];

/**
 * Separa o teste-2 do u1.base. Para cada usuário de 1 a 462: ordena as notas por filme,
 * embaralha com criarAleatorio(SEMENTE_TESTE2 + usuario) e esconde as primeiras
 * Math.round(FRACAO_TESTE2 × n) (mesmo algoritmo de criarDivisoes).
 * @param base avaliações de u1.base ({ usuario, filme, nota, timestamp })
 * @returns { teste2, semTeste2 } (semTeste2 mantém a ordem original da base)
 */
export function dividirTeste2(base) {
  const [minimo, maximo] = USUARIOS_TESTE2;
  const porUsuario = new Map();
  for (const a of base) {
    if (a.usuario < minimo || a.usuario > maximo) continue;
    if (!porUsuario.has(a.usuario)) porUsuario.set(a.usuario, []);
    porUsuario.get(a.usuario).push(a);
  }

  const escondidas = new Set();
  const teste2 = [];
  const ids = [...porUsuario.keys()].sort((x, y) => x - y);
  for (const id of ids) {
    const ordenadas = [...porUsuario.get(id)].sort((x, y) => x.filme - y.filme);
    const mistura = embaralhar(ordenadas, criarAleatorio(SEMENTE_TESTE2 + id));
    const k = Math.round(FRACAO_TESTE2 * mistura.length);
    for (const a of mistura.slice(0, k)) {
      escondidas.add(a);
      teste2.push(a);
    }
  }
  return { teste2, semTeste2: base.filter((a) => !escondidas.has(a)) };
}

/**
 * Hash sha256 (hex) das avaliações: jsonEstavel dos triplos [usuario, filme, nota]
 * ordenados por usuário e filme; não depende da ordem de entrada.
 */
export function hashAvaliacoes(avaliacoes) {
  const triplos = avaliacoes
    .map((a) => [a.usuario, a.filme, a.nota])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return crypto.createHash('sha256').update(jsonEstavel(triplos)).digest('hex');
}

/**
 * Estatísticas de uma lista de números: média, mediana clássica e percentis 10, 25, 75 e 90
 * pelo posto mais próximo (ordenados[ceil(p·n) − 1]). Lista vazia: tudo 0.
 * @returns { media, mediana, p10, p25, p75, p90 }
 */
export function calcularEst(valores) {
  const n = valores.length;
  if (n === 0) return { media: 0, mediana: 0, p10: 0, p25: 0, p75: 0, p90: 0 };
  const o = [...valores].sort((a, b) => a - b);
  const pct = (p) => o[Math.ceil(p * n) - 1];
  return {
    media: o.reduce((s, x) => s + x, 0) / n,
    mediana: mediana(o),
    p10: pct(0.1),
    p25: pct(0.25),
    p75: pct(0.75),
    p90: pct(0.9),
  };
}

// Resume um conjunto de usuários: notas disponíveis (no treino da fase), notas escondidas e
// curtidas (nota ≥ 4) escondidas por usuário, incluindo os usuários com zero (sem listas por usuário).
function resumirConjunto(usuarios, disponiveis, escondidas) {
  const contar = (avaliacoes, filtro = () => true) => {
    const m = new Map(usuarios.map((u) => [u, 0]));
    for (const a of avaliacoes) if (m.has(a.usuario) && filtro(a)) m.set(a.usuario, m.get(a.usuario) + 1);
    return usuarios.map((u) => m.get(u));
  };
  const curtidas = contar(escondidas, (a) => a.nota >= 4);
  return {
    notasDisponiveis: calcularEst(contar(disponiveis)),
    notasEscondidas: calcularEst(contar(escondidas)),
    curtidasEscondidas: calcularEst(curtidas),
    semCurtidas: curtidas.filter((c) => c === 0).length,
    avaliaveis: curtidas.filter((c) => c > 0).length,
  };
}

/**
 * Registro das divisões do Plano 3 (Passo 0): hashes das divisões e agregados (sem listas por
 * usuário) da validação (463–943, treino = treinoExp da v2-exp) e do teste-2 (1–462, treino = semTeste2).
 * Os agregados nunca alimentam escolhas (spec §3.2).
 * @returns { hashes: { teste2, validacao, treinoV2Exp, treinoV2Final }, validacao, teste2 }
 */
export function resumoDivisoesV2(dirDados) {
  const { base, usuarios } = carregarDataset(dirDados);
  const { teste2, semTeste2 } = dividirTeste2(base);
  const { treinoExp, validacao } = criarDivisoes({ base: semTeste2, teste: null }, { semente: 42 });
  const ids = (min, max) => usuarios.map((u) => u.id).filter((id) => id >= min && id <= max).sort((a, b) => a - b);
  return {
    hashes: {
      teste2: hashAvaliacoes(teste2),
      validacao: hashAvaliacoes(validacao),
      treinoV2Exp: hashAvaliacoes(treinoExp),
      treinoV2Final: hashAvaliacoes(semTeste2),
    },
    validacao: resumirConjunto(ids(463, 943), treinoExp, validacao),
    teste2: resumirConjunto(ids(USUARIOS_TESTE2[0], USUARIOS_TESTE2[1]), semTeste2, teste2),
  };
}
