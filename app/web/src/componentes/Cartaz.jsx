import { useState } from 'react';

// Cartaz SVG 2:3 determinístico: o id define o matiz (na família do primeiro gênero), o padrão e o gradiente.

/** FNV-1a de 32 bits sobre os pontos de código UTF-16 da string (ASCII nos ids). */
export function hashFnv1a(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// matiz-base por id de gênero (os mesmos 18 + unknown de GENEROS em servidor/rotas/comum.js), em graus
export const FAMILIAS = {
  action: 8, adventure: 28, animation: 44, "children's": 95, comedy: 40, crime: 345, documentary: 140,
  drama: 172, fantasy: 290, 'film-noir': 220, horror: 355, musical: 320, mystery: 250, romance: 338,
  'sci-fi': 200, thriller: 228, war: 72, western: 26, unknown: 210,
};
// tom por gênero: [saturação, luz-base]. Luz ≥ 0,55 = capa clara com texto escuro; abaixo disso, capa escura com texto claro.
const TONS = {
  action: [0.60, 0.38], adventure: [0.55, 0.36], animation: [0.70, 0.74], "children's": [0.38, 0.74], comedy: [0.68, 0.76],
  crime: [0.45, 0.28], documentary: [0.20, 0.38], drama: [0.38, 0.27], fantasy: [0.40, 0.38], 'film-noir': [0.10, 0.22],
  horror: [0.62, 0.20], musical: [0.50, 0.74], mystery: [0.38, 0.27], romance: [0.52, 0.76], 'sci-fi': [0.55, 0.28],
  thriller: [0.38, 0.22], war: [0.25, 0.28], western: [0.45, 0.62], unknown: [0.10, 0.40],
};
const normalizar = (g) => String(g ?? '').toLowerCase().trim();

export function tomDoGenero(genero) {
  const [sat, luz] = TONS[normalizar(genero)] ?? TONS.unknown;
  return { sat, luz };
}

export function matizBase(generos) {
  const g = generos?.[0];
  if (!g) return FAMILIAS.unknown;
  const n = normalizar(g);
  return FAMILIAS[n] !== undefined ? FAMILIAS[n] : hashFnv1a(n) % 360;
}

// ---- cor e contraste (WCAG 2.x) ----
function hslParaRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
const luminancia = ([r, g, b]) => {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export function contrasteWcag(rgbA, rgbB) {
  const [a, b] = [luminancia(rgbA), luminancia(rgbB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const CLARO = [255, 255, 255];
const ESCURO = [26, 22, 37];

/**
 * Cores do cartaz. Tons claros usam texto escuro e clareiam até passar de 4,5; tons escuros usam texto claro e escurecem.
 * O 2º tom do gradiente gira para o lado quente nos claros e para o frio nos escuros.
 */
export function paletaDoCartaz(filme) {
  const h = hashFnv1a(String(filme.id));
  const { sat, luz } = tomDoGenero(filme.generos?.[0]);
  const matiz = (matizBase(filme.generos) + (h % 29) - 14 + 360) % 360;
  const clara = luz >= 0.55;
  const desvio = 18 + ((h >>> 8) % 16);
  const matiz2 = (matiz + (clara ? -desvio : desvio) + 360) % 360;
  const texto = clara ? ESCURO : CLARO;
  let l1 = luz + (((h >>> 16) % 8) - 4) / 100;
  let c1;
  let c2;
  let contraste = 0;
  for (let t = 0; t < 40; t++) {
    c1 = hslParaRgb(matiz, sat, l1);
    c2 = hslParaRgb(matiz2, Math.min(1, sat + 0.05), Math.max(0.03, l1 - (clara ? 0.10 : 0.12)));
    contraste = Math.min(contrasteWcag(texto, c1), contrasteWcag(texto, c2));
    if (contraste >= 4.5) break;
    l1 = clara ? Math.min(0.97, l1 + 0.02) : Math.max(0.03, l1 - 0.02);
  }
  return { matiz, matiz2, c1: hex(c1), c2: hex(c2), texto: hex(texto), contraste, h };
}

/** Padrão de cinema (0–4) do cartaz, determinístico pelo id. */
export const padraoDoCartaz = (filme) => hashFnv1a(String(filme.id)) % 5;

// ---- título em até 3 linhas ----
const LARGURA_LINHA = 15; // caracteres por linha no viewBox 200x300
export function quebrarTitulo(titulo, maxLinhas = 3, largura = LARGURA_LINHA) {
  const palavras = String(titulo).split(/\s+/).filter(Boolean).map((p) => (p.length > largura ? `${p.slice(0, largura - 1)}…` : p));
  const linhas = [];
  let atual = '';
  let sobrou = false;
  for (const p of palavras) {
    if (!atual) { atual = p; continue; }
    if (`${atual} ${p}`.length <= largura) { atual = `${atual} ${p}`; continue; }
    if (linhas.length === maxLinhas - 1) { sobrou = true; break; }
    linhas.push(atual);
    atual = p;
  }
  if (atual) linhas.push(atual);
  if (sobrou) {
    const ultima = linhas[linhas.length - 1];
    linhas[linhas.length - 1] = `${ultima.length >= largura ? ultima.slice(0, largura - 1) : ultima}…`;
  }
  return linhas;
}

function Padrao({ tipo, cor }) {
  const traco = { stroke: cor, strokeOpacity: 0.18, strokeWidth: 2, fill: 'none' };
  const seq = (n) => Array.from({ length: n }, (_, i) => i);
  switch (tipo) {
    case 0: // feixe de projetor
      return <g>{seq(7).map((i) => <line key={i} x1="186" y1="14" x2={-40 + i * 34} y2="190" {...traco} />)}</g>;
    case 1: // perfuração de película nas bordas
      return <g>{seq(8).map((i) => (
        <g key={i}><rect x="6" y={16 + i * 22} width="8" height="12" rx="2" {...traco} /><rect x="186" y={16 + i * 22} width="8" height="12" rx="2" {...traco} /></g>
      ))}</g>;
    case 2: // pontinha de contagem
      return (
        <g>
          <circle cx="100" cy="92" r="34" {...traco} /><circle cx="100" cy="92" r="58" {...traco} />
          <line x1="100" y1="14" x2="100" y2="170" {...traco} /><line x1="22" y1="92" x2="178" y2="92" {...traco} />
        </g>
      );
    case 3: // letreiro: faixas horizontais
      return <g>{seq(6).map((i) => <line key={i} x1="0" y1={24 + i * 24} x2="200" y2={24 + i * 24} stroke={cor} strokeOpacity={(0.06 + i * 0.03).toFixed(2)} strokeWidth="10" />)}</g>;
    default: // quadros de película
      return <g>{seq(3).flatMap((x) => seq(2).map((y) => <rect key={`${x}-${y}`} x={18 + x * 58} y={18 + y * 78} width="48" height="66" rx="3" {...traco} />))}</g>;
  }
}

const LARGURAS = { pequeno: 96, medio: 160, grande: 280 };

export default function Cartaz({ filme, midia, tamanho = 'medio' }) {
  const [externoFalhou, setExternoFalhou] = useState(false);
  const largura = LARGURAS[tamanho] ?? LARGURAS.medio;
  const altura = Math.round(largura * 1.5);
  const rotulo = `Cartaz: ${filme.titulo}${filme.ano ? ` (${filme.ano})` : ''}`;
  const externo = midia?.cartaz?.tipo === 'externo' && !externoFalhou ? midia.cartaz : null;

  if (externo) {
    return (
      <img
        className={`cartaz cartaz-${tamanho}`}
        src={externo.url}
        width={largura}
        height={altura}
        alt={rotulo}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setExternoFalhou(true)}
      />
    );
  }

  const p = paletaDoCartaz(filme);
  const linhas = quebrarTitulo(filme.titulo);
  const base = 258;
  const y0 = base - (linhas.length - 1) * 26;
  const idGrad = `cartaz-grad-${filme.id}-${tamanho}`;
  return (
    <svg
      className={`cartaz cartaz-${tamanho}`}
      role="img"
      aria-label={rotulo}
      width={largura}
      height={altura}
      viewBox="0 0 200 300"
    >
      <defs>
        <linearGradient id={idGrad} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={p.c1} />
          <stop offset="1" stopColor={p.c2} />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#${idGrad})`} />
      <Padrao tipo={padraoDoCartaz(filme)} cor={p.texto} />
      <rect className="cartaz-moldura" x="9" y="9" width="182" height="282" rx="3" fill="none" stroke={p.texto} strokeOpacity="0.28" strokeWidth="1.5" />
      <text className="cartaz-titulo" lang="en" x="20" y={y0} fill={p.texto}>
        {linhas.map((l, i) => <tspan key={i} x="20" dy={i === 0 ? 0 : 26}>{l}</tspan>)}
      </text>
      {filme.ano ? (
        <>
          <line x1="20" y1={base + 12} x2="44" y2={base + 12} stroke={p.texto} strokeWidth="2" />
          <text className="cartaz-ano" x="52" y={base + 17} fill={p.texto}>{filme.ano}</text>
        </>
      ) : null}
    </svg>
  );
}
