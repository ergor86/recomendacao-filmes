// PUT/DELETE /api/perfis/:id/interacoes/:filmeId e GET /api/perfis/:id/interacoes (spec 6.2).
// Os efeitos vêm de calcularEfeitos (s1.js), a mesma função que define os curtidos da recomendação.
import { ErroApi } from '../seguranca.js';
import { calcularEfeitos, temVetorNoFc } from '../recomendacao/s1.js';
import { cartaoFilme, COLUNAS_CARTAO, estadoDaLinha } from './filmes.js';
import { exigirOperante, exigirPerfil, POR_PAGINA, UUID } from './comum.js';
import { comTransacao, exigirPoolEscrita } from './perfis.js';

const PARAMS = {
  type: 'object',
  properties: { id: { type: 'string', pattern: UUID }, filmeId: { type: 'string', pattern: '^[0-9]{1,9}$' } },
};
const TIPO = '(nota|gostei|quero_assistir)';
const TIPOS_VALIDOS = new Set(['nota', 'gostei', 'quero_assistir']);

// O Fastify remove propriedades extras quando o schema diz additionalProperties: false (removeAdditional),
// o que deixaria passar { tipo: 'gostei', nota: 3 }. Por isso a combinação tipo/nota é conferida à mão.
const CORPO_PUT = {
  type: 'object',
  required: ['tipo'],
  properties: {
    tipo: { type: 'string', enum: ['gostei', 'quero_assistir', 'nota'] },
    nota: { type: 'integer', minimum: 1, maximum: 5 },
  },
};

/** { tipo: 'gostei' } | { tipo: 'quero_assistir' } | { tipo: 'nota', nota: 1..5 }; qualquer outra forma é 400. */
function lerCorpo(corpo) {
  const chaves = Object.keys(corpo);
  const ok = corpo.tipo === 'nota'
    ? chaves.length === 2 && Number.isInteger(corpo.nota)
    : chaves.length === 1;
  if (!ok) throw new ErroApi('VALIDACAO');
  return { tipo: corpo.tipo, nota: corpo.tipo === 'nota' ? corpo.nota : null };
}

const anteriorDaLinha = (l) => (l ? { tipo: l.tipo, nota: l.nota ?? null } : null);

// uma escrita por (perfil, filme) de cada vez: o `anterior` devolvido é o estado que ela realmente substituiu
const travarPar = (c, perfilId, filmeId) => c.query(
  'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`interacao:${perfilId}:${filmeId}`],
);

/** O filme precisa existir e estar visível (ocultos, como o 267, não aceitam interação). */
async function exigirFilmeVisivel(pool, filmeId) {
  const { rows } = await pool.query('SELECT 1 FROM app.filme WHERE id = $1 AND visivel', [filmeId]);
  if (rows.length === 0) throw new ErroApi('FILME_NAO_ENCONTRADO', 'Filme não encontrado.');
}

// FK de perfil quebrada por uma exclusão concorrente
const perfilSumiu = (erro) => (erro?.code === '23503'
  ? new ErroApi('PERFIL_NAO_ENCONTRADO', 'Perfil não encontrado.') : erro);

