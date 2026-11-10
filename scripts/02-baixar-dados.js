import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { carregarConfig } from '../src/config.js';
import { md5Hex, conferirMd5, extrairMd5 } from '../src/dados/download.js';

const URL_ZIP = 'https://files.grouplens.org/datasets/movielens/ml-100k.zip';

const { dirDados } = carregarConfig();
const uData = path.join(dirDados, 'u.data');

if (fs.existsSync(uData)) {
  console.log(`${uData} já existe: nada a baixar.`);
  process.exit(0);
}

async function baixar(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}

console.log(`Baixando ${URL_ZIP} ...`);
const zip = await baixar(URL_ZIP);

let esperado;
try {
  esperado = extrairMd5((await baixar(`${URL_ZIP}.md5`)).toString('utf8'));
} catch (erro) {
  console.error(`Não consegui obter o arquivo .md5 (${erro.message}).`);
  console.error(`MD5 calculado do zip: ${md5Hex(zip)}`);
  console.error('Confira esse valor manualmente em https://grouplens.org/datasets/movielens/100k/ antes de continuar.');
  process.exit(1);
}
conferirMd5(zip, esperado);
console.log(`MD5 confere (${esperado}).`);

const destino = path.dirname(path.resolve(dirDados));
fs.mkdirSync(destino, { recursive: true });
new AdmZip(zip).extractAllTo(destino, true);
console.log(`Extraído em ${destino}.`);
