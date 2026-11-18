// ECONNRESET/ETIMEDOUT/EPIPE: queda do banco vista através de um encaminhamento de porta (Docker no WSL)
const DISPONIBILIDADE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03']);
const INTEGRIDADE = new Set(['42501', '42P01']);
const MSG_INTEGRIDADE = ['régua do banco difere', 'treino do banco difere', 'banco sem filmes_fc'];

export function classificarErroPg(erro) {
  if (!erro) return 'outro';
  const code = erro.code;
  if (code) {
    if (DISPONIBILIDADE.has(code)) return 'disponibilidade';
    if (code === '28P01') return 'credenciais';
    if (INTEGRIDADE.has(code)) return 'integridade';
  }
  const msg = String(erro.message ?? erro);
  if (msg.includes('Connection terminated') || msg.includes('Cannot use a pool after calling end') || msg.includes('timeout exceeded when trying to connect')) return 'disponibilidade';
  if (MSG_INTEGRIDADE.some((p) => msg.startsWith(p))) return 'integridade';
  return 'outro';
}
