import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Monograma from './Monograma.jsx';
import SeletorTema from './SeletorTema.jsx';
import { ProvedorAviso } from './AvisoAcao.jsx';

const ITENS = [
  { para: '/', rotulo: 'Top 10', fim: true },
  { para: '/catalogo', rotulo: 'Catálogo' },
  { para: '/minha-lista', rotulo: 'Minha lista' },
  { para: '/minhas-avaliacoes', rotulo: 'Minhas avaliações' },
  { para: '/sobre', rotulo: 'Sobre' },
];

/** Cabeçalho (perfil ativo e navegação, que vira menu em telas estreitas), conteúdo, rodapé e a única região aria-live. */
export default function Moldura({ perfil, onTrocarPerfil, onInicio, children }) {
  const [menuAberto, setMenuAberto] = useState(false);
  // clique normal em "Top 10"/logo com os primeiros filmes por concluir: conclui (o link continua um link de verdade)
  const aoIrParaInicio = (e) => {
    setMenuAberto(false);
    if (!onInicio || !perfil || perfil.onboardingConcluido === true) return; // undefined: perfil ainda carregando, vale como não concluído (o PATCH é idempotente)
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onInicio();
  };
  return (
    <ProvedorAviso>
      <div className="moldura">
        <header className="moldura-topo">
          <Link to="/" className="moldura-nome" onClick={aoIrParaInicio}>
            <svg className="marca-icone" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
              <rect x="3" y="5" width="6" height="18" rx="1" fill="currentColor" />
              <rect x="11" y="3" width="6" height="20" rx="1" fill="currentColor" opacity=".55" />
              <rect x="19" y="7" width="7" height="16" rx="1" fill="currentColor" opacity=".8" transform="rotate(8 22 15)" />
              <rect x="1" y="24" width="28" height="4" rx="1" fill="currentColor" />
            </svg>
            <span>Minha Prateleira</span>
          </Link>
          {perfil && (
            <>
              <button
                type="button"
                className="menu-botao"
                aria-expanded={menuAberto}
                aria-controls="menu-painel"
                onClick={() => setMenuAberto((a) => !a)}
              >
                <Monograma perfil={perfil} />
                Menu
              </button>
              <div id="menu-painel" className={menuAberto ? 'menu-painel aberta' : 'menu-painel'}>
                <nav id="navegacao-principal" className="navegacao" aria-label="Principal">
                  {ITENS.map((i) => (
                    <NavLink key={i.para} to={i.para} end={i.fim} onClick={i.para === '/' ? aoIrParaInicio : () => setMenuAberto(false)}>{i.rotulo}</NavLink>
                  ))}
                </nav>
                <div className="moldura-perfil">
                  <Monograma perfil={perfil} />
                  <span>Perfil: {perfil.nome ?? '…'}</span>
                  <button type="button" onClick={onTrocarPerfil}>Trocar de perfil</button>
                </div>
              </div>
            </>
          )}
          <SeletorTema />
        </header>
        <main className="moldura-conteudo">{children}</main>
        <footer className="moldura-rodape">
          Projeto acadêmico · dados MovieLens 100K (GroupLens) · <Link to="/sobre">Sobre</Link>
        </footer>
      </div>
    </ProvedorAviso>
  );
}
