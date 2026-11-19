import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar } from '../api.js';
import CartaoFilme from './CartaoFilme.jsx';
import { Estrelas, useInteracao } from './ControleInteracao.jsx';
import { Carregando, Falha } from './Estados.jsx';

function Item({ perfilId, filme, modo, aoMudar }) {
  const estado = filme.estadoPerfil;
  const { aplicar, alternar, clicarEstrela } = useInteracao({ perfilId, filme, estado, aoMudar });
  const [avaliando, setAvaliando] = useState(false);

  if (modo === 'lista') {
    return (
      <div className="acoes-lista">
        <button type="button" aria-expanded={avaliando} onClick={() => setAvaliando((v) => !v)}>Já assisti: avaliar</button>
        <button type="button" onClick={() => aplicar(null)}>Remover da lista</button>
        {avaliando && (
          <Estrelas valor={null} aoEscolher={(n) => aplicar({ tipo: 'nota', nota: n })} aoClicar={clicarEstrela} />
        )}
      </div>
    );
  }
  return (
    <div className="acoes-lista">
      <Estrelas
        valor={estado?.tipo === 'nota' ? estado.nota : null}
        aoEscolher={(n) => aplicar({ tipo: 'nota', nota: n })}
        aoClicar={clicarEstrela}
      />
      <button type="button" aria-pressed={estado?.tipo === 'gostei'} onClick={() => alternar('gostei')}>Gostei</button>
      <button type="button" onClick={() => aplicar(null)}>Remover</button>
    </div>
  );
}

/**
 * Lista paginada das interações do perfil (`tipos` separados por vírgula), com "Carregar mais".
 * Um filme sai da lista quando o seu estado deixa de ser de um dos tipos pedidos (e volta pelo "Desfazer").
 */
export default function ListaInteracoes({ perfilId, tipos, modo, vazio }) {
  const [dados, setDados] = useState({ itens: [], total: 0, pagina: 0 });
  const [fase, setFase] = useState('carregando');
  const [erro, setErro] = useState(null);
  const [erroMais, setErroMais] = useState(null);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const pedido = useRef(0);
  const aceitos = tipos.split(',');

  const carregar = useCallback(async (pagina) => {
    const meu = ++pedido.current;
    try {
      const r = await chamar('GET', `/api/perfis/${perfilId}/interacoes?tipos=${tipos}&pagina=${pagina}`);
      if (meu !== pedido.current) return;
      setDados((d) => {
        const base = pagina === 1 ? [] : d.itens;
        const vistos = new Set(base.map((i) => i.filme.id));
        return { itens: [...base, ...r.itens.filter((i) => !vistos.has(i.filme.id))], total: r.total, pagina: r.pagina };
      });
      setErroMais(null);
      setFase('ok');
    } catch (e) {
      if (meu !== pedido.current) return;
      if (pagina > 1) setErroMais(e);
      else { setErro(e); setFase('erro'); }
    } finally {
      if (meu === pedido.current) setMaisCarregando(false);
    }
  }, [perfilId, tipos]);

  useEffect(() => {
    setFase('carregando');
    carregar(1);
    return () => { pedido.current += 1; };
  }, [carregar]);

  // o estado novo do filme decide: continua na lista (atualiza ou reinsere no topo) ou sai
  const aoMudar = (filme, estado) => setDados((d) => {
    const fica = estado && aceitos.includes(estado.tipo);
    const existe = d.itens.some((i) => i.filme.id === filme.id);
    if (!fica) {
      return existe ? { ...d, itens: d.itens.filter((i) => i.filme.id !== filme.id), total: d.total - 1 } : d;
    }
    const novo = { filme: { ...filme, estadoPerfil: estado }, atualizadoEm: new Date().toISOString() };
    if (existe) return { ...d, itens: d.itens.map((i) => (i.filme.id === filme.id ? { ...i, filme: novo.filme } : i)) };
    return { ...d, itens: [novo, ...d.itens], total: d.total + 1 };
  });

  const maisUm = () => { setMaisCarregando(true); setErroMais(null); carregar(dados.pagina + 1); };

  if (fase === 'carregando') return <Carregando rotulo="Carregando a lista" />;
  if (fase === 'erro') return <Falha erro={erro} onTentar={() => { setFase('carregando'); carregar(1); }} />;
  if (dados.itens.length === 0 && dados.itens.length >= dados.total) return <p className="vazio">{vazio}</p>;
  return (
    <>
      <ul className="grade-filmes">
        {dados.itens.map((i) => (
          <li key={i.filme.id}>
            <CartaoFilme filme={i.filme}>
              <Item perfilId={perfilId} filme={i.filme} modo={modo} aoMudar={(estado) => aoMudar(i.filme, estado)} />
            </CartaoFilme>
          </li>
        ))}
      </ul>
      {erroMais && <Falha erro={erroMais} onTentar={maisUm} />}
      {!erroMais && dados.itens.length < dados.total && (
        <button type="button" className="carregar-mais" disabled={maisCarregando} onClick={maisUm}>Carregar mais</button>
      )}
    </>
  );
}
