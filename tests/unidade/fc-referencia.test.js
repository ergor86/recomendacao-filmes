// Testes da FC em memória (referência float64): escala do escore, exclusões, empates,
// fronteira do arredondamento e invariância ao teste-2 (§3.2). Só dados sintéticos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarContexto } from '../../src/contexto.js';
import {
  construirFC, vetorFilme, perfilFC, escoreOficial, rankingReferencia, elegiveisReferencia, hashVetoresFC,
} from '../../src/fc/referencia.js';

// 5 usuários x 6 filmes; f6 sem curtidas. Nota 5 = curtida, nota 2 = não curtida.
const likes = { 1: [1, 2, 3], 2: [1, 2, 4], 3: [2, 5], 4: [3, 4], 5: [1, 5] };
const treino = [];
for (const [u, fs_] of Object.entries(likes)) {
  for (const f of fs_) treino.push({ usuario: Number(u), filme: f, nota: 5, timestamp: 1 });
}
treino.push({ usuario: 3, filme: 6, nota: 2, timestamp: 1 }, { usuario: 4, filme: 1, nota: 3, timestamp: 1 });
const fc = construirFC(treino, 5);

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norma = (a) => Math.sqrt(dot(a, a));

test('construirFC: fãs, curtidos e vetor unitário na posição u-1', () => {
  assert.deepEqual(fc.fasPorFilme.get(1), [1, 2, 5]);
  assert.deepEqual(fc.curtidosPorUsuario.get(1), [1, 2, 3]);
  const v = vetorFilme(fc, 3);
  assert.equal(v.length, 5);
  assert.ok(Math.abs(v[0] - 1 / Math.sqrt(2)) < 1e-15 && v[1] === 0 && Math.abs(v[3] - 1 / Math.sqrt(2)) < 1e-15);
  assert.ok(Math.abs(norma(v) - 1) < 1e-12);
});

test('filme sem curtidas: vetor null e fora do ranking; usuário sem curtidas: perfil null', () => {
  assert.equal(vetorFilme(fc, 6), null);
  assert.equal(perfilFC(fc, []), null);
  assert.equal(perfilFC(fc, [6]), null);
  const p = perfilFC(fc, [1, 6]);
  assert.ok(p instanceof Float64Array);
  const r = rankingReferencia(fc, perfilFC(fc, [1]), new Set(), 10);
  assert.ok(!r.some((x) => x.id === 6));
});

test('Σ cos(v_i, v_j) = perfil · v_j e escore64 = perfil · v_j / ‖perfil‖', () => {
  const curtidos = [1, 2, 3];
  const p = perfilFC(fc, curtidos);
  const r = rankingReferencia(fc, p, new Set(), 10);
  assert.ok(r.length > 0);
  for (const { id, escore64 } of r) {
    const vj = vetorFilme(fc, id);
    const soma = curtidos.reduce((s, i) => s + dot(vetorFilme(fc, i), vj), 0);
    const pv = dot(Array.from(p), vj);
    assert.ok(Math.abs(soma - pv) < 1e-12);
    assert.ok(Math.abs(escore64 - pv / norma(Array.from(p))) < 1e-12);
  }
});

test('vistos excluídos, empate por id, limite m', () => {
  const p = perfilFC(fc, [1]);
  const r = rankingReferencia(fc, p, new Set([1]), 10);
  assert.deepEqual(r.map((x) => x.id), [2, 3, 4, 5]);
  assert.equal(r[1].escore, r[2].escore);
  assert.equal(r[2].escore, r[3].escore);
  assert.equal(rankingReferencia(fc, p, new Set([1]), 2).length, 2);
  assert.deepEqual([...elegiveisReferencia(fc, p, new Set([1]))].sort(), [2, 3, 4, 5]);
});

test('fronteira do arredondamento (meio para cima) e corte por escore oficial', () => {
  assert.equal(escoreOficial(5e-7), 1e-6);
  assert.equal(escoreOficial(4.999999e-7), 0);
  assert.equal(escoreOficial(2.5e-6), 3e-6);
  const mao = { nUsuarios: 2, fasPorFilme: new Map([[10, [2]], [11, [1]]]), curtidosPorUsuario: new Map() };
  const p = Float64Array.from([1, 4e-7]);
  const r = rankingReferencia(mao, p, new Set(), 10);
  assert.deepEqual(r.map((x) => x.id), [11]);
  assert.ok(!elegiveisReferencia(mao, p, new Set()).has(10));
});

test('hashVetoresFC não muda quando uma nota do teste-2 muda (v2-exp)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-fc-'));
  const zeros = Array(19).fill(0);
  const usuarios = [1, 2, 462, 463, 464, 465];
  const notas = [];
  for (const u of usuarios) {
    const n = u === 2 ? 2 : 10;
    for (let f = 1; f <= n; f++) notas.push(`${u}\t${f}\t${((f + u) % 5) + 1}\t${100 + f}`);
  }
  const gravar = (l) => fs.writeFileSync(path.join(dir, 'u1.base'), l.join('\n') + '\n');
  gravar(notas);
  fs.writeFileSync(path.join(dir, 'u.item'),
    Array.from({ length: 10 }, (_, i) => `${i + 1}|Filme ${i + 1}|01-Jan-1990||u|${zeros.join('|')}`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'u.user'), usuarios.map((u) => `${u}|24|M|admin|1`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'u.genre'), 'g|0\n');
  fs.writeFileSync(path.join(dir, 'u.occupation'), 'admin\n');
  const hash = () => {
    const c = criarContexto({ fase: 'v2-exp', dirDados: dir });
    return hashVetoresFC(construirFC(c.treino, c.dataset.usuarios.length));
  };
  const t2 = criarContexto({ fase: 'v2-final', dirDados: dir, incluirTeste2: true }).alvos[0];
  const antes = hash();
  try {
    // inverte a condição de curtida do par escondido (>= 4 vira 1; senão vira 5)
    gravar(notas.map((l) => {
      const [u, f, n, t] = l.split('\t');
      if (Number(u) !== t2.usuario || Number(f) !== t2.filme) return l;
      return `${u}\t${f}\t${Number(n) >= 4 ? 1 : 5}\t${t}`;
    }));
    assert.equal(hash(), antes);
  } finally {
    gravar(notas);
  }
  assert.match(antes, /^[0-9a-f]{64}$/);
});
