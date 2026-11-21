import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const fase0 = useRef('carregando');
  fase0.current = fase;
  const suja = useRef(false); // a lista mudou localmente: o deslocamento do servidor já não bate com o do cliente
  const raiz = useRef(null);
  const foco = useRef(null);
  const idsAnteriores = useRef([]);
  const aceitos = tipos.split(',');

  // Carrega as páginas `desde`..`alvo`. Depois de mudanças locais recarrega de 1 até o alvo, para não pular itens.
  const carregar = useCallback(async (alvo, desde = alvo) => {
    const meu = ++pedido.current;
    try {
      const lidos = [];
      let ultimo = null;
      for (let p = desde; p <= alvo; p += 1) {
        ultimo = await chamar('GET', `/api/perfis/${perfilId}/interacoes?tipos=${tipos}&pagina=${p}`);
        if (meu !== pedido.current) return;
        lidos.push(...ultimo.itens);
      }
      suja.current = false;
      setDados((d) => {
        const base = desde === 1 ? [] : d.itens;
        const vistos = new Set(base.map((i) => i.filme.id));
        const novos = lidos.filter((i) => !vistos.has(i.filme.id) && vistos.add(i.filme.id));
        return { itens: [...base, ...novos], total: ultimo.total, pagina: alvo };
      });
      setErroMais(null);
      setFase('ok');
    } catch (e) {
      if (meu !== pedido.current) return;
      if (alvo > 1 && fase0.current === 'ok') setErroMais(e);
      else { setErro(e); setFase('erro'); }
    } finally {
      if (meu === pedido.current) setMaisCarregando(false);
    }
  }, [perfilId, tipos]);

  useEffect(() => {
    setFase('carregando');
    suja.current = false;
    carregar(1);
    return () => { pedido.current += 1; };
  }, [carregar]);

  // o estado novo do filme decide: continua na lista (atualiza ou reinsere no topo) ou sai
  const aoMudar = (filme, estado) => setDados((d) => {
    const fica = estado && aceitos.includes(estado.tipo);
    const existe = d.itens.some((i) => i.filme.id === filme.id);
    if (!fica) {
      if (!existe) return d;
      suja.current = true;
      return { ...d, itens: d.itens.filter((i) => i.filme.id !== filme.id), total: d.total - 1 };
    }
    const novo = { filme: { ...filme, estadoPerfil: estado }, atualizadoEm: new Date().toISOString() };
    if (existe) return { ...d, itens: d.itens.map((i) => (i.filme.id === filme.id ? { ...i, filme: novo.filme } : i)) };
    suja.current = true;
    return { ...d, itens: [novo, ...d.itens], total: d.total + 1 };
  });

  // a primeira página esvaziou, mas o servidor ainda tem filmes: recarrega do começo
  const esvaziada = fase === 'ok' && dados.itens.length === 0 && dados.total > 0 && suja.current;
  useEffect(() => { if (esvaziada) carregar(1); }, [esvaziada, carregar]);

  const maisUm = () => {
    setMaisCarregando(true);
    setErroMais(null);
    return suja.current ? carregar(dados.pagina + 1, 1) : carregar(dados.pagina + 1);
  };

  // o foco não cai no body quando o item focado sai: vai para o item da mesma posição, ou o anterior, ou o título
  useLayoutEffect(() => {
    const ids = dados.itens.map((i) => String(i.filme.id));
    const ativo = document.activeElement;
    if (foco.current !== null && !ids.includes(foco.current) && (!ativo || ativo === document.body || !ativo.isConnected)) {
      const indice = Math.max(0, idsAnteriores.current.indexOf(foco.current));
      const alvo = ids.length ? raiz.current?.querySelector(`li[data-filme-id="${ids[Math.min(indice, ids.length - 1)]}"]`) : null;
      const foco0 = alvo?.querySelector('a');
      if (foco0) foco0.focus();
      else {
        const titulo = raiz.current?.closest('section')?.querySelector('h1');
        if (titulo) { titulo.setAttribute('tabindex', '-1'); titulo.focus(); }
      }
      foco.current = null;
    }
    idsAnteriores.current = ids;
  }, [dados.itens]);
  const aoFocar = (e) => { foco.current = e.target.closest('li[data-filme-id]')?.dataset.filmeId ?? foco.current; };

  if (fase === 'carregando') return <Carregando rotulo="Carregando a lista" />;
  if (fase === 'erro') return <Falha erro={erro} onTentar={() => { setFase('carregando'); carregar(1); }} />;
  if (dados.itens.length === 0 && dados.total > 0) return <Carregando rotulo="Carregando a lista" />;
  if (dados.itens.length === 0) return <div ref={raiz}><p className="vazio">{vazio}</p></div>;
  return (
    <div ref={raiz} onFocus={aoFocar}>
      <ul className="grade-filmes">
        {dados.itens.map((i) => (
          <li key={i.filme.id} data-filme-id={i.filme.id}>
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
    </div>
  );
}
