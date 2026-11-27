import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar } from '../api.js';
import BarraBusca from '../componentes/BarraBusca.jsx';
import CartaoFilme from '../componentes/CartaoFilme.jsx';
import ControleRapido from '../componentes/ControleRapido.jsx';
import { Carregando, Falha } from '../componentes/Estados.jsx';

const SUGERIDOS = 3; // só uma orientação: nenhum limiar de qualidade foi medido

function consulta(perfilId, filtros, cursor) {
  const p = new URLSearchParams();
  if (filtros.q) p.set('q', filtros.q);
  if (filtros.genero) p.set('genero', filtros.genero);
  if (cursor) p.set('cursor', cursor);
  const s = p.toString();
  return `/api/perfis/${perfilId}/onboarding${s ? `?${s}` : ''}`;
}

/** Grade curada para marcar filmes que a pessoa já viu e gostou. */
/** `aoConcluir` é a conclusão única do App (PATCH, navegação); `concluindo` e `erroConcluir` vêm dela. */
export default function Onboarding({ perfilId, aoConcluir, concluindo = false, erroConcluir = null }) {
  const [filtros, setFiltros] = useState({ q: '', genero: '' });
  const [pagina, setPagina] = useState({ itens: [], proximoCursor: null });
  const [fase, setFase] = useState('carregando');
  const [erro, setErro] = useState(null);
  const [marcados, setMarcados] = useState(0);
  const pedido = useRef(0);
  const pedidoContagem = useRef(0);

  const carregar = useCallback(async (f, cursor) => {
    const meu = ++pedido.current;
    setFase('carregando');
    try {
      const r = await chamar('GET', consulta(perfilId, f, cursor));
      if (meu !== pedido.current) return;
      setPagina({ itens: r.itens, proximoCursor: r.proximoCursor ?? null });
      setFase('ok');
    } catch (e) {
      if (meu !== pedido.current) return;
      setErro(e);
      setFase('erro');
    }
  }, [perfilId]);

  const recontar = useCallback(async () => {
    const meu = ++pedidoContagem.current;
    try {
      const perfil = (await chamar('GET', '/api/perfis')).find((p) => p.id === perfilId);
      if (meu !== pedidoContagem.current) return; // resposta velha não sobrescreve a mais nova
      if (perfil) setMarcados(perfil.contagens.curtidosComVetor);
    } catch { /* o contador só orienta: mantém o último valor */ }
  }, [perfilId]);

  useEffect(() => { carregar(filtros, null); }, [filtros, carregar]);
  useEffect(() => { recontar(); }, [recontar]);

  const atualizar = (id, estadoPerfil) => {
    setPagina((p) => ({ ...p, itens: p.itens.map((f) => (f.id === id ? { ...f, estadoPerfil } : f)) }));
    recontar();
  };

  const suficiente = marcados >= SUGERIDOS;
  const rotuloBotao = marcados === 0 ? 'Pular por enquanto' : 'Ver minhas recomendações';

  return (
    <section className="onboarding" aria-labelledby="titulo-onboarding">
      <h1 id="titulo-onboarding">Comece pelos filmes que você conhece</h1>
      <p>
        Marque filmes que você já viu e gostou. Cada um já muda as suas recomendações; sugerimos pelo menos 3, para que a lista
        não dependa de um filme só. O catálogo vai até 1998.
      </p>
      <BarraBusca valor={filtros} aoMudar={setFiltros} comOrdem={false} comSoInfluenciam={false} />
      {fase === 'carregando' && <Carregando rotulo="Carregando os filmes" />}
      {fase === 'erro' && <Falha erro={erro} onTentar={() => carregar(filtros, null)} />}
      {fase === 'ok' && pagina.itens.length === 0 && (
        <p className="vazio">Nada encontrado. O MovieLens 100K só tem filmes até 1998.</p>
      )}
      {fase === 'ok' && pagina.itens.length > 0 && (
        <ul className="grade-filmes">
          {pagina.itens.map((f) => (
            <li key={f.id}>
              <CartaoFilme filme={f}>
                <ControleRapido perfilId={perfilId} filme={f} estado={f.estadoPerfil} aoMudar={(e) => atualizar(f.id, e)} />
              </CartaoFilme>
            </li>
          ))}
        </ul>
      )}
      <div className="rodape-onboarding">
        {pagina.proximoCursor && (
          <button type="button" onClick={() => carregar(filtros, pagina.proximoCursor)}>Não reconheço nenhum: mostrar outros</button>
        )}
        {!suficiente && <p className="contador">{marcados} marcados · sugerimos pelo menos 3</p>}
        <button type="button" className={suficiente ? 'principal destaque' : 'principal'} disabled={concluindo} onClick={() => aoConcluir?.()}>
          {rotuloBotao}
        </button>
        {erroConcluir && <p className="erro-texto" role="alert">{erroConcluir.mensagem}</p>}
      </div>
    </section>
  );
}
