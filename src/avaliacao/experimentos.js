// Lógica pura da avaliação final no u1.test (spec §9.2–9.4): pré-condições do teste único,
// listas dos Exp. 5 e 6, regra de N = 0 e montagem das métricas de cada experimento.
// Nada aqui lê arquivos ou o banco: o script 13 junta as entradas e chama estas funções.
import { contribuicaoExclusivaAgregada } from '../candidatos/hibrido.js';
import { top10PorScore } from '../modelo/ranqueador.js';
import { projetar, mediaEntreSementes } from './escolha.js';
import { bootstrapPareado } from './estatistica.js';

const SEMENTES = [1, 2, 3];
const METRICAS = ['ndcg', 'precisao', 'recall'];
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Exp. 5: os `tamanho` primeiros filmes do ranking de popularidade que o usuário não viu.
 * `tamanho` = nº de candidatos únicos do Exp. 4 daquele usuário (depois da união, deduplicação e
 * exclusão dos vistos), para os dois sistemas terem o mesmo orçamento usuário a usuário.
 */
export function popularesMesmoOrcamento(ranking, vistos, tamanho) {
  const saida = [];
  for (const id of ranking) {
    if (saida.length >= tamanho) break;
    if (!vistos.has(id)) saida.push(id);
  }
  if (saida.length < tamanho) {
    throw new Error(`popularesMesmoOrcamento: só ${saida.length} não vistos no ranking, mas o orçamento é ${tamanho}; confira o ranking da régua`);
  }
  return saida;
}

/** Exp. 6: todos os filmes do catálogo (ids ou objetos { id }) que o usuário não viu, em ordem crescente de id. */
export function todosNaoVistos(catalogo, vistos) {
  return catalogo
    .map((f) => (typeof f === 'number' ? f : f.id))
    .filter((id) => !vistos.has(id))
    .sort((a, b) => a - b);
}

/** Os 6 modelos finais esperados pela configuração: modelo e controle × sementes 1, 2, 3. */
export function modelosEsperados(configuracao) {
  const saida = [];
  for (const [papel, semPop] of [['modelo', false], ['controle', true]]) {
    for (const semente of SEMENTES) saida.push({ nome: configuracao[papel], papel, semente, semPop });
  }
  return saida;
}

// Comando que (re)treina um modelo final com as épocas congeladas.
function comandoTreinoFinal(configuracao, nome, semPop) {
  return `npm run treinar -- --fase final --negativos ${configuracao.negativos} --arquitetura ${configuracao.arquitetura}`
    + `${semPop ? ' --sem-pop' : ''} --epocas-de resultados/treino-${nome}-exp.json`;
}

/**
 * Confere tudo o que precisa estar pronto antes de ler o u1.test, na ordem, e falha alto com o comando
 * que resolve cada caso:
 *  1. resultados/configuracao-final.json existe;
 *  2. resultados/avaliacao-final.json ainda não existe (o teste é usado uma única vez);
 *  3. artefatos/regua-final.json existe;
 *  4. o banco foi carregado com a régua-final;
 *  5. artefatos/candidatos-final.json existe e é da régua-final;
 *  6. cada modelo final existe, é da fase final e da régua-final e usou os candidatos finais atuais;
 *  7. cada modelo final treinou exatamente as épocas congeladas para a sua semente.
 * @param candidatosFinal { hashRegua, sha256 } do cabeçalho do arquivo, ou null se ausente
 * @param modelos [{ nome, semente, metadados | null }]
 */
