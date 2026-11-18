import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarFornecedorMidia } from '../../servidor/midia/index.js';

test('midia: local devolve cartaz gerado, sem sinopse nem atribuição', () => {
  const f = criarFornecedorMidia('local');
  assert.deepEqual(f.midia({ id: 1 }), { cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null });
});

test('midia: o padrão é local (MIDIA_FORNECEDOR ausente)', () => {
  const antes = process.env.MIDIA_FORNECEDOR;
  delete process.env.MIDIA_FORNECEDOR;
  try {
    assert.equal(criarFornecedorMidia().midia({ id: 1 }).cartaz.tipo, 'gerado');
  } finally {
    if (antes !== undefined) process.env.MIDIA_FORNECEDOR = antes;
  }
});

test('midia: desconhecido lança', () => {
  assert.throws(() => criarFornecedorMidia('tmdb'), { message: 'MIDIA_FORNECEDOR desconhecido: tmdb' });
  assert.throws(() => criarFornecedorMidia('xyz'), /MIDIA_FORNECEDOR desconhecido: xyz/);
});
