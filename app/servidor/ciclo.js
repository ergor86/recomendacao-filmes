// Ciclo de estados do servidor (spec 4.3): preparando | falhou | bloqueado | operante.
//
// Máquina de estados:
// - Fora do operante, o estado vem do estado.json (preparando/falhou). Quando ele diz "pronto", o
//   ciclo lê credenciais.json, (re)cria os pools e faz a conferência integral: se passar, operante;
//   se falhar por integridade, credenciais ou erro inesperado, bloqueado com a causa; se o banco não
//   responder, continua preparando ("aguardando o banco de dados"), porque disponibilidade não bloqueia.
//   A reavaliação acontece no /saude (e na vigia), limitada a 1 a cada 2 s.
// - No operante, a vigia tira a cada `vigiaSegundos` uma impressão digital barata (e o resumo do
//   conteúdo a cada `conteudoACada` ciclos). Se algo difere do retrato da última conferência integral
//   bem-sucedida, refaz a conferência integral: se passar, continua operante com o fc recarregado e um
//   retrato novo (os pedidos em andamento seguem com o snapshot anterior); se falhar, bloqueia.
// - Regra do controlador (Ruling 15): cada `docker compose up` refaz a preparação, e o estado.json
//   passa por "preparando" e volta a "pronto" em ~0,2 s. Um estado.json em "preparando" NÃO derruba o
//   servidor operante; só a mudança do retrato (que leva à reconferência) importa. O servidor só deixa
//   o operante quando a conferência falha (integridade/credenciais), quando um erro de integridade ou
//   de credenciais é registrado por um pedido, ou quando o estado.json vira "falhou".
// - Erros de disponibilidade (banco fora do ar) nunca bloqueiam: o pedido recebe 503
//   BANCO_INDISPONIVEL e o ciclo segue como está.
import { conferirIntegridade } from '../comum/conferencia.js';
import { classificarErroPg } from '../comum/erros-pg.js';
import { lerCredenciais, lerEstado } from '../comum/estado.js';
import { impressaoDigital } from '../comum/fc-banco.js';
import { criarPools, encerrarPools } from './pools.js';
import { temVetorNoFc } from './recomendacao/s1.js';

export const COMANDO_PREPARAR = 'docker compose run --rm preparar';
export const CAUSA_CREDENCIAIS = 'credenciais do banco não conferem; rode `docker compose run --rm preparar`';
const INTERVALO_REAVALIACAO_MS = 2000;
const MAX_CAUSA = 400;

const divergencia = (causa) => ({ ok: false, causa });

/**
 * Conferência integral (spec 4.2 passos 4 e 7): current_schema() do pool de leitura = v2_final,
 * hashes de metadados = HASHES, vetores (contagem, suporte e valores) e selo app.preparacao.
 * Carrega também ocultos, temVetor e o ranking de populares de app.filme e app.estatistica_historica.
 * O retrato (impressão digital com o resumo do conteúdo) é tirado ANTES da conferência: uma mudança
 * entre os dois aparece na próxima volta da vigia.
 * Erros de consulta que não são de integridade (conexão, credenciais...) são relançados.
 */
export async function conferirIntegral(pools) {
  try {
    const { rows: [s] } = await pools.leitura.query('SELECT current_schema() AS s');
    if (s.s !== 'v2_final') {
      return divergencia(`o pool de leitura não enxerga o schema v2_final (current_schema = ${s.s ?? 'nenhum'})`);
    }
    const retrato = await impressaoDigital(pools.leitura, { comConteudo: true });
    const c = await conferirIntegridade(pools.leitura, { comSelo: true });
    if (!c.ok) return divergencia(c.causa);
    const { rows: filmes } = await pools.leitura.query('SELECT id, visivel, tem_vetor FROM app.filme ORDER BY id');
    const { rows: ranking } = await pools.leitura.query(
      'SELECT filme_id FROM app.estatistica_historica ORDER BY n_notas DESC, filme_id',
    );
    const ocultos = new Set();
    const temVetor = new Set();
    for (const f of filmes) {
      if (!f.visivel) ocultos.add(f.id);
      if (f.tem_vetor) temVetor.add(f.id);
      if (f.tem_vetor !== temVetorNoFc(c.fc, f.id)) return divergencia(`app.filme.tem_vetor difere do fc no filme ${f.id}`);
    }
    if (filmes.length === 0 || ranking.length !== filmes.length) {
      return divergencia('tabelas de referência incompletas (app.filme / app.estatistica_historica)');
    }
    return { ok: true, fc: c.fc, ocultos, temVetor, rankingPopulares: ranking.map((r) => r.filme_id), retrato };
  } catch (e) {
    if (e?.code === '42P01') return divergencia(`tabela ausente: ${e.message}`);
    throw e;
  }
}

