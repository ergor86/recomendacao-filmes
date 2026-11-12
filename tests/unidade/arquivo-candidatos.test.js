// Testes de lerCandidatos: arquivo íntegro carrega; sha256 alterado, régua diferente e arquivo
// ausente falham alto com mensagem acionável. Usam arquivos sintéticos numa pasta temporária.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerCandidatos, montarArquivoCandidatos } from '../../src/candidatos/arquivo.js';

const regua = { hash: 'hash-a' };

// Cria uma pasta temporária, grava o conteúdo e devolve o caminho do arquivo.
function gravar(conteudo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cand-'));
  const caminho = path.join(dir, 'candidatos-exp.json');
  fs.writeFileSync(caminho, JSON.stringify(conteudo));
  return { dir, caminho };
}

const porUsuario = { 1: { populares: [5, 6, 7], vizinhos: [1, 2] }, 2: { populares: [5, 6, 8], vizinhos: [] } };

test('arquivo íntegro carrega como Map de usuário numérico', () => {
  const { dir, caminho } = gravar(montarArquivoCandidatos('exp', 'hash-a', porUsuario));
  try {
    const m = lerCandidatos(caminho, regua);
    assert.deepEqual([...m.keys()], [1, 2]);
    assert.deepEqual(m.get(1), { populares: [5, 6, 7], vizinhos: [1, 2] });
    assert.deepEqual(m.get(2).vizinhos, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sha256 alterado gera erro acionável', () => {
  const arq = montarArquivoCandidatos('exp', 'hash-a', porUsuario);
  arq.porUsuario[1].vizinhos = [9, 9];
  const { dir, caminho } = gravar(arq);
  try {
    assert.throws(() => lerCandidatos(caminho, regua), /candidatos de outra régua ou alterados: rode npm run gerar-candidatos -- --fase exp/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('régua diferente gera erro acionável', () => {
  const { dir, caminho } = gravar(montarArquivoCandidatos('exp', 'hash-a', porUsuario));
  try {
    assert.throws(() => lerCandidatos(caminho, { hash: 'hash-b' }), /candidatos de outra régua ou alterados: rode npm run gerar-candidatos -- --fase exp/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo ausente manda gerar os candidatos', () => {
  assert.throws(() => lerCandidatos(path.join(os.tmpdir(), 'nao-existe', 'candidatos-final.json'), regua),
    /npm run gerar-candidatos -- --fase final/);
});
