// Uso: node app/testes/determinismo/obter-dados.js <destino>
// Baixa o zip oficial do MovieLens 100K e extrai SÓ os 5 arquivos permitidos em <destino>/ml-100k,
// conferindo o sha256 de cada um (sai com erro se algum divergir).
import path from 'node:path';
import { obterArquivosML } from '../../preparar/dados.js';

const destino = process.argv[2];
if (!destino) {
  console.error('uso: node obter-dados.js <destino>');
  process.exit(2);
}
try {
  const r = await obterArquivosML({ destino: path.resolve(destino), log: (m) => console.log(m) });
  console.log(`dados prontos em ${path.join(path.resolve(destino), 'ml-100k')} (origem: ${r.origem})`);
} catch (e) {
  console.error(`falha ao obter os dados: ${e.causa ?? e.message}`);
  process.exit(1);
}
