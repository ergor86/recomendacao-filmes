// Testes da fidelidade da FC (spec §5.3): sobreposição, listas idênticas, conferência de precisão
// busca exata = referência (τ = 1e-5), teto do impacto, top 10 idênticos, resumos das medidas e a
// leitura dos argumentos e a mescla da medida 4. Só dados sintéticos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sobreposicao, listasIdenticas, conferirPrecisao, tetoImpacto, top10Identicos,
  medidas12, medida3, resumoMedida4, entradaReferencia,
  lerArgumentosFidelidade, kNDoSistema, resolverSistemasMedida4, mesclarMedida4,
} from '../../src/avaliacao/fidelidade.js';

const mapa = (obj) => new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));

test('sobreposicao: |a_n ∩ b_n| / max(|a_n|, |b_n|); vazias = 1', () => {
  assert.equal(sobreposicao([1, 2, 3], [1, 2, 4], 3), 2 / 3);
  assert.equal(sobreposicao([], [], 50), 1);
  assert.equal(sobreposicao([1, 2, 3, 9], [3, 2, 1, 8], 3), 1); // ordem não importa
  assert.equal(sobreposicao([1, 2], [1, 2, 3, 4], 4), 2 / 4); // tamanhos diferentes
  assert.equal(sobreposicao([], [1], 10), 0);
});

test('listasIdenticas: mesmos ids na mesma ordem nos n primeiros', () => {
  assert.equal(listasIdenticas([1, 2, 3, 4], [1, 2, 3, 5], 3), true);
  assert.equal(listasIdenticas([1, 2, 3], [1, 3, 2], 3), false);
  assert.equal(listasIdenticas([1, 2], [1, 2, 3], 3), false);
  assert.equal(listasIdenticas([], [], 50), true);
});

test('conferirPrecisao: listas iguais passam sem divergência', () => {
  const r = conferirPrecisao({ exata: [1, 2], referencia: [1, 2], escore64: mapa({ 1: 0.9, 2: 0.8 }), escoreM: 0.8 });
  assert.deepEqual(r, { ok: true, divergenciasPrecisao: 0, erros: [] });
});

test('conferirPrecisao: troca entre 0,5 e 0,500004 passa; entre 0,5 e 0,51 é erro', () => {
  const boa = conferirPrecisao({ exata: [3, 2, 1], referencia: [3, 1, 2], escore64: mapa({ 3: 0.9, 1: 0.500004, 2: 0.5 }), escoreM: 0.1 });
  assert.equal(boa.ok, true);
  assert.equal(boa.divergenciasPrecisao, 1);
  const ruim = conferirPrecisao({ exata: [3, 2, 1], referencia: [3, 1, 2], escore64: mapa({ 3: 0.9, 1: 0.51, 2: 0.5 }), escoreM: 0.1 });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.erros.length, 1);
  assert.match(ruim.erros[0], /troca/);
});

test('conferirPrecisao: saída no corte de escore > 0 com escore64 = 3e-6 passa; com 0,2 é erro', () => {
  const boa = conferirPrecisao({ exata: [1, 2], referencia: [1, 2, 3], escore64: mapa({ 1: 0.9, 2: 0.4, 3: 3e-6 }), escoreM: null });
  assert.equal(boa.ok, true);
  assert.equal(boa.divergenciasPrecisao, 1);
  const ruim = conferirPrecisao({ exata: [1, 2], referencia: [1, 2, 3], escore64: mapa({ 1: 0.9, 2: 0.4, 3: 0.2 }), escoreM: null });
  assert.equal(ruim.ok, false);
  assert.match(ruim.erros[0], /saída/);
  // entrada no corte (o banco devolve um filme que a referência arredondou para 0)
  const entra = conferirPrecisao({ exata: [1, 2, 4], referencia: [1, 2], escore64: mapa({ 1: 0.9, 2: 0.4, 4: 4e-7 }), escoreM: null });
  assert.equal(entra.ok, true);
});

test('conferirPrecisao: entrada/saída na posição m só perto de escoreM; escoreM null desliga a regra', () => {
  const e64 = mapa({ 1: 0.9, 2: 0.3, 5: 0.300004 });
  const ok = conferirPrecisao({ exata: [1, 5], referencia: [1, 2], escore64: e64, escoreM: 0.3 });
  assert.equal(ok.ok, true);
  assert.equal(ok.divergenciasPrecisao, 2); // uma saída e uma entrada
  const longe = conferirPrecisao({ exata: [1, 5], referencia: [1, 2], escore64: mapa({ 1: 0.9, 2: 0.3, 5: 0.35 }), escoreM: 0.3 });
  assert.equal(longe.ok, false);
  assert.equal(longe.erros.length, 1); // só a entrada do 5; a saída do 2 está na posição m
  const semM = conferirPrecisao({ exata: [1, 5], referencia: [1, 2], escore64: e64, escoreM: null });
  assert.equal(semM.ok, false);
});

