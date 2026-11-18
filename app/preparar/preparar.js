// Orquestracao da preparacao (spec 4.2, passos 0 a 8). Idempotente: pode rodar quantas vezes quiser.
import path from 'node:path';
import pg from 'pg';
import { garantirCredenciais, gravarEstado } from '../comum/estado.js';
import { conferirIntegridade } from '../comum/conferencia.js';
import { DIM_FC, HASHES, N_FC, N_FILMES } from '../integridade.js';
import { carregarContextoV2Final } from './contexto.js';
import { ErroPreparacao, obterArquivosML } from './dados.js';
import { aplicarMigracoes, aplicarPapeis } from './papeis.js';
import { preencherReferencia } from './referencia.js';
import { rodarScript16 } from './script16.js';

export const CHAVE_TRAVA = 727101;
export const TOTAL_ETAPAS = 8;
export const COMANDO_PADRAO = 'docker compose run --rm preparar';
const TENTATIVAS_CONEXAO = 30;

// Recusa que nao deve sugerir comando: repetir o mesmo comando recusaria de novo.
export class ErroRecusa extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'ErroRecusa';
  }
}

const COMANDO_CREDENCIAIS =
  'apague credenciais.json no volume de estado (docker compose down -v apaga tudo) e rode docker compose run --rm preparar';

function lerOuCriarCredenciais(dirEstado) {
  try {
    return garantirCredenciais(dirEstado);
  } catch (e) {
    if (e.code === 'CREDENCIAIS_INVALIDAS' || e.code === 'JSON_INVALIDO') {
      throw new ErroPreparacao('O arquivo de credenciais está corrompido.', COMANDO_CREDENCIAIS);
    }
    throw e;
  }
}

