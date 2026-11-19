import { ProvedorAviso } from './AvisoAcao.jsx';

/** Cabeçalho (perfil ativo), conteúdo, rodapé e a única região aria-live (AvisoAcao). */
export default function Moldura({ perfil, onTrocarPerfil, children }) {
  return (
    <ProvedorAviso>
      <div className="moldura">
        <header className="moldura-topo">
          <strong className="moldura-nome">Minha Prateleira</strong>
          {perfil && (
            <div className="moldura-perfil">
              <span>Perfil: {perfil.nome ?? '…'}</span>
              <button type="button" onClick={onTrocarPerfil}>Trocar de perfil</button>
            </div>
          )}
        </header>
        <main className="moldura-conteudo">{children}</main>
        <footer className="moldura-rodape">
          Projeto acadêmico · dados MovieLens 100K (GroupLens) · Sobre
        </footer>
      </div>
    </ProvedorAviso>
  );
}
