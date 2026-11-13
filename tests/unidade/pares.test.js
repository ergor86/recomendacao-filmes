// Testes dos pares de treino e de validação: perfil por tipo de par, desconto de popularidade,
// exclusões e sementes do sorteio de negativos. Usa só dados sintéticos criados aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRegua } from '../../src/features/regua.js';
import {
  historicoDoTreino, resumoCurtidos, perfilRede, popZDoPar, filmeRede, popZReferencia,
} from '../../src/features/entrada.js';
import { sortearNegativos, paresDeTreino, paresDeValidacao } from '../../src/features/pares.js';
import { criarAleatorio } from '../../src/util/aleatorio.js';

// 20 filmes com vetor de gêneros único (permite descobrir o filme de cada linha de x).
const multi = (...idx) => Array.from({ length: 19 }, (_, i) => (idx.includes(i) ? 1 : 0));
const anos = [1970, 1985, 1995, null];
const filmes = Array.from({ length: 20 }, (_, k) => ({
  id: k + 1, titulo: `F${k + 1}`, ano: anos[k % 4], generos: k < 19 ? multi(k) : multi(0, 1),
}));
const filmesPorId = new Map(filmes.map((f) => [f.id, f]));
const catalogo = filmes.map((f) => f.id);
const usuarios = [1, 2, 3, 4, 5].map((id) => ({
  id, idade: 18 + 7 * id, genero: id % 2 ? 'M' : 'F', ocupacao: `o${id}`,
}));
const usuariosPorId = new Map(usuarios.map((u) => [u.id, u]));
const treino = [
  { usuario: 1, filme: 1, nota: 5 }, { usuario: 1, filme: 2, nota: 4 }, { usuario: 1, filme: 3, nota: 5 },
  { usuario: 1, filme: 4, nota: 2 }, { usuario: 1, filme: 5, nota: 3 },
  { usuario: 2, filme: 1, nota: 4 }, { usuario: 2, filme: 6, nota: 1 }, // só 1 curtido: descartado
  { usuario: 3, filme: 2, nota: 5 }, { usuario: 3, filme: 7, nota: 4 }, { usuario: 3, filme: 8, nota: 2 },
  { usuario: 4, filme: 3, nota: 1 }, // sem curtidas
  { usuario: 5, filme: 9, nota: 4 }, { usuario: 5, filme: 10, nota: 5 },
  { usuario: 5, filme: 1, nota: 3 }, { usuario: 5, filme: 2, nota: 3 },
];
const validacao = [
  { usuario: 1, filme: 6, nota: 5 }, { usuario: 1, filme: 7, nota: 2 },
  { usuario: 3, filme: 9, nota: 4 },
  { usuario: 4, filme: 11, nota: 5 },
  { usuario: 5, filme: 12, nota: 2 }, // sem positivo escondido
];
const regua = calcularRegua({
  treino, filmes, usuarios,
  generos: Array.from({ length: 19 }, (_, i) => `g${i}`),
  ocupacoes: Array.from({ length: 21 }, (_, i) => `o${i}`),
});
const historico = historicoDoTreino(treino, filmesPorId);
const candidatosPorUsuario = new Map([
  [1, [6, 7, 8, 9, 10, 11, 12, 13]],
  [2, [2, 3, 4, 5, 7]],
  [3, [1, 3, 9, 11, 13, 15]],
  [4, [1, 2, 11, 12, 14]],
  [5, [3, 4, 12, 13, 14, 16]],
]);
const base = { historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema: 'candidatos', semente: 1 };

