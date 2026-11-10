import { createHash } from 'node:crypto';

export function md5Hex(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

export function conferirMd5(buffer, esperado) {
  const calculado = md5Hex(buffer);
  if (calculado !== esperado.toLowerCase()) {
    throw new Error(`MD5 não confere: esperado ${esperado}, calculado ${calculado}. Apague o download e rode de novo.`);
  }
}

export function extrairMd5(textoArquivoMd5) {
  const m = textoArquivoMd5.match(/\b[0-9a-fA-F]{32}\b/);
  if (!m) throw new Error(`Não achei um hash MD5 de 32 caracteres em: "${textoArquivoMd5.trim()}"`);
  return m[0].toLowerCase();
}
