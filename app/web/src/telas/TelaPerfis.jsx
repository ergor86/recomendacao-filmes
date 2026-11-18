import { useState } from 'react';
import { chamar } from '../api.js';
import { ConfirmaExclusao, EstadoLista, usePerfis } from '../componentes/ListaPerfis.jsx';

/** "Quem está usando?": entrar, criar, ver o exemplo, renomear e excluir perfis. */
export default function TelaPerfis({ onEntrar }) {
  const { perfis, erro, carregando, recarregar } = usePerfis();
  const [apelido, setApelido] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const [renomeando, setRenomeando] = useState(null); // { id, nome }
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState(null);

  async function executar(acao) {
    setOcupado(true);
    setFalha(null);
    try {
      await acao();
    } catch (e) {
      setFalha(e.mensagem);
    } finally {
      setOcupado(false);
    }
  }

  const criar = (e) => {
    e.preventDefault();
    return executar(async () => onEntrar(await chamar('POST', '/api/perfis', { nome: apelido.trim() })));
  };
  const exemplo = () => executar(async () => onEntrar(await chamar('POST', '/api/perfis/exemplo')));
  const excluir = (p) => executar(async () => {
    await chamar('DELETE', `/api/perfis/${p.id}`);
    setConfirmando(null);
    await recarregar();
  });
  const renomear = (e) => {
    e.preventDefault();
    return executar(async () => {
      await chamar('PATCH', `/api/perfis/${renomeando.id}`, { nome: renomeando.nome.trim() });
      setRenomeando(null);
      await recarregar();
    });
  };

  return (
    <section className="perfis" aria-labelledby="titulo-perfis">
      <h1 id="titulo-perfis">Quem está usando?</h1>
      <p className="aviso-fixo">Os perfis ficam só neste computador e não têm senha.</p>
      <EstadoLista carregando={carregando} erro={erro} recarregar={recarregar} />
      {perfis && (
        <ul className="lista-perfis">
          {perfis.map((p) => (
            <li key={p.id}>
              <div className="perfil-linha">
                <button type="button" className="principal" onClick={() => onEntrar(p)}>{p.nome}</button>
                <button type="button" aria-label={`Renomear o perfil ${p.nome}`} onClick={() => setRenomeando({ id: p.id, nome: p.nome })}>Renomear</button>
                <button type="button" aria-label={`Excluir o perfil ${p.nome}`} onClick={() => setConfirmando(p.id)}>Excluir</button>
              </div>
              {renomeando?.id === p.id && (
                <form onSubmit={renomear} className="renomear">
                  <label>
                    Novo apelido
                    <input value={renomeando.nome} maxLength={40} onChange={(e) => setRenomeando({ ...renomeando, nome: e.target.value })} />
                  </label>
                  <button type="submit" disabled={ocupado || !renomeando.nome.trim()}>Salvar</button>
                  <button type="button" onClick={() => setRenomeando(null)}>Cancelar</button>
                </form>
              )}
              {confirmando === p.id && (
                <ConfirmaExclusao perfil={p} ocupado={ocupado} onConfirmar={() => excluir(p)} onCancelar={() => setConfirmando(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={criar} className="novo-perfil">
        <label>
          Apelido
          <input value={apelido} maxLength={40} autoComplete="off" onChange={(e) => setApelido(e.target.value)} />
        </label>
        <button type="submit" disabled={ocupado || !apelido.trim()}>Criar perfil</button>
      </form>
      <button type="button" disabled={ocupado} onClick={exemplo}>Ver um exemplo</button>
      {falha && <p role="alert" className="erro-texto">{falha}</p>}
    </section>
  );
}
