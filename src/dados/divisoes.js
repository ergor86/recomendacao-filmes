import { criarAleatorio, embaralhar } from '../util/aleatorio.js';

// Para cada usuário de validação: ordena por filme, embaralha com semente + idUsuario
// e esconde as primeiras Math.round(fracao × n) avaliações.
export function criarDivisoes(
  { base, teste },
  { semente = 42, usuariosValidacao = [463, 943], fracao = 0.4 } = {},
) {
  const [minimo, maximo] = usuariosValidacao;
  const porUsuario = new Map();
  for (const a of base) {
    if (a.usuario < minimo || a.usuario > maximo) continue;
    if (!porUsuario.has(a.usuario)) porUsuario.set(a.usuario, []);
    porUsuario.get(a.usuario).push(a);
  }

  const escondidas = new Set();
  const validacao = [];
  const ids = [...porUsuario.keys()].sort((x, y) => x - y);
  for (const id of ids) {
    const ordenadas = [...porUsuario.get(id)].sort((x, y) => x.filme - y.filme);
    const mistura = embaralhar(ordenadas, criarAleatorio(semente + id));
    const k = Math.round(fracao * mistura.length);
    for (const a of mistura.slice(0, k)) {
      escondidas.add(a);
      validacao.push(a);
    }
  }

  const treinoExp = base.filter(a => !escondidas.has(a));
  return { treinoExp, validacao, treinoFinal: base, teste };
}
