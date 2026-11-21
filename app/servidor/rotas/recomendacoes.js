// GET /api/perfis/:id/recomendacoes (spec 4.4, 6.2 e 6.3). Ignora a query string: M, K e o modo vêm só de s1.js.
import { criarBuscarBanco, recomendar } from '../recomendacao/s1.js';
import { cartaoFilme, COLUNAS_CARTAO, estadoDaLinha, JUNCOES_CARTAO } from './filmes.js';
import { exigirOperante, exigirPerfil, UUID } from './comum.js';

const MAX_BASEADO_EM = 5;

/** Interações do perfil, da mais recente para a mais antiga (a ordem de `baseadoEm`). */
export async function lerInteracoes(pool, perfilId) {
  const { rows } = await pool.query(
    'SELECT filme_id, tipo, nota FROM app.interacao WHERE perfil_id = $1 ORDER BY atualizado_em DESC, filme_id', [perfilId],
  );
  return rows.map((r) => ({ filmeId: r.filme_id, tipo: r.tipo, nota: r.nota ?? null }));
}

export async function rotasRecomendacoes(app, { ciclo, midia }) {
  app.get('/perfis/:id/recomendacoes', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: UUID } } } },
  }, async (req) => {
    const { pools, fc, ocultos, rankingPopulares } = exigirOperante(ciclo);
    const perfilId = req.params.id;
    await exigirPerfil(pools.leitura, perfilId);
    const interacoes = await lerInteracoes(pools.leitura, perfilId);
    // um erro da busca sobe ao tratador do app, que o classifica com ciclo.registrarErro (spec 4.3)
    const r = await recomendar({ interacoes, fc, ocultos, rankingPopulares, buscar: criarBuscarBanco(pools.leitura) });

    // mais recentes primeiro (as interações já vêm ordenadas); até 5 curtidos com vetor
    const comVetor = new Set(r.perfil.curtidosComVetor);
    const baseadoEmIds = interacoes.map((i) => i.filmeId).filter((id) => comVetor.has(id)).slice(0, MAX_BASEADO_EM);

    const idsItens = r.itens.map((i) => i.id);
    const { rows: cartoes } = await pools.leitura.query(
      `SELECT ${COLUNAS_CARTAO} ${JUNCOES_CARTAO} WHERE f.id = ANY($2::int[])`, [perfilId, idsItens],
    );
    const porId = new Map(cartoes.map((l) => [l.id, l]));
    const idsTitulos = new Set(baseadoEmIds);
    for (const i of r.itens) for (const q of i.porque) idsTitulos.add(q);
    const { rows: titulosLinhas } = await pools.leitura.query(
      'SELECT id, titulo_exibicao, ano, generos FROM app.filme WHERE id = ANY($1::int[])', [[...idsTitulos]],
    );
    const filmes = new Map(titulosLinhas.map((l) => [l.id, l]));
    const titulos = new Map(titulosLinhas.map((l) => [l.id, l.titulo_exibicao]));
    const comTitulo = (id) => ({ id, titulo: titulos.get(id) });

    return {
      perfilId,
      geradoEm: new Date().toISOString(),
      motivo: r.motivo,
      perfil: {
        curtidos: r.perfil.curtidos.length,
        curtidosComVetor: r.perfil.curtidosComVetor.length,
        baseadoEm: baseadoEmIds.map((id) => ({ ...comTitulo(id), ano: filmes.get(id)?.ano ?? null, generos: filmes.get(id)?.generos ?? [] })),
      },
      itens: r.itens.map((i, k) => {
        const linha = porId.get(i.id);
        return {
          posicao: k + 1,
          fonte: i.fonte,
          escore: i.escore,
          porque: i.porque.map(comTitulo),
          filme: cartaoFilme(linha, estadoDaLinha(linha), midia.midia(linha)),
        };
      }),
      busca: r.busca.linhasPedidas === null ? null : {
        mecanismo: 'S1/HNSW',
        m: r.busca.m,
        nFc: r.busca.nFc,
        linhasPedidas: r.busca.linhasPedidas,
        empateNaoResolvido: r.busca.empateNaoResolvido,
        candidatosS1: r.busca.candidatosS1,
        nExcluidos: r.busca.nExcluidos,
      },
    };
  });
}
