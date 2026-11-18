// Tarefa 8: pipeline da S1 (spec 4.4), efeitos das interações (spec 6.2), com fc sintético e buscar falso.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularEfeitos, contribui, derivarConjuntos, K, M, MODO, N_FC, recomendar,
} from '../../servidor/recomendacao/s1.js';

// fc sintético: 1 e 2 têm vetor (fã 1 em comum com os itens da busca); 3 não tem vetor.
// Os itens 1001..1300 que o buscar falso devolve têm o fã 1, compartilhado com os curtidos.
function fcSintetico() {
  const fasPorFilme = new Map([[1, [1, 2]], [2, [1, 3, 4]], [4, [6]]]);
  for (let id = 1001; id <= 1300; id++) fasPorFilme.set(id, [1, 5]);
  return { nUsuarios: 20, fasPorFilme };
}
const FC = fcSintetico();
const OCULTOS = new Set([267, 999]);
// populares: inclui interagidos (5, 6), ocultos (267, 999) e itens da busca (1001, 1002)
const POPULARES = [5, 1001, 267, 6, 1002, 999, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

const lista = (n) => Array.from({ length: n }, (_, i) => ({ id: 1001 + i, escore: Math.round((0.9 - i * 0.001) * 1e6) / 1e6 }));
function buscarFalso(n, extra = {}) {
  const chamadas = [];
  const buscar = async (vetor, excluirOrdenado, m, modo) => {
    chamadas.push({ vetor, excluirOrdenado, m, modo });
    return { lista: lista(n), linhasPedidas: 350, empateNaoResolvido: false, ...extra };
  };
  return { buscar, chamadas };
}
const INTERACOES_BASE = [
  { filmeId: 1, tipo: 'gostei', nota: null },
  { filmeId: 2, tipo: 'nota', nota: 5 },
  { filmeId: 5, tipo: 'nota', nota: 2 },
  { filmeId: 6, tipo: 'quero_assistir', nota: null },
];
const rec = (interacoes, buscar) => recomendar({ interacoes, fc: FC, ocultos: OCULTOS, rankingPopulares: POPULARES, buscar });

describe('constantes', () => {
  it('M = 300, N_FC = 150, K = 10, MODO = hnsw', () => {
    assert.deepEqual([M, N_FC, K, MODO], [300, 150, 10, 'hnsw']);
  });
});

describe('efeitos', () => {
  it('"gostei" → nota 2: perfilMudou true e contribuiParaPerfil false', () => {
    const e = calcularEfeitos({ nova: { tipo: 'nota', nota: 2 }, anterior: { tipo: 'gostei', nota: null }, temVetor: true });
    assert.deepEqual(e, { contribuiParaPerfil: false, excluidoDasRecomendacoes: true, perfilMudou: true });
  });
  it('DELETE de "gostei": perfilMudou true, nada excluído', () => {
    const e = calcularEfeitos({ nova: null, anterior: { tipo: 'gostei', nota: null }, temVetor: true });
    assert.deepEqual(e, { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: true });
  });
  it('nota 3 sobre nada: perfilMudou false', () => {
    const e = calcularEfeitos({ nova: { tipo: 'nota', nota: 3 }, anterior: null, temVetor: true });
    assert.deepEqual(e, { contribuiParaPerfil: false, excluidoDasRecomendacoes: true, perfilMudou: false });
  });
  it('"gostei" em filme sem vetor não contribui', () => {
    assert.equal(contribui({ tipo: 'gostei', nota: null }, false), false);
    assert.equal(contribui({ tipo: 'nota', nota: 4 }, true), true);
    assert.equal(contribui({ tipo: 'quero_assistir', nota: null }, true), false);
  });

  const TODAS = [
    null,
    { tipo: 'gostei', nota: null },
    { tipo: 'quero_assistir', nota: null },
    ...[1, 2, 3, 4, 5].map((nota) => ({ tipo: 'nota', nota })),
  ];
  const comVetor = (temVetor, inter) => {
    const id = temVetor ? 1 : 3;
    const interacoes = inter ? [{ filmeId: id, ...inter }] : [];
    return derivarConjuntos(interacoes, FC, OCULTOS).curtidosComVetor.includes(id);
  };
  it('propriedade: contribuiParaPerfil ⇔ pertencer a curtidos e ter vetor; perfilMudou ⇔ o conjunto mudou', () => {
    for (const temVetor of [true, false]) {
      for (const anterior of TODAS) {
        for (const nova of TODAS) {
          const e = calcularEfeitos({ nova, anterior, temVetor });
          const depois = comVetor(temVetor, nova);
          const antes = comVetor(temVetor, anterior);
          const caso = JSON.stringify({ temVetor, anterior, nova });
          assert.equal(e.contribuiParaPerfil, depois, caso);
          assert.equal(e.perfilMudou, antes !== depois, caso);
          assert.equal(e.excluidoDasRecomendacoes, nova !== null, caso);
          if (nova) {
            const curtido = derivarConjuntos([{ filmeId: 1, ...nova }], FC, OCULTOS).curtidos.includes(1);
            assert.equal(contribui(nova, true), curtido, caso);
          }
        }
      }
    }
  });
});

describe('derivarConjuntos', () => {
  it('excluir contém interagidos e ocultos; curtidos = gostei ∪ notas 4–5', () => {
    const inter = [...INTERACOES_BASE, { filmeId: 3, tipo: 'gostei', nota: null }, { filmeId: 4, tipo: 'nota', nota: 4 }];
    const d = derivarConjuntos(inter, FC, OCULTOS);
    assert.deepEqual(d.curtidos, [1, 2, 3, 4]);
    assert.deepEqual(d.curtidosComVetor, [1, 2, 4]);
    assert.ok(d.excluir instanceof Set);
    assert.deepEqual([...d.excluir].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 267, 999]);
  });
});