export function verificarPreCondicoes({ configuracao, avaliacaoExiste, reguaFinal, hashBanco, candidatosFinal, modelos }) {
  if (!configuracao) {
    throw new Error('resultados/configuracao-final.json ausente: congele a configuração antes do teste com '
      + 'npm run congelar -- --modelo <nome> --controle <nome>-sempop');
  }
  if (avaliacaoExiste) {
    throw new Error('resultados/avaliacao-final.json já existe: a avaliação final no u1.test é feita uma única vez e não pode ser repetida');
  }
  if (!reguaFinal) {
    throw new Error('artefatos/regua-final.json ausente: rode npm run carregar-filmes -- --fase final');
  }
  if (hashBanco !== reguaFinal.hash) {
    throw new Error(`banco ${hashBanco ? 'carregado com outra régua' : 'sem carga registrada'} `
      + `(hash ${String(hashBanco).slice(0, 12)}… ≠ régua-final ${reguaFinal.hash.slice(0, 12)}…): rode npm run carregar-filmes -- --fase final`);
  }
  if (!candidatosFinal) {
    throw new Error('artefatos/candidatos-final.json ausente: rode npm run gerar-candidatos -- --fase final');
  }
  if (candidatosFinal.hashRegua !== reguaFinal.hash) {
    throw new Error('artefatos/candidatos-final.json é de outra régua: rode npm run gerar-candidatos -- --fase final');
  }
  const esperados = modelosEsperados(configuracao);
  for (const { nome, papel, semente, semPop } of esperados) {
    const dir = `modelos/${nome}-final-s${semente}`;
    const comando = comandoTreinoFinal(configuracao, nome, semPop);
    const m = (modelos ?? []).find((x) => x.nome === nome && x.semente === semente)?.metadados ?? null;
    if (!m) throw new Error(`modelo final ${dir} ausente: rode ${comando}`);
    if (m.fase !== 'final') throw new Error(`${dir} é da fase ${m.fase}, não da final: rode ${comando}`);
    if (m.hashRegua !== reguaFinal.hash) throw new Error(`${dir} foi treinado com outra régua: rode ${comando} --motivo "régua-final nova"`);
    if (m.sha256Candidatos !== candidatosFinal.sha256) {
      throw new Error(`${dir} tem sha256Candidatos diferente de artefatos/candidatos-final.json `
        + `(${String(m.sha256Candidatos).slice(0, 12)}… ≠ ${candidatosFinal.sha256.slice(0, 12)}…): rode ${comando} --motivo "candidatos finais regerados"`);
    }
    const congeladas = configuracao.epocasPorSemente?.[papel]?.[String(semente)];
    if (!Number.isInteger(congeladas) || congeladas < 1) {
      throw new Error(`configuracao-final.json sem épocas válidas para ${papel} semente ${semente} (${congeladas}): `
        + 'refaça npm run congelar -- --modelo <nome> --controle <nome>-sempop');
    }
    if (!Number.isInteger(m.epocas) || m.epocas !== congeladas) {
      throw new Error(`${dir} treinou ${m.epocas} épocas, mas configuracao-final.json congelou ${congeladas} para a semente ${semente}: `
        + `rode ${comando} --motivo "épocas congeladas"`);
    }
  }
}

/**
 * Regra decidida antes do teste (spec §9.2) para quando N = 0 vence a grade: o Exp. 2 usa N = 100 no
 * recall dos candidatos; a contribuição exclusiva vetorial é zero por construção; o Exp. 5 é idêntico
 * ao Exp. 4. Com N > 0 o Exp. 2 usa o próprio N e nada é forçado.
 */
export function regraNZero(n) {
  const aplicada = n === 0;
  return { aplicada, nRecallExp2: aplicada ? 100 : n, contribuicaoVetorialPorConstrucao: aplicada, exp5IdenticoAoExp4: aplicada };
}

/** Recall de uma lista de candidatos: média, entre os usuários de `relevantes`, de |lista ∩ R| / |R|. */
export function recallDosCandidatos(listas, relevantes) {
  const porUsuario = new Map();
  for (const [u, r] of relevantes) {
    const lista = listas.get(u);
    if (!lista) throw new Error(`recallDosCandidatos: falta a lista de candidatos do usuário ${u}`);
    porUsuario.set(u, lista.filter((id) => r.has(id)).length / r.size);
  }
  return { media: media([...porUsuario.values()]), porUsuario };
}

/** Acertos (relevantes) de cada lista { ids, fonte } de candidatosDe, no formato de contribuicaoExclusivaAgregada. */
export function acertosComFonte(listas, relevantes) {
  const saida = [];
  for (const [u, r] of relevantes) {
    const l = listas.get(u);
    if (!l) throw new Error(`acertosComFonte: falta a lista do usuário ${u}`);
    saida.push({ acertos: l.ids.filter((id) => r.has(id)), fonte: l.fonte });
  }
  return saida;
}

/** Fração agregada dos acertos trazidos só pelos vetores, só pelos populares e pelas duas fontes. */
export function contribuicoesDasFontes(listas) {
  return {
    vet: contribuicaoExclusivaAgregada(listas, 'vet'),
    pop: contribuicaoExclusivaAgregada(listas, 'pop'),
    ambas: contribuicaoExclusivaAgregada(listas, 'ambas'),
    acertos: listas.reduce((s, l) => s + l.acertos.length, 0),
  };
}

/** Top 10 por score entre os `ids` pedidos; falha alto se algum id não tem score. */
export function top10DoSubconjunto(scores, ids) {
  const sub = new Map();
  for (const id of ids) {
    const s = scores.get(id);
    if (s === undefined) throw new Error(`top10DoSubconjunto: o filme ${id} não foi pontuado; ele precisa estar entre os não vistos`);
    sub.set(id, s);
  }
  return top10PorScore(sub);
}

