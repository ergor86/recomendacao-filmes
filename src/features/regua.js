import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { jsonEstavel } from '../util/json-estavel.js';

// A régua guarda todos os parâmetros para codificar vetores de forma idêntica em qualquer lugar.
export function faixaEpoca(ano) {
  if (ano === null || ano === undefined) return null;
  if (ano < 1980) return 0;
  if (ano < 1990) return 1;
  return 2;
}

export function popEscalada(n, regua) {
  const { min, max } = regua.logPop;
  const v = (Math.log1p(n) - min) / (max - min);
  return Math.min(1, Math.max(0, v));
}

export function popZ(n, regua) {
  return (Math.log1p(n) - regua.logPopZ.media) / regua.logPopZ.desvio;
}

function mediaDesvio(valores) {
  const n = valores.length;
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const variancia = valores.reduce((a, b) => a + (b - media) ** 2, 0) / n;
  return { media, desvio: Math.sqrt(variancia) };
}

function calcularHash(regua) {
  const { hash, ...semHash } = regua;
  return crypto.createHash('sha256').update(jsonEstavel(semHash)).digest('hex');
}

export function calcularRegua({ treino, filmes, usuarios, generos, ocupacoes, fase }) {
  const contagens = {};
  for (const f of filmes) contagens[f.id] = 0;
  for (const a of treino) contagens[a.filme] = (contagens[a.filme] ?? 0) + 1;

  const logs = filmes.map((f) => Math.log1p(contagens[f.id]));
  const logPop = { min: Math.min(...logs), max: Math.max(...logs) };
  const logPopZ = mediaDesvio(logs);
  const idade = mediaDesvio(usuarios.map((u) => u.idade));

  const regua = {
    fase: fase ?? null,
    generos: [...generos],
    faixasEpoca: ['antes1980', 'anos80', 'anos90'],
    ocupacoes: [...ocupacoes],
    contagens,
    logPop,
    logPopZ,
    idade,
    pesos: { genero: 0.6, epoca: 0.2, popularidade: 0.2 },
    referencias: null,
    dimensoes: { busca: 23, rede: 70, redeSemPop: 68 },
  };

  // Referências: médias sobre todas as curtidas (nota >= 4) do treino, ponderadas por curtida.
  const porId = new Map(filmes.map((f) => [f.id, f]));
  const generosSoma = new Array(generos.length).fill(0);
  const epocaSoma = [0, 0, 0];
  let curtidas = 0;
  let comEpoca = 0;
  let popSoma = 0;
  for (const a of treino) {
    if (a.nota < 4) continue;
    const f = porId.get(a.filme);
    if (!f) continue;
    curtidas++;
    f.generos.forEach((g, i) => { generosSoma[i] += g; });
    const e = faixaEpoca(f.ano);
    if (e !== null) { epocaSoma[e]++; comEpoca++; }
    popSoma += popEscalada(contagens[a.filme], regua);
  }
  regua.referencias = {
    generosMedia: generosSoma.map((s) => (curtidas ? s / curtidas : 0)),
    epocaMedia: epocaSoma.map((s) => (comEpoca ? s / comEpoca : 0)),
    popularidadeMedia: curtidas ? popSoma / curtidas : 0,
  };

  regua.hash = calcularHash(regua);
  return regua;
}

export function salvarRegua(regua, caminho) {
  fs.mkdirSync(path.dirname(path.resolve(caminho)), { recursive: true });
  fs.writeFileSync(caminho, jsonEstavel(regua));
}

export function carregarRegua(caminho) {
  if (!fs.existsSync(caminho)) {
    const m = /regua-(exp|final).json$/.exec(caminho);
    throw new Error(`régua não encontrada: rode npm run carregar-filmes${m ? ` -- --fase ${m[1]}` : ''}`);
  }
  const regua = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const esperado = calcularHash(regua);
  if (esperado !== regua.hash) {
    throw new Error(`hash da régua diverge (gravado ${regua.hash}, recalculado ${esperado}): rode npm run carregar-filmes`);
  }
  return regua;
}
