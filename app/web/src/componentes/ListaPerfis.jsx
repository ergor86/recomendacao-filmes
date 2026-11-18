import { useCallback, useEffect, useState } from 'react';
import { chamar } from '../api.js';
import { Carregando, Falha } from './Estados.jsx';

/** Carrega GET /api/perfis. Devolve { perfis, erro, carregando, recarregar }. */
export function usePerfis() {
  const [estado, setEstado] = useState({ perfis: null, erro: null });
  const recarregar = useCallback(async () => {
    setEstado((e) => ({ ...e, erro: null }));
    try {
      setEstado({ perfis: await chamar('GET', '/api/perfis'), erro: null });
    } catch (erro) {
      setEstado({ perfis: null, erro });
    }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);
  return { ...estado, carregando: estado.perfis === null && estado.erro === null, recarregar };
}

export const totalAvaliacoes = (p) => p.contagens.notas + p.contagens.gostei + p.contagens.queroAssistir;

/** Confirmação de exclusão: o mesmo texto na TelaPerfis e na GestaoPerfisRestrita. */
export function ConfirmaExclusao({ perfil, ocupado, onConfirmar, onCancelar }) {
  return (
    <div className="confirmacao" role="group" aria-label={`Excluir o perfil ${perfil.nome}`}>
      <p>Apagar remove as avaliações deste perfil. Apagar o perfil {perfil.nome}?</p>
      <button type="button" className="perigo" disabled={ocupado} onClick={onConfirmar}>Apagar</button>
      <button type="button" disabled={ocupado} onClick={onCancelar}>Cancelar</button>
    </div>
  );
}

/** Cabeçalho comum de carregamento/erro das listas de perfis; devolve null quando há perfis. */
export function EstadoLista({ carregando, erro, recarregar }) {
  if (carregando) return <Carregando rotulo="Carregando perfis" />;
  if (erro) return <Falha erro={erro} onTentar={recarregar} />;
  return null;
}
