// Os 30 perfis sintéticos das camadas (a) e (b) da equivalência (spec 10.5), com semente fixa 2026.
// Incluem: perfil vazio, só interações não curtidas, curtidos sem vetor, gêmeos, déficit (parcial),
// um perfil que esgota os candidatos (sem_semelhantes) e perfis aleatórios com 0 a 15 curtidos.
import { perfilFC, rankingReferencia } from '../../../src/fc/referencia.js';

export const SEMENTE = 2026;
export const N_PERFIS = 30;
const M = 300;

// mulberry32: gerador pseudoaleatório pequeno e determinístico
function gerador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param fc construirFC(ctx.treino, 943); @param nFilmes 1682; @param pares gêmeos (detectados + manuais)
 * @param ocultos calcularOcultos(pares)
 * @returns Array<{ nome, interacoes: Array<{ filmeId, tipo, nota }> }> com N_PERFIS perfis
 */
export function gerarPerfis({ fc, nFilmes, pares, ocultos }) {
  const rnd = gerador(SEMENTE);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const temVetor = (id) => (fc.fasPorFilme.get(id)?.length ?? 0) > 0;
  const todos = Array.from({ length: nFilmes }, (_, i) => i + 1);
  const comVetor = todos.filter(temVetor);
  const semVetor = todos.filter((id) => !temVetor(id));
  const curtida = () => (rnd() < 0.5 ? { tipo: 'gostei', nota: null } : { tipo: 'nota', nota: int(4, 5) });
  const naoCurtida = () => (int(0, 3) === 0 ? { tipo: 'quero_assistir', nota: null } : { tipo: 'nota', nota: int(1, 3) });
  const sortear = (fonte, n, usados) => {
    const saida = [];
    while (saida.length < n) {
      const id = fonte[int(0, fonte.length - 1)];
      if (usados.has(id)) continue;
      usados.add(id);
      saida.push(id);
    }
    return saida;
  };

  // Filme com déficit: o primeiro (id crescente) cujo ranking sozinho tem de 1 a 9 elegíveis.
  let deficit = null;
  for (const id of comVetor) {
    const ref = rankingReferencia(fc, perfilFC(fc, [id]), new Set([id, ...ocultos]), M);
    if (ref.length >= 1 && ref.length < 10) {
      deficit = { id, candidatos: ref.map((x) => x.id) };
      break;
    }
  }
  if (!deficit) throw new Error('nenhum filme com déficit encontrado: os perfis da spec 10.5 não podem ser montados');

  const perfis = [];
  perfis.push({ nome: 'vazio', interacoes: [] });
  {
    const usados = new Set();
    perfis.push({ nome: 'só não curtidas', interacoes: sortear(todos, 6, usados).map((filmeId) => ({ filmeId, ...naoCurtida() })) });
  }
  {
    const usados = new Set();
    perfis.push({ nome: 'curtidos sem vetor', interacoes: sortear(semVetor, 3, usados).map((filmeId) => ({ filmeId, ...curtida() })) });
  }
  {
    // gêmeos: curte o menor de cada par com vetor; o maior é oculto e não pode aparecer
    const menores = pares.map((p) => p.menor).filter(temVetor).slice(0, 6);
    perfis.push({ nome: 'gêmeos', interacoes: menores.map((filmeId) => ({ filmeId, tipo: 'gostei', nota: null })) });
  }
  perfis.push({ nome: 'déficit', interacoes: [{ filmeId: deficit.id, tipo: 'gostei', nota: null }] });
  perfis.push({
    nome: 'esgota os candidatos',
    interacoes: [
      { filmeId: deficit.id, tipo: 'nota', nota: 5 },
      ...deficit.candidatos.map((filmeId) => ({ filmeId, tipo: 'nota', nota: 2 })),
    ],
  });
  {
    const usados = new Set();
    const interacoes = [
      ...sortear(comVetor, 12, usados).map((filmeId) => ({ filmeId, ...curtida() })),
      ...sortear(semVetor, 3, usados).map((filmeId) => ({ filmeId, ...curtida() })),
      ...sortear(todos, 5, usados).map((filmeId) => ({ filmeId, ...naoCurtida() })),
    ];
    perfis.push({ nome: '15 curtidos com e sem vetor', interacoes });
  }
  while (perfis.length < N_PERFIS) {
    const usados = new Set();
    const interacoes = [
      ...sortear(todos, int(0, 15), usados).map((filmeId) => ({ filmeId, ...curtida() })),
      ...sortear(todos, int(0, 8), usados).map((filmeId) => ({ filmeId, ...naoCurtida() })),
    ];
    perfis.push({ nome: `aleatório ${perfis.length}`, interacoes });
  }
  return perfis;
}

/** Curtidos (gostei ∪ notas 4–5) em ordem crescente, derivados aqui, sem usar o s1.js. */
export function curtidosDe(interacoes) {
  return interacoes
    .filter((i) => i.tipo === 'gostei' || (i.tipo === 'nota' && i.nota >= 4))
    .map((i) => i.filmeId)
    .sort((a, b) => a - b);
}
