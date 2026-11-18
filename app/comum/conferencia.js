// Conferência de integridade do banco (spec 4.2 passo 4; reutilizada pelo servidor na Tarefa 9).
// Confere hashes de v2_final.metadados, os vetores de filmes_fc e (opcionalmente) o selo app.preparacao.
import { hashVetoresFC } from '../../src/fc/referencia.js';
import { HASHES, N_FC, N_FILMES } from '../integridade.js';
import { carregarFcDoBanco, conferirVetores } from './fc-banco.js';

const divergencia = (causa) => ({ ok: false, causa, tipo: 'integridade' });

// Devolve { ok: true, fc, hashes } ou { ok: false, causa, tipo: 'integridade' } para divergencias.
// Erros de consulta (conexao etc.) sao relancados sem alteracao, com o `code` original.
// `comSelo: false` serve à preparação, que confere os dados antes de gravar o selo.
export async function conferirIntegridade(executor, { comSelo = true } = {}) {
  try {
    const { rows } = await executor.query(
      `SELECT chave, valor FROM v2_final.metadados WHERE chave IN ('hash_regua', 'hash_treino')`,
    );
    const m = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    if (m.hash_regua !== HASHES.regua) return divergencia('régua do banco difere da congelada');
    if (m.hash_treino !== HASHES.treino) return divergencia('treino do banco difere do congelado');
    const carregado = await carregarFcDoBanco(executor);
    const r = conferirVetores(carregado);
    if (!r.ok) return divergencia(`conferência dos vetores falhou: ${r.causa}`);
    const hashes = { regua: m.hash_regua, treino: m.hash_treino, vetoresFC: hashVetoresFC(carregado.fc) };
    if (comSelo) {
      const { rows: selo } = await executor.query(
        'SELECT hash_regua, hash_treino, hash_vetores_fc, n_filmes, n_fc FROM app.preparacao WHERE id = 1',
      );
      const s = selo[0];
      if (!s) return divergencia('selo de preparação ausente');
      if (s.hash_regua !== hashes.regua || s.hash_treino !== hashes.treino || s.hash_vetores_fc !== hashes.vetoresFC) {
        return divergencia('selo de preparação com hashes divergentes');
      }
      if (Number(s.n_filmes) !== N_FILMES || Number(s.n_fc) !== N_FC) {
        return divergencia('selo de preparação com contagens divergentes');
      }
    }
    return { ok: true, fc: carregado.fc, hashes };
  } catch (e) {
    // tabela ausente e divergencia de integridade; qualquer outro erro de consulta segue sem alteracao
    if (e?.code === '42P01') return divergencia(`tabela ausente: ${e.message}`);
    throw e;
  }
}
