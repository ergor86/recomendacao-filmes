// Tarefa 6: o modulo de referencia nunca apaga nem trunca dados que os usuarios usam.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../../preparar/referencia.js', import.meta.url), 'utf8');

describe('referencia.js: SQL proibido', () => {
  it('sem TRUNCATE', () => {
    assert.doesNotMatch(fonte, /TRUNCATE/i);
  });
  it('sem DELETE em tabelas de filme, estatistica, perfil ou interacao', () => {
    assert.doesNotMatch(fonte, /DELETE\s+FROM\s+app\.(filme|estatistica_historica|perfil|interacao)\b/i);
  });
  it('nunca menciona perfil nem interacao', () => {
    assert.doesNotMatch(fonte, /app\.(perfil|interacao)\b/i);
  });
});
