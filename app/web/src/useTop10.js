import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar } from './api.js';
import { useAviso } from './componentes/AvisoAcao.jsx';

const corpoDe = (acao) => (acao.tipo === 'nota' ? { tipo: 'nota', nota: acao.nota } : { tipo: acao.tipo });

function textoAnuncio(novos) {
  if (novos.length === 0) return 'Recomendações atualizadas';
  if (novos.length === 1) return `Recomendações atualizadas: 1 filme novo, ${novos[0]}`;
  return `Recomendações atualizadas: ${novos.length} filmes novos`;
}

/**
 * Top 10 do perfil com a "Atualização automática" (spec 7):
 * - abre sempre com GET /recomendacoes (sem cache);
 * - marcar(filmeId, acao) escreve (acao = { tipo, nota? } ou null para remover); as escritas do mesmo filme vão
 *   em fila; cada uma incrementa `seq`, aborta o GET em andamento, e o GET só sai quando não resta escrita pendente;
 * - resposta de GET com `seq` ultrapassado é descartada;
 * - "Novo" é o item ausente da lista da abertura da tela (`ehNovo`).
 */
export function useTop10(perfilId) {
  const { anunciar } = useAviso();
  const anunciarRef = useRef(anunciar);
  anunciarRef.current = anunciar;
  const [lista, setLista] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(null);
  const [erroAtualizar, setErroAtualizar] = useState(null);
  const [saindo, setSaindo] = useState(() => new Set());

  const seq = useRef(0);
  const pendentes = useRef(0);
  const sujo = useRef(false); // houve escrita que ainda não foi refletida por um GET
  const controlador = useRef(null);
  const filas = useRef(new Map());
  const baseline = useRef(null);
  const atual = useRef(null);
  const geracao = useRef(0);

  const buscar = useCallback(async (inicial) => {
    const minhaGeracao = geracao.current;
    controlador.current?.abort();
    const ctl = new AbortController();
    controlador.current = ctl;
    const meuSeq = seq.current;
    const velho = () => minhaGeracao !== geracao.current || meuSeq !== seq.current || controlador.current !== ctl;
    try {
      const r = await chamar('GET', `/api/perfis/${perfilId}/recomendacoes`, undefined, { signal: ctl.signal });
      if (velho()) return;
      const ids = r.itens.map((i) => i.filme.id);
      let novos = [];
      if (baseline.current === null) baseline.current = new Set(ids);
      else {
        const antes = new Set(atual.current.itens.map((i) => i.filme.id));
        novos = r.itens.filter((i) => !antes.has(i.filme.id) && !baseline.current.has(i.filme.id)).map((i) => i.filme.titulo);
      }
      atual.current = r;
      sujo.current = false;
      setLista(r);
      setErro(null);
      setErroAtualizar(null);
      setSaindo(new Set());
      setAtualizando(false);
      setCarregando(false);
      if (!inicial) anunciarRef.current(textoAnuncio(novos));
    } catch (e) {
      if (e?.name === 'AbortError' || velho()) return;
      if (atual.current === null) {
        setErro(e);
        setCarregando(false);
      } else {
        setErroAtualizar(e);
        anunciarRef.current('Não foi possível atualizar as recomendações.');
      }
      setSaindo(new Set());
      setAtualizando(false);
    }
  }, [perfilId]);

  useEffect(() => {
    geracao.current += 1;
    seq.current = 0;
    pendentes.current = 0;
    sujo.current = false;
    baseline.current = null;
    atual.current = null;
    filas.current = new Map();
    setLista(null);
    setErro(null);
    setErroAtualizar(null);
    setSaindo(new Set());
    setAtualizando(false);
    setCarregando(true);
    buscar(true);
    return () => { geracao.current += 1; controlador.current?.abort(); };
  }, [perfilId, buscar]);

  const marcar = useCallback((filmeId, acao) => {
    seq.current += 1;
    pendentes.current += 1;
    controlador.current?.abort(); // o GET em andamento já nasceu velho
    setAtualizando(true);
    setErroAtualizar(null);
    if (acao) setSaindo((s) => new Set(s).add(filmeId));
    const url = `/api/perfis/${perfilId}/interacoes/${filmeId}`;
    const anterior = filas.current.get(filmeId) ?? Promise.resolve();
    const escrita = anterior.then(() => (acao ? chamar('PUT', url, corpoDe(acao)) : chamar('DELETE', url)));
    filas.current.set(filmeId, escrita.catch(() => {}));
    const minhaGeracao = geracao.current;
    return escrita.then(
      (r) => { sujo.current = true; return r; },
      (e) => {
        if (minhaGeracao === geracao.current) {
          setSaindo((s) => { const n = new Set(s); n.delete(filmeId); return n; });
        }
        throw e;
      },
    ).finally(() => {
      if (minhaGeracao !== geracao.current) return;
      pendentes.current -= 1;
      if (pendentes.current > 0) return;
      if (sujo.current) buscar(false);
      else setAtualizando(false);
    });
  }, [perfilId, buscar]);

  const ehNovo = useCallback((id) => baseline.current !== null && !baseline.current.has(id), []);
  const recarregar = useCallback(() => {
    setErro(null);
    setCarregando(true);
    return buscar(true);
  }, [buscar]);
  const tentarAtualizar = useCallback(() => {
    setErroAtualizar(null);
    setAtualizando(true);
    return buscar(false);
  }, [buscar]);

  return { lista, carregando, atualizando, erro, erroAtualizar, saindo, ehNovo, marcar, recarregar, tentarAtualizar };
}
