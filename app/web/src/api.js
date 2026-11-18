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
 * chamar(metodo, caminho, corpo?) → Promise<json | null>
 * O cabeçalho Content-Type só vai quando há corpo JSON; sem corpo, não vai cabeçalho nem corpo.
 */
export async function chamar(metodo, caminho, corpo) {
  const init = { method: metodo, cache: 'no-store', headers: { Accept: 'application/json' } };
  if (corpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(corpo);
  }
  let resposta;
  try {
    resposta = await fetch(caminho, init);
  } catch {
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
    throw erro;
  }
  return dados;
}
