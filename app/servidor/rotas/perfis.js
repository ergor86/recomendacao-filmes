// GET/POST/PATCH/DELETE /api/perfis e POST /api/perfis/exemplo (spec 4.3 e 6.2).
// Tudo passa pelo pool de escrita do ciclo (app_escrita): é o que permite a gestão restrita fora do
// estado operante, em que só GET /perfis e DELETE /perfis/:id funcionam.
import { readFileSync } from 'node:fs';
import { ErroApi } from '../seguranca.js';
import { exigirOperante, UUID } from './comum.js';

export const MAX_PERFIS = 20;
export const LOCK_PERFIS = 727102;
const MIN_NOME = 1;
const MAX_NOME = 40;

// Lista versionada de 6 ids escolhidos à mão (spec 6.2); um teste confere vetor e visibilidade.
export const IDS_EXEMPLO = Object.freeze(
  JSON.parse(readFileSync(new URL('../exemplo.json', import.meta.url), 'utf8')),
);

const CURTIDA = `(i.tipo = 'gostei' OR (i.tipo = 'nota' AND i.nota >= 4))`;
// perfil + contagens; curtidos = gostei ∪ notas 4–5, curtidosComVetor = os que têm vetor (spec 4.4, passo 2)
const SQL_PERFIS = `SELECT p.id, p.nome, p.exemplo, p.onboarding_concluido,
    count(i.filme_id) FILTER (WHERE i.tipo = 'nota')::int AS notas,
    count(i.filme_id) FILTER (WHERE i.tipo = 'gostei')::int AS gostei,
    count(i.filme_id) FILTER (WHERE i.tipo = 'quero_assistir')::int AS quero_assistir,
    count(i.filme_id) FILTER (WHERE ${CURTIDA})::int AS curtidos,
    count(i.filme_id) FILTER (WHERE ${CURTIDA} AND f.tem_vetor)::int AS curtidos_com_vetor
  FROM app.perfil p
  LEFT JOIN app.interacao i ON i.perfil_id = p.id
  LEFT JOIN app.filme f ON f.id = i.filme_id`;

export function formatarPerfil(l) {
  return {
    id: l.id,
    nome: l.nome,
    exemplo: l.exemplo,
    onboardingConcluido: l.onboarding_concluido,
    contagens: {
      notas: l.notas, gostei: l.gostei, queroAssistir: l.quero_assistir,
      curtidos: l.curtidos, curtidosComVetor: l.curtidos_com_vetor,
    },
  };
}

/** Pool de escrita do ciclo; sem ele (credenciais ausentes), 503 BANCO_INDISPONIVEL. */
export function exigirPoolEscrita(ciclo) {
  const pool = ciclo.poolEscrita?.();
  if (!pool) throw new ErroApi('BANCO_INDISPONIVEL');
  return pool;
}

/** Roda `fn(cliente)` numa transação; o COMMIT/ROLLBACK e a devolução do cliente são garantidos. */
export async function comTransacao(pool, fn) {
  const cliente = await pool.connect();
  let falha;
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (erro) {
    falha = erro;
    await cliente.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    cliente.release(falha); // com erro, o cliente é descartado em vez de voltar ao pool
  }
}

// Espaços (o que o trim do JS remove) e caracteres de formato Unicode (\p{Cf}: U+200B, U+200D, U+FEFF, U+00AD...)
// nas pontas, repetidos até não sobrar nenhum. Só as pontas: o meio fica intacto (emoji com ZWJ, U+FE0F).
const PONTAS_INVISIVEIS = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;

/** Nome em NFC, sem invisíveis nas pontas, de 1 a 40 caracteres (pontos de código: um emoji conta como 1). */
function validarNome(nome) {
  const limpo = nome.normalize('NFC').replace(PONTAS_INVISIVEIS, ''); // composto e decomposto (André) são o mesmo nome
  const n = Array.from(limpo).length;
  if (n < MIN_NOME || n > MAX_NOME) throw new ErroApi('VALIDACAO', `O nome deve ter de ${MIN_NOME} a ${MAX_NOME} caracteres.`);
  return limpo;
}

// Nome único sem diferenciar caixa (decisão do usuário, 2026-11-21); roda sob o lock de LOCK_PERFIS.
// Só compara com OUTROS perfis (`idAtual`). "Perfil de exemplo" é reservado ao perfil de exemplo
// (`exemplo = true`). Tudo no banco, com o mesmo lower(), para a reserva e a unicidade não divergirem.
async function exigirNomeLivre(cliente, nome, idAtual = null, atualEhExemplo = false) {
  const { rows: [r] } = await cliente.query(
    `SELECT EXISTS (SELECT 1 FROM app.perfil WHERE lower(nome) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)) AS repetido,
            lower($1) = 'perfil de exemplo' AS reservado`,
    [nome, idAtual],
  );
  if (r.repetido || (r.reservado && !atualEhExemplo)) throw new ErroApi('NOME_EM_USO');
}

const buscarPerfil = async (cliente, id) => {
  const { rows } = await cliente.query(`${SQL_PERFIS} WHERE p.id = $1 GROUP BY p.id`, [id]);
  return rows.length ? formatarPerfil(rows[0]) : null;
};

