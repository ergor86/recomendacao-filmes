import { useEffect, useState } from 'react';

/** Esqueleto de cartões; depois de 5 s acrescenta "Demorando mais que o normal…". */
export function Carregando({ rotulo = 'Carregando' }) {
  const [demora, setDemora] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDemora(true), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="carregando" role="status" aria-label={rotulo}>
      <div className="esqueleto" aria-hidden="true" />
      <div className="esqueleto" aria-hidden="true" />
      <div className="esqueleto" aria-hidden="true" />
      {demora && <p>Demorando mais que o normal…</p>}
    </div>
  );
}

/** Falha de rede ou de API, com o botão "Tentar de novo". */
export function Falha({ erro, onTentar }) {
  const texto = erro?.codigo === 'SEM_SERVIDOR' || !erro?.mensagem
    ? 'Não consegui falar com o servidor local. Ele está rodando?'
    : erro.mensagem;
  return (
    <div className="falha" role="alert">
      <p>{texto}</p>
      {onTentar && <button type="button" onClick={onTentar}>Tentar de novo</button>}
    </div>
  );
}