// Causa legível de um erro de integridade registrado por um pedido. As mensagens da busca da pesquisa
// terminam com uma instrução para o pesquisador (": rode npm run ..."), que não vale para o app.
function causaDeErro(erro) {
  const msg = String(erro?.message ?? erro).split(': rode ')[0];
  let causa = msg;
  if (erro?.code === '42501') causa = `permissão negada no banco: ${msg}`;
  else if (erro?.code === '42P01') causa = `tabela ausente: ${msg}`;
  return causa.slice(0, MAX_CAUSA);
}

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

function retratoMudou(a, b, comConteudo) {
  if (!a || !b) return true;
  if (String(a.oids) !== String(b.oids)) return true;
  if (a.nFc !== b.nFc || a.hashRegua !== b.hashRegua || a.hashTreino !== b.hashTreino) return true;
  if (iso(a.concluidaEm) !== iso(b.concluidaEm)) return true;
  if ((a.atualizadoEm ?? null) !== (b.atualizadoEm ?? null)) return true;
  return comConteudo && a.md5Conteudo !== b.md5Conteudo;
}

// Só os campos conhecidos, com o tipo certo, saem do estado.json (que nunca deve ter segredos).
function copiarCampos(origem, estado, campos) {
  const out = { estado };
  for (const c of campos) {
    const v = origem?.[c];
    if ((c === 'etapa' || c === 'total') ? Number.isInteger(v) : typeof v === 'string') out[c] = v;
  }
  return out;
}

