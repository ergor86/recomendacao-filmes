import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile, mkdir, writeFile, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { obterArquivosML, fetchComTentativas, ErroPreparacao } from '../../preparar/dados.js';
import { SHA256_ARQUIVOS } from '../../integridade.js';
import { NOMES_PROIBIDOS } from '../fixtures/nomes-proibidos.js';

const NOMES = Object.keys(SHA256_ARQUIVOS);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const COMANDO = 'docker compose -f compose.yml -f compose.local-zip.yml run --rm preparar';
const CAUSA_REDE = 'Não consegui baixar o MovieLens 100K (sem internet ou servidor fora do ar).';

const sintetico = (sufixo = '') =>
  Object.fromEntries(NOMES.map((n) => [n, Buffer.from(`conteudo inventado de ${n}${sufixo}\n`)]));
const hashesDe = (conteudos) => Object.fromEntries(Object.entries(conteudos).map(([n, b]) => [n, sha(b)]));

function montarZip(conteudos, extras = {}) {
  const zip = new AdmZip();
  for (const [n, b] of Object.entries(conteudos)) zip.addFile(`ml-100k/${n}`, b);
  for (const [n, b] of Object.entries(extras)) zip.addFile(`ml-100k/${n}`, b);
  return zip.toBuffer();
}

const temp = () => mkdtemp(path.join(tmpdir(), 'dados-teste-'));
const existe = (p) => access(p).then(() => true, () => false);
const semRede = async () => {
  throw new Error('a rede não deveria ser usada');
};