test('conferirPrecisao: τ ajustável e escore64 ausente é erro alto', () => {
  const r = conferirPrecisao({ exata: [2, 1], referencia: [1, 2], escore64: mapa({ 1: 0.5001, 2: 0.5 }), escoreM: 0, tau: 1e-3 });
  assert.equal(r.ok, true);
  assert.throws(() => conferirPrecisao({ exata: [2, 1], referencia: [1, 2], escore64: mapa({ 1: 0.5 }), escoreM: 0 }), /escore64/);
});

test('tetoImpacto = min(1, nDiferentes / nt)', () => {
  assert.equal(tetoImpacto(470, 430), 1);
  assert.equal(tetoImpacto(43, 430), 0.1);
  assert.equal(tetoImpacto(0, 430), 0);
});

test('top10Identicos: conta iguais e diferentes; usuários diferentes é erro', () => {
  const a = mapa({ 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9] });
  const b = mapa({ 1: [1, 2, 3], 2: [4, 6, 5], 3: [7, 8, 9] });
  assert.deepEqual(top10Identicos(a, b), { iguais: 2, diferentes: 1 });
  assert.throws(() => top10Identicos(a, mapa({ 1: [1], 2: [2] })), /usuários/);
  assert.throws(() => top10Identicos(a, mapa({ 1: [1], 2: [2], 4: [3] })), /usuários/);
});

test('medidas12: sobreposição média e fração de listas idênticas por N', () => {
  const a = mapa({ 1: [1, 2, 3, 4], 2: [5, 6, 7, 8] });
  const b = mapa({ 1: [1, 2, 3, 9], 2: [5, 6, 8, 7] });
  const r = medidas12(a, b, [2, 4]);
  assert.deepEqual(r['2'], { nUsuarios: 2, sobreposicaoMedia: 1, fracaoIdenticas: 1, nIdenticas: 2 });
  assert.equal(r['4'].sobreposicaoMedia, (3 / 4 + 1) / 2);
  assert.equal(r['4'].fracaoIdenticas, 0);
  assert.throws(() => medidas12(a, mapa({ 1: [1] }), [2]), /usuários/);
});

test('medida3: recall dos N primeiros em cada versão, pareado, só usuários com lista', () => {
  const hnsw = mapa({ 1: [1, 2, 3], 2: [4, 5, 6] });
  const ref = mapa({ 1: [1, 9, 3], 2: [4, 5, 6] });
  const relevantes = new Map([[1, new Set([2, 3])], [2, new Set([5])], [7, new Set([1])]]);
  const r = medida3(hnsw, ref, relevantes, [2, 3]);
  assert.equal(r.nUsuarios, 2);
  assert.equal(r.porN['2'].recallHnsw, (1 / 2 + 1) / 2);
  assert.equal(r.porN['2'].recallReferencia, (0 + 1) / 2);
  assert.equal(r.porN['2'].diferenca.media, 0.25);
  assert.equal(r.porN['3'].diferenca.media, 0.25);
  assert.equal(r.porN['3'].diferenca.ic95.length, 2);
});

test('resumoMedida4: NDCG médio das sementes por usuário e bootstrap pareado HNSW − referência', () => {
  const relevantes = new Map([[1, new Set([1])], [2, new Set([2])]]);
  const s1 = { hnsw: mapa({ 1: [1, 3], 2: [2, 3] }), referencia: mapa({ 1: [3, 1], 2: [2, 3] }) };
  const s2 = { hnsw: mapa({ 1: [1, 3], 2: [2, 3] }), referencia: mapa({ 1: [1, 3], 2: [2, 3] }) };
  const r = resumoMedida4({ relevantes, porSemente: [s1, s2] });
  const ndcg2 = 1 / Math.log2(3);
  assert.equal(r.nUsuarios, 2);
  assert.equal(r.ndcgHnsw, 1);
  assert.equal(r.ndcgReferencia, ((ndcg2 + 1) / 2 + 1) / 2);
  assert.ok(Math.abs(r.diferenca.media - (1 - ndcg2) / 4) < 1e-15);
  assert.deepEqual(r.top10Identicos, [{ iguais: 1, diferentes: 1 }, { iguais: 2, diferentes: 0 }]);
  assert.throws(() => resumoMedida4({ relevantes: new Map([[3, new Set([1])]]), porSemente: [s1] }), /usuário 3/);
});

