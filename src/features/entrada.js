// Entrada da rede neural (70 posições, ou 68 no controle sem popularidade):
//   0–23 demografia · 24–46 perfil do usuário · 47–69 filme do par.
// Funções puras: recebem a régua e os dados já carregados e devolvem vetores numéricos.
// Qualquer dimensão errada ou valor não finito falha alto, com mensagem acionável.
import { popZ, faixaEpoca } from './regua.js';

const N_GENEROS = 19;

/**
 * Agrupa o treino por usuário: mapa filmeId→nota e lista dos filmes curtidos (nota ≥ 4),
 * na ordem em que aparecem no treino. `filmesPorId` é um Map<id, filme>.
 */
export function historicoDoTreino(treino, filmesPorId) {
  const mapa = new Map();
  for (const a of treino) {
    if (!mapa.has(a.usuario)) mapa.set(a.usuario, { notas: new Map(), curtidos: [] });
    const h = mapa.get(a.usuario);
    h.notas.set(a.filme, a.nota);
    if (a.nota >= 4) {
      const f = filmesPorId.get(a.filme);
      if (!f) throw new Error(`filme ${a.filme} do treino não existe no catálogo: recarregue os filmes (npm run carregar-filmes)`);
      h.curtidos.push(f);
    }
  }
  return mapa;
}

/** Demografia (24 posições): idade em z-score, gênero M/F, ocupação one-hot na ordem da régua. */
export function demografia(usuario, regua) {
  const v = new Array(24).fill(0);
  v[0] = (usuario.idade - regua.idade.media) / regua.idade.desvio;
  if (usuario.genero === 'M') v[1] = 1;
  else if (usuario.genero === 'F') v[2] = 1;
  else throw new Error(`gênero desconhecido "${usuario.genero}" do usuário ${usuario.id}: esperado 'M' ou 'F'`);
  const i = regua.ocupacoes.indexOf(usuario.ocupacao);
  if (i < 0) throw new Error(`ocupação desconhecida "${usuario.ocupacao}" do usuário ${usuario.id}: não consta na régua`);
  v[3 + i] = 1;
  return v;
}

/** Popularidade z-score do usuário sem curtidas (ruling R4): inverte a escala mín/máx de `popularidadeMedia`. */
export function popZReferencia(regua) {
  const p = regua.referencias.popularidadeMedia;
  const { min, max } = regua.logPop;
  return (min + p * (max - min) - regua.logPopZ.media) / regua.logPopZ.desvio;
}

/**
 * Somas dos curtidos para o perfil: gêneros, época one-hot (filme sem ano soma zeros, ruling R11)
 * e popularidade z-score com a contagem SEM desconto (ruling R3).
 */
export function resumoCurtidos(curtidos, regua) {
  const somaGeneros = new Array(N_GENEROS).fill(0);
  const somaEpoca = [0, 0, 0];
  let somaPop = 0;
  for (const f of curtidos) {
    f.generos.forEach((g, i) => { somaGeneros[i] += g; });
    const e = faixaEpoca(f.ano);
    if (e !== null) somaEpoca[e] += 1;
    somaPop += popZ(regua.contagens[f.id] ?? 0, regua);
  }
  return { somaGeneros, somaEpoca, somaPop, n: curtidos.length };
}

/**
 * Perfil do usuário (23 posições): média dos gêneros (19), da época (3) e da popularidade z (1).
 * Com `filmeRemovido`, calcula (soma − filme) / (n − 1), de modo que o perfil não contenha o filme do par.
 * Sem curtidos efetivos, devolve a referência da régua.
 */
export function perfilRede(resumo, regua, filmeRemovido = null) {
  let { somaGeneros, somaEpoca, somaPop, n } = resumo;
  if (filmeRemovido) {
    somaGeneros = somaGeneros.map((s, i) => s - filmeRemovido.generos[i]);
    somaEpoca = [...somaEpoca];
    const e = faixaEpoca(filmeRemovido.ano);
    if (e !== null) somaEpoca[e] -= 1;
    somaPop -= popZ(regua.contagens[filmeRemovido.id] ?? 0, regua);
    n -= 1;
  }
  if (n <= 0) {
    return [...regua.referencias.generosMedia, ...regua.referencias.epocaMedia, popZReferencia(regua)];
  }
  return [...somaGeneros.map((s) => s / n), ...somaEpoca.map((s) => s / n), somaPop / n];
}

/**
 * Popularidade z-score do filme num par: contagem da régua, menos 1 somente se a nota do usuário
 * para o filme está no treino que gerou a régua (o próprio par não pode contar para si mesmo).
 */
export function popZDoPar(filmeId, avaliouNoTreinoDaRegua, regua) {
  const n = (regua.contagens[filmeId] ?? 0) - (avaliouNoTreinoDaRegua ? 1 : 0);
  return popZ(n, regua);
}

/** Parte do filme (23 posições): gêneros 0/1 (19), época one-hot (3; sem ano = zeros) e popularidade z. */
export function filmeRede(filme, popZPar) {
  const epoca = [0, 0, 0];
  const e = faixaEpoca(filme.ano);
  if (e !== null) epoca[e] = 1;
  return [...filme.generos, ...epoca, popZPar];
}

/**
 * Monta a entrada: demografia(24) + perfil(23) + filme(23) = 70 posições.
 * Com `semPop`, remove a popularidade do perfil (46) e do filme (69), resultando em 68.
 * Falha se alguma parte tiver tamanho errado ou algum valor não for finito.
 */
export function montarEntrada(demo, perfil, filme, { semPop = false } = {}) {
  if (demo.length !== 24 || perfil.length !== 23 || filme.length !== 23) {
    throw new Error(`dimensão errada na entrada da rede: demografia ${demo.length} (24), perfil ${perfil.length} (23), filme ${filme.length} (23)`);
  }
  let v = [...demo, ...perfil, ...filme];
  if (semPop) v = v.filter((_, i) => i !== 46 && i !== 69);
  const ruim = v.findIndex((x) => !Number.isFinite(x));
  if (ruim >= 0) throw new Error(`valor não finito (${v[ruim]}) na posição ${ruim} da entrada da rede: confira a régua e os dados`);
  return v;
}