const DIM = 70;
const linha = (r, i) => Array.from(r.x.subarray(i * r.dim, (i + 1) * r.dim));
const perfilDe = (r, i) => linha(r, i).slice(24, 47);
const f32 = (a) => Array.from(Float32Array.from(a));
const igual = (a, b, tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tol);
// Descobre o usuário (pela idade em z-score) e o filme (pela parte do filme) de cada linha.
function usuarioDe(r, i) {
  const z = r.x[i * r.dim];
  return usuarios.find((u) => Math.abs((u.idade - regua.idade.media) / regua.idade.desvio - z) < 1e-5).id;
}
function filmeDe(r, i) {
  const parte = linha(r, i).slice(47, 69);
  const f = filmes.find((g) => igual(filmeRede(g, 0).slice(0, 22), parte));
  assert.ok(f, `filme da linha ${i} não identificado`);
  return f.id;
}
const perfilCompleto = (u) => perfilRede(resumoCurtidos(historico.get(u).curtidos, regua), regua);
const avaliados = (u) => new Set(historico.get(u).notas.keys());

test('sortearNegativos: candidatos esgotados vão ao catálogo e contam em recorreuAoCatalogo', () => {
  const r = sortearNegativos({
    quantidade: 8, excluir: new Set([1, 2, 3]), catalogo, candidatos: [1, 2, 3], aleatorio: criarAleatorio(7),
  });
  assert.equal(r.ids.length, 8);
  assert.equal(r.recorreuAoCatalogo, 6);
  assert.ok(r.ids.every((id) => id > 3));
});

test('sortearNegativos: com 5 candidatos e quantidade grande, ids se repetem; índices 0–2 (mod 4) vêm dos candidatos', () => {
  const candidatos = [11, 12, 13, 14, 15];
  const r = sortearNegativos({
    quantidade: 400, excluir: new Set([1]), catalogo, candidatos, aleatorio: criarAleatorio(3),
  });
  assert.ok(new Set(r.ids).size < r.ids.length);
  r.ids.forEach((id, j) => { if (j % 4 < 3) assert.ok(candidatos.includes(id), `índice ${j}: ${id}`); });
  assert.ok(r.ids.some((id, j) => j % 4 === 3 && !candidatos.includes(id)), 'índice 3 deve vir do catálogo');
  assert.equal(r.recorreuAoCatalogo, 0);
  assert.ok(!r.ids.includes(1));
});

test('sortearNegativos: catálogo elegível vazio falha alto', () => {
  assert.throws(() => sortearNegativos({
    quantidade: 4, excluir: new Set(catalogo), catalogo, candidatos: null, aleatorio: criarAleatorio(1),
  }), /nenhum filme elegível/);
});

test('treino: usuário com 1 curtido tem o positivo descartado; contagens do resumo', () => {
  const r = paresDeTreino(base);
  assert.equal(r.resumo.descartados, 1);
  assert.equal(r.resumo.positivos, 3 + 2 + 2);
  assert.equal(r.resumo.observados, 2 + 1 + 1 + 1 + 2);
  assert.equal(r.resumo.sorteados, 4 * 7);
  assert.equal(r.n, 7 * 5 + 7);
  assert.equal(r.dim, DIM);
  assert.equal(r.x.length, r.n * DIM);
  // Usuário 2: só o observado, nenhum positivo nem sorteado.
  const linhasU2 = [...Array(r.n).keys()].filter((i) => usuarioDe(r, i) === 2);
  assert.equal(linhasU2.length, 1);
  assert.equal(r.y[linhasU2[0]], 0);
  assert.equal(r.negativosSorteados.get(2).size, 0);
});

test('treino: perfil do positivo é sem o filme do par e diferente do completo', () => {
  const r = paresDeTreino(base);
  const A = filmesPorId.get(1);
  assert.equal(r.y[0], 1);
  assert.equal(filmeDe(r, 0), 1);
  const resumoU1 = resumoCurtidos(historico.get(1).curtidos, regua);
  assert.ok(igual(perfilDe(r, 0), f32(perfilRede(resumoU1, regua, A))));
  assert.ok(!igual(perfilDe(r, 0), f32(perfilCompleto(1))));
  // Vale para todo positivo.
  for (let i = 0; i < r.n; i++) {
    if (r.y[i] !== 1) continue;
    const u = usuarioDe(r, i);
    const f = filmesPorId.get(filmeDe(r, i));
    assert.ok(igual(perfilDe(r, i), f32(perfilRede(resumoCurtidos(historico.get(u).curtidos, regua), regua, f))));
  }
});

