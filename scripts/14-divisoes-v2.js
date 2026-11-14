// Script 14 (npm run divisoes-v2): Passo 0 do Plano 3 — registra as divisões (hashes e agregados).
//   npm run divisoes-v2
// Grava resultados/divisoes-v2.json (jsonEstavel). Só agregados: nenhuma lista por usuário e
// nenhum ID ou nota do teste-2. Recusa sobrescrever se o arquivo já está commitado com outros hashes.

import 'dotenv/config';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { carregarConfig } from '../src/config.js';
import { resumoDivisoesV2 } from '../src/dados/teste2.js';
import { jsonEstavel } from '../src/util/json-estavel.js';

const ARQ = 'resultados/divisoes-v2.json';

// Diz se o arquivo está versionado no git.
function estaCommitado(arq) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', arq], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const { dirDados } = carregarConfig();
const resumo = resumoDivisoesV2(dirDados);

if (fs.existsSync(ARQ) && estaCommitado(ARQ)) {
  const antigo = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  if (jsonEstavel(antigo.hashes) !== jsonEstavel(resumo.hashes)) {
    throw new Error(
      `${ARQ} já está commitado com outros hashes: as divisões mudaram (dados ou código). ` +
      'Investigue a causa; se for intencional, remova o arquivo do git e registre o motivo antes de regravar.',
    );
  }
}

fs.mkdirSync('resultados', { recursive: true });
fs.writeFileSync(ARQ, jsonEstavel(resumo) + '\n');
const { teste2, validacao } = resumo;
console.log(`Gravado ${ARQ}`);
console.log(`teste-2: ${teste2.avaliaveis} avaliáveis, ${teste2.semCurtidas} sem curtidas; ` +
  `notas escondidas (média) ${teste2.notasEscondidas.media.toFixed(2)}, curtidas ${teste2.curtidasEscondidas.media.toFixed(2)}`);
console.log(`validação: ${validacao.avaliaveis} avaliáveis; curtidas escondidas (média) ${validacao.curtidasEscondidas.media.toFixed(2)}`);