/** Duas listas de ids iguais posição a posição. */
export function listasIguais(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Resumo de um experimento sem rede a partir de avaliarSistema. */
export function resumirSemRede(r) {
  return {
    ndcg: r.ndcg, precisao: r.precisao, recall: r.recall, cobertura: r.cobertura,
    popularidadeMediaContagem: r.popularidadeMediaContagem, nUsuarios: r.nUsuarios, porUsuario: r.porUsuario,
  };
}

/**
 * Resumo de um experimento com rede: o valor de cada usuário é a média das sementes (não é ensemble);
 * também as métricas de cada semente, o mínimo e o máximo entre sementes, e cobertura e popularidade
 * média por semente e na média.
 * @param porSemente [{ semente, resultado }] com `resultado` de avaliarSistema
 */
export function resumirComRede(porSemente) {
  const medias = Object.fromEntries(METRICAS.map((m) => [m, mediaEntreSementes(porSemente.map((s) => projetar(s.resultado.porUsuario, m)))]));
  const porUsuario = new Map();
  for (const u of medias.ndcg.keys()) porUsuario.set(u, Object.fromEntries(METRICAS.map((m) => [m, medias[m].get(u)])));
  const linhas = porSemente.map(({ semente, resultado: r }) => ({
    semente, ndcg: r.ndcg, precisao: r.precisao, recall: r.recall,
    cobertura: r.cobertura, popularidadeMediaContagem: r.popularidadeMediaContagem,
  }));
  const minMax = Object.fromEntries(METRICAS.map((m) => [m, [Math.min(...linhas.map((l) => l[m])), Math.max(...linhas.map((l) => l[m]))]]));
  return {
    ...Object.fromEntries(METRICAS.map((m) => [m, media([...medias[m].values()])])),
    porSemente: linhas,
    minMax,
    cobertura: { media: media(linhas.map((l) => l.cobertura)) },
    popularidadeMediaContagem: { media: media(linhas.map((l) => l.popularidadeMediaContagem)) },
    nUsuarios: porUsuario.size,
    porUsuario,
  };
}

/** Diferença descritiva (sem intervalo): média de A − B por métrica, nos usuários de A (B precisa tê-los). */
export function diferencaDescritiva(porUsuarioA, porUsuarioB) {
  const difs = Object.fromEntries(METRICAS.map((m) => [m, []]));
  for (const [u, a] of porUsuarioA) {
    const b = porUsuarioB.get(u);
    if (!b) throw new Error(`diferencaDescritiva: usuário ${u} sem valor no sistema de referência`);
    for (const m of METRICAS) difs[m].push(a[m] - b[m]);
  }
  return { ...Object.fromEntries(METRICAS.map((m) => [m, media(difs[m])])), nUsuarios: porUsuarioA.size };
}

/**
 * Hipótese principal (spec §1 e §9.4): bootstrap pareado percentil das diferenças por usuário A − B
 * (usuários em ordem crescente de id). Suportada se o IC de 95% exclui zero por cima (limite inferior > 0).
 * @param a, b Map<usuario, número>
 */
export function hipotesePrincipal(a, b, { reamostragens, semente }) {
  const usuarios = [...a.keys()].sort((x, y) => x - y);
  const difs = usuarios.map((u) => {
    if (!b.has(u)) throw new Error(`hipotesePrincipal: usuário ${u} sem valor no sistema de referência`);
    return a.get(u) - b.get(u);
  });
  const { media: m, ic95 } = bootstrapPareado(difs, { reamostragens, semente });
  return { media: m, ic95, suportada: ic95[0] > 0, nUsuarios: difs.length };
}

/**
 * Valor de cada usuário para o corte mainstream × nicho: média de `popDe(id)` dos filmes curtidos no
 * treino. Usuários sem curtidas ficam fora e são contados.
 * @param curtidosPorUsuario Map<usuario, id[]>
 */
export function valoresMainstream(usuarios, curtidosPorUsuario, popDe) {
  const valores = new Map();
  let semCurtidas = 0;
  for (const u of usuarios) {
    const c = curtidosPorUsuario.get(u) ?? [];
    if (c.length === 0) { semCurtidas++; continue; }
    valores.set(u, media(c.map(popDe)));
  }
  return { valores, semCurtidas };
}

/** Mediana de uma lista de números (média dos dois do meio quando o tamanho é par). */
export function mediana(valores) {
  const o = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(o.length / 2);
  return o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2;
}

/** Médias das métricas em cada grupo; usuários do grupo ausentes no experimento são ignorados; grupo vazio → null. */
export function metricasPorGrupo(porUsuario, grupos) {
  const saida = {};
  for (const g of ['mainstream', 'nicho']) {
    const vals = [...grupos].filter(([u, x]) => x === g && porUsuario.has(u)).map(([u]) => porUsuario.get(u));
    saida[g] = vals.length === 0 ? null : { n: vals.length, ...Object.fromEntries(METRICAS.map((m) => [m, media(vals.map((v) => v[m]))])) };
  }
  return saida;
}
