// Aplica o tema salvo antes da primeira pintura (script clássico e bloqueante no <head>; a CSP só permite script externo).
// Chave e valores iguais aos de src/tema.js; a API de execução continua sendo o tema.js.
(function () {
  try {
    var t = localStorage.getItem('minha-prateleira:tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-tema', t);
  } catch (e) { /* sem localStorage: fica Automático */ }
})();
