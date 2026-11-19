import { useRef } from 'react';
import { Carregando, Falha } from '../componentes/Estados.jsx';
import ExplicacaoMotivo from '../componentes/ExplicacaoMotivo.jsx';
import ListaRecomendacoes from '../componentes/ListaRecomendacoes.jsx';
import { useTop10 } from '../useTop10.js';

/** Top 10: "Baseado em", a lista numerada que se atualiza sozinha e a explicação do motivo. */
export default function Top10({ perfilId }) {
  const { lista, carregando, atualizando, erro, erroAtualizar, saindo, ehNovo, marcar, recarregar, tentarAtualizar } = useTop10(perfilId);
  const titulo = useRef(null);
  const base = lista?.perfil?.baseadoEm ?? [];

  return (
    <section className="top10" aria-labelledby="titulo-top10">
      <h1 id="titulo-top10" ref={titulo} tabIndex={-1}>Top 10</h1>
      {carregando && <Carregando rotulo="Carregando as recomendações" />}
      {!carregando && erro && <Falha erro={erro} onTentar={recarregar} />}
      {lista && (
        <>
          {base.length > 0 && (
            <p className="baseado-em">
              Baseado em:{' '}
              {base.map((b, i) => (
                <span key={b.id}>{i > 0 ? ', ' : ''}<em lang="en">{b.titulo}</em></span>
              ))}
            </p>
          )}
          <p className="contagem-curtidos">
            {`${lista.perfil.curtidosComVetor} dos seus ${lista.perfil.curtidos} filmes curtidos estão sendo usados`}
          </p>
          {erroAtualizar && (
            <div className="faixa-erro">
              <span>Não consegui atualizar as recomendações ·</span>{' '}
              <button type="button" onClick={tentarAtualizar}>Tentar de novo</button>
            </div>
          )}
          {atualizando && <p className="indicador-atualizando">Atualizando…</p>}
          {lista.itens.length === 0 && <p className="vazio">Nenhuma recomendação por enquanto.</p>}
          <ListaRecomendacoes
            perfilId={perfilId}
            itens={lista.itens}
            atualizando={atualizando}
            saindo={saindo}
            ehNovo={ehNovo}
            marcar={marcar}
            fallbackFocoRef={titulo}
          />
          <ExplicacaoMotivo motivo={lista.motivo} />
        </>
      )}
    </section>
  );
}
