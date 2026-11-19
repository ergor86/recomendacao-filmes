import { useEffect, useRef, useState } from 'react';
import { chamar } from '../api.js';

const ORDENS = [
  ['mais_avaliados', 'Mais avaliados'],
  ['mais_bem_avaliados', 'Mais bem avaliados'],
  ['titulo', 'Título'],
  ['ano', 'Ano (mais recentes)'],
];
const ESPERA_MS = 300;

/**
 * Busca por título, gênero e (opcional) ordem e "Só filmes que ajudam a recomendar".
 * `valor` = { q, genero, ordem, soInfluenciam }; `aoMudar` recebe o valor novo inteiro.
 */
export default function BarraBusca({ valor, aoMudar, comOrdem = true, comSoInfluenciam = true }) {
  const [generos, setGeneros] = useState([]);
  const [texto, setTexto] = useState(valor.q ?? '');
  const ultimo = useRef(valor);
  ultimo.current = valor;

  useEffect(() => {
    let ativo = true;
    chamar('GET', '/api/generos').then((g) => { if (ativo) setGeneros(g); }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  // o texto só vai para a consulta depois de uma pausa na digitação
  useEffect(() => {
    if (texto === (ultimo.current.q ?? '')) return undefined;
    const t = setTimeout(() => aoMudar({ ...ultimo.current, q: texto }), ESPERA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const mudar = (parte) => aoMudar({ ...valor, ...parte });

  return (
    <form className="barra-busca" role="search" onSubmit={(e) => { e.preventDefault(); aoMudar({ ...valor, q: texto }); }}>
      <label>
        Buscar por título
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <label>
        Gênero
        <select value={valor.genero ?? ''} onChange={(e) => mudar({ genero: e.target.value })}>
          <option value="">Todos os gêneros</option>
          {generos.map((g) => <option key={g.id} value={g.id}>{g.rotulo}</option>)}
        </select>
      </label>
      {comOrdem && (
        <label>
          Ordem
          <select value={valor.ordem ?? 'mais_avaliados'} onChange={(e) => mudar({ ordem: e.target.value })}>
            {ORDENS.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
          </select>
        </label>
      )}
      {comSoInfluenciam && (
        <label className="rotulo-linha">
          <input type="checkbox" checked={Boolean(valor.soInfluenciam)} onChange={(e) => mudar({ soInfluenciam: e.target.checked })} />
          Só filmes que ajudam a recomendar
        </label>
      )}
    </form>
  );
}
