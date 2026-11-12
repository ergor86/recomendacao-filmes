// Configuração do projeto, lida das variáveis de ambiente (arquivo .env).
// Fica centralizada aqui para que nenhum outro módulo leia process.env diretamente.

const VARIAVEIS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'DIR_DADOS'];

/**
 * Monta o objeto de configuração usado pelos scripts.
 * Falha cedo, com mensagem clara, se faltar alguma variável (ex.: .env não foi criado).
 * @param env variáveis de ambiente; o padrão é process.env (os testes passam um objeto falso)
 * @returns { pg: dados de conexão do Postgres, dirDados: pasta do MovieLens }
 */
export function carregarConfig(env = process.env) {
  const faltando = VARIAVEIS.filter((v) => !env[v]);
  if (faltando.length > 0) {
    throw new Error(`Faltam variáveis de ambiente (${faltando.join(', ')}): copie .env.example para .env`);
  }
  return {
    pg: {
      host: env.PGHOST,
      port: Number(env.PGPORT),
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
    },
    dirDados: env.DIR_DADOS,
  };
}
