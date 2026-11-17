// Tarefa 6: o modulo de referencia nunca apaga nem trunca dados que os usuarios usam.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PROIBIDO = /DELETE\s+FROM\s+(ONLY\s+)?("?app"?\.)?"?(filme|estatistica_historica|perfil|interacao)"?\b/i;

const fonte = readFileSync(new URL('../../preparar/referencia.js', import.meta.url), 'utf8');

describe('referencia.js: SQL proibido', () => {
  it('sem TRUNCATE', () => {
    assert.doesNotMatch(fonte, /TRUNCATE/i);
  });
  it('sem DELETE em tabelas de filme, estatistica, perfil ou interacao', () => {
    assert.doesNotMatch(fonte, PROIBIDO);
  });
  it('nunca menciona perfil nem interacao', () => {
    assert.doesNotMatch(fonte, /app\.(perfil|interacao)\b/i);
  });
});

describe('regex de DELETE proibido', () => {
  for (const sql of ['DELETE FROM app.filme', 'delete  from app.perfil WHERE 1', 'DELETE FROM ONLY app.interacao',
    'DELETE FROM "app"."filme"', 'DELETE FROM app."estatistica_historica"', 'DELETE FROM filme']) {
    it(`casa: ${sql}`, () => assert.match(sql, PROIBIDO));
  }
  for (const sql of ['DELETE FROM app.filme_gemeo', 'DELETE FROM "app"."filme_gemeo"', 'SELECT * FROM app.filme']) {
    it(`nao casa: ${sql}`, () => assert.doesNotMatch(sql, PROIBIDO));
  }
});
