const decimal = (x, casas) => Number(x).toFixed(casas).replace('.', ',');

const Poucas = () => <span className="poucas-notas">poucas notas ainda</span>;

function suaNota(sua) {
  if (!sua) return 'Você ainda não marcou este filme.';
  if (sua.tipo === 'nota') return `${sua.nota} de 5 estrelas`;
  return sua.tipo === 'gostei' ? 'Gostei' : 'Quero assistir';
}

/** As três seções separadas: MovieLens, Neste computador (recolhido até ter 5 notas) e Sua nota. */
export default function PainelEstatisticas({ estatisticas, temGemeoOculto = false }) {
  const { movielens: ml, computador: pc, sua } = estatisticas;
  return (
    <div className="painel-estatisticas">
      <section className="estatistica estatistica-movielens" aria-labelledby="est-ml">
        <h3 id="est-ml">MovieLens (1997–98, 943 pessoas)</h3>
        {ml.poucasNotas && <Poucas />}
        <dl>
          <div><dt>Média</dt><dd>{ml.media === null ? '—' : decimal(ml.media, 2)}</dd></div>
          <div><dt>Número de notas</dt><dd>{ml.nNotas}</dd></div>
          <div>
            <dt>
              % de notas 4–5{' '}
              <span
                className="dica"
                tabIndex={0}
                role="note"
                title="Porcentagem das notas dadas ao filme que foram 4 ou 5 estrelas."
                aria-label="Porcentagem das notas dadas ao filme que foram 4 ou 5 estrelas."
              >
                ⓘ
              </span>
            </dt>
            <dd>{ml.pctAprovacao === null ? '—' : `${decimal(ml.pctAprovacao, 1)}%`}</dd>
          </div>
        </dl>
        {temGemeoOculto && <p className="nota-gemeo">O MovieLens tem dois registros deste filme; usamos este.</p>}
      </section>

      <section className="estatistica estatistica-computador">
        <details open={!pc.poucasNotas}>
          <summary>
            <span className="titulo-secao">Neste computador</span>
            {pc.poucasNotas && <> <Poucas /></>}
          </summary>
          <dl>
            <div><dt>Média</dt><dd>{pc.media === null ? '—' : decimal(pc.media, 2)}</dd></div>
            <div><dt>Número de notas</dt><dd>{pc.nNotas}</dd></div>
          </dl>
        </details>
      </section>

      <section className="estatistica estatistica-sua" aria-labelledby="est-sua">
        <h3 id="est-sua">Sua nota</h3>
        <p>{suaNota(sua)}</p>
      </section>
    </div>
  );
}
