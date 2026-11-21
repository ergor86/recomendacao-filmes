// Segurança do servidor (spec 6.1, 7 "CSP" e 9): Host em lista de permissão (contra DNS rebinding),
// Origin/Sec-Fetch-Site nas escritas, só JSON nas escritas, corpo de até 4 KB, CSP explícita e erros
// no formato { codigo, mensagem } com o catálogo da spec 6.1.
import helmet from '@fastify/helmet';

export const LIMITE_CORPO = 4096;

// Catálogo da spec 6.1 (código → status HTTP). ERRO_INTERNO fica fora do catálogo: é o 500 genérico.
export const CODIGOS = Object.freeze({
  VALIDACAO: 400,
  ORIGEM_INVALIDA: 403,
  PERFIL_NAO_ENCONTRADO: 404,
  FILME_NAO_ENCONTRADO: 404,
  ROTA_NAO_ENCONTRADA: 404,
  LIMITE_PERFIS: 409,
  NOME_EM_USO: 409,
  CORPO_GRANDE: 413,
  TIPO_NAO_SUPORTADO: 415,
  HOST_INVALIDO: 421,
  PREPARANDO: 503,
  BLOQUEADO: 503,
  BANCO_INDISPONIVEL: 503,
});

const MENSAGENS = Object.freeze({
  VALIDACAO: 'Pedido inválido.',
  ORIGEM_INVALIDA: 'Origem do pedido não permitida.',
  ROTA_NAO_ENCONTRADA: 'Rota não encontrada.',
  CORPO_GRANDE: 'Corpo do pedido maior que 4 KB.',
  TIPO_NAO_SUPORTADO: 'As escritas com corpo exigem Content-Type: application/json.',
  HOST_INVALIDO: 'Host não permitido. Abra a aplicação por http://localhost:<porta>.',
  NOME_EM_USO: 'Já existe um perfil com esse nome.',
  PREPARANDO: 'A aplicação ainda está se preparando.',
  BLOQUEADO: 'A aplicação está bloqueada: a conferência de integridade falhou.',
  BANCO_INDISPONIVEL: 'O banco de dados não está respondendo agora. Tente de novo em instantes.',
  ERRO_INTERNO: 'Erro interno do servidor.',
});

/** Erro com código do catálogo; o tratador de erros o devolve como { codigo, mensagem }. */
export class ErroApi extends Error {
  constructor(codigo, mensagem = MENSAGENS[codigo] ?? codigo) {
    super(mensagem);
    this.codigo = codigo;
    this.statusCode = CODIGOS[codigo] ?? 500;
  }
}

export function enviarErro(reply, codigo, mensagem = MENSAGENS[codigo] ?? codigo) {
  return reply.code(CODIGOS[codigo] ?? 500).type('application/json; charset=utf-8').send({ codigo, mensagem });
}

/** Hosts aceitos: localhost, 127.0.0.1 e [::1] com a porta publicada; sem porta só quando ela é 80. */
export function hostsPermitidos(porta) {
  const nomes = ['localhost', '127.0.0.1', '[::1]'];
  const hosts = new Set(nomes.map((n) => `${n}:${porta}`));
  if (Number(porta) === 80) for (const n of nomes) hosts.add(n);
  return hosts;
}

const ESCRITAS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_CT = /^application\/json\s*(;|$)/i;

// A CSP da spec §7, diretiva por diretiva. useDefaults: false (nada além destas, nem
// upgrade-insecure-requests) e hsts: false (a aplicação é http em localhost).
export const DIRETIVAS_CSP = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
});

export function registrarSeguranca(app, { porta }) {
  const permitidos = hostsPermitidos(porta);

  app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: DIRETIVAS_CSP },
    hsts: false,
  });

  // sem o parser text/plain: um formulário HTML de outro site não consegue mandar um corpo aceito
  app.removeContentTypeParser('text/plain');

  // Corpo vazio com Content-Type: application/json vale como corpo ausente (DELETE, POST /perfis/exemplo):
  // o parser padrão o recusaria com 400. Corpo não vazio segue o parser padrão (JSON inválido e
  // __proto__/constructor continuam 400); rotas com schema de body continuam exigindo o corpo.
  const jsonPadrao = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, corpo, done) => {
    if (corpo.trim() === '') return done(null, undefined);
    return jsonPadrao(req, corpo, done);
  });

  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!permitidos.has(host)) return enviarErro(reply, 'HOST_INVALIDO');

    if (ESCRITAS.has(req.method)) {
      const origem = req.headers.origin;
      if (origem !== undefined && origem !== `http://${host}`) return enviarErro(reply, 'ORIGEM_INVALIDA');
      if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
        return enviarErro(reply, 'ORIGEM_INVALIDA');
      }
      const ct = req.headers['content-type'];
      const temCorpo = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
      if ((temCorpo || ct !== undefined) && !JSON_CT.test(String(ct ?? ''))) {
        return enviarErro(reply, 'TIPO_NAO_SUPORTADO');
      }
    }
    return undefined;
  });

  // respostas da API nunca ficam em cache (estado, perfis e recomendações mudam a todo momento)
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/') || req.url === '/api') reply.header('cache-control', 'no-store');
    return payload;
  });
}
