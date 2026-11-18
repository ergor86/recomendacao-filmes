import { useState } from 'react';
import { chamar } from '../api.js';
import { ConfirmaExclusao, EstadoLista, totalAvaliacoes, usePerfis } from '../componentes/ListaPerfis.jsx';

/** Gestão restrita (fora do estado operante): lista os perfis e permite só excluir. */
export default function GestaoPerfisRestrita({ onVoltar }) {
  const { perfis, erro, carregando, recarregar } = usePerfis();
  const [confirmando, setConfirmando] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState(null);

  async function excluir(perfil) {
    setOcupado(true);
    setFalha(null);
    try {
      await chamar('DELETE', `/api/perfis/${perfil.id}`);
      setConfirmando(null);
      await recarregar();
    } catch (e) {
      setFalha(e.mensagem);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="gestao" aria-labelledby="titulo-gestao">
      <h1 id="titulo-gestao">Apagar perfis e avaliações</h1>
      <EstadoLista carregando={carregando} erro={erro} recarregar={recarregar} />
      {perfis && perfis.length === 0 && <p>Não há perfis neste computador.</p>}
      {perfis && perfis.length > 0 && (
        <ul className="lista-perfis">
          {perfis.map((p) => (
            <li key={p.id}>
              <div className="perfil-linha">
                <span className="perfil-nome">{p.nome}</span>
                <span className="perfil-info">{totalAvaliacoes(p)} marcações</span>
                <button type="button" aria-label={`Excluir o perfil ${p.nome}`} onClick={() => setConfirmando(p.id)}>Excluir</button>
              </div>
              {confirmando === p.id && (
                <ConfirmaExclusao perfil={p} ocupado={ocupado} onConfirmar={() => excluir(p)} onCancelar={() => setConfirmando(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {falha && <p role="alert" className="erro-texto">{falha}</p>}
      <button type="button" onClick={onVoltar}>Voltar</button>
    </section>
  );
}