// o limite é conferido sob o lock da transação: criações concorrentes se serializam
async function travarELimitar(cliente) {
  await cliente.query('SELECT pg_advisory_xact_lock($1)', [LOCK_PERFIS]);
  const { rows: [{ n }] } = await cliente.query('SELECT count(*)::int AS n FROM app.perfil');
  if (n >= MAX_PERFIS) throw new ErroApi('LIMITE_PERFIS', `O limite é de ${MAX_PERFIS} perfis. Apague algum para criar outro.`);
}

// Sem additionalProperties: false de propósito. O Fastify (removeAdditional) apagaria o campo extra em vez de
// recusar o pedido; por isso `recusarExtras` confere as chaves à mão (spec 6.1: validação, 400).
function recusarExtras(corpo, permitidas) {
  if (Object.keys(corpo).some((k) => !permitidas.includes(k))) throw new ErroApi('VALIDACAO');
}

const NOME_SCHEMA = { type: 'string', maxLength: 200 };
const PARAMS_ID = { type: 'object', properties: { id: { type: 'string', pattern: UUID } } };

export async function rotasPerfis(app, { ciclo }) {
  // Gestão restrita: funciona em qualquer estado, desde que haja pool de escrita.
  app.get('/perfis', async () => {
    const pool = exigirPoolEscrita(ciclo);
    const { rows } = await pool.query(`${SQL_PERFIS} GROUP BY p.id ORDER BY p.criado_em, p.id`);
    return rows.map(formatarPerfil);
  });

  app.delete('/perfis/:id', { schema: { params: PARAMS_ID } }, async (req, reply) => {
    const pool = exigirPoolEscrita(ciclo);
    const { rowCount } = await pool.query('DELETE FROM app.perfil WHERE id = $1', [req.params.id]); // cascata nas interações
    if (rowCount === 0) throw new ErroApi('PERFIL_NAO_ENCONTRADO', 'Perfil não encontrado.');
    return reply.code(204).send();
  });

  app.post('/perfis', {
    schema: {
      body: { type: 'object', required: ['nome'], properties: { nome: NOME_SCHEMA } },
    },
  }, async (req, reply) => {
    recusarExtras(req.body, ['nome']);
    exigirOperante(ciclo);
    const nome = validarNome(req.body.nome);
    const pool = exigirPoolEscrita(ciclo);
    const perfil = await comTransacao(pool, async (c) => {
      await travarELimitar(c);
      await exigirNomeLivre(c, nome);
      const { rows: [{ id }] } = await c.query('INSERT INTO app.perfil (nome) VALUES ($1) RETURNING id', [nome]);
      return buscarPerfil(c, id);
    });
    return reply.code(201).send(perfil);
  });

  // Idempotente: o perfil de exemplo (exemplo = true) existe no máximo uma vez.
  app.post('/perfis/exemplo', async (req, reply) => {
    exigirOperante(ciclo);
    const pool = exigirPoolEscrita(ciclo);
    const { perfil, criado } = await comTransacao(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_PERFIS]);
      const { rows: [existente] } = await c.query('SELECT id FROM app.perfil WHERE exemplo ORDER BY criado_em, id LIMIT 1');
      if (existente) return { perfil: await buscarPerfil(c, existente.id), criado: false };
      await travarELimitar(c);
      const { rows: [{ id }] } = await c.query(
        `INSERT INTO app.perfil (nome, exemplo, onboarding_concluido) VALUES ('Perfil de exemplo', true, true) RETURNING id`,
      );
      await c.query(
        `INSERT INTO app.interacao (perfil_id, filme_id, tipo) SELECT $1, f, 'gostei' FROM unnest($2::int[]) AS f`,
        [id, IDS_EXEMPLO],
      );
      return { perfil: await buscarPerfil(c, id), criado: true };
    });
    return reply.code(criado ? 201 : 200).send(perfil);
  });

  app.patch('/perfis/:id', {
    schema: {
      params: PARAMS_ID,
      body: {
        type: 'object',
        minProperties: 1,
        properties: { nome: NOME_SCHEMA, onboardingConcluido: { type: 'boolean' } },
      },
    },
  }, async (req) => {
    recusarExtras(req.body, ['nome', 'onboardingConcluido']);
    exigirOperante(ciclo);
    const pool = exigirPoolEscrita(ciclo);
    const nome = req.body.nome === undefined ? null : validarNome(req.body.nome);
    const concluido = req.body.onboardingConcluido ?? null;
    const atualizar = async (c) => {
      const { rowCount } = await c.query(
        `UPDATE app.perfil SET nome = COALESCE($2, nome), onboarding_concluido = COALESCE($3, onboarding_concluido)
         WHERE id = $1`,
        [req.params.id, nome, concluido],
      );
      if (rowCount === 0) throw new ErroApi('PERFIL_NAO_ENCONTRADO', 'Perfil não encontrado.');
      return buscarPerfil(c, req.params.id);
    };
    if (nome === null) return atualizar(pool); // sem renomear: nada a conferir, sem lock
    return comTransacao(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_PERFIS]);
      // a existência vem antes da regra de nome: id inexistente é sempre 404
      const { rows: [alvo] } = await c.query('SELECT exemplo FROM app.perfil WHERE id = $1', [req.params.id]);
      if (!alvo) throw new ErroApi('PERFIL_NAO_ENCONTRADO', 'Perfil não encontrado.');
      await exigirNomeLivre(c, nome, req.params.id, alvo.exemplo);
      return atualizar(c);
    });
  });
}
