import { Link } from 'react-router-dom';
import Cartaz from './Cartaz.jsx';
import { rotuloGenero } from '../generos.js';

/** Cartão de filme: cartaz, título (em inglês), ano, gêneros, o selo sem vetor e os controles (children). */
export default function CartaoFilme({ filme, children }) {
  return (
    <article className="cartao-filme">
      <Link to={`/filmes/${filme.id}`} className="cartao-link">
        <span className="cartao-capa">
          <Cartaz filme={filme} midia={filme.midia} tamanho="medio" />
          {filme.estadoPerfil?.tipo === 'gostei' && <span className="carimbo-gostei" aria-hidden="true">Gostei</span>}
        </span>
        <span className="cartao-titulo" lang="en" id={`titulo-filme-${filme.id}`}>{filme.titulo}</span>
      </Link>
      <p className="cartao-meta">
        {filme.ano ? <span className="cartao-ano">{filme.ano}</span> : null}
        {filme.generos?.length ? <span className="cartao-generos">{filme.generos.map(rotuloGenero).join(' · ')}</span> : null}
      </p>
      {!filme.temVetor && (
        <p className="selo selo-sem-vetor" title="Este filme é raro nos dados de 1998: curtir não muda as suas recomendações.">
          curtir não personaliza
        </p>
      )}
      {children}
    </article>
  );
}
