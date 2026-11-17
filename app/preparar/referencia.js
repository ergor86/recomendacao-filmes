// Tabelas de referencia do schema `app` (spec 4.2 passo 6, 5.1, 5.3).
// Nao abre transacao: o chamador a executa dentro da transacao dos passos 5 a 7.
// Idempotente sem apagar dados de usuarios: filme e estatistica por upsert; so a tabela de
// gemeos (que nenhuma tabela de usuario referencia) e reescrita.
import assert from 'node:assert/strict';
import { rankingPopularidade } from '../../src/candidatos/populares.js';
import { calcularOcultos, carregarGemeosManuais, detectarGemeos } from '../comum/gemeos.js';
import { tituloBusca, tituloExibicao } from '../comum/titulos.js';
import { N_FILMES } from '../integridade.js';

function falhar(msg) {
  throw new Error(`conferencia da referencia: ${msg}`);
}

export async function preencherReferencia(client, ctx) {
  assert(ctx.alvos === null, 'o contexto da preparacao nao pode carregar alvos');
  const { filmes, generos } = ctx.dataset;
  const contagens = ctx.regua.contagens;
  if (filmes.length !== N_FILMES) falhar(`${filmes.length} filmes no dataset (esperado ${N_FILMES})`);

  const pares = [...detectarGemeos(filmes), ...carregarGemeosManuais()];
  const ocultos = calcularOcultos(pares);

  const ids = new Set(filmes.map((f) => f.id));
  const { rows: existentes } = await client.query('SELECT id FROM app.filme');
  const sobra = existentes.map((r) => r.id).filter((id) => !ids.has(id));
  if (sobra.length > 0) falhar(`app.filme tem ids fora do dataset: ${sobra.join(', ')}`);

  const fc = new Set((await client.query('SELECT id FROM v2_final.filmes_fc')).rows.map((r) => r.id));

  const soma = new Map();
  const aprov = new Map();
  for (const a of ctx.treino) {
    soma.set(a.filme, (soma.get(a.filme) ?? 0) + a.nota);
    if (a.nota >= 4) aprov.set(a.filme, (aprov.get(a.filme) ?? 0) + 1);
  }

  const nomesGenero = generos.map((g) => g);
  const col = { id: [], orig: [], exib: [], ano: [], gen: [], vet: [], vis: [], busca: [] };
  for (const f of filmes) {
    col.id.push(f.id);
    col.orig.push(f.titulo);
    col.exib.push(tituloExibicao(f.titulo));
    col.ano.push(f.ano);
    // text[] de tamanho variavel nao cabe em unnest multidimensional: vai como texto separado por '|'
    col.gen.push(nomesGenero.filter((n, i) => f.generos[i] === 1 && n !== 'unknown').join('|'));
    col.vet.push(fc.has(f.id));
    col.vis.push(!ocultos.has(f.id));
    col.busca.push(tituloBusca(f.titulo));
  }
  await client.query(
    `INSERT INTO app.filme (id, titulo_original, titulo_exibicao, ano, generos, tem_vetor, visivel, titulo_busca)
     SELECT id, orig, exib, ano,
            CASE WHEN gen = '' THEN ARRAY[]::text[] ELSE string_to_array(gen, '|') END,
            vet, vis, busca
       FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::text[], $6::bool[], $7::bool[], $8::text[])
            AS t(id, orig, exib, ano, gen, vet, vis, busca)
     ON CONFLICT (id) DO UPDATE SET
       titulo_original = EXCLUDED.titulo_original,
       titulo_exibicao = EXCLUDED.titulo_exibicao,
       ano = EXCLUDED.ano,
       generos = EXCLUDED.generos,
       tem_vetor = EXCLUDED.tem_vetor,
       visivel = EXCLUDED.visivel,
       titulo_busca = EXCLUDED.titulo_busca`,
    [col.id, col.orig, col.exib, col.ano, col.gen, col.vet, col.vis, col.busca],
  );

  const idsOrdem = col.id;
  await client.query(
    `INSERT INTO app.estatistica_historica (filme_id, n_notas, soma_notas, n_aprovacao)
     SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[])
     ON CONFLICT (filme_id) DO UPDATE SET
       n_notas = EXCLUDED.n_notas,
       soma_notas = EXCLUDED.soma_notas,
       n_aprovacao = EXCLUDED.n_aprovacao`,
    [
      idsOrdem,
      idsOrdem.map((id) => contagens[id] ?? 0),
      idsOrdem.map((id) => soma.get(id) ?? 0),
      idsOrdem.map((id) => aprov.get(id) ?? 0),
    ],
  );

  await client.query('DELETE FROM app.filme_gemeo');
  const a = [];
  const b = [];
  const ev = [];
  for (const p of pares) {
    a.push(p.menor, p.maior);
    b.push(p.maior, p.menor);
    ev.push(p.evidencia, p.evidencia);
  }
  await client.query(
    `INSERT INTO app.filme_gemeo (filme_id, gemeo_id, evidencia)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[])`,
    [a, b, ev],
  );

  // conferencias (spec 4.2 passo 6)
  const n = (await client.query('SELECT count(*)::int AS n FROM app.filme')).rows[0].n;
  if (n !== N_FILMES) falhar(`COUNT(app.filme) = ${n}`);
  const est = (await client.query(
    'SELECT count(*)::int AS n, sum(n_notas)::int AS s FROM app.estatistica_historica')).rows[0];
  if (est.n !== N_FILMES) falhar(`COUNT(estatistica_historica) = ${est.n}`);
  if (est.s !== ctx.treino.length) falhar(`SUM(n_notas) = ${est.s}, treino = ${ctx.treino.length}`);
  const linhas = (await client.query(
    'SELECT filme_id, n_notas FROM app.estatistica_historica ORDER BY n_notas DESC, filme_id')).rows;
  for (const r of linhas) {
    if (r.n_notas !== contagens[r.filme_id]) falhar(`n_notas do filme ${r.filme_id} diverge da regua`);
  }
  const esperada = rankingPopularidade(contagens);
  if (linhas.length !== esperada.length || linhas.some((r, i) => r.filme_id !== esperada[i])) {
    falhar('ordem de popularidade diverge de rankingPopularidade');
  }
  const nFc = (await client.query('SELECT count(*)::int AS n FROM app.filme WHERE tem_vetor')).rows[0].n;
  if (nFc !== fc.size) falhar(`tem_vetor = ${nFc}, filmes_fc = ${fc.size}`);
  const nGemeos = (await client.query('SELECT count(*)::int AS n FROM app.filme_gemeo')).rows[0].n;
  if (nGemeos !== pares.length * 2) falhar(`filme_gemeo = ${nGemeos}`);

  return { nFilmes: n, nFc, nGemeos };
}
