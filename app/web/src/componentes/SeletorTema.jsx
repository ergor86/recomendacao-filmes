import { useEffect, useState } from 'react';
import { lerTema, aplicarTema, salvarTema, CHAVE_TEMA } from '../tema.js';

const ORDEM = ['auto', 'claro', 'escuro'];
const NOMES = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };

function Icone({ tema }) {
  return (
    <svg className="botao-tema-icone" data-icone={tema} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      {tema === 'auto' && (
        <>
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
        </>
      )}
      {tema === 'claro' && (
        <>
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </>
      )}
      {tema === 'escuro' && <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />}
    </svg>
  );
}

/** Botão de tema: cada clique avança Automático, Claro, Escuro e volta. A escolha fica só neste navegador. */
export default function SeletorTema() {
  const [tema, setTema] = useState(lerTema);
  // outras abas abertas: seguem a mudança (estado do botão e data-tema)
  useEffect(() => {
    const aoMudar = (e) => {
      if (e.key !== null && e.key !== CHAVE_TEMA) return;
      const novo = lerTema();
      setTema(novo);
      aplicarTema(novo);
    };
    window.addEventListener('storage', aoMudar);
    return () => window.removeEventListener('storage', aoMudar);
  }, []);
  const alternar = () => {
    const novo = ORDEM[(ORDEM.indexOf(tema) + 1) % ORDEM.length];
    setTema(novo);
    aplicarTema(novo);
    salvarTema(novo);
  };
  const nome = `Tema: ${NOMES[tema]}`;
  return (
    <button type="button" className="botao-tema" aria-label={nome} title={nome} onClick={alternar}>
      <Icone tema={tema} />
    </button>
  );
}
