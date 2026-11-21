import { useEffect, useRef, useState } from 'react';
import { Estrelas, useInteracao } from './ControleInteracao.jsx';

/** Controle do cartão: "Gostei" (aria-pressed) e um menu "…" com "Quero assistir" e "Dar nota". */
export default function ControleRapido({ perfilId, filme, estado, aoMudar, enviar }) {
  const { aplicar, alternar, clicarEstrela } = useInteracao({ perfilId, filme, estado, aoMudar, enviar });
  const [aberto, setAberto] = useState(false);
  const [comNota, setComNota] = useState(false);
  const gatilho = useRef(null);
  const raiz = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const fechar = () => { setAberto(false); setComNota(false); gatilho.current?.focus(); };
  const aoTeclar = (e) => { if (e.key === 'Escape' && aberto) { e.stopPropagation(); fechar(); } };
  const descricao = `titulo-filme-${filme.id}`;

  return (
    <div className="controle-rapido" ref={raiz} onKeyDown={aoTeclar}>
      <button
        type="button"
        className="gostei"
        aria-pressed={estado?.tipo === 'gostei'}
        aria-describedby={descricao}
        onClick={() => alternar('gostei')}
      >
        Gostei
      </button>
      <button
        type="button"
        ref={gatilho}
        className="mais-acoes"
        aria-label={`Mais ações para ${filme.titulo}`}
        aria-haspopup="true"
        aria-expanded={aberto}
        onClick={() => { setAberto((a) => !a); setComNota(false); }}
      >
        <span aria-hidden="true">…</span>
      </button>
      {aberto && (
        <div className="menu-rapido">
          <button
            type="button"
            aria-pressed={estado?.tipo === 'quero_assistir'}
            onClick={() => { alternar('quero_assistir'); fechar(); }}
          >
            Quero assistir
          </button>
          <button type="button" aria-expanded={comNota} onClick={() => setComNota((v) => !v)}>Dar nota</button>
          {comNota && (
            <Estrelas
              valor={estado?.tipo === 'nota' ? estado.nota : null}
              aoEscolher={(n) => aplicar({ tipo: 'nota', nota: n })}
              aoClicar={clicarEstrela}
            />
          )}
        </div>
      )}
    </div>
  );
}