export async function rotasInteracoes(app, { ciclo, midia }) {
  app.put('/perfis/:id/interacoes/:filmeId', { schema: { params: PARAMS, body: CORPO_PUT } }, async (req) => {
    const { tipo, nota } = lerCorpo(req.body);
    const { fc } = exigirOperante(ciclo);
    const pool = exigirPoolEscrita(ciclo);
    const { id: perfilId } = req.params;
    const filmeId = Number(req.params.filmeId);
    await exigirPerfil(pool, perfilId);
    await exigirFilmeVisivel(pool, filmeId);
    let anterior;
    let gravada;
    try {
      ({ anterior, gravada } = await comTransacao(pool, async (c) => {
        await travarPar(c, perfilId, filmeId);
        const { rows: [ant] } = await c.query(
          'SELECT tipo, nota FROM app.interacao WHERE perfil_id = $1 AND filme_id = $2', [perfilId, filmeId],
        );
        const { rows: [nova] } = await c.query(
          `INSERT INTO app.interacao (perfil_id, filme_id, tipo, nota) VALUES ($1, $2, $3, $4)
           ON CONFLICT (perfil_id, filme_id) DO UPDATE SET tipo = EXCLUDED.tipo, nota = EXCLUDED.nota, atualizado_em = now()
           RETURNING tipo, nota, atualizado_em`,
          [perfilId, filmeId, tipo, nota],
        );
        return { anterior: anteriorDaLinha(ant), gravada: nova };
      }));
    } catch (erro) {
      throw perfilSumiu(erro);
    }
    const temVetor = temVetorNoFc(fc, filmeId);
    return {
      interacao: { filmeId, tipo: gravada.tipo, nota: gravada.nota ?? null, atualizadoEm: gravada.atualizado_em.toISOString() },
      anterior,
      filme: { temVetor },
      efeitos: calcularEfeitos({ nova: { tipo, nota }, anterior, temVetor }),
    };
  });

  app.delete('/perfis/:id/interacoes/:filmeId', { schema: { params: PARAMS } }, async (req) => {
    const { fc } = exigirOperante(ciclo);
    const pool = exigirPoolEscrita(ciclo);
    const { id: perfilId } = req.params;
    const filmeId = Number(req.params.filmeId);
    await exigirPerfil(pool, perfilId);
    await exigirFilmeVisivel(pool, filmeId);
    const anterior = await comTransacao(pool, async (c) => {
      await travarPar(c, perfilId, filmeId);
      const { rows: [ant] } = await c.query(
        'DELETE FROM app.interacao WHERE perfil_id = $1 AND filme_id = $2 RETURNING tipo, nota', [perfilId, filmeId],
      );
      return anteriorDaLinha(ant);
    });
    return { anterior, efeitos: calcularEfeitos({ nova: null, anterior, temVetor: temVetorNoFc(fc, filmeId) }) };
  });

  app.get('/perfis/:id/interacoes', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', pattern: UUID } } },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tipos: { type: 'string', pattern: `^${TIPO}(,${TIPO})*$` },
          pagina: { type: 'string', pattern: '^[1-9][0-9]{0,5}$' },
        },
      },
    },
  }, async (req) => {
    const { pools } = exigirOperante(ciclo);
    const perfilId = req.params.id;
    await exigirPerfil(pools.leitura, perfilId);
    const pagina = Number(req.query.pagina ?? 1);
    const tipos = req.query.tipos ? [...new Set(req.query.tipos.split(','))].filter((t) => TIPOS_VALIDOS.has(t)) : null;
    // só filmes visíveis (um filme oculto depois de interagido não aparece, como no catálogo)
    const onde = `WHERE i.perfil_id = $1 AND f.visivel AND ($2::text[] IS NULL OR i.tipo = ANY($2))`;
    const base = `FROM app.interacao i
      JOIN app.filme f ON f.id = i.filme_id
      JOIN app.estatistica_historica e ON e.filme_id = f.id ${onde}`;
    const [{ rows: [{ total }] }, { rows }] = await Promise.all([
      pools.leitura.query(`SELECT count(*)::int AS total ${base}`, [perfilId, tipos]),
      pools.leitura.query(
        `SELECT ${COLUNAS_CARTAO.replace('e.n_notas, i.tipo, i.nota', 'e.n_notas, i.tipo, i.nota, i.atualizado_em')} ${base}
         ORDER BY i.atualizado_em DESC, f.id LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
        [perfilId, tipos],
      ),
    ]);
    return {
      itens: rows.map((l) => ({
        filme: cartaoFilme(l, estadoDaLinha(l), midia.midia(l)),
        atualizadoEm: l.atualizado_em.toISOString(),
      })),
      total,
      pagina,
    };
  });
}
