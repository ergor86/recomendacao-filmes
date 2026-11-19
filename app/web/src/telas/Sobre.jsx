import { useCallback, useEffect, useState } from 'react';
import { chamar } from '../api.js';
import { Carregando, Falha } from '../componentes/Estados.jsx';

const num = (x) => x.toFixed(4).replace('.', ',');
// população do teste-2 (README da pesquisa): 462 usuários considerados, 445 na métrica, 17 fora dela
const FORA_DA_METRICA = 17;

/** Sobre, em camadas: resumo em 3 frases, "O que foi medido", limites, "Detalhes técnicos" (recolhido), licenças. */
export default function Sobre() {
  const [sobre, setSobre] = useState(null);
  const [erro, setErro] = useState(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    chamar('GET', '/api/sobre')
      .then((s) => { if (ativo) setSobre(s); })
      .catch((e) => { if (ativo) setErro(e); });
    return () => { ativo = false; };
  }, [tentativa]);
  const tentar = useCallback(() => setTentativa((n) => n + 1), []);

  if (erro) return <Falha erro={erro} onTentar={tentar} />;
  if (!sobre) return <Carregando rotulo="Carregando o Sobre" />;

  const r = sobre.resultado;
  const t = sobre.tecnica;
  return (
    <article className="sobre">
      <h1>Sobre</h1>
      <div className="sobre-resumo">
        {sobre.resumo.map((frase) => <p key={frase}>{frase}</p>)}
      </div>

      <section aria-labelledby="sobre-medido">
        <h2 id="sobre-medido">O que foi medido</h2>
        <p>{sobre.conclusao}</p>
        <dl className="sobre-numeros">
          <div><dt>Diferença média no NDCG@10 (S1 menos S2)</dt><dd>{num(r.media)}</dd></div>
          <div><dt>Intervalo de confiança de 95%</dt><dd>{`[${num(r.ic95[0])}; ${num(r.ic95[1])}]`}</dd></div>
          <div><dt>Pessoas avaliadas</dt><dd>{r.nUsuarios}</dd></div>
        </dl>
        <h3>O que isso não significa</h3>
        <ul>{sobre.naoSignifica.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <section aria-labelledby="sobre-limites">
        <h2 id="sobre-limites">Limites</h2>
        <ul>{sobre.avisos.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <details className="sobre-detalhes">
        <summary>Detalhes técnicos</summary>
        <p>
          {`${r.nUsuarios + FORA_DA_METRICA} pessoas foram consideradas inicialmente; ${r.nUsuarios} entraram na métrica e ${FORA_DA_METRICA} ficaram fora da métrica.`}
        </p>
        <p>{sobre.metodo}</p>
        <p>{`Técnica: ${t.mecanismo} · M = ${t.m} · FC${t.nFc}`}</p>
        <p>{t.descricao}</p>
        <dl className="sobre-hashes">
          <div><dt>Versão</dt><dd>{sobre.versao}</dd></div>
          <div><dt>Commit do código</dt><dd><code>{sobre.commitCodigo}</code></dd></div>
          <div><dt>Hash da régua</dt><dd><code>{sobre.hashes.regua}</code></dd></div>
          <div><dt>Hash do treino</dt><dd><code>{sobre.hashes.treino}</code></dd></div>
          <div><dt>Hash dos vetores FC</dt><dd><code>{sobre.hashes.vetoresFC}</code></dd></div>
        </dl>
      </details>

      <section aria-labelledby="sobre-licencas">
        <h2 id="sobre-licencas">Licenças e citação</h2>
        <ul>
          {sobre.licencas.map((l) => (
            <li key={l.nome}>
              {l.url ? <a href={l.url} rel="noreferrer noopener">{l.nome}</a> : <strong>{l.nome}</strong>}
              {' '}
              <span>{l.texto}</span>
            </li>
          ))}
        </ul>
        <p>{sobre.citacao}</p>
        <p>Os detalhes completos da pesquisa estão no README da pesquisa, na pasta do projeto.</p>
      </section>
    </article>
  );
}
