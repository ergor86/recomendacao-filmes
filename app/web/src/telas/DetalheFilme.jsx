import { useEffect, useRef, useState } from 'react';
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
  const [tentativa, setTentativa] = useState(0);
  // guarda das recargas pós-escrita: `geracao` numera as recargas; trocar de filme/perfil, tentar de novo ou desmontar também a avança
  const geracao = useRef(0);

  // uma única carga, com a guarda `ativo`: trocar de filme, desmontar ou tentar de novo descarta a resposta velha
  useEffect(() => {
    let ativo = true;
    geracao.current += 1;
    setErro(null);
    setFilme(null);
    chamar('GET', `/api/filmes/${id}?perfilId=${perfilId}`)
      .then((f) => { if (ativo) setFilme(f); })
      .catch((e) => { if (ativo) setErro(e); });
    return () => { ativo = false; geracao.current += 1; };
  }, [id, perfilId, tentativa]);

  // "Neste computador" é calculado no servidor (a escrita não devolve estatísticas): recarrega o detalhe sem
  // piscar a tela e aplica só `computador`; falha, filme/perfil trocado ou recarga mais antiga: descarta em silêncio
  const recarregarComputador = (filmeId) => {
    const minha = ++geracao.current;
    chamar('GET', `/api/filmes/${filmeId}?perfilId=${perfilId}`)
      .then((novo) => {
        if (minha !== geracao.current || !novo?.estatisticas?.computador) return;
        setFilme((f) => (f && f.id === filmeId
          ? { ...f, estatisticas: { ...f.estatisticas, computador: novo.estatisticas.computador } }
          : f));
      })
      .catch(() => {});
  };

  // só aplica se o filme na tela ainda é o dono da escrita (PUT ou Desfazer tardio não vaza para outro filme)
  const aoMudar = (filmeId, estado) => {
    if (String(filmeId) !== String(id)) return;
    setFilme((f) => (f && f.id === filmeId
      ? { ...f, estadoPerfil: estado, estatisticas: { ...f.estatisticas, sua: estado } }
      : f));
    recarregarComputador(filmeId);
  };

  if (erro) {
    return (
      <section className="detalhe-filme">
        <Falha erro={erro} onTentar={erro.status === 404 ? undefined : () => setTentativa((n) => n + 1)} />
        <p><Link to="/catalogo">Voltar ao catálogo</Link></p>
      </section>
    );
  }
  if (!filme) return <Carregando rotulo="Carregando o filme" />;

  return (
    <article className="detalhe-filme">
      <p><Link to="/catalogo">Voltar ao catálogo</Link></p>
      <div className="detalhe-topo">
        <div className="detalhe-capa">
          <Cartaz filme={filme} midia={filme.midia} tamanho="grande" />
          <div className="prateleira-detalhe" aria-hidden="true" />
        </div>
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
          <ControleInteracao perfilId={perfilId} filme={filme} estado={filme.estadoPerfil} aoMudar={(e) => aoMudar(filme.id, e)} />
        </div>
      </div>
      <PainelEstatisticas estatisticas={filme.estatisticas} temGemeoOculto={filme.temGemeoOculto} />
    </article>
  );
}
