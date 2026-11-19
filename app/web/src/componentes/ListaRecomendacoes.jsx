import { useLayoutEffect, useRef } from 'react';
import CartaoFilme from './CartaoFilme.jsx';
import ControleRapido from './ControleRapido.jsx';

const DURACAO_FLIP_MS = 300;
const DICA_POPULARES = 'Estes filmes completam a lista pelos mais avaliados do MovieLens 100K; não vêm da semelhança com os seus gostos.';

const reduzirMovimento = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function medir(raiz) {
  const mapa = new Map();
  for (const li of raiz.querySelectorAll('li[data-filme-id]')) {
    const r = li.getBoundingClientRect();
    mapa.set(li.dataset.filmeId, { li, left: r.left + window.scrollX, top: r.top + window.scrollY });
  }
  return mapa;
}

function Porque({ porque }) {
  if (!porque?.length) return null;
  return (
    <p className="porque">
      Porque você curtiu <em lang="en">{porque[0].titulo}</em>
      {porque[1] && <> e <em lang="en">{porque[1].titulo}</em></>}
    </p>
  );
}

/**
 * Lista numerada do Top 10. Os itens mantêm a chave (filme.id): ao trocar a lista, os que ficam deslizam até a
 * nova posição (FLIP, ≤ 300 ms, desligado com prefers-reduced-motion) e o foco nunca cai no body.
 */
export default function ListaRecomendacoes({ perfilId, itens, atualizando, saindo, ehNovo, marcar, fallbackFocoRef }) {
  const raiz = useRef(null);
  const foco = useRef(null); // id do item em que o foco estava
  const idsAnteriores = useRef([]);
  const posicoes = useRef(new Map());

  useLayoutEffect(() => {
    const ol = raiz.current;
    const ids = itens.map((i) => String(i.filme.id));
    if (!ol) { // lista vazia: o foco que estava num item vai para o título
      const ativo0 = document.activeElement;
      if (foco.current !== null && (!ativo0 || ativo0 === document.body || !ativo0.isConnected)) fallbackFocoRef?.current?.focus();
      foco.current = null;
      posicoes.current = new Map();
      idsAnteriores.current = ids;
      return;
    }

    // foco: se o item focado saiu e o foco caiu no body, vai para o item da mesma posição (ou o anterior, ou o título)
    const ativo = document.activeElement;
    if (foco.current !== null && !ids.includes(foco.current) && (!ativo || ativo === document.body || !ativo.isConnected)) {
      const indice = Math.max(0, idsAnteriores.current.indexOf(foco.current));
      if (ids.length) {
        const alvo = ol.querySelector(`li[data-filme-id="${ids[Math.min(indice, ids.length - 1)]}"]`);
        (alvo?.querySelector('a') ?? alvo)?.focus();
      } else {
        fallbackFocoRef?.current?.focus();
        foco.current = null;
      }
    } else if (ativo && ol.contains(ativo)) {
      foco.current = ativo.closest('li[data-filme-id]')?.dataset.filmeId ?? foco.current;
    }

    // FLIP: "primeiro" = posições do commit anterior; "último" = agora
    const agora = medir(ol);
    if (!reduzirMovimento()) {
      for (const [id, { li, left, top }] of agora) {
        const antes = posicoes.current.get(id);
        if (!antes || typeof li.animate !== 'function') continue;
        const dx = antes.left - left;
        const dy = antes.top - top;
        if (dx === 0 && dy === 0) continue;
        li.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
          { duration: DURACAO_FLIP_MS, easing: 'ease-out' },
        );
      }
    }
    posicoes.current = agora;
    idsAnteriores.current = ids;
  }, [itens, fallbackFocoRef]);

  const aoFocar = (e) => {
    foco.current = e.target.closest('li[data-filme-id]')?.dataset.filmeId ?? null;
  };
  const aoDesfocar = (e) => {
    if (e.relatedTarget && !raiz.current?.contains(e.relatedTarget)) foco.current = null;
  };

  if (itens.length === 0) return null;
  return (
    <ol className="lista-recomendacoes" role="list" ref={raiz} aria-busy={atualizando ? 'true' : 'false'} onFocus={aoFocar} onBlur={aoDesfocar}>
      {itens.map((item) => {
        const f = item.filme;
        const novo = ehNovo(f.id);
        const classes = ['item-recomendacao', saindo.has(f.id) && 'item-saindo', novo && 'item-novo'].filter(Boolean).join(' ');
        return (
          <li key={f.id} className={classes} data-filme-id={f.id}>
            <CartaoFilme filme={f}>
              {novo && <p className="selo selo-novo">Novo</p>}
              {item.fonte === 'populares'
                ? <p className="selo selo-populares" title={DICA_POPULARES}>Mais avaliados nos dados de 1998</p>
                : <Porque porque={item.porque} />}
              <ControleRapido
                perfilId={perfilId}
                filme={f}
                estado={null}
                aoMudar={() => {}}
                enviar={(novoEstado) => marcar(f.id, novoEstado)}
              />
            </CartaoFilme>
          </li>
        );
      })}
    </ol>
  );
}
