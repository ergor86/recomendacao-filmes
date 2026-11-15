// Teste estático do isolamento do teste-2 e do u1.test (spec §3.2): varre o texto de src/ e scripts/
// e confere que cada função sensível só aparece nos arquivos permitidos.
// Os arquivos que definem cada função fazem parte das listas permitidas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '../..');

// Lista os .js de uma pasta (recursivo ou não), com caminhos relativos à raiz em barras normais.
function listar(dir, recursivo) {
  const saida = [];
  const abs = path.join(raiz, dir);
  if (!fs.existsSync(abs)) return saida;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory() && recursivo) saida.push(...listar(rel, true));
    else if (e.isFile() && e.name.endsWith('.js')) saida.push(rel);
  }
  return saida;
}

const arquivos = [...listar('src', true), ...listar('scripts', false)].sort();
const texto = new Map(arquivos.map((f) => [f, fs.readFileSync(path.join(raiz, f), 'utf8')]));

// Arquivos cujo texto contém o nome como palavra inteira.
function usam(nome) {
  const re = new RegExp(`\\b${nome}\\b`);
  return arquivos.filter((f) => re.test(texto.get(f)));
}

const permitidos = {
  carregarDataset: ['src/dados/carregar.js', 'src/contexto.js', 'src/dados/teste2.js', 'scripts/03-eda.js'],
  criarDivisoes: ['src/dados/divisoes.js', 'src/contexto.js', 'src/dados/teste2.js', 'scripts/03-eda.js'],
  lerAvaliacoes: ['src/dados/leitura.js', 'src/dados/carregar.js'],
  dividirTeste2: ['src/dados/teste2.js', 'src/contexto.js'],
  incluirTeste2: ['src/contexto.js', 'scripts/23-etapa2-v2.js'],
};

for (const [nome, lista] of Object.entries(permitidos)) {
  test(`${nome} só aparece nos arquivos permitidos`, () => {
    const fora = usam(nome).filter((f) => !lista.includes(f));
    assert.deepEqual(fora, [], `${nome} usado fora da lista permitida: ${fora.join(', ')}`);
  });
}

test('teste2.js só é importado por contexto.js e pelos scripts 14 e 21 (estes só com resumoDivisoesV2)', () => {
  const reImport = /^\s*import\s[^;]*?from\s+['"][^'"]*teste2\.js['"]/gm;
  const permitidosImport = ['src/contexto.js', 'scripts/14-divisoes-v2.js', 'scripts/21-congelar-v2.js'];
  for (const f of arquivos) {
    const imports = texto.get(f).match(reImport) ?? [];
    if (imports.length === 0) continue;
    assert.ok(permitidosImport.includes(f), `${f} importa teste2.js sem permissão`);
    if (f.startsWith('scripts/')) {
      for (const linha of imports) {
        const nomes = linha.match(/\{([^}]*)\}/)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
        assert.deepEqual(nomes, ['resumoDivisoesV2'], `${f} só pode importar resumoDivisoesV2 de teste2.js`);
      }
    }
  }
});
