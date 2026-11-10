// Conferência de integridade do download do MovieLens. O MD5 funciona como uma impressão
// digital do arquivo: se um único byte mudar, o MD5 muda. Comparamos com o publicado pelo GroupLens.

import { createHash } from 'node:crypto';

/** Calcula o MD5 de um conteúdo binário, em hexadecimal (32 caracteres). */
export function md5Hex(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

/** Lança erro se o MD5 do arquivo baixado não bater com o esperado (download corrompido ou alterado). */
export function conferirMd5(buffer, esperado) {
  const calculado = md5Hex(buffer);
  if (calculado !== esperado.toLowerCase()) {
    throw new Error(`MD5 não confere: esperado ${esperado}, calculado ${calculado}. Apague o download e rode de novo.`);
  }
}

/** Extrai o hash de 32 caracteres do texto do arquivo .md5 publicado junto com o zip. */
export function extrairMd5(textoArquivoMd5) {
  const m = textoArquivoMd5.match(/\b[0-9a-fA-F]{32}\b/);
  if (!m) throw new Error(`Não achei um hash MD5 de 32 caracteres em: "${textoArquivoMd5.trim()}"`);
  return m[0].toLowerCase();
}
