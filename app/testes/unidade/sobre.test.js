// /sobre: texto técnico montado a partir de s1.js e com a consequência do índice reconstruído (spec 4.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montarSobre } from '../../servidor/rotas/sobre.js';
import { M, N_FC } from '../../servidor/recomendacao/s1.js';

describe('/sobre: tecnica.descricao', () => {
  const { tecnica } = montarSobre();
  it('interpola M e N_FC de s1.js', () => {
    assert.ok(tecnica.descricao.includes(`M = ${M},`));
    assert.ok(tecnica.descricao.includes(`FC${N_FC} = os ${N_FC} primeiros`));
    assert.ok(tecnica.descricao.includes(`prefixo da FC${N_FC}`));
  });
  it('diz a consequência do índice reconstruído (spec 4.4)', () => {
    assert.match(tecnica.descricao, /pode diferir, em casos raros, da que o índice da pesquisa daria/);
    assert.match(tecnica.descricao, /medida no índice da pesquisa/);
  });
});

describe('/sobre: licenças e atribuição', () => {
  const { licencas, resumo } = montarSobre();
  const ml = licencas.find((l) => l.nome === 'MovieLens 100K');
  it('atribui os dados ao GroupLens e afirma que não há endosso', () => {
    assert.ok(ml);
    assert.match(ml.texto, /GroupLens Research/);
    assert.ok(ml.texto.includes('Este projeto não é endossado nem apoiado pelo GroupLens nem pela Universidade de Minnesota.'));
  });
  it('não altera as 3 frases do topo', () => {
    assert.equal(resumo.length, 3);
  });
});
