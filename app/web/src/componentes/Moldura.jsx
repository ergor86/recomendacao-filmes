import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ProvedorAviso } from './AvisoAcao.jsx';

const ITENS = [
  { para: '/', rotulo: 'Top 10', fim: true },
  { para: '/catalogo', rotulo: 'Catálogo' },
  { para: '/minha-lista', rotulo: 'Minha lista' },
  { para: '/minhas-avaliacoes', rotulo: 'Minhas avaliações' },
  { para: '/sobre', rotulo: 'Sobre' },
];

/** Cabeçalho (perfil ativo e navegação, que vira menu em telas estreitas), conteúdo, rodapé e a única região aria-live. */
export default function Moldura({ perfil, onTrocarPerfil, children }) {
  const [menuAberto, setMenuAberto] = useState(false);
  return (
    <ProvedorAviso>
      <div className="moldura">
        <header className="moldura-topo">
          <Link to="/" className="moldura-nome" onClick={() => setMenuAberto(false)}>Minha Prateleira</Link>
          {perfil && (
            <>
              <button
                type="button"
                className="menu-botao"
                aria-expanded={menuAberto}
                aria-controls="navegacao-principal"
                onClick={() => setMenuAberto((a) => !a)}
              >
                Menu
              </button>
              <nav
                id="navegacao-principal"
                className={menuAberto ? 'navegacao aberta' : 'navegacao'}
                aria-label="Principal"
              >
                {ITENS.map((i) => (
                  <NavLink key={i.para} to={i.para} end={i.fim} onClick={() => setMenuAberto(false)}>{i.rotulo}</NavLink>
                ))}
              </nav>
              <div className="moldura-perfil">
                <span>Perfil: {perfil.nome ?? '…'}</span>
                <button type="button" onClick={onTrocarPerfil}>Trocar de perfil</button>
              </div>
            </>
          )}
        </header>
        <main className="moldura-conteudo">{children}</main>
        <footer className="moldura-rodape">
          Projeto acadêmico · dados MovieLens 100K (GroupLens) · <Link to="/sobre">Sobre</Link>
        </footer>
      </div>
    </ProvedorAviso>
  );
}
