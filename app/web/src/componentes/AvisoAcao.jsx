import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DURACAO_MS = 6000;
const contexto = createContext({ mostrar: () => {} });

/** Contexto com mostrar({ texto, desfazer? }); sem provedor, mostrar não faz nada. */
export const useAviso = () => useContext(contexto);

/** Monta a única região aria-live da aplicação e a expõe aos filhos por useAviso(). */
export function ProvedorAviso({ children }) {
  const [aviso, setAviso] = useState(null);
  const temporizador = useRef(null);

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

  useEffect(() => () => clearTimeout(temporizador.current), []);
  const valor = useMemo(() => ({ mostrar }), [mostrar]);

  const aoDesfazer = () => {
    const f = aviso?.desfazer;
    limpar();
    if (f) f();
  };

  return (
    <contexto.Provider value={valor}>
      {children}
      <div className="aviso-acao" aria-live="polite" role="status">
        {aviso && (
          <>
            <span>{aviso.texto}</span>
            {aviso.desfazer && <button type="button" onClick={aoDesfazer}>Desfazer</button>}
          </>
        )}
      </div>
    </contexto.Provider>
  );
}
