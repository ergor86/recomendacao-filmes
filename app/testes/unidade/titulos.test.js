import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tituloExibicao, tituloBusca, normalizarConsulta } from '../../comum/titulos.js';

test('tituloExibicao move o artigo final e tira o ano', () => {
  assert.equal(tituloExibicao('Usual Suspects, The (1995)'), 'The Usual Suspects');
  assert.equal(tituloExibicao('Toy Story (1995)'), 'Toy Story');
  assert.equal(tituloExibicao('City of Lost Children, The (1995)'), 'The City of Lost Children');
});

test('tituloExibicao com alias entre parênteses: o alias sai do título', () => {
  assert.equal(tituloExibicao('Seven (Se7en) (1995)'), 'Seven');
  assert.equal(tituloExibicao('City of Lost Children, The (Cité des enfants perdus, La) (1995)'), 'The City of Lost Children');
  assert.equal(tituloExibicao('Boot, Das (Boat, The) (1981)'), 'Das Boot');
});

test("tituloExibicao: outros artigos, L' e títulos sem ano", () => {
  assert.equal(tituloExibicao('Bewegte Mann, Der (1994)'), 'Der Bewegte Mann');
  assert.equal(tituloExibicao("Odyssée, L' (1990)"), "L'Odyssée");
  assert.equal(tituloExibicao('Sem Ano, A'), 'A Sem Ano');
  assert.equal(tituloExibicao('Sem Ano'), 'Sem Ano');
  assert.equal(tituloExibicao('unknown'), 'unknown');
});

test('tituloBusca contém a forma original e a de exibição, sem acento e sem pontuação', () => {
  const b = tituloBusca('Cité des enfants perdus, La (1995)');
  assert.ok(b.includes('cite des enfants perdus'), b);
  assert.ok(b.includes('la cite des enfants perdus'), b);
  assert.ok(!/[^a-z0-9 ]/.test(b), b);
});

test('tituloBusca casa "usual suspects" e "the usual suspects"', () => {
  const b = tituloBusca('Usual Suspects, The (1995)');
  assert.ok(b.includes('usual suspects'));
  assert.ok(b.includes('the usual suspects'));
});

test('tituloExibicao tira o sufixo "(V)" depois do ano', () => {
  assert.equal(
    tituloExibicao('Land Before Time III: The Time of the Great Giving (1995) (V)'),
    'Land Before Time III: The Time of the Great Giving',
  );
  assert.equal(tituloExibicao('Toy Story (1995) '), 'Toy Story');
  assert.ok(!tituloBusca('Land Before Time III: The Time of the Great Giving (1995) (V)').includes(' v'));
});

test('normalizarConsulta usa a mesma normalização de tituloBusca', () => {
  assert.equal(normalizarConsulta('  Cité   des Enfants, Perdus! '), 'cite des enfants perdus');
  assert.equal(normalizarConsulta('SHAWSHANK'), 'shawshank');
  assert.equal(normalizarConsulta('!!!'), '');
  assert.ok(tituloBusca('Cité des enfants perdus, La (1995)').includes(normalizarConsulta('Cité des ENFANTS')));
});
