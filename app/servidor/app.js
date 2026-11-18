// Montagem do servidor Fastify (spec 4.3, 6.1 e 6.2).
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { enviarErro, LIMITE_CORPO, registrarSeguranca } from './seguranca.js';
import { rotasSaude } from './rotas/saude.js';
import { rotasSobre } from './rotas/sobre.js';
import { rotasFilmes } from './rotas/filmes.js';
import { rotasOnboarding } from './rotas/onboarding.js';
import { rotasPerfis } from './rotas/perfis.js';
import { rotasInteracoes } from './rotas/interacoes.js';
import { criarFornecedorMidia } from './midia/index.js';

/**
 * @param ciclo o ciclo de estados (ciclo.js)
 * @param porta a porta PUBLICADA (APP_PORTA), que o navegador manda no Host
 * @param dirWeb pasta com o build do frontend; sem ela, só a API é servida
 */
export function construirApp({ ciclo, porta, dirWeb, logger = false, midia = criarFornecedorMidia() }) {
  const app = Fastify({
    logger,
    bodyLimit: LIMITE_CORPO,
    ajv: { customOptions: { coerceTypes: false } },
  });

  registrarSeguranca(app, { porta });

  app.setErrorHandler((erro, req, reply) => {
    if (erro.codigo && erro.statusCode) return enviarErro(reply, erro.codigo, erro.message);
    if (erro.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || erro.statusCode === 413) return enviarErro(reply, 'CORPO_GRANDE');
    if (erro.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || erro.statusCode === 415) return enviarErro(reply, 'TIPO_NAO_SUPORTADO');
    if (erro.validation || (erro.statusCode >= 400 && erro.statusCode < 500)) return enviarErro(reply, 'VALIDACAO');
    // erros do banco: disponibilidade não bloqueia; integridade e credenciais bloqueiam (spec 4.3)
    const tipo = ciclo.registrarErro(erro);
    if (tipo === 'disponibilidade') return enviarErro(reply, 'BANCO_INDISPONIVEL');
    if (tipo === 'integridade' || tipo === 'credenciais') return enviarErro(reply, 'BLOQUEADO');
    req.log.error({ msg: erro.message }, 'erro interno');
    return reply.code(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' });
  });

  app.register(rotasSaude, { prefix: '/api', ciclo });
  app.register(rotasSobre, { prefix: '/api' });
  app.register(rotasFilmes, { prefix: '/api', ciclo, midia });
  app.register(rotasOnboarding, { prefix: '/api', ciclo, midia });
  app.register(rotasPerfis, { prefix: '/api', ciclo });
  app.register(rotasInteracoes, { prefix: '/api', ciclo, midia });

  const temWeb = Boolean(dirWeb) && existsSync(path.join(dirWeb, 'index.html'));
  if (temWeb) app.register(fastifyStatic, { root: path.resolve(dirWeb), wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (url === '/api' || url.startsWith('/api/')) return enviarErro(reply, 'ROTA_NAO_ENCONTRADA');
    // fora de /api: o frontend (SPA) resolve a rota
    if (temWeb && (req.method === 'GET' || req.method === 'HEAD')) return reply.sendFile('index.html');
    return enviarErro(reply, 'ROTA_NAO_ENCONTRADA');
  });

  return app;
}
