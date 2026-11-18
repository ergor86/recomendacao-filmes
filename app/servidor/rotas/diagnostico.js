// GET /api/diagnostico/busca?perfilId= (spec 6.2): só existe com APP_DIAGNOSTICO=1 (registrada em app.js).
// Compara a lista HNSW com a exata para o mesmo perfil, com a mesma busca de produção (M e exclusões).
import { perfilFC, vetorDeBusca } from '../../../src/fc/referencia.js';
import { criarBuscarBanco, derivarConjuntos, M, N_FC } from '../recomendacao/s1.js';
import { exigirOperante, exigirPerfil, UUID } from './comum.js';
import { lerInteracoes } from './recomendacoes.js';

export async function rotasDiagnostico(app, { ciclo }) {
  app.get('/diagnostico/busca', {
    schema: {
      querystring: {
        type: 'object',
        required: ['perfilId'],
        additionalProperties: false,
        properties: { perfilId: { type: 'string', pattern: UUID } },
      },
    },
  }, async (req) => {
    const { pools, fc, ocultos } = exigirOperante(ciclo);
    const { perfilId } = req.query;
    await exigirPerfil(pools.leitura, perfilId);
    const interacoes = await lerInteracoes(pools.leitura, perfilId);
    const { curtidos, excluir } = derivarConjuntos(interacoes, fc, ocultos);
    const perfil = curtidos.length > 0 ? perfilFC(fc, curtidos) : null;
    if (perfil === null) return { hnsw: [], exata: [], sobreposicao: null };

    const buscar = criarBuscarBanco(pools.leitura);
    const vetor = vetorDeBusca(perfil);
    const excluirOrdenado = [...excluir].sort((a, b) => a - b);
    const ids = async (modo) => (await buscar(vetor, excluirOrdenado, M, modo)).lista.slice(0, N_FC).map((x) => x.id);
    const hnsw = await ids('hnsw');
    const exata = await ids('exata');
    const naExata = new Set(exata);
    const comuns = hnsw.filter((id) => naExata.has(id)).length;
    return { hnsw, exata, sobreposicao: exata.length === 0 ? null : comuns / exata.length };
  });
}
