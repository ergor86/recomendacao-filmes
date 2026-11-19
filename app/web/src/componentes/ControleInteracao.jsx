import { useCallback, useRef } from 'react';
import { chamar } from '../api.js';
import { useAviso } from './AvisoAcao.jsx';

const FRASES = Object.freeze({
  conta: 'Este filme agora conta para as suas recomendações.',
  deixouDeContar: 'Este filme deixou de contar para as suas recomendações e não aparece nelas enquanto estiver marcado.',
  notaBaixa: 'Notas 1–3 tiram este filme das recomendações, mas ainda não afastam filmes parecidos.',
  semVetor: 'Este filme é raro nos dados de 1998 e não entra no cálculo dos seus gostos.',
  queroAssistir: 'Ele não aparece nas recomendações enquanto estiver na Minha lista.',
  voltar: 'Este filme pode voltar a aparecer nas recomendações.',
  deixouDosGostos: 'Ele deixou de contar para os seus gostos.',
});

/**
 * Frase que o AvisoAcao acrescenta depois de uma escrita, escolhida por `efeitos`, `tipo`, `nota` e
 * `temVetor` (spec 7). `operacao` é 'put' ou 'delete'. Devolve '' quando nada há a acrescentar.
 */
export function fraseEfeitos({ efeitos, tipo, nota, temVetor, operacao }) {
  if (operacao === 'delete') {
    return efeitos?.perfilMudou ? `${FRASES.deixouDosGostos} ${FRASES.voltar}` : FRASES.voltar;
  }
  if (efeitos?.perfilMudou) return efeitos.contribuiParaPerfil ? FRASES.conta : FRASES.deixouDeContar;
  if (tipo === 'nota' && nota <= 3) return FRASES.notaBaixa;
  const curtiu = tipo === 'gostei' || (tipo === 'nota' && nota >= 4);
  if (!temVetor && curtiu) return FRASES.semVetor;
  if (tipo === 'quero_assistir') return FRASES.queroAssistir;
  return '';
}

const rotuloEstado = (e) => (e.tipo === 'nota' ? `nota ${e.nota}` : e.tipo === 'gostei' ? 'Gostei' : 'Quero assistir');
const igual = (a, b) => a.tipo === b.tipo && (a.nota ?? null) === (b.nota ?? null);

function frasePorSubstituicao(anterior, novo) {
  if (!anterior || igual(anterior, novo)) return '';
  const quem = anterior.tipo === 'nota' ? `Sua nota ${anterior.nota} foi substituída` : `${rotuloEstado(anterior)} foi substituído`;
  return `${quem} por ${rotuloEstado(novo)}.`;
}

const corpoDe = (e) => (e.tipo === 'nota' ? { tipo: 'nota', nota: e.nota } : { tipo: e.tipo });

/**
 * Gancho das escritas do filme: `aplicar(novo)` com novo = { tipo, nota? } ou null (remover).
 * As escritas do mesmo controle vão em fila, na ordem dos cliques; o resultado vai ao AvisoAcao
 * (com "Desfazer", que reaplica o `anterior`) e o novo estado ao `aoMudar`.
 */
