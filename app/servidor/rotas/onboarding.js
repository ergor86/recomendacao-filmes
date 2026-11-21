// GET /api/perfis/:id/onboarding (spec 6.2): grade curada e depois os demais filmes por cursor.
import { normalizarConsulta } from '../../comum/titulos.js';
import { cartaoFilme, COLUNAS_CARTAO, estadoDaLinha, JUNCOES_CARTAO } from './filmes.js';
import {
  exigirOperante, exigirPerfil, GENEROS_REAIS, POR_PAGINA, UUID,
} from './comum.js';

const POR_GENERO = 2;
// Cursor "n_notas:id" do último filme entregue. O início da lista dos demais é um cursor anterior a
// qualquer filme (n_notas máximo de um int4); a primeira página curada devolve este cursor.
export const CURSOR_INICIO = '2147483647:0';

/**
 * Seleção curada (spec 6.2): para cada gênero real, em ordem, os 2 filmes de maior n_notas ainda não
 * escolhidos. Recebe os elegíveis já ordenados por n_notas decrescente e id; devolve ids na mesma ordem.
 */
export function escolherCurados(elegiveis) {
  const escolhidos = new Set();
  for (const g of GENEROS_REAIS) {
    let n = 0;
    for (const f of elegiveis) {
      if (n === POR_GENERO) break;
      if (!escolhidos.has(f.id) && f.generos.includes(g)) { escolhidos.add(f.id); n += 1; }
    }
  }
  return elegiveis.filter((f) => escolhidos.has(f.id)).map((f) => f.id);
}

export async function rotasOnboarding(app, { ciclo, midia }) {
  app.get('/perfis/:id/onboarding', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', pattern: UUID } } },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 100 },
          genero: { type: 'string', enum: [...GENEROS_REAIS, 'unknown'] },
          cursor: { type: 'string', pattern: '^[0-9]{1,10}:[0-9]{1,9}$' },
        },
      },
    },
  }, async (req) => {
    const { pools } = exigirOperante(ciclo);
    const perfilId = req.params.id;
    const { q, genero, cursor } = req.query;
    await exigirPerfil(pools.leitura, perfilId);

    const palavras = normalizarConsulta(q ?? '').split(' ').filter(Boolean);
    const filtrado = Boolean(genero) || palavras.length > 0;
    const entrega = (rows) => rows.map((l) => cartaoFilme(l, estadoDaLinha(l), midia.midia(l)));

    // grade curada: sem filtros; a primeira página é só ela, as demais excluem os curados
    let curados = [];
    if (!filtrado) {
      const { rows } = await pools.leitura.query(
        `SELECT f.id, f.generos FROM app.filme f JOIN app.estatistica_historica e ON e.filme_id = f.id
         WHERE f.visivel AND f.tem_vetor ORDER BY e.n_notas DESC, f.id`,
      );
      curados = escolherCurados(rows);
      if (!cursor) {
        const { rows: itens } = await pools.leitura.query(
          `SELECT ${COLUNAS_CARTAO} ${JUNCOES_CARTAO} WHERE f.id = ANY($2) ORDER BY e.n_notas DESC, f.id`,
          [perfilId, curados],
        );
        return { itens: entrega(itens), proximoCursor: CURSOR_INICIO };
      }
    }

    const onde = ['f.visivel', 'f.tem_vetor'];
    const params = [perfilId];
    if (!filtrado) { params.push(curados); onde.push(`NOT (f.id = ANY($${params.length}))`); }
    if (genero) { params.push(genero); onde.push(`$${params.length} = ANY(f.generos)`); }
    for (const palavra of palavras) { params.push(`%${palavra}%`); onde.push(`f.titulo_busca LIKE $${params.length}`); }
    if (cursor) {
      const [n, id] = cursor.split(':').map(Number);
      params.push(n, id);
      onde.push(`(e.n_notas < $${params.length - 1} OR (e.n_notas = $${params.length - 1} AND f.id > $${params.length}))`);
    }
    const { rows } = await pools.leitura.query(
      `SELECT ${COLUNAS_CARTAO} ${JUNCOES_CARTAO} WHERE ${onde.join(' AND ')}
       ORDER BY e.n_notas DESC, f.id LIMIT ${POR_PAGINA + 1}`, params,
    );
    const itens = rows.slice(0, POR_PAGINA);
    const ultimo = itens.at(-1);
    return {
      itens: entrega(itens),
      proximoCursor: rows.length > POR_PAGINA ? `${ultimo.n_notas}:${ultimo.id}` : null,
    };
  });
}
