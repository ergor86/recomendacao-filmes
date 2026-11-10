// Pesos e cosseno (spec §5.4 — texto obrigatório na documentação do código)
//
// Definição usada na implementação:
//   V = [ w_g·G , w_e·E , w_p·P ]      cos(u,f) = (V_u · V_f) / (‖V_u‖ ‖V_f‖)
// Na fórmula, G e E são os blocos já normalizados (um bloco zerado continua zerado)
// e P é a popularidade escalada.
//
// Forma geral expandida, que explica os pesos (a definição oficial continua sendo a do vetor concatenado):
//   cos(u,f) = [ w_g²(G_u·G_f) + w_e²(E_u·E_f) + w_p² P_u P_f ]
//              / ( sqrt(w_g²‖G_u‖² + w_e²‖E_u‖² + w_p² P_u²) · sqrt(w_g²‖G_f‖² + w_e²‖E_f‖² + w_p² P_f²) )
// Na fórmula, ‖G‖² e ‖E‖² valem 1 (bloco normalizado) ou 0 (bloco zerado, como no filme 267).
//
// O cosseno ignora a escala do vetor inteiro: só as proporções entre os pesos importam
// (0,6 / 0,2 / 0,2 equivale a 3 / 1 / 1). Cada bloco normalizado contribui com
// peso² × (cosseno dentro do bloco). A popularidade contribui com peso² × p_usuário × p_filme
// e também entra no denominador. Por isso 0,6 / 0,2 / 0,2 NÃO significa 60% / 20% / 20%.
// Um bloco zerado sai automaticamente do produto e da norma.
//
// Influência efetiva medida: 73,6% gênero, 14,4% época e 12,0% popularidade.
// Método: participação de cada bloco no produto escalar V_u · V_f, calculada em cada par
// (usuário de validação com curtidas, filme relevante escondido) e depois em média simples
// sobre os 10.418 pares. Outros métodos dão outros números. Entre os 100 vizinhos mais
// próximos de cada usuário, por exemplo, a popularidade pesa cerca de 6%.
//
// Consequências documentadas:
// - Popularidade: na maioria dos pares, age como "mais popular = um pouco mais próximo".
//   Em pares de gosto quase perfeito, age como "popularidade parecida com a do usuário".
// - Filmes com vários gêneros: ficam um pouco menos próximos de quem gosta de um gênero só.

import { faixaEpoca, popEscalada, popZ } from './regua.js';

export { popEscalada, popZ };

/**
 * Normalização L2: divide o vetor pelo próprio comprimento, que passa a ser 1.
 * "Seguro" porque um vetor todo zero continua zero, em vez de dividir por zero e gerar NaN.
 */
export function normalizarSeguro(v) {
  const norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norma === 0 ? v.map(() => 0) : v.map((x) => x / norma);
}

// Monta o vetor de busca de 23 dimensões (19 de gênero + 3 de época + 1 de popularidade):
// normaliza os blocos de gênero e época, e multiplica cada bloco pelo seu peso na régua.
function montar(generos, epoca, popularidade, regua) {
  const { genero, epoca: pe, popularidade: pp } = regua.pesos;
  const v = [
    ...normalizarSeguro(generos).map((x) => x * genero),
    ...normalizarSeguro(epoca).map((x) => x * pe),
    popularidade * pp,
  ];
  return v.map((x) => x + 0); // evita -0
}

// Codificação one-hot da época: [1,0,0] antes de 1980, [0,1,0] anos 80, [0,0,1] anos 90, [0,0,0] sem ano.
function umHotEpoca(ano) {
  const e = faixaEpoca(ano);
  return [0, 1, 2].map((i) => (i === e ? 1 : 0));
}

/** Vetor de busca (23 dimensões) de um filme, pronto para gravar no pgvector. */
export function vetorBuscaFilme(filme, regua) {
  const pop = popEscalada(regua.contagens[filme.id] ?? 0, regua);
  return montar(filme.generos, umHotEpoca(filme.ano), pop, regua);
}

/**
 * Resume o gosto de um usuário como a média dos filmes que ele curtiu (nota ≥ 4):
 * fração de cada gênero, fração de cada época e popularidade média.
 * Devolve null se o usuário não curtiu nenhum filme.
 * A popularidade do perfil está na escala popEscalada (log1p, mín/máx, [0, 1]) e serve só ao
 * vetor de busca; a entrada da rede (spec §6) usa z-score via popZ.
 */
export function perfilUsuario(filmesCurtidos, regua) {
  const n = filmesCurtidos.length;
  if (n === 0) return null;
  const generos = new Array(regua.generos.length).fill(0);
  const epoca = [0, 0, 0];
  let pop = 0;
  for (const f of filmesCurtidos) {
    f.generos.forEach((g, i) => { generos[i] += g; });
    umHotEpoca(f.ano).forEach((e, i) => { epoca[i] += e; });
    pop += popEscalada(regua.contagens[f.id] ?? 0, regua);
  }
  return { generos: generos.map((x) => x / n), epoca: epoca.map((x) => x / n), popularidade: pop / n };
}

/** Converte o perfil no vetor de busca (mesmo formato do vetor dos filmes), usado para achar vizinhos. */
export function vetorBuscaUsuario(perfil, regua) {
  return montar(perfil.generos, perfil.epoca, perfil.popularidade, regua);
}

/**
 * Vetor de busca de um usuário recém-cadastrado, que ainda não deu notas (partida a frio).
 * Usa os gêneros que ele escolheu como favoritos; época e popularidade vêm das médias de
 * referência da régua (o "usuário típico").
 */
export function vetorBuscaUsuarioNovo(indicesGenerosFavoritos, regua) {
  const generos = new Array(regua.generos.length).fill(0);
  for (const i of indicesGenerosFavoritos) generos[i] = 1 / Math.sqrt(indicesGenerosFavoritos.length);
  return montar(generos, regua.referencias.epocaMedia, regua.referencias.popularidadeMedia, regua);
}

/**
 * Confere um vetor antes de usá-lo no banco: dimensão certa, sem NaN ou infinito, e não zerado
 * (um vetor zero não tem direção, então o cosseno não é definido). Lança erro explicativo.
 */
export function validarVetor(v, dim) {
  if (!Array.isArray(v) || v.length !== dim) {
    throw new Error(`vetor inválido: dimensão ${v?.length} em vez de ${dim}; recalcule os vetores com a régua atual`);
  }
  if (!v.every((x) => Number.isFinite(x))) {
    throw new Error('vetor inválido: contém NaN ou valor infinito; confira a régua e os dados de entrada');
  }
  if (Math.sqrt(v.reduce((s, x) => s + x * x, 0)) === 0) {
    throw new Error('vetor de usuário zerado: sem curtidas para montar o perfil; use os gêneros favoritos (usuário novo)');
  }
}