describe('recomendar: motivos', () => {
  it('sem_curtidas quando não há curtida (sem busca, só populares)', async () => {
    const { buscar, chamadas } = buscarFalso(300);
    const r = await rec([{ filmeId: 5, tipo: 'nota', nota: 3 }], buscar);
    assert.equal(r.motivo, 'sem_curtidas');
    assert.equal(chamadas.length, 0);
    assert.equal(r.itens.length, K);
    assert.ok(r.itens.every((x) => x.fonte === 'populares' && x.escore === null));
    assert.equal(r.busca.linhasPedidas, null);
    assert.equal(r.busca.empateNaoResolvido, null);
    assert.equal(r.busca.candidatosS1, 0);
  });
  it('curtidas_sem_vetor quando só há curtida sem vetor', async () => {
    const { buscar, chamadas } = buscarFalso(300);
    const r = await rec([{ filmeId: 3, tipo: 'gostei', nota: null }], buscar);
    assert.equal(r.motivo, 'curtidas_sem_vetor');
    assert.equal(chamadas.length, 0);
    assert.ok(r.itens.every((x) => x.fonte === 'populares'));
    assert.deepEqual(r.perfil, { curtidos: [3], curtidosComVetor: [] });
  });
  it('sem_semelhantes quando buscar devolve [] com perfil', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(0).buscar);
    assert.equal(r.motivo, 'sem_semelhantes');
    assert.equal(r.itens.length, K);
    assert.ok(r.itens.every((x) => x.fonte === 'populares'));
    assert.equal(r.busca.linhasPedidas, 350);
  });
  it('parcial quando buscar devolve 4 itens', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(4).buscar);
    assert.equal(r.motivo, 'parcial');
    assert.deepEqual(r.itens.map((x) => x.fonte), [...Array(4).fill('S1'), ...Array(6).fill('populares')]);
    assert.equal(r.busca.candidatosS1, 4);
  });
  it('personalizado quando devolve 300', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(300).buscar);
    assert.equal(r.motivo, 'personalizado');
    assert.ok(r.itens.every((x) => x.fonte === 'S1'));
  });
});

describe('recomendar: pipeline', () => {
  it('S1 = prefixo de 10 dos 150 primeiros de H', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(300).buscar);
    const s1 = r.itens.filter((x) => x.fonte === 'S1');
    assert.equal(s1.length, 10);
    assert.deepEqual(s1.map(({ id, escore }) => ({ id, escore })), lista(300).slice(0, 150).slice(0, 10));
    assert.deepEqual(r.itens.slice(0, 10), s1);
  });
  it('buscar recebe m=300 e modo hnsw, uma única vez, com excluir ordenado e vetor normalizado', async () => {
    const { buscar, chamadas } = buscarFalso(300);
    const r = await rec(INTERACOES_BASE, buscar);
    assert.equal(chamadas.length, 1);
    const [c] = chamadas;
    assert.equal(c.m, 300);
    assert.equal(c.modo, 'hnsw');
    assert.deepEqual(c.excluirOrdenado, [1, 2, 5, 6, 267, 999]);
    assert.ok(Array.isArray(c.vetor) && c.vetor.length === FC.nUsuarios);
    const norma = Math.sqrt(c.vetor.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norma - 1) < 1e-12);
    assert.deepEqual(r.busca, {
      m: 300, nFc: 150, linhasPedidas: 350, empateNaoResolvido: false, candidatosS1: 300, nExcluidos: 6,
    });
  });
  it('repassa empateNaoResolvido da busca', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(300, { empateNaoResolvido: true, linhasPedidas: 1000 }).buscar);
    assert.equal(r.busca.empateNaoResolvido, true);
    assert.equal(r.busca.linhasPedidas, 1000);
  });
  it('preenchimento pula excluir e itens já na lista, na ordem de rankingPopulares', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(2).buscar);
    assert.deepEqual(r.itens.map((x) => x.id), [1001, 1002, 7, 8, 9, 10, 11, 12, 13, 14]);
    const s = await rec([], buscarFalso(0).buscar);
    assert.deepEqual(s.itens.map((x) => x.id), [5, 1001, 6, 1002, 7, 8, 9, 10, 11, 12]);
  });
  it('populares sem porque e todo item S1 tem 1 ou 2 porque', async () => {
    const r = await rec(INTERACOES_BASE, buscarFalso(4).buscar);
    for (const x of r.itens) {
      if (x.fonte === 'populares') {
        assert.deepEqual(x.porque, []);
        assert.equal(x.escore, null);
      } else {
        assert.ok(x.porque.length >= 1 && x.porque.length <= 2, JSON.stringify(x));
        for (const i of x.porque) assert.ok(r.perfil.curtidosComVetor.includes(i));
      }
    }
    // os dois curtidos com vetor compartilham o fã 1 com cada item da busca
    assert.deepEqual(r.itens[0].porque.slice().sort(), [1, 2]);
  });
  it('perfil traz curtidos e curtidosComVetor', async () => {
    const inter = [...INTERACOES_BASE, { filmeId: 3, tipo: 'nota', nota: 4 }];
    const r = await rec(inter, buscarFalso(300).buscar);
    assert.deepEqual(r.perfil, { curtidos: [1, 2, 3], curtidosComVetor: [1, 2] });
  });
});
