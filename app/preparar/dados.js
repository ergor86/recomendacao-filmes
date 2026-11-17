// Obtenção dos 5 arquivos do MovieLens 100K usados pela aplicação (spec §4.2, passo 2).
// Só os 5 nomes de SHA256_ARQUIVOS são extraídos do zip, cada um conferido por sha256.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { SHA256_ARQUIVOS } from '../integridade.js';

export const URL_ML100K = 'https://files.grouplens.org/datasets/movielens/ml-100k.zip';
export const COMANDO_ZIP_LOCAL = 'docker compose -f compose.yml -f compose.local-zip.yml run --rm preparar';
export const LIMITE_ZIP = 50 * 1024 * 1024;
export const LIMITE_ARQUIVO = 20 * 1024 * 1024;
const CAUSA_TAMANHO = 'O download do MovieLens excedeu o tamanho esperado.';
const CAUSA_REDE = 'Não consegui baixar o MovieLens 100K (sem internet ou servidor fora do ar).';

export class ErroPreparacao extends Error {
  constructor(causa, comando = COMANDO_ZIP_LOCAL) {
    super(causa);
    this.name = 'ErroPreparacao';
    this.causa = causa;
    this.comando = comando;
  }
}

const sha256Hex = (b) => createHash('sha256').update(b).digest('hex');
const md5Hex = (b) => createHash('md5').update(b).digest('hex');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lê o corpo por stream, abortando ao passar do limite. */
async function lerCorpo(resp, limite) {
  const declarado = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > limite) {
    await resp.body?.cancel().catch(() => {});
    throw new ErroPreparacao(CAUSA_TAMANHO);
  }
  const partes = [];
  let total = 0;
  if (!resp.body) return Buffer.alloc(0);
  const leitor = resp.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      throw new ErroPreparacao(CAUSA_TAMANHO);
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/** Baixa a URL com 3 tentativas (esperas de 1 s e 2 s), 60 s de limite cada; não 2xx é falha. */
export async function fetchComTentativas(url, { limite = LIMITE_ZIP } = {}) {
  const esperas = [1000, 2000];
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await lerCorpo(resp, limite);
    } catch (e) {
      if (e instanceof ErroPreparacao) throw e;
      if (i < 2) await espera(esperas[i]);
    }
  }
  throw new ErroPreparacao(CAUSA_REDE);
}

async function arquivosConferem(pasta, sha256Esperado) {
  try {
    // O volume de dados contém só os 5 arquivos: qualquer nome a mais invalida a pasta.
    const nomes = (await readdir(pasta)).sort();
    const esperados = Object.keys(sha256Esperado).sort();
    if (nomes.length !== esperados.length || nomes.some((n, k) => n !== esperados[k])) return false;
    for (const [nome, esperado] of Object.entries(sha256Esperado)) {
      if (sha256Hex(await readFile(path.join(pasta, nome))) !== esperado) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const existe = (p) => access(p).then(() => true, () => false);

/** Apaga sobras de execuções interrompidas. */
async function limparOrfaos(destino, log) {
  let nomes;
  try {
    nomes = await readdir(destino);
  } catch {
    return;
  }
  for (const n of nomes) {
    if (n.startsWith('.ml-100k.tmp-') || n.startsWith('.ml-100k.antiga-')) {
      await rm(path.join(destino, n), { recursive: true, force: true }).catch((e) => log(`Não consegui apagar ${n}: ${e.message}`));
    }
  }
}

export async function obterArquivosML({
  destino,
  zipLocal,
  baixar = fetchComTentativas,
  log = () => {},
  sha256Esperado = SHA256_ARQUIVOS,
  limites = {},
}) {
  const limiteZip = limites.zip ?? LIMITE_ZIP;
  const limiteArquivo = limites.arquivo ?? LIMITE_ARQUIVO;
  await limparOrfaos(destino, log);
  const final = path.join(destino, 'ml-100k');
  if (await arquivosConferem(final, sha256Esperado)) return { origem: 'existente' };

  let zipBuf;
  let origem;
  if (zipLocal) {
    origem = 'zip-local';
    try {
      if ((await stat(zipLocal)).size > limiteZip) throw new ErroPreparacao(CAUSA_TAMANHO);
      zipBuf = await readFile(zipLocal);
    } catch (e) {
      if (e instanceof ErroPreparacao) throw e;
      throw new ErroPreparacao(`Não consegui ler o zip local ${zipLocal}.`);
    }
  } else {
    origem = 'download';
    try {
      zipBuf = await baixar(URL_ML100K);
    } catch (e) {
      throw e instanceof ErroPreparacao ? e : new ErroPreparacao(CAUSA_REDE);
    }
    if (zipBuf.length > limiteZip) throw new ErroPreparacao(CAUSA_TAMANHO);
  }
  const md5Zip = md5Hex(zipBuf);
  log(`MD5 do zip do MovieLens: ${md5Zip}`);

  let zip;
  try {
    zip = new AdmZip(zipBuf);
  } catch {
    throw new ErroPreparacao('O arquivo do MovieLens 100K não é um zip válido.');
  }

  // Lê e confere em memória só as entradas exatas dos 5 nomes.
  const conteudos = {};
  for (const [nome, esperado] of Object.entries(sha256Esperado)) {
    const entrada = zip.getEntry(`ml-100k/${nome}`);
    if (!entrada || entrada.isDirectory) throw new ErroPreparacao(`O zip não contém ${nome}.`);
    if (entrada.header.size > limiteArquivo) throw new ErroPreparacao(`O arquivo ${nome} do zip excede o tamanho esperado.`);
    const dados = entrada.getData();
    if (dados.length > limiteArquivo) throw new ErroPreparacao(`O arquivo ${nome} descompactado excede o tamanho esperado.`);
    if (sha256Hex(dados) !== esperado) {
      throw new ErroPreparacao(`O arquivo ${nome} baixado não confere com o usado na pesquisa.`);
    }
    conteudos[nome] = dados;
  }

  await mkdir(destino, { recursive: true });
  const sufixo = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const tmp = path.join(destino, `.ml-100k.tmp-${sufixo}`);
  const antiga = path.join(destino, `.ml-100k.antiga-${sufixo}`);
  let moveuAntiga = false;
  try {
    await mkdir(tmp);
    for (const [nome, dados] of Object.entries(conteudos)) await writeFile(path.join(tmp, nome), dados);
    if (await existe(final)) {
      await rename(final, antiga);
      moveuAntiga = true;
    }
    await rename(tmp, final);
  } catch (e) {
    if (moveuAntiga && !(await existe(final))) await rename(antiga, final).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
  if (moveuAntiga) {
    await rm(antiga, { recursive: true, force: true }).catch((e) => log(`Não consegui apagar a pasta antiga: ${e.message}`));
  }
  return { origem, md5Zip };
}