test('treino: 4 sorteados por positivo usável, por usuário, cada um com o perfil idêntico ao do seu positivo', () => {
  const r = paresDeTreino(base);
  const positivosPorUsuario = new Map();
  const sorteadosPorUsuario = new Map();
  const inc = (m, u) => m.set(u, (m.get(u) ?? 0) + 1);
  for (let i = 0; i < r.n; i++) {
    if (r.y[i] !== 1) continue;
    const u = usuarioDe(r, i);
    inc(positivosPorUsuario, u);
    for (let k = 1; k <= 4; k++) {
      assert.equal(r.y[i + k], 0);
      assert.equal(usuarioDe(r, i + k), u);
      assert.deepEqual(perfilDe(r, i + k), perfilDe(r, i), `linha ${i + k} com perfil diferente do positivo ${i}`);
      inc(sorteadosPorUsuario, u);
    }
  }
  for (const [u, p] of positivosPorUsuario) {
    assert.equal(p, historico.get(u).curtidos.length);
    assert.equal(sorteadosPorUsuario.get(u), 4 * p);
  }
  assert.deepEqual([...positivosPorUsuario.keys()].sort(), [1, 3, 5]);
});

test('treino: observado com perfil completo e desconto; positivo com desconto; sorteado sem desconto', () => {
  const r = paresDeTreino(base);
  // Linhas do usuário 1: 3 blocos (0–14) e os observados 4 e 5 (15, 16).
  assert.equal(filmeDe(r, 15), 4);
  assert.equal(r.y[15], 0);
  assert.ok(igual(perfilDe(r, 15), f32(perfilCompleto(1))));
  assert.ok(Math.abs(r.x[15 * DIM + 69] - popZDoPar(4, true, regua)) < 1e-6);
  assert.ok(Math.abs(r.x[15 * DIM + 69] - popZDoPar(4, false, regua)) > 1e-3);
  assert.ok(Math.abs(r.x[0 * DIM + 69] - popZDoPar(1, true, regua)) < 1e-6);
  for (let i = 0; i < r.n; i++) {
    if (r.y[i] !== 1) continue;
    for (let k = 1; k <= 4; k++) {
      const f = filmeDe(r, i + k);
      assert.ok(Math.abs(r.x[(i + k) * DIM + 69] - popZDoPar(f, false, regua)) < 1e-6);
    }
  }
});

test('treino: nenhum sorteado é filme avaliado no treino', () => {
  for (const esquema of ['candidatos', 'uniforme']) {
    const r = paresDeTreino({ ...base, esquema, candidatosPorUsuario: esquema === 'uniforme' ? null : candidatosPorUsuario });
    for (let i = 0; i < r.n; i++) {
      if (r.y[i] !== 1) continue;
      const u = usuarioDe(r, i);
      for (let k = 1; k <= 4; k++) {
        const f = filmeDe(r, i + k);
        assert.ok(!avaliados(u).has(f), `${esquema}: usuário ${u} recebeu o avaliado ${f}`);
        assert.ok(r.negativosSorteados.get(u).has(f));
      }
    }
    for (const [u, s] of r.negativosSorteados) for (const f of s) assert.ok(!avaliados(u).has(f));
  }
});

test('treino esquema candidatos: sorteios de índice 0, 1, 2 no bloco estão nos candidatos', () => {
  const r = paresDeTreino(base);
  for (let i = 0; i < r.n; i++) {
    if (r.y[i] !== 1) continue;
    const u = usuarioDe(r, i);
    for (let k = 1; k <= 3; k++) assert.ok(candidatosPorUsuario.get(u).includes(filmeDe(r, i + k)));
  }
});

