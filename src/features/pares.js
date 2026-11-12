// Pares (usuário, filme, rótulo) para treinar e validar a rede neural (spec §6 e §7.1–7.3).
//
// Cada par vira uma linha de `x` (70 posições, ou 68 com `semPop`) e um rótulo em `y` (1 = gostou, 0 = não).
// Tipos de par e perfil usado (tabela "Perfil por tipo de par" do Plano 2):
//   - positivo de treino (nota ≥ 4): perfil SEM o filme do par; usuário com 1 curtido tem o par descartado;
//   - 4 negativos sorteados vinculados ao positivo: o MESMO perfil do positivo (sem atalho "perfil completo = negativo");
//   - negativo observado de treino (nota 1–3): perfil completo;
//   - todos os pares de validação: perfil completo do treino (as notas escondidas nunca entram no perfil).
// Popularidade do filme no par: contagem da régua, menos 1 só se a nota do usuário está no treino da régua
// (positivos e observados de treino). Sorteados e pares de validação nunca têm desconto.
//
// Ordem das linhas (determinística, entra no sha256): usuários em ordem crescente de id; dentro do usuário,
// cada positivo usável (na ordem do histórico) seguido imediatamente dos seus 4 sorteados; depois os
// negativos observados (na ordem do histórico). Na validação, o mesmo, com os positivos e observados escondidos
// na ordem em que aparecem em `validacao`.
import crypto from 'node:crypto';
import { criarAleatorio } from '../util/aleatorio.js';
import {
  demografia, resumoCurtidos, perfilRede, popZDoPar, filmeRede, montarEntrada,
} from './entrada.js';

const POR_POSITIVO = 4;
const ESQUEMAS = ['uniforme', 'candidatos'];

/**
 * Sorteia `quantidade` negativos COM reposição.
 * Os elegíveis são filtrados antes do sorteio (sem laço de rejeição): itens de `excluir` nunca saem.
 * Esquema dos candidatos (`candidatos` não nulo): no bloco de 4, os índices 0, 1 e 2 (j % 4 < 3) vêm dos
 * candidatos elegíveis e o índice 3 do catálogo elegível. Sem candidatos elegíveis, o sorteio vai ao catálogo
 * e conta em `recorreuAoCatalogo`. Esquema uniforme (`candidatos` nulo): tudo do catálogo.
 * Catálogo elegível vazio: erro (não há negativo possível).
 */
export function sortearNegativos({ quantidade, excluir, catalogo, candidatos, aleatorio }) {
  const ids = [];
  let recorreuAoCatalogo = 0;
  if (quantidade <= 0) return { ids, recorreuAoCatalogo };
  const catalogoElegivel = catalogo.filter((id) => !excluir.has(id));
  if (catalogoElegivel.length === 0) {
    throw new Error(`nenhum filme elegível no catálogo para sortear negativos (${catalogo.length} filmes, ${excluir.size} excluídos): confira o catálogo e as exclusões`);
  }
  const candidatosElegiveis = candidatos ? candidatos.filter((id) => !excluir.has(id)) : null;
  const escolher = (lista) => lista[Math.floor(aleatorio() * lista.length)];
  for (let j = 0; j < quantidade; j++) {
    if (candidatosElegiveis && j % POR_POSITIVO < 3) {
      if (candidatosElegiveis.length > 0) {
        ids.push(escolher(candidatosElegiveis));
        continue;
      }
      recorreuAoCatalogo += 1;
    }
    ids.push(escolher(catalogoElegivel));
  }
  return { ids, recorreuAoCatalogo };
}

// Confere o esquema e devolve os candidatos do usuário (null no uniforme). Falha alto se faltarem.
function candidatosDoUsuario(esquema, candidatosPorUsuario, usuario) {
  if (!ESQUEMAS.includes(esquema)) {
    throw new Error(`esquema de negativos desconhecido "${esquema}": use 'uniforme' ou 'candidatos'`);
  }
  if (esquema === 'uniforme') return null;
  const c = candidatosPorUsuario?.get(usuario);
  if (!c) throw new Error(`usuário ${usuario} sem candidatos no esquema 'candidatos': gere os candidatos da fase (npm run candidatos)`);
  return c;
}

// Busca um registro num Map e falha alto com mensagem acionável se não existir.
function obter(mapa, id, oQue) {
  const v = mapa.get(id);
  if (!v) throw new Error(`${oQue} ${id} não encontrado: confira se os dados carregados são da mesma fase`);
  return v;
}

