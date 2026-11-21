// Constantes de integridade da pesquisa congelada. Os testes de app/testes/congelamento.test.js
// as conferem contra `git show` dos commits abaixo.

export const COMMIT_CODIGO = 'c048537911c14313c4e85c516270513871a14a88';
export const COMMIT_PESQUISA = '6077974fb015c31c870eb5c4995a3a6f45682ca7';

export const HASHES = Object.freeze({
  regua: '12119b16edab32568ad1e3e147d793da98b07ec17c46b5f8d695187f91c1521a',
  treino: 'ac6c0eacd7ab52a956a07dd948105aee86b354651e106b0a41a0652661ba377a',
  vetoresFC: '08325f426922df6138519c8dc712bd21ad8a5c298f53d5eed1ce249517f44861',
});

export const SHA256_ARQUIVOS = Object.freeze({
  'u1.base': 'ce253ec86c448b44fb3ba9a30d12dcfc2e9210cbde71efada3730c22e9ac212a',
  'u.item': '553841ebc7de3a0fd0d6b62a204ea30c1e651aacfb2814c7a6584ac52f2c5701',
  'u.user': 'f120e114da2e8cf314fd28f99417c94ae9ddf1cb6db8ce0e4b5995d40e90e62c',
  'u.genre': '9757e0d3e6b298159a80dd48eaf938114690e911e39af97a76949ef1663610bb',
  'u.occupation': 'cd5fbec9afe345d993a62fc7817df1a4a9079c4feb267b3118763b8fd942137d',
});

export const N_FILMES = 1682;
export const N_FC = 1385;
export const DIM_FC = 943;

// resultados/avaliacao-v2.json → comparacaoPrincipal (em COMMIT_PESQUISA)
export const RESULTADO_PLANO3 = Object.freeze({
  metrica: 'ndcg',
  v2: 'S1',
  v1: 'S2',
  media: 0.029388066181615696,
  ic95: Object.freeze([0.01358972926587421, 0.04582883195809324]),
  nUsuarios: 445,
  suportada: true,
});