test('treino: mesma semente dá o mesmo sha256; sementes 1 e 2 dão sha256 diferentes; semPop dá dim 68', () => {
  const a = paresDeTreino(base);
  const b = paresDeTreino(base);
  const c = paresDeTreino({ ...base, semente: 2 });
  assert.equal(a.sha256, b.sha256);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(a.sha256, c.sha256);
  const s = paresDeTreino({ ...base, semPop: true });
  assert.equal(s.dim, 68);
  assert.equal(s.x.length, s.n * 68);
});

test('treino: candidatos esgotados vão ao catálogo e contam em recorreuAoCatalogo', () => {
  const esgotados = new Map([...candidatosPorUsuario].map(([u]) => [u, [...historico.get(u).notas.keys()]]));
  const r = paresDeTreino({ ...base, candidatosPorUsuario: esgotados });
  assert.equal(r.resumo.recorreuAoCatalogo, 3 * 7);
});

test('treino: esquema candidatos sem candidatos do usuário falha alto', () => {
  assert.throws(() => paresDeTreino({ ...base, candidatosPorUsuario: new Map() }), /sem candidatos/);
  assert.throws(() => paresDeTreino({ ...base, esquema: 'outro' }), /esquema/);
});

// Validação da mesma semente do treino.
function validar(extra = {}) {
  const t = paresDeTreino(base);
  return paresDeValidacao({ ...base, validacao, negativosSorteadosNoTreino: t.negativosSorteados, ...extra });
}

test('validação: perfil completo do treino em todas as linhas; usuário sem curtidas recebe referência sem NaN', () => {
  const r = validar();
  assert.ok(r.x.every(Number.isFinite));
  const ref = [...regua.referencias.generosMedia, ...regua.referencias.epocaMedia, popZReferencia(regua)];
  for (let i = 0; i < r.n; i++) {
    const u = usuarioDe(r, i);
    const esperado = historico.get(u).curtidos.length ? perfilCompleto(u) : ref;
    assert.ok(igual(perfilDe(r, i), f32(esperado)), `linha ${i} (usuário ${u})`);
    const f = filmeDe(r, i);
    assert.ok(Math.abs(r.x[i * DIM + 69] - popZDoPar(f, false, regua)) < 1e-6, 'validação nunca desconta');
  }
  assert.equal(r.resumo.positivos, 3);
  assert.equal(r.resumo.observados, 2);
  assert.equal(r.resumo.sorteados, 12);
  assert.equal(r.resumo.descartados, 0);
  assert.equal(r.n, 3 * 5 + 2);
  assert.equal(r.negativosSorteados, undefined);
});

test('validação: nenhuma nota escondida altera perfil ou popularidade (com e sem uma curtida escondida a mais)', () => {
  const sem = validar();
  const com = validar({ validacao: [...validacao, { usuario: 1, filme: 13, nota: 5 }] });
  const perfisU1 = (r) => [...Array(r.n).keys()].filter((i) => usuarioDe(r, i) === 1).map((i) => perfilDe(r, i));
  const pSem = perfisU1(sem);
  const pCom = perfisU1(com);
  assert.equal(pCom.length, pSem.length + 5);
  for (const p of [...pSem, ...pCom]) assert.deepEqual(p, pSem[0]);
  // O perfil é o mesmo do observado de treino do usuário 1 (perfil completo, só com o treino).
  assert.deepEqual(pSem[0], perfilDe(paresDeTreino(base), 15));
  // A popularidade do filme escondido usa a régua do treino, sem desconto.
  const i13 = [...Array(com.n).keys()].find((i) => com.y[i] === 1 && filmeDe(com, i) === 13);
  assert.ok(Math.abs(com.x[i13 * DIM + 69] - popZDoPar(13, false, regua)) < 1e-6);
});

