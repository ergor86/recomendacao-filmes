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

// Números do Plano 3 com 4 casas e vírgula decimal, sempre a partir de RESULTADO_PLANO3.
const num = (x) => x.toFixed(4).replace('.', ',');
const R = RESULTADO_PLANO3;

// População (README da pesquisa, "Avaliação retrospectiva do Plano 3"): o teste-2 escondeu 20% das notas
// dos usuários 1 a 462; 445 foram avaliados (17 sem nenhuma curtida escondida). As 943 pessoas são a base
// dos vetores, não as pessoas avaliadas.
const METODO = 'O que foi medido: no teste-2 do Plano 3, 20% das notas dos usuários 1 a 462 do MovieLens 100K foram escondidas; '
  + '445 deles foram avaliados (17 ficaram de fora por não terem nenhuma curtida escondida). '
  + 'Para cada um, a lista da S1 (filtragem colaborativa sozinha) foi comparada com a da S2: a configuração da v1 '
  + '(150 populares + rede), retreinada no treino do Plano 3, e não o modelo avaliado no Plano 2. '
  + 'A comparação S1 × S2 mede o sistema completo, sem atribuir a diferença a um componente. '
  + 'A medida é o NDCG@10, com intervalo de confiança de 95% por bootstrap pareado (5.000 reamostragens). '
  + 'Os vetores que a S1 usa vêm das notas de treino das 943 pessoas do MovieLens 100K, sem as notas escondidas do teste-2.';

const CONCLUSAO = `Nesta avaliação retrospectiva, com essas ${R.nUsuarios} pessoas, a S1 teve NDCG@10 maior que a S2 `
  + `(diferença média de ${num(R.media)} no NDCG@10, IC 95% [${num(R.ic95[0])}; ${num(R.ic95[1])}]).`;

const NAO_SIGNIFICA = Object.freeze([
  // spec §4.4, literal
  'A qualidade medida no teste-2 (usuários históricos com ≥ 20 notas, avaliação retrospectiva) não se transfere para perfis novos.',
  'A avaliação é retrospectiva: as notas avaliadas já pertenciam aos dados usados no projeto, ainda que isoladas no Plano 3. '
    + 'Não é uma validação externa independente.',
  'Os níveis absolutos de NDCG não são comparáveis entre conjuntos de avaliação diferentes.',
]);

const LIMITES = Object.freeze([
  'O catálogo vai só até 1998: o MovieLens 100K não tem filmes mais novos.',
  'Notas 1–3 tiram o filme das suas recomendações, mas ainda não afastam filmes parecidos (não há sinal negativo).',
  'Um filme raro nos dados de 1998 não tem vetor: curtir esse filme não entra no cálculo dos seus gostos.',
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
    conclusao: CONCLUSAO,
    naoSignifica: [...NAO_SIGNIFICA],
    tecnica: {
      mecanismo: 'S1/HNSW',
      m: M,
      nFc: N_FC,
      modo: MODO,
      descricao: `Filtragem colaborativa item a item (S1) com busca HNSW no pgvector: uma busca com M = ${M}, `
        + `FC${N_FC} = os ${N_FC} primeiros, top 10 = prefixo da FC${N_FC}, completado pelos mais avaliados. `
        + 'A única mudança em relação à pesquisa é a exclusão: as interações do perfil e os filmes ocultos. '
        + 'O índice é reconstruído na preparação e os hashes abaixo são conferidos antes de servir. '
        + 'Como o índice HNSW é reconstruído em cada instalação, com níveis aleatórios, a lista aproximada pode diferir, '
        + 'em casos raros, da que o índice da pesquisa daria; a fidelidade publicada entre HNSW e busca exata foi medida no índice da pesquisa.',
    },
    avisos: [...LIMITES],
    licencas: LICENCAS.map((l) => ({ nome: l.nome, texto: l.texto, url: l.url })),
    citacao: CITACAO,
  };
}

export async function rotasSobre(app) {
  app.get('/sobre', async () => montarSobre());
}
