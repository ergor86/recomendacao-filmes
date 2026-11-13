import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerAvaliacoes, lerFilmes, lerUsuarios, lerLista } from '../../src/dados/leitura.js';
import { carregarDataset } from '../../src/dados/carregar.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leitura-'));
const arq = path.join(dir, 'arquivo.txt');

test('lerFilmes lê latin-1, ano e 19 gêneros', () => {
  const linha = '1|Café da Manhã (1995)|01-Jan-1995||http://x|' + '0|1|0|0|0|0|0|0|1|0|0|0|0|0|0|0|0|0|0';
  const linha2 = '2|Sem Data|||http://y|' + '1|' + '0|'.repeat(17) + '0';
  fs.writeFileSync(arq, Buffer.from(linha + '\n' + linha2 + '\n', 'latin1'));
  const [f1, f2] = lerFilmes(arq);
  assert.equal(f1.titulo, 'Café da Manhã (1995)');
  assert.equal(f1.ano, 1995);
  assert.equal(f1.generos.length, 19);
  assert.deepEqual([f1.generos[1], f1.generos[8]], [1, 1]);
  assert.equal(f2.ano, null);
});

test('lerAvaliacoes lê TAB', () => {
  fs.writeFileSync(arq, '1\t2\t5\t881250949\n');
  assert.deepEqual(lerAvaliacoes(arq), [{ usuario: 1, filme: 2, nota: 5, ts: 881250949 }]);
});

test('lerUsuarios e lerLista', () => {
  fs.writeFileSync(arq, '1|24|M|technician|85711\n\n2|53|F|other|94043\n');
  assert.deepEqual(lerUsuarios(arq), [
    { id: 1, idade: 24, genero: 'M', ocupacao: 'technician' },
    { id: 2, idade: 53, genero: 'F', ocupacao: 'other' },
  ]);
  fs.writeFileSync(arq, 'unknown|0\nAction|1\n\n');
  assert.deepEqual(lerLista(arq), ['unknown', 'Action']);
  fs.writeFileSync(arq, 'admin\nartist\n');
  assert.deepEqual(lerLista(arq), ['admin', 'artist']);
});

test('carregarDataset junta tudo', () => {
  const d = path.join(dir, 'ds');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'u1.base'), '1\t2\t5\t10\n');
  fs.writeFileSync(path.join(d, 'u1.test'), '1\t3\t4\t11\n2\t3\t1\t12\n');
  fs.writeFileSync(path.join(d, 'u.item'), '1|A|01-Jan-1990||u|' + Array(19).fill(0).join('|') + '\n');
  fs.writeFileSync(path.join(d, 'u.user'), '1|24|M|admin|1\n');
  fs.writeFileSync(path.join(d, 'u.genre'), 'g|0\n');
  fs.writeFileSync(path.join(d, 'u.occupation'), 'admin\n');
  const r = carregarDataset(d, { incluirTeste: true });
  assert.deepEqual([r.base.length, r.teste.length, r.filmes.length, r.usuarios.length, r.generos, r.ocupacoes],
    [1, 2, 1, 1, ['g'], ['admin']]);
});

test('carregarDataset sem incluirTeste não lê u1.test e devolve teste: null', () => {
  const d = path.join(dir, 'ds-sem-teste');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'u1.base'), '1\t2\t5\t10\n');
  fs.writeFileSync(path.join(d, 'u.item'), '1|A|01-Jan-1990||u|' + Array(19).fill(0).join('|') + '\n');
  fs.writeFileSync(path.join(d, 'u.user'), '1|24|M|admin|1\n');
  fs.writeFileSync(path.join(d, 'u.genre'), 'g|0\n');
  fs.writeFileSync(path.join(d, 'u.occupation'), 'admin\n');
  assert.equal(carregarDataset(d).teste, null);
});
