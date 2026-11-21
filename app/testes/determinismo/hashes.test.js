// Determinismo entre plataformas (spec 10.7): com os 5 arquivos do MovieLens 100K, calcula a régua, o hash do
// treino e o hash dos vetores FC e compara com as constantes congeladas. Sem Docker, sem banco.
// Sem ML100K_DIR o teste é ignorado, EXCETO com APP_EXIGIR_DADOS=1 (o CI sempre define): aí a falta de
// ML100K_DIR ou de qualquer dos 5 arquivos faz o teste falhar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarContexto } from '../../../src/contexto.js';
import { hashAvaliacoes } from '../../../src/util/hash-avaliacoes.js';
import { construirFC, hashVetoresFC } from '../../../src/fc/referencia.js';
import { DIM_FC, HASHES, SHA256_ARQUIVOS } from '../../integridade.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.ML100K_DIR;
const exigir = process.env.APP_EXIGIR_DADOS === '1';
const faltando = !dir ? ['ML100K_DIR'] : Object.keys(SHA256_ARQUIVOS).filter((n) => !existsSync(path.join(dir, n)));

test(
  'determinismo: régua, treino e vetores FC reproduzem os hashes congelados',
  { skip: !exigir && faltando.length > 0 ? `${faltando.join(', ')} ausente (defina ML100K_DIR com os 5 arquivos)` : false },
  (t) => {
    assert.ok(dir, 'ML100K_DIR ausente: o CI precisa baixar os dados');
    assert.deepEqual(faltando, [], `arquivos ausentes em ML100K_DIR: ${faltando.join(', ')}`);

    const sha256Arquivos = {};
    for (const [nome, esperado] of Object.entries(SHA256_ARQUIVOS)) {
      sha256Arquivos[nome] = createHash('sha256').update(readFileSync(path.join(dir, nome))).digest('hex');
      assert.equal(sha256Arquivos[nome], esperado, `sha256 de ${nome}`);
    }

    const ctx = criarContexto({ fase: 'v2-final', dirDados: dir });
    assert.equal(ctx.alvos, null);
    const calculados = {
      regua: ctx.regua.hash,
      treino: hashAvaliacoes(ctx.treino),
      vetoresFC: hashVetoresFC(construirFC(ctx.treino, DIM_FC)),
    };

    const resumo = { plataforma: process.platform, node: process.version, hashes: calculados };
    t.diagnostic(JSON.stringify(resumo));
    const pasta = path.resolve(aqui, '..', '..', 'test-results'); // ignorada pelo git
    mkdirSync(pasta, { recursive: true });
    writeFileSync(path.join(pasta, `hashes-${process.platform}.json`), JSON.stringify(resumo, null, 2) + '\n');

    assert.equal(calculados.regua, HASHES.regua, 'regua.hash');
    assert.equal(calculados.treino, HASHES.treino, 'hashAvaliacoes(treino)');
    assert.equal(calculados.vetoresFC, HASHES.vetoresFC, 'hashVetoresFC(construirFC(treino, 943))');
  },
);