test('entradaReferencia: troca só o colab, sem alterar a entrada HNSW', () => {
  const e = { colab: [1, 2], populares: [9, 8], nElegiveis: 2, elegiveisEntrePopulares: [], empateNaoResolvido: false };
  const r = entradaReferencia(e, [2, 1]);
  assert.deepEqual(r.colab, [2, 1]);
  assert.deepEqual(e.colab, [1, 2]);
  assert.equal(r.populares, e.populares);
  assert.equal(r.nElegiveis, 2);
});

test('lerArgumentosFidelidade: --fase obrigatória v2-exp; --medida4 com lista separada por vírgula', () => {
  assert.deepEqual(lerArgumentosFidelidade(['--fase', 'v2-exp']), { fase: 'v2-exp', medida4: null });
  assert.deepEqual(lerArgumentosFidelidade(['--fase', 'v2-exp', '--medida4', 'S3,v2']), { fase: 'v2-exp', medida4: ['S3', 'v2'] });
  assert.deepEqual(lerArgumentosFidelidade(['--medida4', 'v2', '--fase', 'v2-exp']), { fase: 'v2-exp', medida4: ['v2'] });
  assert.throws(() => lerArgumentosFidelidade([]), /--fase v2-exp/);
  assert.throws(() => lerArgumentosFidelidade(['--fase', 'v2-final']), /--fase v2-exp/);
  assert.throws(() => lerArgumentosFidelidade(['--fase', 'v2-exp', '--medida4']), /--medida4/);
  assert.throws(() => lerArgumentosFidelidade(['--fase', 'v2-exp', '--medida4', 'S3,X9']), /X9/);
});

test('kNDoSistema: S2, S3 e S4-k-n; S0 e S1 não têm rede', () => {
  assert.deepEqual(kNDoSistema('S2'), { k: 150, n: 0 });
  assert.deepEqual(kNDoSistema('S3'), { k: 0, n: 150 });
  assert.deepEqual(kNDoSistema('S4-100-50'), { k: 100, n: 50 });
  assert.equal(kNDoSistema('S0'), null);
  assert.equal(kNDoSistema('S1'), null);
  assert.throws(() => kNDoSistema('S9'), /S9/);
});

test('resolverSistemasMedida4: v2 vem da grade; S0/S1 pulados; S3 pulado com portão reprovado; sem repetição', () => {
  const grade = { cenario: 'aprovado', escolha: { escolhida: 'S4-100-50' } };
  assert.deepEqual(resolverSistemasMedida4(['S3', 'v2'], grade), [
    { nome: 'S3', pedidos: ['S3'], k: 0, n: 150 },
    { nome: 'S4-100-50', pedidos: ['v2'], k: 100, n: 50 },
  ]);
  assert.deepEqual(resolverSistemasMedida4(['S3', 'v2'], { cenario: 'aprovado', escolha: { escolhida: 'S3' } }), [
    { nome: 'S3', pedidos: ['S3', 'v2'], k: 0, n: 150 },
  ]);
  const r = resolverSistemasMedida4(['v2'], { cenario: 'aprovado', escolha: { escolhida: 'S1' } });
  assert.equal(r[0].nome, 'S1');
  assert.match(r[0].pulado, /S1/);
  const rep = resolverSistemasMedida4(['S3', 'v2'], { cenario: 'reprovado', escolha: { escolhida: 'S0' } });
  assert.match(rep[0].pulado, /reprovado/);
  assert.match(rep[1].pulado, /S0/);
  assert.throws(() => resolverSistemasMedida4(['v2'], { cenario: 'aprovado' }), /grade-v2/);
});

test('mesclarMedida4: acrescenta sistemas sem apagar os outros; candidatos diferentes é erro', () => {
  const existente = { sha256Candidatos: 'abc', medida4: { S1: { x: 1 } }, outro: 7 };
  const novo = mesclarMedida4(existente, { S3: { x: 2 } }, { sha256Candidatos: 'abc', v2Escolhida: 'S3' });
  assert.deepEqual(novo.medida4, { S1: { x: 1 }, S3: { x: 2 } });
  assert.equal(novo.v2Escolhida, 'S3');
  assert.equal(novo.outro, 7);
  assert.deepEqual(existente.medida4, { S1: { x: 1 } });
  const comPulado = mesclarMedida4(existente, {}, { sha256Candidatos: 'abc', v2Escolhida: 'S1', pulados: { S1: 'sem rede' } });
  assert.deepEqual(comPulado.medida4, { S1: { x: 1 } }); // o resultado de S1 não é apagado
  assert.deepEqual(comPulado.medida4Pulados, { S1: 'sem rede' });
  assert.throws(() => mesclarMedida4(existente, {}, { sha256Candidatos: 'zzz', v2Escolhida: 'S3' }), /candidatos/);
});
