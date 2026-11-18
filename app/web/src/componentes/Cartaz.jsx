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
  action: 8, adventure: 28, animation: 48, "children's": 70, comedy: 45, crime: 345, documentary: 170,
  drama: 265, fantasy: 290, 'film-noir': 220, horror: 355, musical: 320, mystery: 250, romance: 330,
  'sci-fi': 195, thriller: 235, war: 100, western: 25, unknown: 210,
};

export function matizBase(generos) {
  const g = generos?.[0];
  if (!g) return FAMILIAS.unknown;
  const n = String(g).toLowerCase().trim();
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
const ESCURO = [17, 17, 17];

/** Cores do cartaz, e o texto (claro ou escuro) com o pior contraste, entre os dois extremos do gradiente, ≥ 4,5. */
export function paletaDoCartaz(filme) {
  const h = hashFnv1a(String(filme.id));
  const matiz = (matizBase(filme.generos) + (h % 41) - 20 + 360) % 360;
  const matiz2 = (matiz + 24 + ((h >>> 8) % 20)) % 360;
  let luz1 = 0.34 + ((h >>> 16) % 8) / 100;
  let luz2 = luz1 - 0.12;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const c1 = hslParaRgb(matiz, 0.58, luz1);
    const c2 = hslParaRgb(matiz2, 0.62, luz2);
    const comTexto = [CLARO, ESCURO].map((texto) => ({
      texto,
      contraste: Math.min(contrasteWcag(texto, c1), contrasteWcag(texto, c2)),
    }));
    const melhor = comTexto.sort((x, y) => y.contraste - x.contraste)[0];
    if (melhor.contraste >= 4.5) {
      return { matiz, matiz2, c1: hex(c1), c2: hex(c2), texto: hex(melhor.texto), contraste: melhor.contraste, h };
    }
    luz1 = Math.max(0.05, luz1 - 0.03);
    luz2 = Math.max(0.03, luz2 - 0.03);
  }
  // inalcançável na prática: tons muito escuros sempre passam com texto claro
  const c1 = hslParaRgb(matiz, 0.5, 0.1);
  const c2 = hslParaRgb(matiz2, 0.5, 0.05);
  return { matiz, matiz2, c1: hex(c1), c2: hex(c2), texto: '#ffffff', contraste: Math.min(contrasteWcag(CLARO, c1), contrasteWcag(CLARO, c2)), h };
}

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
  const traco = { stroke: cor, strokeOpacity: 0.16, strokeWidth: 2, fill: 'none' };
  if (tipo === 0) {
    return <g>{[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={-20 + i * 50} y1="0" x2={80 + i * 50} y2="165" {...traco} />)}</g>;
  }
  if (tipo === 1) {
    return <g>{[0, 1, 2].map((i) => <circle key={i} cx="100" cy="82" r={22 + i * 28} {...traco} />)}</g>;
  }
  return (
    <g>
      {[0, 1, 2, 3].flatMap((x) => [0, 1, 2].map((y) => (
        <rect key={`${x}-${y}`} x={14 + x * 48} y={14 + y * 50} width="30" height="30" rx="4" {...traco} />
      )))}
    </g>
  );
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
  const idGrad = `cartaz-grad-${filme.id}`;
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
        <linearGradient id={idGrad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.c1} />
          <stop offset="1" stopColor={p.c2} />
        </linearGradient>
      </defs>
      <rect width="200" height="300" rx="12" fill={`url(#${idGrad})`} />
      <Padrao tipo={p.h % 3} cor={p.texto} />
      <text className="cartaz-titulo" lang="en" x="14" y="196" fill={p.texto} fontSize="21" fontWeight="700" fontFamily="system-ui, sans-serif">
        {linhas.map((l, i) => <tspan key={i} x="14" dy={i === 0 ? 0 : 26}>{l}</tspan>)}
      </text>
      {filme.ano ? <text x="14" y="282" fill={p.texto} fontSize="15" fontFamily="system-ui, sans-serif">{filme.ano}</text> : null}
    </svg>
  );
}