export function useInteracao({ perfilId, filme, estado, aoMudar }) {
  const { mostrar } = useAviso();
  const fila = useRef(Promise.resolve());
  // estado mais recente (otimista): a alternância decide por ele, não pela prop, que só muda quando a escrita volta
  const atual = useRef(estado ?? null);
  const propVista = useRef(estado ?? null);
  const propAtual = useRef(estado ?? null);
  const pendentes = useRef(0);
  propAtual.current = estado ?? null;
  const mudouProp = (propVista.current?.tipo ?? null) !== (estado?.tipo ?? null)
    || (propVista.current?.nota ?? null) !== (estado?.nota ?? null);
  if (mudouProp) {
    propVista.current = estado ?? null;
    if (pendentes.current === 0) atual.current = estado ?? null;
  }
  const url = `/api/perfis/${perfilId}/interacoes/${filme.id}`;
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  const executar = useCallback(async (novo, desfazendo) => {
    try {
      const r = novo ? await chamar('PUT', url, corpoDe(novo)) : await chamar('DELETE', url);
      const estado = novo ? { tipo: novo.tipo, nota: novo.nota ?? null } : null;
      aoMudarRef.current?.(estado, r);
      const frase = fraseEfeitos({
        efeitos: r.efeitos,
        tipo: estado?.tipo ?? null,
        nota: estado?.nota ?? null,
        temVetor: novo ? (r.filme?.temVetor ?? filme.temVetor) : filme.temVetor,
        operacao: novo ? 'put' : 'delete',
      });
      const substituicao = estado ? frasePorSubstituicao(r.anterior, estado) : '';
      const texto = ['Salvo.', substituicao, frase].filter(Boolean).join(' ');
      const anterior = r.anterior ?? null;
      mostrar({
        texto,
        desfazer: desfazendo ? undefined : () => aplicarRef.current(anterior ? { tipo: anterior.tipo, nota: anterior.nota } : null, true),
      });
    } catch (e) {
      if (pendentes.current === 1) atual.current = propAtual.current;
      mostrar({ texto: e?.mensagem ?? 'Não consegui salvar. Tente de novo.' });
    } finally {
      pendentes.current -= 1;
    }
  }, [url, filme.temVetor, mostrar]);

  const aplicarRef = useRef(null);
  const aplicar = useCallback((novo, desfazendo = false) => {
    atual.current = novo ? { tipo: novo.tipo, nota: novo.nota ?? null } : null;
    pendentes.current += 1;
    fila.current = fila.current.then(() => executar(novo, desfazendo));
    return fila.current;
  }, [executar]);
  aplicarRef.current = aplicar;
  const alternar = useCallback((tipo) => aplicar(atual.current?.tipo === tipo ? null : { tipo }), [aplicar]);
  const clicarEstrela = useCallback(
    (n) => aplicar(atual.current?.tipo === 'nota' && atual.current.nota === n ? null : { tipo: 'nota', nota: n }),
    [aplicar],
  );
  return { aplicar, alternar, clicarEstrela };
}

/** Estrelas 1–5 como radiogroup: setas movem a seleção; clicar na atual remove a nota. */
export function Estrelas({ valor, aoEscolher, aoClicar, rotulo = 'Sua nota' }) {
  const refs = useRef([]);
  const parada = valor ?? 1;

  const aoTeclar = (e, n) => {
    const passo = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    let alvo = n;
    if (passo) alvo = Math.min(5, Math.max(1, n + passo));
    else if (e.key === 'Home') alvo = 1;
    else if (e.key === 'End') alvo = 5;
    else return;
    e.preventDefault();
    refs.current[alvo - 1]?.focus();
    if (alvo !== n) aoEscolher(alvo);
  };

  return (
    <div className="estrelas" role="radiogroup" aria-label={rotulo}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          ref={(el) => { refs.current[n - 1] = el; }}
          aria-checked={n === valor}
          aria-label={`${n} de 5 estrelas`}
          tabIndex={n === parada ? 0 : -1}
          className={valor && n <= valor ? 'estrela cheia' : 'estrela'}
          onClick={() => aoClicar(n)}
          onKeyDown={(e) => aoTeclar(e, n)}
        >
          <span aria-hidden="true">{valor && n <= valor ? '★' : '☆'}</span>
        </button>
      ))}
    </div>
  );
}

const DESCRICAO = (e) => (!e ? 'nenhum' : e.tipo === 'nota' ? `Nota ${e.nota}` : e.tipo === 'gostei' ? 'Gostei' : 'Quero assistir');

/** Controles do detalhe: estrelas, Gostei, Quero assistir e Remover, com o estado atual e o texto fixo. */
export default function ControleInteracao({ perfilId, filme, estado, aoMudar }) {
  const { aplicar, alternar, clicarEstrela } = useInteracao({ perfilId, filme, estado, aoMudar });

  return (
    <div className="controle-interacao">
      <p className="estado-atual">Estado atual: <strong>{DESCRICAO(estado)}</strong></p>
      <Estrelas
        valor={estado?.tipo === 'nota' ? estado.nota : null}
        aoEscolher={(n) => aplicar({ tipo: 'nota', nota: n })}
        aoClicar={clicarEstrela}
      />
      <div className="acoes-interacao">
        <button type="button" aria-pressed={estado?.tipo === 'gostei'} onClick={() => alternar('gostei')}>Gostei</button>
        <button type="button" aria-pressed={estado?.tipo === 'quero_assistir'} onClick={() => alternar('quero_assistir')}>Quero assistir</button>
        <button type="button" disabled={!estado} onClick={() => aplicar(null)}>Remover</button>
      </div>
      <p className="texto-fixo">
        <strong>Gostei</strong> e notas <strong>4–5</strong> entram no cálculo dos seus gostos. Qualquer marcação,
        inclusive notas 1–3 e &apos;Quero assistir&apos;, tira o filme das suas recomendações. Notas 1–3 ainda não afastam filmes parecidos.
      </p>
    </div>
  );
}
