// GET /api/filmes, /api/filmes/:id e /api/generos (spec 6.2 e 6.3, estatísticas na 5.3).
import { normalizarConsulta } from '../../comum/titulos.js';
import { ErroApi } from '../seguranca.js';
import {
  booleanoConsulta, ehVerdadeiro, exigirOperante, exigirPerfil, GENEROS_REAIS, POR_PAGINA, TODOS_GENEROS, UUID,
} from './comum.js';

const MIN_NOTAS = 5; // suficiência (spec 5.3)
export const C_BAYES = 10;

export const estadoDaLinha = (l) => (l.tipo ? { tipo: l.tipo, nota: l.nota ?? null } : null);

/** CartaoFilme (spec 6.3). `linha` vem de app.filme; `estadoPerfil` é { tipo, nota } ou null. */
export function cartaoFilme(linha, estadoPerfil, midia) {
  return {
    id: linha.id,
    titulo: linha.titulo_exibicao,
    tituloOriginal: linha.titulo_original,
    ano: linha.ano ?? null,
    generos: linha.generos,
    temVetor: linha.tem_vetor,
    midia,
    estadoPerfil: estadoPerfil ?? null,
  };
}

// colunas de um cartão; `i` é a interação do perfil informado ($1; nenhuma se for null)
export const COLUNAS_CARTAO = `f.id, f.titulo_exibicao, f.titulo_original, f.ano, f.generos, f.tem_vetor,
  e.n_notas, i.tipo, i.nota`;
export const JUNCOES_CARTAO = `FROM app.filme f
  JOIN app.estatistica_historica e ON e.filme_id = f.id
  LEFT JOIN app.interacao i ON i.perfil_id = $1 AND i.filme_id = f.id`;

const arred = (x, casas) => Math.round(x * 10 ** casas) / 10 ** casas;

// Média bayesiana (C = 10; m = média global do treino): só ordena, nunca aparece na resposta.
const SCORE_BAYES = `((${C_BAYES}::numeric * (SELECT SUM(soma_notas)::numeric / SUM(n_notas) FROM app.estatistica_historica)
  + e.soma_notas) / (${C_BAYES} + e.n_notas))`;
const ORDENS = Object.freeze({
  mais_avaliados: 'e.n_notas DESC, f.id',
  mais_bem_avaliados: `${SCORE_BAYES} DESC, f.id`,
  titulo: 'f.titulo_exibicao, f.id',
  ano: 'f.ano DESC NULLS LAST, f.id',
});

export async function rotasFilmes(app, { ciclo, midia }) {
  app.get('/generos', async () => {
    exigirOperante(ciclo);
    return TODOS_GENEROS;
  });

  app.get('/filmes', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 100 },
          genero: { type: 'string', enum: [...GENEROS_REAIS, 'unknown'] },
          ordem: { type: 'string', enum: Object.keys(ORDENS) },
          pagina: { type: 'string', pattern: '^[1-9][0-9]{0,5}$' },
          perfilId: { type: 'string', pattern: UUID },
          soInfluenciam: booleanoConsulta,
        },
      },
    },
  }, async (req) => {
    const { pools } = exigirOperante(ciclo);
    const { q, genero, ordem = 'mais_avaliados', perfilId = null } = req.query;
    const pagina = Number(req.query.pagina ?? 1);
    if (perfilId) await exigirPerfil(pools.leitura, perfilId);

    const onde = ['f.visivel'];
    const params = [perfilId];
    if (ehVerdadeiro(req.query.soInfluenciam)) onde.push('f.tem_vetor');
    if (genero) { params.push(genero); onde.push(`$${params.length} = ANY(f.generos)`); }
    // cada palavra da consulta precisa aparecer em titulo_busca (mesma normalização de tituloBusca)
    for (const palavra of normalizarConsulta(q ?? '').split(' ').filter(Boolean)) {
      params.push(`%${palavra}%`);
      onde.push(`f.titulo_busca LIKE $${params.length}`);
    }
    const filtro = onde.join(' AND ');
    const { rows: [{ total }] } = await pools.leitura.query(
      `SELECT COUNT(*)::int AS total ${JUNCOES_CARTAO} WHERE ${filtro}`, params,
    );
    const { rows } = await pools.leitura.query(
      `SELECT ${COLUNAS_CARTAO} ${JUNCOES_CARTAO} WHERE ${filtro}
       ORDER BY ${ORDENS[ordem]} LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`, params,
    );
    return { itens: rows.map((l) => cartaoFilme(l, estadoDaLinha(l), midia.midia(l))), total, pagina };
  });

  app.get('/filmes/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]{1,9}$' } } },
      querystring: { type: 'object', additionalProperties: false, properties: { perfilId: { type: 'string', pattern: UUID } } },
    },
  }, async (req) => {
    const { pools } = exigirOperante(ciclo);
    const id = Number(req.params.id);
    const perfilId = req.query.perfilId ?? null;
    if (perfilId) await exigirPerfil(pools.leitura, perfilId);
    const { rows: [l] } = await pools.leitura.query(
      `SELECT ${COLUNAS_CARTAO},
         e.soma_notas, e.n_aprovacao,
         EXISTS (SELECT 1 FROM app.filme_gemeo g JOIN app.filme h ON h.id = g.gemeo_id
                 WHERE g.filme_id = f.id AND NOT h.visivel) AS tem_gemeo_oculto
       ${JUNCOES_CARTAO} WHERE f.id = $2 AND f.visivel`, [perfilId, id],
    );
    if (!l) throw new ErroApi('FILME_NAO_ENCONTRADO', 'Filme não encontrado.');
    // "Neste computador": só notas de perfis reais (os de exemplo não entram)
    const { rows: [c] } = await pools.leitura.query(
      `SELECT COUNT(*)::int AS n, AVG(i.nota)::float8 AS media
       FROM app.interacao i JOIN app.perfil p ON p.id = i.perfil_id
       WHERE i.filme_id = $1 AND i.tipo = 'nota' AND NOT p.exemplo`, [id],
    );
    const poucasMl = l.n_notas < MIN_NOTAS;
    const poucasPc = c.n < MIN_NOTAS;
    const estado = estadoDaLinha(l);
    return {
      ...cartaoFilme(l, estado, midia.midia(l)),
      temGemeoOculto: l.tem_gemeo_oculto,
      estatisticas: {
        movielens: {
          nNotas: l.n_notas,
          media: poucasMl ? null : arred(l.soma_notas / l.n_notas, 2),
          pctAprovacao: poucasMl ? null : arred((100 * l.n_aprovacao) / l.n_notas, 1),
          poucasNotas: poucasMl,
        },
        computador: { nNotas: c.n, media: poucasPc ? null : arred(c.media, 2), poucasNotas: poucasPc },
        sua: estado,
      },
    };
  });
}
