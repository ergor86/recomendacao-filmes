// Reconstrói o `fc` a partir de v2_final.filmes_fc e confere os vetores (spec 4.2 passo 4, 4.3).
import { hashVetoresFC } from '../../src/fc/referencia.js';
import { DIM_FC, HASHES, N_FC } from '../integridade.js';

const TOLERANCIA = 1e-7;

// Uma única consulta: o suporte (posições não nulas) vira fãs = posição + 1.
export async function carregarFcDoBanco(executor) {
  const { rows } = await executor.query(
    'SELECT id, embedding::real[] AS v, vector_dims(embedding) AS d FROM v2_final.filmes_fc ORDER BY id',
  );
  const fasPorFilme = new Map();
  const valores = new Map();
  let dim = null;
  for (const { id, v, d } of rows) {
    if (dim === null) dim = d;
    else if (d !== dim) dim = -1; // dimensões misturadas: a conferência recusa
    const fas = [];
    v.forEach((x, k) => { if (x !== 0 && x !== null) fas.push(k + 1); });
    fasPorFilme.set(id, fas);
    valores.set(id, Float32Array.from(v));
  }
  return {
    fc: { nUsuarios: dim ?? 0, fasPorFilme },
    linhas: rows.length,
    dim: dim ?? 0,
    valores,
  };
}

export function conferirVetores({ fc, linhas, dim, valores }) {
  if (linhas !== N_FC || dim !== DIM_FC) return { ok: false, causa: 'vetores: contagem' };
  if (hashVetoresFC(fc) !== HASHES.vetoresFC) return { ok: false, causa: 'vetores: suporte (hash)' };
  for (const [id, fas] of fc.fasPorFilme) {
    const v = valores.get(id);
    if (!v || v.length !== dim) return { ok: false, causa: 'valores dos vetores' };
    const esperado = Math.fround(1 / Math.sqrt(fas.length));
    for (const u of fas) {
      if (!(Math.abs(v[u - 1] - esperado) <= TOLERANCIA)) return { ok: false, causa: 'valores dos vetores' };
    }
  }
  return { ok: true };
}

// Retrato barato do estado do banco (vigia). `concluidaEm` é null se app.preparacao ou a linha não existe.
export async function impressaoDigital(executor, { comConteudo }) {
  const { rows: [r] } = await executor.query(
    `SELECT ('v2_final.filmes'::regclass::oid)::text AS o1,
            ('v2_final.filmes_fc'::regclass::oid)::text AS o2,
            ('v2_final.metadados'::regclass::oid)::text AS o3,
            (SELECT count(*)::int FROM v2_final.filmes_fc) AS n_fc,
            (SELECT valor FROM v2_final.metadados WHERE chave = 'hash_regua') AS hash_regua,
            (SELECT valor FROM v2_final.metadados WHERE chave = 'hash_treino') AS hash_treino`,
  );
  let concluidaEm = null;
  const { rows: [t] } = await executor.query("SELECT to_regclass('app.preparacao') IS NOT NULL AS existe");
  if (t.existe) {
    const { rows } = await executor.query('SELECT concluida_em FROM app.preparacao WHERE id = 1');
    if (rows.length) concluidaEm = rows[0].concluida_em;
  }
  const saida = {
    oids: [Number(r.o1), Number(r.o2), Number(r.o3)],
    nFc: r.n_fc,
    hashRegua: r.hash_regua,
    hashTreino: r.hash_treino,
    concluidaEm,
  };
  if (comConteudo) {
    const { rows: [c] } = await executor.query(
      "SELECT md5(string_agg(embedding::text, ',' ORDER BY id)) AS m FROM v2_final.filmes_fc",
    );
    saida.md5Conteudo = c.m;
  }
  return saida;
}