test('validação: sorteado nunca é avaliado no treino, na validação ou sorteado no treino da mesma semente', () => {
  for (const esquema of ['candidatos', 'uniforme']) {
    const cand = esquema === 'uniforme' ? null : candidatosPorUsuario;
    const t = paresDeTreino({ ...base, esquema, candidatosPorUsuario: cand });
    const r = paresDeValidacao({
      ...base, esquema, candidatosPorUsuario: cand, validacao, negativosSorteadosNoTreino: t.negativosSorteados,
    });
    let vistos = 0;
    for (let i = 0; i < r.n; i++) {
      if (r.y[i] !== 1) continue;
      const u = usuarioDe(r, i);
      const escondidos = validacao.filter((a) => a.usuario === u).map((a) => a.filme);
      for (let k = 1; k <= 4; k++) {
        const f = filmeDe(r, i + k);
        assert.ok(!avaliados(u).has(f), `${esquema}: avaliado no treino ${f}`);
        assert.ok(!escondidos.includes(f), `${esquema}: avaliado na validação ${f}`);
        assert.ok(!t.negativosSorteados.get(u).has(f), `${esquema}: sorteado no treino ${f}`);
        vistos += 1;
      }
    }
    assert.equal(vistos, 12);
  }
});

test('validação: usuário sem positivo escondido não recebe sorteados', () => {
  const r = validar();
  const linhasU5 = [...Array(r.n).keys()].filter((i) => usuarioDe(r, i) === 5);
  assert.equal(linhasU5.length, 1);
  assert.equal(r.y[linhasU5[0]], 0);
  assert.equal(filmeDe(r, linhasU5[0]), 12);
});

test('validação: candidatos totalmente excluídos vão ao catálogo e contam em recorreuAoCatalogo', () => {
  const t = paresDeTreino({ ...base, esquema: 'uniforme', candidatosPorUsuario: null });
  const esgotados = new Map([[1, [6, 7, 1]], [3, [9, 2]], [4, [11, 3]], [5, [12]]]);
  const r = paresDeValidacao({
    ...base, candidatosPorUsuario: esgotados, validacao, negativosSorteadosNoTreino: t.negativosSorteados,
  });
  assert.equal(r.resumo.recorreuAoCatalogo, 3 * 3);
});

test('validação: mesma semente dá o mesmo sha256; sementes 1 e 2 diferem; nota escondida no treino falha', () => {
  assert.equal(validar().sha256, validar().sha256);
  const t2 = paresDeTreino({ ...base, semente: 2 });
  const v2 = paresDeValidacao({ ...base, semente: 2, validacao, negativosSorteadosNoTreino: t2.negativosSorteados });
  assert.notEqual(validar().sha256, v2.sha256);
  assert.throws(() => validar({ validacao: [{ usuario: 1, filme: 1, nota: 5 }] }), /vazamento/);
});

test('sementes exatamente da tabela: treino 1_000_000·semente + usuario; validação 5_000_000 + 1_000_000·semente + usuario', () => {
  const semente = 2;
  const t = paresDeTreino({ ...base, semente });
  const sorteadosDe = (r, u) => {
    const ids = [];
    for (let i = 0; i < r.n; i++) {
      if (r.y[i] === 1 && usuarioDe(r, i) === u) for (let k = 1; k <= 4; k++) ids.push(filmeDe(r, i + k));
    }
    return ids;
  };
  const esperadoTreino = sortearNegativos({
    quantidade: 12, excluir: avaliados(1), catalogo, candidatos: candidatosPorUsuario.get(1),
    aleatorio: criarAleatorio(1_000_000 * semente + 1),
  }).ids;
  assert.deepEqual(sorteadosDe(t, 1), esperadoTreino);
  const v = paresDeValidacao({ ...base, semente, validacao, negativosSorteadosNoTreino: t.negativosSorteados });
  const esperadoValidacao = sortearNegativos({
    quantidade: 4, excluir: new Set([...avaliados(1), 6, 7, ...t.negativosSorteados.get(1)]), catalogo,
    candidatos: candidatosPorUsuario.get(1), aleatorio: criarAleatorio(5_000_000 + 1_000_000 * semente + 1),
  }).ids;
  assert.deepEqual(sorteadosDe(v, 1), esperadoValidacao);
});
