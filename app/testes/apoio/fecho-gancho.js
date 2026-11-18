// Gancho de resolução (module.register): grava em FECHO_SAIDA toda URL resolvida (uma por linha).
// Escrita síncrona, para que nada se perca quando o processo é encerrado logo depois.
import { appendFileSync } from 'node:fs';

export async function resolve(especificador, contexto, proximo) {
  const r = await proximo(especificador, contexto);
  if (process.env.FECHO_SAIDA) appendFileSync(process.env.FECHO_SAIDA, `${r.url}\n`);
  return r;
}
