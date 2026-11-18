// GET /api/saude (spec 6.2): sempre 200 com o Host válido, montada campo a campo e sem segredos.
// Nada do objeto do ciclo é repassado sem passar por esta lista de campos e tipos.
const ESTADOS = new Set(['preparando', 'falhou', 'bloqueado', 'operante']);
const MOTIVOS = new Set(['banco_indisponivel', 'credenciais', 'sem_dados']);
const INTEIROS = ['etapa', 'total'];
const TEXTOS = ['mensagem', 'causa', 'comando'];

export function montarSaude(s) {
  const out = { estado: ESTADOS.has(s?.estado) ? s.estado : 'preparando' };
  for (const c of INTEIROS) if (Number.isInteger(s?.[c])) out[c] = s[c];
  for (const c of TEXTOS) if (typeof s?.[c] === 'string') out[c] = s[c];
  const disponivel = s?.perfis?.disponivel === true;
  out.perfis = { disponivel };
  if (!disponivel && MOTIVOS.has(s?.perfis?.motivo)) out.perfis.motivo = s.perfis.motivo;
  return out;
}

export async function rotasSaude(app, { ciclo }) {
  app.get('/saude', async (req) => {
    try {
      return montarSaude(await ciclo.saude());
    } catch (erro) {
      // a resposta nunca repassa a mensagem (pode trazer detalhes internos); o log traz só o texto, sem o objeto
      req.log.error({ msg: String(erro?.message ?? erro).slice(0, 400) }, 'falha ao montar /saude');
      return montarSaude({ estado: 'preparando', mensagem: 'Não consegui conferir o estado agora; tentando de novo.' });
    }
  });
}