// Cria o escritor de linhas sobre x e y pré-alocados; cada chamada grava uma linha (já validada por montarEntrada).
function criarMatrizes(n, semPop) {
  const dim = semPop ? 68 : 70;
  const x = new Float32Array(n * dim);
  const y = new Float32Array(n);
  let i = 0;
  const gravar = (demo, perfil, filmeVetor, rotulo) => {
    const v = montarEntrada(demo, perfil, filmeVetor, { semPop });
    if (v.length !== dim) throw new Error(`dimensão errada na linha ${i}: ${v.length} (esperado ${dim})`);
    x.set(v, i * dim);
    y[i] = rotulo;
    i += 1;
  };
  const finalizar = () => {
    if (i !== n) throw new Error(`contagem de pares inconsistente: ${i} gravados, ${n} previstos`);
    const sha256 = crypto.createHash('sha256')
      .update(Buffer.from(x.buffer, x.byteOffset, x.byteLength))
      .update(Buffer.from(y.buffer, y.byteOffset, y.byteLength))
      .digest('hex');
    return { x, y, n, dim, sha256 };
  };
  return { gravar, finalizar };
}

/**
 * Pares de treino da fase. `historico` vem de `historicoDoTreino` (o mesmo treino que gerou a régua).
 * Sementes: um gerador por usuário, `criarAleatorio(1_000_000 · semente + usuario)`, consumido na ordem dos pares.
 * Exclusões do sorteio: os filmes avaliados pelo usuário no treino da fase.
 * Devolve também `negativosSorteados` (Map usuário → Set de filmes sorteados), usado na validação da mesma semente.
 */
export function paresDeTreino({
  historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema, semente, semPop = false,
}) {
  const usuarios = [...historico.keys()].sort((a, b) => a - b);
  const resumo = { positivos: 0, descartados: 0, observados: 0, sorteados: 0, recorreuAoCatalogo: 0 };

  // 1ª passada: contar os pares para pré-alocar.
  for (const u of usuarios) {
    const h = historico.get(u);
    if (h.curtidos.length >= 2) resumo.positivos += h.curtidos.length;
    else resumo.descartados += h.curtidos.length;
    for (const nota of h.notas.values()) if (nota < 4) resumo.observados += 1;
  }
  resumo.sorteados = POR_POSITIVO * resumo.positivos;
  const n = resumo.positivos + resumo.sorteados + resumo.observados;
  const { gravar, finalizar } = criarMatrizes(n, semPop);
  const negativosSorteados = new Map();

  // 2ª passada: gravar as linhas.
  for (const u of usuarios) {
    const h = historico.get(u);
    const demo = demografia(obter(usuariosPorId, u, 'usuário'), regua);
    const resumoU = resumoCurtidos(h.curtidos, regua);
    const perfilCompleto = perfilRede(resumoU, regua);
    const sorteadosU = new Set();
    negativosSorteados.set(u, sorteadosU);

    if (h.curtidos.length >= 2) {
      const candidatos = candidatosDoUsuario(esquema, candidatosPorUsuario, u);
      const aleatorio = criarAleatorio(1_000_000 * semente + u);
      // Um único sorteio por usuário com 4 × positivos: o índice j corre sobre os blocos, e j % 4 é a
      // posição no bloco; equivale a sortear bloco a bloco com o mesmo gerador.
      const { ids, recorreuAoCatalogo } = sortearNegativos({
        quantidade: POR_POSITIVO * h.curtidos.length,
        excluir: new Set(h.notas.keys()),
        catalogo, candidatos, aleatorio,
      });
      resumo.recorreuAoCatalogo += recorreuAoCatalogo;
      h.curtidos.forEach((filme, p) => {
        // filmeRemovido só para positivo de treino: o filme está, por construção, entre os curtidos.
        const perfilPositivo = perfilRede(resumoU, regua, filme);
        gravar(demo, perfilPositivo, filmeRede(filme, popZDoPar(filme.id, true, regua)), 1);
        for (let k = 0; k < POR_POSITIVO; k++) {
          const id = ids[p * POR_POSITIVO + k];
          sorteadosU.add(id);
          const f = obter(filmesPorId, id, 'filme sorteado');
          gravar(demo, perfilPositivo, filmeRede(f, popZDoPar(id, false, regua)), 0);
        }
      });
    }

    for (const [id, nota] of h.notas) {
      if (nota >= 4) continue;
      const f = obter(filmesPorId, id, 'filme');
      gravar(demo, perfilCompleto, filmeRede(f, popZDoPar(id, true, regua)), 0);
    }
  }

  return { ...finalizar(), resumo, negativosSorteados };
}

