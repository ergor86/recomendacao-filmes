import { useCallback, useEffect, useState } from 'react';
import { chamar } from './api.js';
import Moldura from './componentes/Moldura.jsx';
import { Carregando, Falha } from './componentes/Estados.jsx';
import TelaPreparando from './telas/TelaPreparando.jsx';
import TelaPerfis from './telas/TelaPerfis.jsx';

const CHAVE = 'perfilAtivo';
const INTERVALO_MS = 2000;

// o localStorage pode lançar (bloqueado, modo privado): nunca quebra a aplicação
function lerPerfilAtivo() {
  try { return window.localStorage.getItem(CHAVE); } catch { return null; }
}
function gravarPerfilAtivo(id) {
  try {
    if (id) window.localStorage.setItem(CHAVE, id);
    else window.localStorage.removeItem(CHAVE);
  } catch { /* sem armazenamento: o perfil vale só nesta sessão */ }
}

export default function App() {
  const [saude, setSaude] = useState(null);
  const [erroSaude, setErroSaude] = useState(null);
  const [erroPerfil, setErroPerfil] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const [perfil, setPerfil] = useState(() => {
    const id = lerPerfilAtivo();
    return id ? { id } : null;
  });

  const conferir = useCallback(async () => {
    try {
      setSaude(await chamar('GET', '/api/saude'));
      setErroSaude(null);
    } catch (e) {
      setErroSaude(e);
    }
  }, []);

  // polling a cada 2 s até operante
  const operante = saude?.estado === 'operante';
  useEffect(() => {
    conferir();
  }, [conferir]);
  useEffect(() => {
    if (operante) return undefined;
    const t = setInterval(conferir, INTERVALO_MS);
    return () => clearInterval(t);
  }, [operante, conferir]);

  useEffect(() => {
    const aoPerder = () => { gravarPerfilAtivo(null); setPerfil(null); };
    window.addEventListener('perfil-perdido', aoPerder);
    return () => window.removeEventListener('perfil-perdido', aoPerder);
  }, []);

  // perfil guardado só por id: resolve o nome pela lista (e descarta o que não existe mais)
  const semNome = perfil && perfil.nome === undefined;
  useEffect(() => {
    if (!operante || !semNome) return undefined;
    let ativo = true;
    setErroPerfil(null);
    chamar('GET', '/api/perfis').then((lista) => {
      if (!ativo) return;
      const achado = lista.find((p) => p.id === perfil.id);
      if (achado) setPerfil({ id: achado.id, nome: achado.nome });
      else { gravarPerfilAtivo(null); setPerfil(null); }
    }).catch((e) => { if (ativo) setErroPerfil(e); });
    return () => { ativo = false; };
  }, [operante, semNome, perfil?.id, tentativa]);

  const entrar = (p) => {
    gravarPerfilAtivo(p.id);
    setPerfil({ id: p.id, nome: p.nome });
  };
  const trocar = () => { gravarPerfilAtivo(null); setPerfil(null); };

  if (!saude) {
    return erroSaude
      ? <Falha erro={erroSaude} onTentar={conferir} />
      : <Carregando rotulo="Conferindo o servidor" />;
  }
  if (!operante) {
    return (
      <>
        {erroSaude && <Falha erro={erroSaude} onTentar={conferir} />}
        <TelaPreparando saude={saude} onConferir={conferir} />
      </>
    );
  }
  return (
    <Moldura perfil={perfil} onTrocarPerfil={trocar}>
      {perfil && erroPerfil && semNome
        ? <Falha erro={erroPerfil} onTentar={() => setTentativa((n) => n + 1)} />
        : perfil
        ? <p>As telas de recomendação chegam nas próximas tarefas.</p>
        : <TelaPerfis onEntrar={entrar} />}
    </Moldura>
  );
}
