import { readFileSync } from 'node:fs';

const ID_UNKNOWN = 267;
const ARQUIVO_MANUAIS = new URL('../preparar/gemeos-manuais.json', import.meta.url);

export function detectarGemeos(filmes) {
  const porTitulo = new Map();
  for (const f of filmes) {
    if (!porTitulo.has(f.titulo)) porTitulo.set(f.titulo, []);
    porTitulo.get(f.titulo).push(f.id);
  }
  const pares = [];
  for (const ids of porTitulo.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => a - b);
    for (let i = 1; i < ids.length; i++) {
      pares.push({ menor: ids[0], maior: ids[i], evidencia: 'titulo_identico' });
    }
  }
  return pares.sort((a, b) => a.menor - b.menor || a.maior - b.maior);
}

export function carregarGemeosManuais() {
  return JSON.parse(readFileSync(ARQUIVO_MANUAIS, 'utf8'));
}

export function calcularOcultos(pares) {
  return new Set([ID_UNKNOWN, ...pares.map((p) => p.maior)]);
}
