import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar } from '../api.js';
import BarraBusca from '../componentes/BarraBusca.jsx';
import CartaoFilme from '../componentes/CartaoFilme.jsx';
import ControleRapido from '../componentes/ControleRapido.jsx';
import { Carregando, Falha } from '../componentes/Estados.jsx';

const FILTROS_INICIAIS = { q: '', genero: '', ordem: 'mais_avaliados', soInfluenciam: false };

function consulta(filtros, pagina, perfilId) {
  const p = new URLSearchParams();
  if (filtros.q) p.set('q', filtros.q);
  if (filtros.genero) p.set('genero', filtros.genero);
  p.set('ordem', filtros.ordem);
  p.set('pagina', String(pagina));
  if (perfilId) p.set('perfilId', perfilId);
  if (filtros.soInfluenciam) p.set('soInfluenciam', 'true');
  return `/api/filmes?${p.toString()}`;
}

/** Catálogo: busca, grade de cartões com o controle rápido e "Carregar mais". */
export default function Catalogo({ perfilId }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [lista, setLista] = useState({ itens: [], total: 0, pagina: 0 });
  const [fase, setFase] = useState('carregando'); // carregando | ok | erro
  const [erro, setErro] = useState(null);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [erroMais, setErroMais] = useState(null);
  const pedido = useRef(0);

  const carregar = useCallback(async (f, pagina) => {
    const meu = ++pedido.current;
    try {
      const r = await chamar('GET', consulta(f, pagina, perfilId));
      if (meu !== pedido.current) return;
      setLista((atual) => ({
        itens: pagina === 1 ? r.itens : [...atual.itens, ...r.itens],
        total: r.total,
        pagina: r.pagina,
      }));
      setErroMais(null);
      setFase('ok');
    } catch (e) {
      if (meu !== pedido.current) return;
      // falha em "Carregar mais" mantém a grade já carregada
      if (pagina > 1) { setErroMais(e); return; }
      setErro(e);
      setFase('erro');
    } finally {
      if (meu === pedido.current) setMaisCarregando(false);
    }
  }, [perfilId]);

  useEffect(() => {
    setFase('carregando');
    carregar(filtros, 1);
  }, [filtros, carregar]);

  const maisUm = () => { setMaisCarregando(true); setErroMais(null); carregar(filtros, lista.pagina + 1); };
  const atualizar = (id, estadoPerfil) => setLista((l) => ({
    ...l,
    itens: l.itens.map((f) => (f.id === id ? { ...f, estadoPerfil } : f)),
  }));

  return (
    <section className="catalogo" aria-labelledby="titulo-catalogo">
      <h1 id="titulo-catalogo">Catálogo</h1>
      <BarraBusca valor={filtros} aoMudar={setFiltros} />
      {fase === 'carregando' && <Carregando rotulo="Carregando o catálogo" />}
      {fase === 'erro' && <Falha erro={erro} onTentar={() => { setFase('carregando'); carregar(filtros, 1); }} />}
      {fase === 'ok' && lista.itens.length === 0 && (
        <p className="vazio">Nada encontrado. O MovieLens 100K só tem filmes até 1998.</p>
      )}
      {fase === 'ok' && lista.itens.length > 0 && (
        <>
          <ul className="grade-filmes">
            {lista.itens.map((f) => (
              <li key={f.id}>
                <CartaoFilme filme={f}>
                  <ControleRapido perfilId={perfilId} filme={f} estado={f.estadoPerfil} aoMudar={(e) => atualizar(f.id, e)} />
                </CartaoFilme>
              </li>
            ))}
          </ul>
          {erroMais && <Falha erro={erroMais} onTentar={maisUm} />}
          {!erroMais && lista.itens.length < lista.total && (
            <button type="button" className="carregar-mais" disabled={maisCarregando} onClick={maisUm}>Carregar mais</button>
          )}
        </>
      )}
    </section>
  );
}
