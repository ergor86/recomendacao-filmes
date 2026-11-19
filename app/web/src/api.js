// Cliente da API local. O caminho já inclui o prefixo (/api/...).

export class ErroApi extends Error {
  constructor({ status = 0, codigo, mensagem }) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.mensagem = mensagem;
  }
}

const MENSAGEM_SEM_SERVIDOR = 'Não consegui falar com o servidor local. Ele está rodando?';

/**
 * chamar(metodo, caminho, corpo?, { signal }?) → Promise<json | null>
 * O cabeçalho Content-Type só vai quando há corpo JSON; sem corpo, não vai cabeçalho nem corpo.
 */
export async function chamar(metodo, caminho, corpo, { signal } = {}) {
  const init = { method: metodo, cache: 'no-store', headers: { Accept: 'application/json' } };
  if (corpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(corpo);
  }
  if (signal) init.signal = signal;
  let resposta;
  try {
    resposta = await fetch(caminho, init);
  } catch (e) {
    if (e?.name === 'AbortError') throw e; // aborto pedido por quem chamou: não é falha do servidor
    throw new ErroApi({ status: 0, codigo: 'SEM_SERVIDOR', mensagem: MENSAGEM_SEM_SERVIDOR });
  }
  let dados = null;
  if (resposta.status !== 204) {
    try {
      dados = await resposta.json();
    } catch {
      dados = null;
    }
  }
  if (!resposta.ok) {
    const erro = new ErroApi({
      status: resposta.status,
      codigo: dados?.codigo ?? 'ERRO_DESCONHECIDO',
      mensagem: dados?.mensagem ?? 'Algo deu errado. Tente de novo.',
    });
    if (erro.codigo === 'PERFIL_NAO_ENCONTRADO') window.dispatchEvent(new CustomEvent('perfil-perdido'));
    // 503 BLOQUEADO/PREPARANDO com a página aberta: o App reconsulta /api/saude.
    // BANCO_INDISPONIVEL não bloqueia (§4.3): fica a Falha local, com "Tentar de novo".
    if (erro.status === 503 && (erro.codigo === 'BLOQUEADO' || erro.codigo === 'PREPARANDO')) {
      window.dispatchEvent(new CustomEvent('estado-mudou'));
    }
    throw erro;
  }
  return dados;
}