/**
 * Pares de validação: notas escondidas ≥ 4 são positivos, 1–3 negativos observados, e 4 sorteados por
 * positivo escondido. Perfil sempre completo do treino; popularidade nunca descontada (as notas escondidas
 * não entraram na régua). Semente por usuário: `criarAleatorio(5_000_000 + 1_000_000 · semente + usuario)`.
 * Exclusões: avaliados no treino, avaliados na validação e os sorteados para o usuário no treino da mesma semente.
 * Usuário sem positivo escondido não recebe sorteados.
 */
export function paresDeValidacao({
  historico, validacao, negativosSorteadosNoTreino, usuariosPorId, filmesPorId, regua, catalogo,
  candidatosPorUsuario, esquema, semente, semPop = false,
}) {
  if (!negativosSorteadosNoTreino) {
    throw new Error('paresDeValidacao precisa de negativosSorteadosNoTreino (de paresDeTreino da mesma semente)');
  }
  const porUsuario = new Map();
  for (const a of validacao) {
    if (historico.get(a.usuario)?.notas.has(a.filme)) {
      throw new Error(`vazamento: a nota escondida (usuário ${a.usuario}, filme ${a.filme}) também está no treino; confira as divisões`);
    }
    if (!porUsuario.has(a.usuario)) porUsuario.set(a.usuario, []);
    porUsuario.get(a.usuario).push(a);
  }
  const usuarios = [...porUsuario.keys()].sort((a, b) => a - b);
  const resumo = { positivos: 0, descartados: 0, observados: 0, sorteados: 0, recorreuAoCatalogo: 0 };
  for (const u of usuarios) {
    for (const a of porUsuario.get(u)) {
      if (a.nota >= 4) resumo.positivos += 1;
      else resumo.observados += 1;
    }
  }
  resumo.sorteados = POR_POSITIVO * resumo.positivos;
  const n = resumo.positivos + resumo.sorteados + resumo.observados;
  const { gravar, finalizar } = criarMatrizes(n, semPop);

  for (const u of usuarios) {
    const escondidas = porUsuario.get(u);
    const h = historico.get(u) ?? { notas: new Map(), curtidos: [] };
    const demo = demografia(obter(usuariosPorId, u, 'usuário'), regua);
    // Perfil completo só com o treino (referência da régua se não houver curtidos).
    const perfil = perfilRede(resumoCurtidos(h.curtidos, regua), regua);
    const positivos = escondidas.filter((a) => a.nota >= 4);

    let ids = [];
    if (positivos.length > 0) {
      const candidatos = candidatosDoUsuario(esquema, candidatosPorUsuario, u);
      const excluir = new Set([
        ...h.notas.keys(),
        ...escondidas.map((a) => a.filme),
        ...(negativosSorteadosNoTreino.get(u) ?? []),
      ]);
      const aleatorio = criarAleatorio(5_000_000 + 1_000_000 * semente + u);
      const sorteio = sortearNegativos({
        quantidade: POR_POSITIVO * positivos.length, excluir, catalogo, candidatos, aleatorio,
      });
      ids = sorteio.ids;
      resumo.recorreuAoCatalogo += sorteio.recorreuAoCatalogo;
    }

    positivos.forEach((a, p) => {
      const filme = obter(filmesPorId, a.filme, 'filme');
      gravar(demo, perfil, filmeRede(filme, popZDoPar(a.filme, false, regua)), 1);
      for (let k = 0; k < POR_POSITIVO; k++) {
        const id = ids[p * POR_POSITIVO + k];
        gravar(demo, perfil, filmeRede(obter(filmesPorId, id, 'filme sorteado'), popZDoPar(id, false, regua)), 0);
      }
    });
    for (const a of escondidas) {
      if (a.nota >= 4) continue;
      const filme = obter(filmesPorId, a.filme, 'filme');
      gravar(demo, perfil, filmeRede(filme, popZDoPar(a.filme, false, regua)), 0);
    }
  }

  return { ...finalizar(), resumo };
}
