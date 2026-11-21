// Pools de conexão do servidor (spec 5.2). Os nomes dos papéis são constantes; as senhas vêm de
// credenciais.json e nunca vão a logs nem respostas.
import pg from 'pg';

export const PAPEL_LEITURA = 'app_leitura';
export const PAPEL_ESCRITA = 'app_escrita';

/**
 * @param aoErro recebe os erros de clientes ociosos (queda do banco etc.); sem ele, o processo cairia.
 * @returns { leitura, escrita }: leitura com search_path=v2_final,public (só neste pool, nunca via
 *   PGOPTIONS); escrita sem search_path especial.
 */
export function criarPools({ host, port, database, credenciais, aoErro = () => {} }) {
  const base = { host, port, database, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 };
  const leitura = new pg.Pool({
    ...base, user: PAPEL_LEITURA, password: credenciais.app_leitura, options: '-c search_path=v2_final,public',
  });
  const escrita = new pg.Pool({ ...base, user: PAPEL_ESCRITA, password: credenciais.app_escrita });
  for (const pool of [leitura, escrita]) {
    pool.on('error', aoErro);
    // Todo cliente ganha um ouvinte permanente: um cliente que o pool já descartou (ex.: depois de um
    // erro na busca) pode ficar com o socket pendurado atrás do encaminhamento de porta do Docker e
    // emitir ECONNRESET quando o banco cai. Sem ouvinte, esse 'error' derrubaria o processo.
    pool.on('connect', (cliente) => cliente.on('error', aoErro));
  }
  return { leitura, escrita };
}

export async function encerrarPools(pools) {
  if (!pools) return;
  await Promise.allSettled([pools.leitura.end(), pools.escrita.end()]);
}
