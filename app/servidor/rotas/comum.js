// Apoio das rotas de dados: estado operante e validação de parâmetros.
import { ErroApi } from '../seguranca.js';

/** Devolve o estado operante do ciclo ou lança 503 PREPARANDO / BLOQUEADO (spec 4.3). */
export function exigirOperante(ciclo) {
  const op = ciclo.operante();
  if (op) return op;
  throw new ErroApi(ciclo.estado?.()?.estado === 'bloqueado' ? 'BLOQUEADO' : 'PREPARANDO');
}

export const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const POR_PAGINA = 24;

// coerceTypes é false (spec 6.1): parâmetros de consulta chegam como texto e são validados por padrão.
export const booleanoConsulta = { type: 'string', enum: ['true', 'false', '1', '0'] };
export const ehVerdadeiro = (v) => v === 'true' || v === '1';

/** Gêneros do MovieLens 100K, na ordem de exibição, com o rótulo em português (spec 6.2, GET /generos). */
export const GENEROS = Object.freeze([
  ['Action', 'Ação'], ['Adventure', 'Aventura'], ['Animation', 'Animação'], ["Children's", 'Infantil'],
  ['Comedy', 'Comédia'], ['Crime', 'Crime'], ['Documentary', 'Documentário'], ['Drama', 'Drama'],
  ['Fantasy', 'Fantasia'], ['Film-Noir', 'Noir'], ['Horror', 'Terror'], ['Musical', 'Musical'],
  ['Mystery', 'Mistério'], ['Romance', 'Romance'], ['Sci-Fi', 'Ficção científica'], ['Thriller', 'Suspense'],
  ['War', 'Guerra'], ['Western', 'Faroeste'],
].map(([id, rotulo]) => Object.freeze({ id, rotulo })));
export const GENEROS_REAIS = Object.freeze(GENEROS.map((g) => g.id));
export const TODOS_GENEROS = Object.freeze([...GENEROS, Object.freeze({ id: 'unknown', rotulo: 'Desconhecido' })]);

/** Confere que o perfil existe; senão 404 PERFIL_NAO_ENCONTRADO. */
export async function exigirPerfil(pool, perfilId) {
  const { rowCount } = await pool.query('SELECT 1 FROM app.perfil WHERE id = $1', [perfilId]);
  if (rowCount === 0) throw new ErroApi('PERFIL_NAO_ENCONTRADO', 'Perfil não encontrado.');
}
