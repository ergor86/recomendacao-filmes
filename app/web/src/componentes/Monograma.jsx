import { useId } from 'react';
import { hashFnv1a, paletaDoCartaz } from './Cartaz.jsx';

// Só gêneros de tom escuro: a letra é sempre clara e a paleta do cartaz garante contraste ≥ 4,5 com os dois tons.
const FAMILIAS_ESCURAS = ['action', 'adventure', 'crime', 'documentary', 'drama', 'fantasy', 'horror', 'mystery', 'sci-fi', 'thriller', 'war'];

/** Cor do monograma, determinística pelo id do perfil (a mesma paleta dos cartazes). */
export function corDoMonograma(id) {
  const chave = String(id);
  const genero = FAMILIAS_ESCURAS[hashFnv1a(`monograma:${chave}`) % FAMILIAS_ESCURAS.length];
  return paletaDoCartaz({ id: `monograma:${chave}`, generos: [genero] });
}

/** Primeira letra ou número do apelido, em maiúscula; "?" se não houver. */
export function inicialDoApelido(nome) {
  const m = String(nome ?? '').match(/[\p{L}\p{N}]/u);
  return m ? m[0].toLocaleUpperCase('pt-BR') : '?';
}

/** Quadro colorido com a inicial do apelido. Decorativo: o nome do perfil vem sempre em texto ao lado. */
export default function Monograma({ perfil }) {
  const idGrad = `mono-${useId().replace(/:/g, '')}`;
  const c = corDoMonograma(perfil.id);
  return (
    <svg className="monograma" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={idGrad} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={c.c1} />
          <stop offset="1" stopColor={c.c2} />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="4" fill={`url(#${idGrad})`} />
      <rect y="36" width="44" height="8" fill="#000" opacity="0.32" />
      <text x="22" y="29" textAnchor="middle" fill={c.texto}>{inicialDoApelido(perfil.nome)}</text>
    </svg>
  );
}
