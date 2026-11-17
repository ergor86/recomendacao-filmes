// Migracoes do schema `app` e papeis do banco (spec 4.2 passo 5 e 5.2).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const PAPEL_LEITURA = 'app_leitura';
export const PAPEL_ESCRITA = 'app_escrita';

const DIR_MIGRACOES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'banco', 'migracoes');

async function emTransacao(client, fn) {
  await client.query('BEGIN');
  try {
    const r = await fn();
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

// Aplica as migracoes NNN_*.sql ainda nao registradas em app.migracao. Cada arquivo e idempotente
// e registra a propria versao. Devolve as versoes aplicadas agora.
// `transacao: false` quando o chamador ja abriu a transacao (passos 5 a 7 da preparacao).
export async function aplicarMigracoes(client, { transacao = true, diretorio = DIR_MIGRACOES } = {}) {
  const arquivos = readdirSync(diretorio).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const executar = async () => {
    const existe = (await client.query(`SELECT to_regclass('app.migracao') AS t`)).rows[0].t !== null;
    const feitas = new Set(existe ? (await client.query('SELECT versao FROM app.migracao')).rows.map((r) => r.versao) : []);
    const aplicadas = [];
    for (const arquivo of arquivos) {
      const versao = Number(arquivo.slice(0, 3));
      if (feitas.has(versao)) continue;
      await client.query(readFileSync(path.join(diretorio, arquivo), 'utf8'));
      aplicadas.push(versao);
    }
    return aplicadas;
  };
  return transacao ? emTransacao(client, executar) : executar();
}

// Cria ou atualiza os papeis e os GRANTs. `senhas` = { app_leitura, app_escrita }.
// ALTER ROLE ... PASSWORD nao aceita parametro: o literal vem de pg.escapeLiteral e o nome do papel
// de uma constante (unica excecao a regra "SQL so com parametros"). Antes do comando, SET LOCAL
// impede que a senha va ao log do servidor, inclusive em caso de erro.
// `_alterarPapel` e uma costura so para testes (fabricar falha no comando com a senha).
export async function aplicarPapeis(client, {
  senhas, superusuario, transacao = true,
  _alterarPapel = (papel, literal) => `ALTER ROLE ${papel} PASSWORD ${literal}`,
}) {
  for (const papel of [PAPEL_LEITURA, PAPEL_ESCRITA]) {
    if (typeof senhas?.[papel] !== 'string' || senhas[papel].length === 0) {
      throw new Error(`senha ausente para ${papel}`);
    }
  }
  if (typeof superusuario !== 'string' || superusuario.length === 0) throw new Error('superusuario ausente');
  const su = pg.escapeIdentifier(superusuario);

  const executar = async () => {
    await client.query(`SET LOCAL log_statement = 'none'`);
    await client.query(`SET LOCAL log_min_error_statement = 'panic'`);
    // Fora de transacao, SET LOCAL so emite aviso e a protecao some: confirma o efeito antes de usar a senha.
    const { rows: [cfg] } = await client.query(
      `SELECT current_setting('log_statement') AS ls, current_setting('log_min_error_statement') AS lm`);
    if (cfg.ls !== 'none' || cfg.lm !== 'panic') {
      throw new Error('aplicarPapeis exige uma transação aberta');
    }
    for (const papel of [PAPEL_LEITURA, PAPEL_ESCRITA]) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [papel]);
      if (rowCount === 0) await client.query(`CREATE ROLE ${papel} LOGIN`);
      await client.query(_alterarPapel(papel, pg.escapeLiteral(senhas[papel])));
    }
    await client.query(`
      GRANT USAGE ON SCHEMA v2_final, app TO ${PAPEL_LEITURA};
      GRANT SELECT ON ALL TABLES IN SCHEMA v2_final TO ${PAPEL_LEITURA};
      GRANT SELECT ON ALL TABLES IN SCHEMA app TO ${PAPEL_LEITURA};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${su} IN SCHEMA v2_final GRANT SELECT ON TABLES TO ${PAPEL_LEITURA};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${su} IN SCHEMA app GRANT SELECT ON TABLES TO ${PAPEL_LEITURA};
      GRANT USAGE ON SCHEMA app TO ${PAPEL_ESCRITA};
      GRANT SELECT, INSERT, UPDATE, DELETE ON app.perfil, app.interacao TO ${PAPEL_ESCRITA};
      GRANT SELECT ON app.filme TO ${PAPEL_ESCRITA};
    `);
  };
  return transacao ? emTransacao(client, executar) : executar();
}
