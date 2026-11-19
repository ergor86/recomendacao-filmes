import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DURACAO_MS = 6000;
const contexto = createContext({ mostrar: () => {}, anunciar: () => {} });

/** Contexto com mostrar({ texto, desfazer? }); sem provedor, mostrar não faz nada. */
export const useAviso = () => useContext(contexto);

/** Monta a única região aria-live da aplicação e a expõe aos filhos por useAviso(). */
export function ProvedorAviso({ children }) {
  const [aviso, setAviso] = useState(null);
  const [anuncio, setAnuncio] = useState(null);
  const temporizador = useRef(null);
  const temporizadorAnuncio = useRef(null);

  const limpar = useCallback(() => {
    clearTimeout(temporizador.current);
    temporizador.current = null;
    setAviso(null);
  }, []);

  const mostrar = useCallback(({ texto, desfazer }) => {
    clearTimeout(temporizador.current);
    setAviso({ texto, desfazer });
    temporizador.current = setTimeout(limpar, DURACAO_MS);
  }, [limpar]);

  // anúncio extra na mesma região: não substitui o aviso (nem o seu "Desfazer") e não reinicia o seu tempo
  const anunciar = useCallback((texto) => {
    clearTimeout(temporizadorAnuncio.current);
    setAnuncio(texto);
    temporizadorAnuncio.current = setTimeout(() => setAnuncio(null), DURACAO_MS);
  }, []);

  useEffect(() => () => { clearTimeout(temporizador.current); clearTimeout(temporizadorAnuncio.current); }, []);
  const valor = useMemo(() => ({ mostrar, anunciar }), [mostrar, anunciar]);

  const aoDesfazer = () => {
    const f = aviso?.desfazer;
    limpar();
    if (f) f();
  };

  return (
    <contexto.Provider value={valor}>
      {children}
      <div className="aviso-acao" aria-live="polite" role="status">
        {aviso && <span>{aviso.texto}</span>}
        {anuncio && <span className="anuncio">{anuncio}</span>}
        {aviso?.desfazer && <button type="button" onClick={aoDesfazer}>Desfazer</button>}
      </div>
    </contexto.Provider>
  );
}
