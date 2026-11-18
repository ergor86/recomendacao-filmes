import { useState } from 'react';
import GestaoPerfisRestrita from './GestaoPerfisRestrita.jsx';

const MOTIVOS = {
  credenciais: 'as credenciais do banco não estão disponíveis para o servidor',
  sem_dados: 'o banco ainda não tem os dados preparados',
  banco_indisponivel: 'o banco de dados não está acessível agora',
};

/** Aparece enquanto /saude não está operante. O polling fica no App; aqui só a apresentação. */
export default function TelaPreparando({ saude, onConferir }) {
  const [gestao, setGestao] = useState(false);
  if (gestao) return <GestaoPerfisRestrita onVoltar={() => setGestao(false)} />;

  const { estado, etapa, total, mensagem, causa, comando, perfis } = saude;
  const parado = estado === 'falhou' || estado === 'bloqueado';
  const progresso = Number.isInteger(etapa) && Number.isInteger(total) && total > 0;
  const motivo = MOTIVOS[perfis?.motivo] ?? 'o banco de dados não está disponível';

  return (
    <section className="preparando" aria-labelledby="titulo-preparando">
      <h1 id="titulo-preparando">
        {estado === 'bloqueado' ? 'A aplicação está bloqueada' : estado === 'falhou' ? 'A preparação falhou' : 'Preparando a aplicação'}
      </h1>
      {progresso && (
        <>
          <p>Etapa {etapa} de {total}</p>
          <progress max={total} value={etapa} aria-label={`Etapa ${etapa} de ${total}`} />
        </>
      )}
      {mensagem && <p>{mensagem}</p>}
      {parado && (
        <>
          {causa && <p className="causa">{causa}</p>}
          {comando && <p>Para resolver, rode: <code className="comando">{comando}</code></p>}
          <button type="button" onClick={onConferir}>Conferir de novo</button>
        </>
      )}
      {perfis?.disponivel ? (
        <p>
          <a href="#apagar-perfis" onClick={(e) => { e.preventDefault(); setGestao(true); }}>Apagar perfis e avaliações</a>
        </p>
      ) : (
        <p>
          Agora não é possível apagar perfis: {motivo}. Para apagar tudo, use <code>docker compose down -v</code> (isso também apaga a preparação).
        </p>
      )}
    </section>
  );
}
