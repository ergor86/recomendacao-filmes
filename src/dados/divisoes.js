import { criarAleatorio, embaralhar } from '../util/aleatorio.js';

/**
 * Cria as divisões de dados do projeto a partir de u1.base e u1.test.
 *
 * Validação: para cada usuário de 463 a 943, esconde 40% das notas dele. Isso imita o teste
 * oficial (u1.test esconde notas dos usuários 1 a 462), para que as escolhas feitas na
 * validação valham também no teste.
 *
 * Passo a passo por usuário: ordena as notas por filme (ordem fixa), embaralha com a
 * semente (semente + idUsuario) e esconde as primeiras Math.round(fracao × n) avaliações.
 *
 * @returns
 *  - treinoExp: u1.base sem as notas escondidas (treino da fase de experimentos)
 *  - validacao: as notas escondidas (o gabarito da validação)
 *  - treinoFinal: u1.base inteiro (treino da fase final)
 *  - teste: u1.test (o gabarito da avaliação final)
 */
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
