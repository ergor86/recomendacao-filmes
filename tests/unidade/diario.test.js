// Testes do motivo do diário de treinos: primeira execução 'planejado', retreino sem --motivo dá erro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivoDoTreino } from '../../src/treino/diario.js';

const linha = (nome, fase) => JSON.stringify({ data: '2026-11-12T00:00:00Z', nome, fase, motivo: 'planejado' });
const diario = [linha('uniforme-128-64-32', 'exp'), linha('candidatos-64-32', 'final')].join('\n') + '\n';

test('primeira execução sem --motivo registra planejado (diário vazio ou de outros modelos)', () => {
  assert.equal(motivoDoTreino('', { nome: 'uniforme-128-64-32', fase: 'exp', motivoInformado: null }), 'planejado');
  assert.equal(motivoDoTreino(diario, { nome: 'uniforme-128-64-32', fase: 'final', motivoInformado: null }), 'planejado');
  assert.equal(motivoDoTreino(diario, { nome: 'candidatos-128-64-32', fase: 'exp', motivoInformado: null }), 'planejado');
});

test('retreino do mesmo nome e fase sem --motivo falha pedindo --motivo', () => {
  assert.throws(
    () => motivoDoTreino(diario, { nome: 'uniforme-128-64-32', fase: 'exp', motivoInformado: null }),
    /retreino fora do plano exige --motivo/,
  );
});

test('motivo informado é usado como está, inclusive em retreino', () => {
  assert.equal(motivoDoTreino(diario, { nome: 'uniforme-128-64-32', fase: 'exp', motivoInformado: 'corrigir bug' }), 'corrigir bug');
  assert.equal(motivoDoTreino('', { nome: 'x', fase: 'exp', motivoInformado: 'teste' }), 'teste');
});