export function criarCiclo({
  dirEstado,
  pg: cfgPg,
  intervalos = {
    vigiaSegundos: Number(process.env.APP_VIGIA_SEGUNDOS ?? 60),
    conteudoACada: Number(process.env.APP_VIGIA_CONTEUDO_A_CADA ?? 10),
  },
  relogio = Date,
  dependencias = {},
  log = () => {},
}) {
  const dep = {
    criarPools, conferirIntegral, impressaoDigital, lerEstado, lerCredenciais, ...dependencias,
  };
  const vigiaMs = Math.max(1, Number(intervalos.vigiaSegundos)) * 1000;
  const conteudoACada = Math.max(1, Math.trunc(Number(intervalos.conteudoACada)));

  let fase = { estado: 'preparando', mensagem: 'aguardando a preparação' };
  let op = null; // { pools, fc, ocultos, rankingPopulares, temVetor }: snapshot imutável do operante
  let retrato = null; // retrato da última conferência integral bem-sucedida
  let pools = null;
  let chaveCredenciais = null;
  let geracao = 0; // muda a cada saída do operante: uma conferência em curso não desfaz um bloqueio
  let emCurso = null;
  let ultimaReavaliacao = -Infinity;
  let perfis = { disponivel: false, motivo: 'sem_dados' };
  let ultimaSonda = -Infinity;
  let sondaEmCurso = null;
  let ciclos = 0;
  let timer = null;
  let parado = false;

  function sairDoOperante(novaFase) {
    geracao += 1;
    op = null;
    retrato = null;
    ciclos = 0;
    fase = novaFase;
  }

  function bloquear(causa) {
    sairDoOperante({ estado: 'bloqueado', causa: String(causa).slice(0, MAX_CAUSA), comando: COMANDO_PREPARAR });
  }

  function registrarErro(erro) {
    const tipo = classificarErroPg(erro);
    if (tipo === 'integridade') bloquear(causaDeErro(erro));
    else if (tipo === 'credenciais') bloquear(CAUSA_CREDENCIAIS);
    log(`erro do banco (${tipo}): ${String(erro?.message ?? erro).slice(0, MAX_CAUSA)}`);
    return tipo;
  }

  function lerEstadoSeguro() {
    try {
      return dep.lerEstado(dirEstado);
    } catch {
      return { estado: 'preparando', mensagem: 'estado da preparação ilegível; aguardando' };
    }
  }

  // Lê credenciais.json e (re)cria os pools se as senhas mudaram. Devolve false se o arquivo
  // falta ou é inválido.
  function garantirPools() {
    let cred;
    try {
      cred = dep.lerCredenciais(dirEstado);
    } catch {
      return false;
    }
    if (!cred) return false;
    const chave = JSON.stringify([cred.app_leitura, cred.app_escrita]);
    if (chave !== chaveCredenciais) {
      const velhos = pools;
      pools = dep.criarPools({ ...cfgPg, credenciais: cred, aoErro: registrarErro });
      chaveCredenciais = chave;
      if (op) op = { ...op, pools };
      // pg-pool encerra os clientes em uso só quando são devolvidos: pedidos em andamento terminam
      if (velhos) encerrarPools(velhos);
    }
    return true;
  }

  async function conferir(atualizadoEm, estavaOperante) {
    const g = geracao;
    const usados = pools;
    let r;
    try {
      r = await dep.conferirIntegral(usados);
    } catch (erro) {
      if (g !== geracao) return;
      const tipo = classificarErroPg(erro);
      if (tipo === 'disponibilidade') {
        if (!estavaOperante && fase.estado !== 'bloqueado') {
          fase = { estado: 'preparando', mensagem: 'aguardando o banco de dados' };
        }
        return;
      }
      if (tipo === 'credenciais') return bloquear(CAUSA_CREDENCIAIS);
      return bloquear(causaDeErro(erro));
    }
    if (g !== geracao) return;
    if (!r.ok) return bloquear(r.causa);
    op = { pools: usados, fc: r.fc, ocultos: r.ocultos, rankingPopulares: r.rankingPopulares, temVetor: r.temVetor };
    retrato = { ...r.retrato, atualizadoEm: atualizadoEm ?? null };
    fase = { estado: 'operante' };
  }

  // Fora do operante: estado.json manda até ficar "pronto"; então, conferência integral.
  async function avaliar() {
    const e = lerEstadoSeguro();
    const temCredenciais = garantirPools(); // também abre o pool de escrita da gestão restrita
    if (!e) {
      fase = { estado: 'preparando', mensagem: 'aguardando a preparação' };
      return;
    }
    if (e.estado === 'falhou') {
      fase = copiarCampos(e, 'falhou', ['etapa', 'total', 'mensagem', 'causa', 'comando']);
      return;
    }
    if (e.estado !== 'pronto') {
      fase = copiarCampos(e, 'preparando', ['etapa', 'total', 'mensagem']);
      return;
    }
    if (!temCredenciais) return bloquear(CAUSA_CREDENCIAIS);
    await conferir(e.atualizadoEm, false);
  }

  function exclusivo(fn) {
    if (emCurso) return emCurso;
    emCurso = fn().finally(() => { emCurso = null; });
    return emCurso;
  }

  function reavaliarLimitado() {
    if (emCurso) return emCurso;
    const agora = relogio.now();
    if (agora - ultimaReavaliacao < INTERVALO_REAVALIACAO_MS) return Promise.resolve();
    ultimaReavaliacao = agora;
    return exclusivo(avaliar);
  }

  // No operante: impressão digital; se mudou, reconferência integral (spec 4.3, gatilhos 2 e 3).
  async function vigiarOperante() {
    const atual = op;
    ciclos += 1;
    const comConteudo = ciclos % conteudoACada === 0;
    const e = lerEstadoSeguro();
    if (e?.estado === 'falhou') {
      sairDoOperante(copiarCampos(e, 'falhou', ['etapa', 'total', 'mensagem', 'causa', 'comando']));
      return;
    }
    // "preparando" no estado.json não derruba o operante (Ruling 15): só entra no retrato.
    const reconferir = async () => {
      if (!garantirPools()) return bloquear(CAUSA_CREDENCIAIS);
      await conferir(e?.atualizadoEm, true);
    };
    let novo;
    try {
      novo = { ...(await dep.impressaoDigital(atual.pools.leitura, { comConteudo })), atualizadoEm: e?.atualizadoEm ?? null };
    } catch (erro) {
      if (classificarErroPg(erro) === 'disponibilidade') return; // banco fora do ar: tenta na próxima volta
      return reconferir(); // tabela ausente, permissão, senha...: a conferência integral decide
    }
    if (op !== atual) return;
    if (retratoMudou(retrato, novo, comConteudo)) await reconferir();
  }

  async function vigiar() {
    if (fase.estado !== 'operante') return reavaliarLimitado();
    if (emCurso) return emCurso;
    return exclusivo(vigiarOperante);
  }

  // Gestão restrita de perfis (spec 4.3): disponível quando o pool de escrita conecta e app.perfil existe.
  async function sondarPerfis() {
    let cred;
    try {
      cred = dep.lerCredenciais(dirEstado);
    } catch {
      perfis = { disponivel: false, motivo: 'credenciais' };
      return;
    }
    if (!cred) {
      perfis = { disponivel: false, motivo: 'sem_dados' };
      return;
    }
    if (!pools) garantirPools();
    try {
      const { rows: [r] } = await pools.escrita.query("SELECT to_regclass('app.perfil') IS NOT NULL AS existe");
      perfis = r?.existe ? { disponivel: true } : { disponivel: false, motivo: 'sem_dados' };
    } catch (erro) {
      const tipo = classificarErroPg(erro);
      perfis = { disponivel: false, motivo: tipo === 'credenciais' ? 'credenciais' : 'banco_indisponivel' };
    }
  }

  function sondarPerfisLimitado() {
    if (sondaEmCurso) return sondaEmCurso;
    const agora = relogio.now();
    if (agora - ultimaSonda < INTERVALO_REAVALIACAO_MS) return Promise.resolve();
    ultimaSonda = agora;
    sondaEmCurso = sondarPerfis().finally(() => { sondaEmCurso = null; });
    return sondaEmCurso;
  }

  function estado() {
    return { ...fase };
  }

  async function saude() {
    if (fase.estado !== 'operante') await reavaliarLimitado();
    await sondarPerfisLimitado();
    return { ...estado(), perfis: { ...perfis } };
  }

  function agendar() {
    if (parado) return;
    timer = setTimeout(async () => {
      try {
        await vigiar();
      } catch (erro) {
        log(`vigia: ${String(erro?.message ?? erro).slice(0, MAX_CAUSA)}`);
      } finally {
        agendar();
      }
    }, vigiaMs);
    timer.unref?.();
  }

  return {
    intervalos: { vigiaSegundos: vigiaMs / 1000, conteudoACada },
    estado,
    saude,
    operante: () => op,
    poolEscrita: () => pools?.escrita ?? null,
    retrato: () => (retrato ? { ...retrato } : null),
    registrarErro,
    vigiar,
    async iniciar() {
      parado = false;
      await reavaliarLimitado();
      agendar();
    },
    async parar() {
      parado = true;
      clearTimeout(timer);
      await emCurso?.catch(() => {});
      await sondaEmCurso?.catch(() => {});
      const p = pools;
      pools = null;
      op = null;
      await encerrarPools(p);
    },
  };
}
