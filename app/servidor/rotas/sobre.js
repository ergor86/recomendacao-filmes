// GET /api/sobre (spec 6.2 e 7, tela Sobre). Montada campo a campo a partir das constantes de
// app/integridade.js (conferidas no CI contra os commits congelados); nada é lido de resultados/.
import { readFileSync } from 'node:fs';
import { COMMIT_CODIGO, HASHES, RESULTADO_PLANO3 } from '../../integridade.js';
import { M, MODO, N_FC } from '../recomendacao/s1.js';

const VERSAO = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// spec §7 (Sobre): "No topo, em 3 frases", copiadas literalmente
const RESUMO = Object.freeze([
  'Compara seus gostos com os de 943 pessoas que avaliaram filmes em 1997–98.',
  'A técnica foi avaliada com essas pessoas, não com você.',
  'Com poucas curtidas, a lista se apoia em poucos filmes.',
]);

const METODO = 'Avaliação retrospectiva do Plano 3: 445 pessoas do MovieLens 100K tiveram 20% das suas notas escondidas; '
  + 'a lista da S1 (filtragem colaborativa item a item) foi comparada com a da versão anterior (S2) pelo NDCG@10, '
  + 'com intervalo de confiança de 95% por bootstrap pareado. O intervalo exclui o zero: a S1 superou a versão anterior.';

const NAO_SIGNIFICA = Object.freeze([
  'Não é uma medida da qualidade das recomendações para você: a técnica foi avaliada com as 943 pessoas de 1997–98.',
  'Não é uma validação externa independente: as notas avaliadas já pertenciam aos dados usados no projeto, ainda que isoladas no Plano 3.',
  'O ganho medido é pequeno em valor absoluto, e os níveis de NDCG não são comparáveis entre conjuntos de avaliação diferentes.',
]);

const LIMITES = Object.freeze([
  'O catálogo vai só até 1998: o MovieLens 100K não tem filmes mais novos.',
  'Notas 1–3 tiram o filme das suas recomendações, mas ainda não afastam filmes parecidos (não há sinal negativo).',
  'Filmes raros nos dados de 1998 não têm vetor: curti-los não muda as suas recomendações.',
  'Os perfis ficam só neste computador e não têm senha.',
]);

const LICENCAS = Object.freeze([
  Object.freeze({
    nome: 'MovieLens 100K',
    texto: 'Dados MovieLens 100K, do GroupLens Research (Universidade de Minnesota), usados sob os termos de uso do GroupLens: '
      + 'uso não comercial, sem redistribuição dos dados e com citação obrigatória. Os dados não ficam no repositório; '
      + 'a preparação os baixa do site do GroupLens.',
    url: 'https://grouplens.org/datasets/movielens/100k/',
  }),
  Object.freeze({
    nome: 'Cartazes',
    texto: 'Os cartazes são gerados neste computador a partir do título e dos gêneros; não há imagens de terceiros.',
    url: null,
  }),
]);

const CITACAO = 'F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. '
  + 'ACM Transactions on Interactive Intelligent Systems (TiiS) 5, 4, Article 19. DOI: 10.1145/2827872';

export function montarSobre() {
  return {
    versao: VERSAO,
    commitCodigo: COMMIT_CODIGO,
    hashes: { regua: HASHES.regua, treino: HASHES.treino, vetoresFC: HASHES.vetoresFC },
    resultado: {
      metrica: RESULTADO_PLANO3.metrica,
      v2: RESULTADO_PLANO3.v2,
      v1: RESULTADO_PLANO3.v1,
      media: RESULTADO_PLANO3.media,
      ic95: [RESULTADO_PLANO3.ic95[0], RESULTADO_PLANO3.ic95[1]],
      nUsuarios: RESULTADO_PLANO3.nUsuarios,
      suportada: RESULTADO_PLANO3.suportada,
    },
    resumo: [...RESUMO],
    metodo: METODO,
    naoSignifica: [...NAO_SIGNIFICA],
    tecnica: {
      mecanismo: 'S1/HNSW',
      m: M,
      nFc: N_FC,
      modo: MODO,
      descricao: 'Filtragem colaborativa item a item (S1) com busca HNSW no pgvector: uma busca com M = 300, '
        + 'FC150 = os 150 primeiros, top 10 = prefixo da FC150, completado pelos mais avaliados. '
        + 'A única mudança em relação à pesquisa é a exclusão: as interações do perfil e os filmes ocultos. '
        + 'O índice é reconstruído na preparação e os hashes abaixo são conferidos antes de servir.',
    },
    avisos: [...LIMITES],
    licencas: LICENCAS.map((l) => ({ nome: l.nome, texto: l.texto, url: l.url })),
    citacao: CITACAO,
  };
}

export async function rotasSobre(app) {
  app.get('/sobre', async () => montarSobre());
}
