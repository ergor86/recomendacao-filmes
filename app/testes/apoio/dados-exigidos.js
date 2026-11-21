// Trava dos dados para as suítes de integração, referência e equivalência (M-2). Basta importar este módulo.
// Sem ML100K_DIR as suítes se ignoram, EXCETO com APP_EXIGIR_DADOS=1 (o CI sempre define): aí este módulo
// registra um teste que FALHA, em vez de deixar o job verde sem rodar a §10.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.ML100K_DIR && process.env.APP_EXIGIR_DADOS === '1') {
  test('ML100K_DIR ausente (APP_EXIGIR_DADOS=1)', () => {
    assert.fail('ML100K_DIR ausente: o CI precisa baixar os dados');
  });
}
