import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { chamar } from '../api.js';
import Cartaz from '../componentes/Cartaz.jsx';
import ControleInteracao from '../componentes/ControleInteracao.jsx';
import { Carregando, Falha } from '../componentes/Estados.jsx';
import PainelEstatisticas from '../componentes/PainelEstatisticas.jsx';
import { rotuloGenero } from '../generos.js';

/** Detalhe de um filme: cartaz grande, dados, controles de interação e estatísticas. */
export default function DetalheFilme({ perfilId }) {
  const { id } = useParams();
  const [filme, setFilme] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setFilme(null);
    try {
      setFilme(await chamar('GET', `/api/filmes/${id}?perfilId=${perfilId}`));
    } catch (e) {
      setErro(e);
    }
  }, [id, perfilId]);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    setFilme(null);
    chamar('GET', `/api/filmes/${id}?perfilId=${perfilId}`)
      .then((f) => { if (ativo) setFilme(f); })
      .catch((e) => { if (ativo) setErro(e); });
    return () => { ativo = false; };
  }, [id, perfilId]);

  const aoMudar = (estado) => setFilme((f) => ({
    ...f,
    estadoPerfil: estado,
    estatisticas: { ...f.estatisticas, sua: estado },
  }));

  if (erro) {
    return (
      <section className="detalhe-filme">
        <Falha erro={erro} onTentar={erro.status === 404 ? undefined : carregar} />
        <p><Link to="/catalogo">Voltar ao catálogo</Link></p>
      </section>
    );
  }
  if (!filme) return <Carregando rotulo="Carregando o filme" />;

  return (
    <article className="detalhe-filme">
      <p><Link to="/catalogo">Voltar ao catálogo</Link></p>
      <div className="detalhe-topo">
        <Cartaz filme={filme} midia={filme.midia} tamanho="grande" />
        <div className="detalhe-dados">
          <h1 lang="en">{filme.titulo}</h1>
          {filme.tituloOriginal && filme.tituloOriginal !== filme.titulo && (
            <p className="titulo-original" lang="en">{filme.tituloOriginal}</p>
          )}
          <p className="detalhe-meta">
            {filme.ano ? <span className="detalhe-ano">{filme.ano}</span> : null}
            {filme.generos?.length ? <span className="detalhe-generos">{filme.generos.map(rotuloGenero).join(' · ')}</span> : null}
          </p>
          {!filme.temVetor && (
            <p className="selo selo-sem-vetor" title="Este filme é raro nos dados de 1998: curtir não muda as suas recomendações.">
              curtir não personaliza
            </p>
          )}
          <ControleInteracao perfilId={perfilId} filme={filme} estado={filme.estadoPerfil} aoMudar={aoMudar} />
        </div>
      </div>
      <PainelEstatisticas estatisticas={filme.estatisticas} temGemeoOculto={filme.temGemeoOculto} />
    </article>
  );
}
