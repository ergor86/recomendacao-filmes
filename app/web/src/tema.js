// Tema da interface: Automático (segue o sistema), Claro ou Escuro. Fica só neste navegador (localStorage), nunca vai ao servidor.
export const CHAVE_TEMA = 'minha-prateleira:tema';
export const TEMAS = ['auto', 'claro', 'escuro'];

/** Tema salvo; sem valor, valor desconhecido ou localStorage indisponível: 'auto'. */
export function lerTema() {
  try {
    const t = window.localStorage.getItem(CHAVE_TEMA);
    return TEMAS.includes(t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** Põe data-tema no <html> ('claro' ou 'escuro'); em 'auto' o atributo é removido. */
export function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'claro' || tema === 'escuro') raiz.setAttribute('data-tema', tema);
  else raiz.removeAttribute('data-tema');
}

/** Guarda a escolha; sem localStorage ela vale só na sessão. */
export function salvarTema(tema) {
  if (!TEMAS.includes(tema)) return;
  try {
    window.localStorage.setItem(CHAVE_TEMA, tema);
  } catch { /* modo privado ou bloqueado: a escolha vale só na sessão */ }
}
