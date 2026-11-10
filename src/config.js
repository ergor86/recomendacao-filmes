const VARIAVEIS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'DIR_DADOS'];

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