test('extrai só os 5 arquivos', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const proibidos = Object.fromEntries(NOMES_PROIBIDOS.map((n) => [n, Buffer.from('x')]));
    const zip = montarZip(c, proibidos);
    const r = await obterArquivosML({ destino: dir, baixar: async () => zip, sha256Esperado: hashesDe(c) });
    assert.equal(r.origem, 'download');
    const lista = (await readdir(path.join(dir, 'ml-100k'))).sort();
    assert.deepEqual(lista, [...NOMES].sort());
    for (const n of NOMES_PROIBIDOS) assert.ok(!lista.includes(n));
    assert.deepEqual(await readdir(dir), ['ml-100k']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sha256 divergente → ErroPreparacao e a pasta final não existe', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const esperado = hashesDe(c);
    esperado['u.item'] = '0'.repeat(64);
    await assert.rejects(
      obterArquivosML({ destino: dir, baixar: async () => montarZip(c), sha256Esperado: esperado }),
      (e) => {
        assert.ok(e instanceof ErroPreparacao);
        assert.equal(e.causa, 'O arquivo u.item baixado não confere com o usado na pesquisa.');
        assert.equal(e.comando, COMANDO);
        return true;
      },
    );
    assert.equal(await existe(path.join(dir, 'ml-100k')), false);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sem rede → ErroPreparacao com causa em português e o comando do zip local', async () => {
  const dir = await temp();
  try {
    await assert.rejects(
      obterArquivosML({
        destino: dir,
        baixar: async () => {
          throw new Error('ENOTFOUND');
        },
        sha256Esperado: hashesDe(sintetico()),
      }),
      (e) => {
        assert.ok(e instanceof ErroPreparacao);
        assert.equal(e.causa, CAUSA_REDE);
        assert.equal(e.comando, COMANDO);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zip sem um dos arquivos → ErroPreparacao', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    delete c['u.genre'];
    await assert.rejects(
      obterArquivosML({ destino: dir, baixar: async () => montarZip(c), sha256Esperado: hashesDe(sintetico()) }),
      (e) => e instanceof ErroPreparacao && e.causa === 'O zip não contém u.genre.',
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('existente → não chama baixar', async (t) => {
  const origem = process.env.ML100K_DIR;
  if (!origem) return t.skip('ML100K_DIR não definido');
  const dir = await temp();
  try {
    await mkdir(path.join(dir, 'ml-100k'));
    for (const n of NOMES) await cp(path.join(origem, n), path.join(dir, 'ml-100k', n));
    const r = await obterArquivosML({ destino: dir, baixar: semRede });
    assert.equal(r.origem, 'existente');
    assert.equal(r.md5Zip, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('existente sintético (sha256 injetado) → não chama baixar', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    await mkdir(path.join(dir, 'ml-100k'));
    for (const [n, b] of Object.entries(c)) await writeFile(path.join(dir, 'ml-100k', n), b);
    const r = await obterArquivosML({ destino: dir, baixar: semRede, sha256Esperado: hashesDe(c) });
    assert.equal(r.origem, 'existente');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pasta antiga inválida é substituída só depois da conferência', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    await mkdir(path.join(dir, 'ml-100k'));
    await writeFile(path.join(dir, 'ml-100k', 'u.item'), 'lixo');
    await writeFile(path.join(dir, 'ml-100k', 'sobra.txt'), 'x');
    const r = await obterArquivosML({ destino: dir, baixar: async () => montarZip(c), sha256Esperado: hashesDe(c) });
    assert.equal(r.origem, 'download');
    assert.deepEqual((await readdir(path.join(dir, 'ml-100k'))).sort(), [...NOMES].sort());
    assert.deepEqual(await readFile(path.join(dir, 'ml-100k', 'u.item')), c['u.item']);
    assert.deepEqual(await readdir(dir), ['ml-100k']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pasta antiga é preservada se o zip novo divergir', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    await mkdir(path.join(dir, 'ml-100k'));
    await writeFile(path.join(dir, 'ml-100k', 'antigo.txt'), 'x');
    await assert.rejects(
      obterArquivosML({ destino: dir, baixar: async () => montarZip(sintetico('-outro')), sha256Esperado: hashesDe(c) }),
      ErroPreparacao,
    );
    assert.deepEqual(await readdir(path.join(dir, 'ml-100k')), ['antigo.txt']);
    assert.deepEqual(await readdir(dir), ['ml-100k']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zip reempacotado (MD5 diferente) com os mesmos arquivos é aceito', async () => {
  const dir1 = await temp();
  const dir2 = await temp();
  try {
    const c = sintetico();
    const zipA = montarZip(c);
    const zipB = montarZip(c, { 'LEIAME-extra.txt': Buffer.from('reempacotado') });
    assert.notEqual(md5(zipA), md5(zipB));
    const logs = [];
    const a = await obterArquivosML({
      destino: dir1,
      baixar: async () => zipA,
      sha256Esperado: hashesDe(c),
      log: (m) => logs.push(m),
    });
    const b = await obterArquivosML({ destino: dir2, baixar: async () => zipB, sha256Esperado: hashesDe(c) });
    assert.equal(a.md5Zip, md5(zipA));
    assert.equal(b.md5Zip, md5(zipB));
    assert.ok(logs.some((m) => m.includes(md5(zipA))));
  } finally {
    await rm(dir1, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
});

test('zipLocal é lido do disco, sem baixar', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const arq = path.join(dir, 'local.zip');
    await writeFile(arq, montarZip(c));
    const destino = path.join(dir, 'dados');
    const r = await obterArquivosML({ destino, zipLocal: arq, baixar: semRede, sha256Esperado: hashesDe(c) });
    assert.equal(r.origem, 'zip-local');
    assert.ok(r.md5Zip);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetchComTentativas: status não 2xx conta como falha e há 3 tentativas', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    n++;
    return new Response('x', { status: 503 });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resultado = fetchComTentativas('http://exemplo.invalido/x.zip').then(() => null, (e) => e);
  for (const ms of [1000, 2000]) {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(ms);
  }
  const erro = await resultado;
  assert.ok(erro instanceof ErroPreparacao);
  assert.equal(n, 3);
  assert.equal(erro.causa, CAUSA_REDE);
});

test('fetchComTentativas devolve o Buffer em caso de sucesso', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.from('abc'), { status: 200 }));
  const b = await fetchComTentativas('http://exemplo.invalido/x.zip');
  assert.ok(Buffer.isBuffer(b));
  assert.equal(b.toString(), 'abc');
});

const CAUSA_TAMANHO = 'O download do MovieLens excedeu o tamanho esperado.';

test('baixar que devolve mais que o limite do zip é rejeitado', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const zip = montarZip(c);
    await assert.rejects(
      obterArquivosML({ destino: dir, baixar: async () => zip, sha256Esperado: hashesDe(c), limites: { zip: zip.length - 1 } }),
      (e) => e instanceof ErroPreparacao && e.causa === CAUSA_TAMANHO,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zipLocal acima do limite é rejeitado pelo stat', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const arq = path.join(dir, 'local.zip');
    const zip = montarZip(c);
    await writeFile(arq, zip);
    await assert.rejects(
      obterArquivosML({
        destino: path.join(dir, 'dados'),
        zipLocal: arq,
        sha256Esperado: hashesDe(c),
        limites: { zip: zip.length - 1 },
      }),
      (e) => e instanceof ErroPreparacao && e.causa === CAUSA_TAMANHO,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('entrada com tamanho declarado acima do teto é rejeitada pelo cabeçalho, sem descompactar', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    const zip = montarZip(c);
    await assert.rejects(
      obterArquivosML({
        destino: dir,
        baixar: async () => zip,
        sha256Esperado: hashesDe(c),
        limites: { arquivo: c['u.item'].length - 1 },
      }),
      // A mensagem do cabeçalho não tem "descompactado": a checagem pós-getData não rodou.
      (e) => e instanceof ErroPreparacao && /^O arquivo u[\w.]+ do zip excede o tamanho esperado\.$/.test(e.causa),
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fetchComTentativas: Content-Length acima do limite aborta sem tentar de novo', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    n++;
    return new Response('abc', { status: 200, headers: { 'content-length': '60000000' } });
  });
  await assert.rejects(
    fetchComTentativas('http://exemplo.invalido/x.zip'),
    (e) => e instanceof ErroPreparacao && e.causa === CAUSA_TAMANHO,
  );
  assert.equal(n, 1);
});

test('fetchComTentativas: corpo por stream acima do limite aborta', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.alloc(100), { status: 200 }));
  await assert.rejects(
    fetchComTentativas('http://exemplo.invalido/x.zip', { limite: 50 }),
    (e) => e instanceof ErroPreparacao && e.causa === CAUSA_TAMANHO,
  );
});

test('existente com arquivo a mais (nome proibido) → nova extração e só restam os 5', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    await mkdir(path.join(dir, 'ml-100k'));
    for (const [n, b] of Object.entries(c)) await writeFile(path.join(dir, 'ml-100k', n), b);
    await writeFile(path.join(dir, 'ml-100k', NOMES_PROIBIDOS[0]), 'x');
    let baixou = 0;
    const r = await obterArquivosML({
      destino: dir,
      baixar: async () => {
        baixou++;
        return montarZip(c);
      },
      sha256Esperado: hashesDe(c),
    });
    assert.equal(baixou, 1);
    assert.equal(r.origem, 'download');
    assert.deepEqual((await readdir(path.join(dir, 'ml-100k'))).sort(), [...NOMES].sort());
    assert.deepEqual(await readdir(dir), ['ml-100k']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('órfãos .ml-100k.tmp-* e .ml-100k.antiga-* são apagados no início', async () => {
  const dir = await temp();
  try {
    const c = sintetico();
    await mkdir(path.join(dir, '.ml-100k.tmp-1-aa'));
    await mkdir(path.join(dir, '.ml-100k.antiga-1-aa'));
    await mkdir(path.join(dir, 'ml-100k'));
    for (const [n, b] of Object.entries(c)) await writeFile(path.join(dir, 'ml-100k', n), b);
    const r = await obterArquivosML({ destino: dir, baixar: semRede, sha256Esperado: hashesDe(c) });
    assert.equal(r.origem, 'existente');
    assert.deepEqual(await readdir(dir), ['ml-100k']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