export class ErroTrava extends Error {
  constructor() {
    super('outra preparação em andamento');
    this.name = 'ErroTrava';
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function recusarBancoDaPesquisa(cfg) {
  if (process.env.PREPARAR_ALVO_APP === '1') return;
  if (Number(cfg.port) === 5433 || cfg.database === 'recomendacao') {
    throw new ErroRecusa(
      'O alvo parece ser o banco da pesquisa (porta 5433 ou banco "recomendacao"); a preparação do app se recusa a mexer nele.',
    );
  }
}

async function conectarComTentativas(cfg, log, espera) {
  let ultimo;
  for (let i = 0; i < TENTATIVAS_CONEXAO; i++) {
    const client = new pg.Client(cfg);
    client.on('error', () => {}); // erro em conexao ja encerrada nao derruba o processo
    try {
      await client.connect();
      return client;
    } catch (e) {
      ultimo = e;
      await client.end().catch(() => {});
      if (i === TENTATIVAS_CONEXAO - 1) break;
      const ms = Math.min(500 * 2 ** i, 5000);
      log(`Banco ainda indisponível (tentativa ${i + 1}/${TENTATIVAS_CONEXAO}); nova tentativa em ${ms} ms`);
      await espera(ms);
    }
  }
  throw new Error(`Não consegui conectar ao banco: ${ultimo?.message ?? 'erro desconhecido'}`);
}

// "Pronto": hashes congelados, filmes_fc completo e selo da versao atual (ruling 11).
async function bancoPronto(client, versaoApp) {
  const { rows: [t] } = await client.query(
    `SELECT to_regclass('v2_final.metadados') IS NOT NULL AS meta,
            to_regclass('v2_final.filmes_fc') IS NOT NULL AS fc,
            to_regclass('app.preparacao') IS NOT NULL AS selo`,
  );
  if (!t.meta || !t.fc || !t.selo) return false;
  const { rows: meta } = await client.query(
    `SELECT chave, valor FROM v2_final.metadados WHERE chave IN ('hash_regua', 'hash_treino')`,
  );
  const m = Object.fromEntries(meta.map((r) => [r.chave, r.valor]));
  if (m.hash_regua !== HASHES.regua || m.hash_treino !== HASHES.treino) return false;
  const { rows: [f] } = await client.query(
    'SELECT count(*)::int AS n, count(*) FILTER (WHERE vector_dims(embedding) = $1)::int AS ok FROM v2_final.filmes_fc',
    [DIM_FC],
  );
  if (f.n !== N_FC || f.ok !== N_FC) return false;
  const { rows: [s] } = await client.query('SELECT versao_app FROM app.preparacao WHERE id = 1');
  return s?.versao_app === versaoApp;
}

async function invalidarSelo(client) {
  const { rows: [t] } = await client.query(`SELECT to_regclass('app.preparacao') IS NOT NULL AS selo`);
  if (t.selo) await client.query('DELETE FROM app.preparacao'); // autocommit: ja confirmado
}

async function recusarV2SemApp(client) {
  const { rows: [r] } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'v2_final') AS v2,
            EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS app`,
  );
  if (r.v2 && !r.app) {
    throw new ErroRecusa(
      'O banco tem o schema v2_final mas não tem o schema app: parece o banco da pesquisa; a preparação em modo de desenvolvimento se recusa a mexer nele.',
    );
  }
}

export async function prepararTudo({
  pg: cfg, dirDados, dirTrabalho, dirEstado, zipLocal, versaoApp, porta,
  modoDev = false, log = console.log, baixar, ganchos = {}, espera = dormir,
}) {
  let client;
  let travado = false;
  let ultimaEtapa = 0;
  const etapa = (n, mensagem) => {
    ultimaEtapa = n;
    log(`${n}/${TOTAL_ETAPAS}: ${mensagem}`);
    gravarEstado(dirEstado, {
      estado: 'preparando', etapa: n, total: TOTAL_ETAPAS, mensagem, atualizadoEm: new Date().toISOString(),
    });
  };

  try {
    // Passos 0 e 1: conexao e trava. Se a trava nao vier, nada e gravado (nao atrapalha a outra preparacao).
    recusarBancoDaPesquisa(cfg);
    client = await conectarComTentativas(cfg, log, espera);
    const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [CHAVE_TRAVA]);
    if (!l.ok) throw new ErroTrava();
    travado = true;
    etapa(1, 'conectando ao banco');
    if (modoDev) {
      // A recusa vem antes de criar o schema: um v2_final sem app ja existente e a pesquisa. Depois dela,
      // o schema app nasce numa transacao propria, para que uma queda apos o script 16 nao deixe
      // v2_final sem app e trave as proximas preparacoes.
      await recusarV2SemApp(client);
      await aplicarMigracoes(client);
    }

    const credenciais = lerOuCriarCredenciais(dirEstado);

    // Passo 2: arquivos do MovieLens, so quando forem necessarios (carga ou preenchimento da referencia)
    let arquivosObtidos = false;
    const obterArquivos = async () => {
      if (arquivosObtidos) return;
      etapa(2, 'conferindo os arquivos do MovieLens 100K');
      await obterArquivosML({ destino: dirDados, zipLocal, log, ...(baixar ? { baixar } : {}) });
      arquivosObtidos = true;
    };

    // Passo 3: carga congelada, so se o banco nao estiver pronto
    let pronto = await bancoPronto(client, versaoApp);
    if (pronto) log(`2/${TOTAL_ETAPAS}: banco já preparado; os arquivos do MovieLens não são necessários`);
    const carregar = async () => {
      await obterArquivos();
      etapa(3, 'carregando filmes no banco');
      // um selo antigo nao pode sobreviver a uma carga que falhe depois do script 16
      await invalidarSelo(client);
      await rodarScript16({ pg: cfg, dirDados, dirTrabalho });
      pronto = false;
    };
    if (pronto) etapa(3, 'banco já preparado; pulando a carga dos filmes');
    else await carregar();

    // Passo 4: integridade. No caminho "pronto", uma divergencia se cura uma unica vez.
    etapa(4, 'conferindo a integridade dos dados');
    // O selo ainda nao existe neste ponto (passo 7): aqui se conferem so os dados.
    let conferencia = await conferirIntegridade(client, { comSelo: false });
    if (!conferencia.ok) {
      if (!pronto) throw new Error(conferencia.causa);
      log('integridade divergente: recarregando os dados congelados');
      await carregar();
      etapa(4, 'conferindo a integridade dos dados');
      conferencia = await conferirIntegridade(client, { comSelo: false });
      if (!conferencia.ok) throw new Error(conferencia.causa);
    }
    log(`hash_regua=${conferencia.hashes.regua}`);
    log(`hash_treino=${conferencia.hashes.treino}`);
    log(`hash_vetores_fc=${conferencia.hashes.vetoresFC}`);

    // Passos 5 a 7: uma transacao so
    etapa(5, 'preparando tabelas e papéis do banco');
    await client.query('BEGIN');
    try {
      await aplicarMigracoes(client, { transacao: false });
      await aplicarPapeis(client, { senhas: credenciais, superusuario: cfg.user, transacao: false });
      if (!pronto) {
        await obterArquivos();
        etapa(6, 'preenchendo as tabelas de referência');
        await preencherReferencia(client, carregarContextoV2Final(path.join(dirDados, 'ml-100k')));
      } else {
        log(`6/${TOTAL_ETAPAS}: tabelas de referência já preenchidas; pulando`);
      }
      etapa(7, 'gravando o selo de preparação');
      if (ganchos.antesDoSelo) await ganchos.antesDoSelo();
      await client.query(
        `INSERT INTO app.preparacao (id, versao_app, hash_regua, hash_treino, hash_vetores_fc, n_filmes, n_fc, concluida_em)
         VALUES (1, $1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE SET
           versao_app = EXCLUDED.versao_app, hash_regua = EXCLUDED.hash_regua, hash_treino = EXCLUDED.hash_treino,
           hash_vetores_fc = EXCLUDED.hash_vetores_fc, n_filmes = EXCLUDED.n_filmes, n_fc = EXCLUDED.n_fc,
           concluida_em = EXCLUDED.concluida_em`,
        [versaoApp, HASHES.regua, HASHES.treino, HASHES.vetoresFC, N_FILMES, N_FC],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    // Passo 8
    log(`8/${TOTAL_ETAPAS}: preparação concluída`);
    gravarEstado(dirEstado, {
      estado: 'pronto', etapa: TOTAL_ETAPAS, total: TOTAL_ETAPAS, mensagem: 'Preparação concluída.',
      atualizadoEm: new Date().toISOString(),
    });
    log(`Pronto: abra http://localhost:${porta}`);
    return 'pronto';
  } catch (e) {
    if (!travado) {
      // Sem a trava, outra preparacao pode estar em andamento: nao sobrescreve o estado, so registra.
      log(`A preparação não começou: ${e.message}`);
    } else {
      const doProprio = e instanceof ErroPreparacao;
      try {
        gravarEstado(dirEstado, {
          estado: 'falhou', etapa: ultimaEtapa, total: TOTAL_ETAPAS, mensagem: 'A preparação falhou.',
          causa: doProprio ? e.causa : e.message,
          ...(e instanceof ErroRecusa ? {} : { comando: doProprio ? e.comando : COMANDO_PADRAO }),
          atualizadoEm: new Date().toISOString(),
        });
      } catch { /* sem onde gravar o estado; o erro original segue */ }
    }
    throw e;
  } finally {
    if (client) {
      if (travado) await client.query('SELECT pg_advisory_unlock($1)', [CHAVE_TRAVA]).catch(() => {});
      await client.end().catch(() => {});
    }
  }
}
