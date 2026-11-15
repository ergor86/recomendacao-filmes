// Regra de escolha de configuração (menor complexidade dentro do erro padrão) e utilitários
// para projetar métricas por usuário e promediar sementes.
import { erroPadraoPareado } from './estatistica.js';

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/** Extrai uma métrica ('ndcg' | 'precisao' | 'recall') de `porUsuario` de avaliarSistema → Map<usuario, número>. */
export function projetar(porUsuario, metrica) {
  const saida = new Map();
  for (const [u, m] of porUsuario) {
    if (!(metrica in m)) throw new Error(`projetar: métrica "${metrica}" inexistente; use ndcg, precisao ou recall`);
    saida.set(u, m[metrica]);
  }
  return saida;
}

// Confere que dois mapas cobrem exatamente os mesmos usuários.
function mesmosUsuarios(a, b, contexto) {
  if (a.size !== b.size || [...a.keys()].some((u) => !b.has(u))) {
    throw new Error(`${contexto}: conjuntos de usuários diferentes (${a.size} e ${b.size}); avalie todos no mesmo conjunto`);
  }
}

/** Média por usuário entre as sementes (não é ensemble: cada semente é avaliada à parte). */
export function mediaEntreSementes(porSemente) {
  if (porSemente.length === 0) throw new Error('mediaEntreSementes: nenhuma semente informada');
  for (const m of porSemente) mesmosUsuarios(porSemente[0], m, 'mediaEntreSementes');
  const saida = new Map();
  for (const u of porSemente[0].keys()) saida.set(u, media(porSemente.map((m) => m.get(u))));
  return saida;
}

// Compara listas de simplicidade lexicograficamente (menor primeiro).
function compararSimplicidade(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Intervalos [mín, máx] das médias por semente se sobrepõem?
function faixasSeSobrepoem(a, b) {
  return Math.min(...a.porSemente) <= Math.max(...b.porSemente) && Math.min(...b.porSemente) <= Math.max(...a.porSemente);
}

/**
 * Escolhe a configuração: a de maior média (melhor) define a referência; toda config cuja diferença
 * para a melhor é menor que o erro padrão pareado por usuário "empata"; entre as que empatam
 * (a melhor inclusive) vence a de menor `simplicidade` lexicográfica (se igual, a de maior média).
 * Diferenças por usuário todas nulas são empate exato (com 0 < 0 falso, só a primeira do array empataria).
 * `fragil` (ruling R10): true quando a faixa [mín, máx] das médias por semente da melhor se sobrepõe
 * à da escolhida (quando são diferentes) ou, se a escolhida é a própria melhor, à de qualquer outra
 * configuração. É só registro: não altera a escolha.
 */
export function escolherConfiguracao(configs) {
  if (configs.length === 0) throw new Error('escolherConfiguracao: nenhuma configuração informada');
  const medias = new Map(configs.map((c) => [c.nome, media([...c.porUsuario.values()])]));
  const melhor = configs.reduce((b, c) => (medias.get(c.nome) > medias.get(b.nome) ? c : b));
  const tabela = configs.map((c) => {
    if (c === melhor) return { nome: c.nome, media: medias.get(c.nome), diferenca: 0, erroPadrao: 0, empata: true };
    mesmosUsuarios(melhor.porUsuario, c.porUsuario, `escolherConfiguracao (${melhor.nome} x ${c.nome})`);
    const difs = [...melhor.porUsuario].map(([u, v]) => v - c.porUsuario.get(u));
    const diferenca = medias.get(melhor.nome) - medias.get(c.nome);
    const erroPadrao = erroPadraoPareado(difs);
    return { nome: c.nome, media: medias.get(c.nome), diferenca, erroPadrao, empata: diferenca < erroPadrao || difs.every((d) => d === 0) };
  });
  const empatadas = configs.filter((c) => tabela.find((t) => t.nome === c.nome).empata);
  const escolhida = empatadas.reduce((e, c) => {
    const s = compararSimplicidade(c.simplicidade, e.simplicidade);
    return s < 0 || (s === 0 && medias.get(c.nome) > medias.get(e.nome)) ? c : e;
  });
  const fragil = escolhida === melhor
    ? configs.some((c) => c !== melhor && faixasSeSobrepoem(melhor, c))
    : faixasSeSobrepoem(melhor, escolhida);
  return { escolhida: escolhida.nome, melhor: melhor.nome, fragil, tabela };
}
