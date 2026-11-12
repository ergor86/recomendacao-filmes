# Treino e avaliação (etapas 7–9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treinar a rede que ordena os candidatos, escolher a configuração na validação (spec §9.1), congelar as escolhas e fazer a avaliação final única no `u1.test` (spec §9.2).

**Architecture:** Continua a fundação (Plano 1, já na `main`). Os candidatos de cada fase são calculados uma vez e gravados com sha256; daí em diante treino e avaliação não dependem do banco. A entrada da rede e os pares ficam em `src/features/`, a rede e o ranqueador em `src/modelo/`, a regra de escolha e os experimentos em `src/avaliacao/`. Cada etapa experimental é um script em `scripts/` que grava um JSON em `resultados/`.

**Tech Stack:** Node 22, `@tensorflow/tfjs-node` 4.22, `pg`, Postgres 17 + pgvector 0.8.1 no Docker (WSL), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-07-recomendacao-filmes-design.md` (**v3.2**). Quem executa lê a spec e o plano. As seções citadas (§6, §7, §9, §10, §15) são as que este plano implementa.

## Global Constraints

- **Raiz:** `C:\dev\recomendacao-filmes`, branch `treino` criada a partir da `main`.
- **Dados:** o MovieLens nunca vai para o git nem para os testes. Os testes usam dados sintéticos criados no próprio teste. `modelos/` e `artefatos/` ficam fora do git; `resultados/` é versionada.
- **Regra do teste único:** o arquivo `u1.test` só é **lido** pelo script 13, depois das pré-condições, com `incluirTeste: true`. Nenhum outro script de treino ou avaliação o carrega (o script 03, de EDA, continua lendo só para contar). Nenhuma task roda o script 13 sem autorização explícita do usuário (Task 12).
- **Entrada da rede (spec §6):** 70 posições, nesta ordem:
  - 0–23 demografia: idade z-score da régua (0), gênero M, F (1–2), ocupação one-hot na ordem de `regua.ocupacoes` (3–23);
  - 24–46 perfil: média dos gêneros curtidos (24–42), média da época (43–45), popularidade média z-score (46);
  - 47–69 filme: gêneros 0/1 (47–65), época one-hot (66–68), popularidade z-score (69).

  Sem os pesos da busca. Controle: 68 posições, sem as posições 46 e 69.
- **Popularidade do filme num par:** contagem da régua, menos 1 **somente se** a nota do usuário para aquele filme está no treino que gerou a régua; depois `popZ`. A popularidade **do perfil** usa a contagem sem desconto (ruling R3).
- **Perfil por tipo de par (spec §6 v3.2):**

  | Par | Perfil |
  |---|---|
  | positivo de treino (nota ≥ 4) | sem o filme do par; usuário com 1 curtido: par descartado |
  | 4 negativos sorteados vinculados a esse positivo | o mesmo perfil do positivo |
  | negativo observado de treino (nota 1–3) | completo |
  | todos os pares de validação e a inferência | completo |
- **Sorteio de negativos (spec §7.2–7.3 v3.2):** com reposição; esquema `uniforme` (catálogo) ou `candidatos` (no bloco de 4, os sorteios de índice 0, 1 e 2 vêm dos candidatos K = 200 ∪ N = 100 do usuário e o de índice 3 do catálogo). Exclusões:
  - treino: filmes avaliados pelo usuário no treino da fase;
  - validação: avaliados no treino-exp ou na validação, **e** os sorteados para aquele usuário no treino da mesma semente; se não sobrar candidato elegível, o sorteio vai para o catálogo e conta em `resumo.recorreuAoCatalogo`;
  - os pares de validação têm 4 sorteados por positivo escondido; usuários sem positivo escondido (685, 797, 814) não recebem sorteados.
- **Sementes (tabela única; todas com `criarAleatorio`):**

  | Uso | Semente |
  |---|---|
  | divisões (Plano 1) | `42 + usuario` |
  | sorteio dos negativos de treino | `1_000_000 · semente + usuario` |
  | sorteio dos negativos de validação | `5_000_000 + 1_000_000 · semente + usuario` |
  | embaralhamento por época | `100_000 · semente + época` |
  | pesos iniciais | `glorotUniform({ seed: 1000 · semente + índice da camada })` |
  | bootstrap | `2026` (registrada no JSON) |
- **Rede (spec §7.4):** camadas `relu`, saída 1 `sigmoid`, `binaryCrossentropy`, `adam` com learning rate **0,001**, lote **256**, sementes **1, 2, 3**, `model.summary()` impresso a cada treino. Arquiteturas `128-64-32` e `64-32`. O embaralhamento é feito pelo nosso código e o `fit` roda 1 época por vez com `shuffle: false` (o `shuffle` do TF.js usa `Math.random`).
- **Parada e melhores pesos:** paciência **3** sobre a perda nos pares de validação, teto de **50** épocas (ruling R1); pesos da melhor época **restaurados** no fim. Épocas contadas a partir de 1. No treino final, cada semente treina exatamente a melhor época dela na validação.
- **Candidatos por fase:** `artefatos/candidatos-<fase>.json` (Task 7) é a única fonte de candidatos de treino e de avaliação. Os candidatos de um (K, N) menor são **prefixos** das listas gravadas (ruling R6). Todo leitor confere o sha256 e o hash da régua.
- **Métricas:** as de `src/avaliacao/metricas.js`. Nos sistemas com rede, o valor de cada usuário é a **média das 3 sementes** (não é ensemble); mínimo e máximo por semente vão à parte. `avaliarSistema` exige listas de exatamente 10 ids distintos.
- **Determinismo:** scores ordenados por (score decrescente, id crescente).
- **Falhar alto** com mensagem acionável: dimensão errada, NaN na entrada ou no score, hash de régua do modelo ou dos candidatos diferente da régua em uso, sha256 dos candidatos divergente, artefato ausente, script rodado fora de ordem.
- **Comentários:** cabeçalho em cada arquivo novo e comentário de finalidade em cada função, no padrão dos módulos do Plano 1.

### Formatos de arquivo (contratos entre tasks)

```text
artefatos/candidatos-<fase>.json
  { fase, hashRegua, k: 200, n: 100, sha256,
    porUsuario: { "<id>": { populares: number[200], vizinhos: number[0 | 100] } } }
  sha256 = sha256(jsonEstavel(porUsuario))

modelos/<nome>-<fase>-s<semente>/   model.json · weights.bin · regua.json · metadados.json
  nome = <negativos>-<arquitetura>[-sempop], ex.: candidatos-128-64-32-sempop
  metadados.json: { nome, fase, negativos, arquitetura, semPop, semente, epocas, melhorEpoca,
                    hashRegua, sha256Candidatos, sha256Pares, data, perdaValidacaoMelhor }

resultados/treino-<nome>-<fase>.json
  { nome, fase, negativos, arquitetura, semPop, hashRegua, sha256Candidatos,
    sementes: [{ semente, melhorEpoca, epocasTreinadas, atingiuTeto, segundos, sha256Pares,
                 historico: [{ epoca, perda, perdaValidacao }],
                 resumoPares: { treino: {...}, validacao: {...} | null } }] }

resultados/diario-treinos.jsonl     uma linha por execução do script 09: { data, argumentos, nome, fase, sha256Pares por semente }

resultados/comparacao-passo<1|2|4>.json
  { passo, k, n, modelos: [{ nome, ndcg, precisao, recall,
      porSemente: [{ semente, ndcg, precisao, recall, cobertura, popularidadeMediaContagem }],
      diagnosticos: { aucValidacao, correlacaoScorePopularidade } }],
    escolha: { escolhida, melhor, fragil, tabela } | null }

resultados/grade-validacao.json
  { modelo, linhas: [{ k, n, ndcg, porSemente: [ndcg], orcamentoEfetivo }], escolha,
    gruposValidacao: { escala, mediana, tamanhos, ndcgPorGrupo },
    descritivaPerdedorPasso1: { modelo, linhas } }

resultados/configuracao-final.json
  { negativos, arquitetura, k, n, modelo, controle,
    epocasPorSemente: { modelo: { "1": e, "2": e, "3": e }, controle: { ... } },
    seed_api: 1, escalaMainstream: "media de popEscalada dos curtidos no treino",
    sementeBootstrap: 2026, hashReguaExp, data }
```

`escolha = { escolhida, melhor, fragil: boolean, tabela: [{ nome, media, diferenca, erroPadrao, empata }] }`.

### Rulings do plano (onde a spec é omissa)

| # | Decisão | Por quê |
|---|---|---|
| R1 | Teto de **50 épocas**; `atingiuTeto` gravado. | A spec fixa a paciência, mas não um teto. |
| R3 | A popularidade do **perfil** usa a contagem sem desconto, em todas as fases. | É igual no treino, na validação e na inferência; o desconto da spec é para o filme do par. |
| R4 | A popularidade de referência (usuário sem curtidas) em z-score é `(min + p · (max − min) − media) / desvio`, com `p = referencias.popularidadeMedia`. | Exata (diferença medida de 1e-13) e não muda a régua. |
| R6 | Candidatos de (K, N) menores são prefixos das listas de K = 200 e N = 100 gravadas por fase, em todos os experimentos. | Mesma nuance de HNSW do script 07; um único cálculo por fase. |
| R7 | 478 usuários de validação com relevantes. | Medido; corrigido na spec v3.2. |
| R8 | Pasta do modelo inclui a fase (`<nome>-<fase>-s<semente>`), diferente da spec §7.5. | Evita que o treino final sobrescreva os modelos da validação. |
| R9 | Trava de sanidade: NDCG@10 de um modelo **abaixo de 0,15 ou acima de 0,35** na validação → parar e investigar. | Uma ordem aleatória entre os populares dá cerca de 0,072; ficar abaixo da popularidade (0,233) é resultado legítimo, não bug. |
| R10 | Decisão **frágil**: quando os intervalos [mín, máx] das médias por semente da melhor e da escolhida se sobrepõem. Fica registrada, não muda a regra. | O erro padrão por usuário não enxerga a variação entre sementes. |

## Review Focus

1. **Vazamento:** uma nota da validação ou do `u1.test` nunca entra num perfil, numa contagem ou num desconto; o `u1.test` não é lido antes do script 13. Testado nas Tasks 2, 3, 4 e 11.
2. **Atalho do perfil:** positivo e seus 4 sorteados têm exatamente o mesmo perfil. Testado na Task 4.
3. **Rodar de novo dá os mesmos números:** mesmos pares (sha256) e mesmos pesos com a mesma semente; fluxos de sorteio e de embaralhamento distintos entre sementes e épocas. Testado nas Tasks 4 e 5.
4. **Régua, candidatos ou modelo de outra fase** devem gerar erro, nunca resultados silenciosos. Testado nas Tasks 5, 6, 7 e 11.
5. **Usuário sem curtidas** (o 685) recebe perfil de referência, sem NaN, nos pares e na inferência. Testado nas Tasks 3, 4 e 6.

---

### Task 1: Teste do caminho de ampliação da busca

**Files:**
- Modify: `tests/unidade/banco-falso.test.js`

**Interfaces:**
- Consumes: `buscarVizinhos` (`src/banco/busca.js`) e o `poolFalso` do arquivo de teste.

O caminho "empate no corte → pedir o dobro → teto de 1000" nunca rodou com dados reais.

- [ ] **Step 1: Ampliar o `poolFalso`** para registrar `{ sql, params }` e chamar `responder(sql, params)`. Os testes existentes continuam passando.
- [ ] **Step 2: Escrever os testes.** Na consulta de busca (`sql` com `embedding <=>`), o `LIMIT` pedido é `params[2]`; guardar cada um em `limitesPedidos`. O `responder` devolve `min(LIMIT, total)` linhas.

```js
test('empate no corte: pede o dobro de linhas e devolve os n primeiros por (distância, id)', async () => {
  // total = 200: ids 1..60 com distância 0.1, ids 61..200 com 0.5; n = 10
  assert.deepEqual(r.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(limitesPedidos, [60, 120]);
});
test('empate que não cabe em 1000 linhas: erro acionável', async () => {
  // total = 2000, todas com distância 0.1
  await assert.rejects(busca, /não cabe em 1000 linhas; reduza N/);
  assert.deepEqual(limitesPedidos, [60, 120, 240, 480, 960, 1000]);
});
test('menos linhas que n: erro acionável', async () => {
  // total = 5, n = 10
  await assert.rejects(busca, /menos que as 10 pedidas/);
});
```

- [ ] **Step 3: Rodar `npm test`.** Expected: PASS. Se falhar, é bug real: parar e investigar.
- [ ] **Step 4: Commit.** `git commit -m "test: caminho de ampliação e teto da busca com banco falso"`

---

### Task 2: Contexto sem o `u1.test`

**Files:**
- Modify: `src/dados/carregar.js`, `src/contexto.js`, `scripts/03-eda.js`
- Create: `tests/unidade/contexto.test.js`

**Interfaces:**
- Produces:
  - `carregarDataset(dir, { incluirTeste = false } = {})`: sem `incluirTeste`, não lê `u1.test` e devolve `teste: null`;
  - `criarContexto({ fase, dirDados, incluirTeste = false })`: na fase `final` sem `incluirTeste`, `alvos` é `null`; na fase `exp`, `alvos` é a validação (não depende do teste);
  - `criarDivisoes` aceita `teste: null` e o devolve como está.

- [ ] **Step 1: Escrever os testes que falham**, com uma pasta temporária sintética (`fs.mkdtempSync`) contendo `u1.base`, `u.item`, `u.user`, `u.genre`, `u.occupation` e **sem** `u1.test`:
  - `criarContexto({ fase: 'exp' })` funciona e `alvos` é a validação;
  - `criarContexto({ fase: 'final' })` funciona e `alvos` é `null`;
  - `criarContexto({ fase: 'final', incluirTeste: true })` lança o erro de arquivo ausente.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.** O script 03 passa `incluirTeste: true` (só conta linhas e usuários do teste).
- [ ] **Step 4: Rodar `npm test` e `npm run eda`.** Expected: PASS; a saída da EDA igual à de antes.
- [ ] **Step 5: Commit.** `git commit -m "feat: u1.test só é lido quando pedido explicitamente"`

---

### Task 3: Entrada da rede

**Files:**
- Create: `src/features/entrada.js`, `tests/unidade/entrada.test.js`

**Interfaces:**
- Consumes: `popZ`, `faixaEpoca` (`src/features/regua.js`).
- Produces (filmes são objetos `{ id, generos, ano }`, como em `dataset.filmes`):
  - `historicoDoTreino(treino, filmesPorId) → Map<usuario, { notas: Map<filmeId, nota>, curtidos: filme[] }>`;
  - `demografia(usuario, regua) → number[24]`; ocupação desconhecida: erro;
  - `popZReferencia(regua) → number` (ruling R4);
  - `resumoCurtidos(curtidos: filme[], regua) → { somaGeneros: number[19], somaEpoca: number[3], somaPop: number, n }`;
  - `perfilRede(resumo, regua, filmeRemovido: filme | null = null) → number[23]`: média; com `filmeRemovido`, `(soma − filme) / (n − 1)`; com 0 curtidos efetivos, a referência (`generosMedia`, `epocaMedia`, `popZReferencia`);
  - `popZDoPar(filmeId, avaliouNoTreinoDaRegua: boolean, regua) → number`;
  - `filmeRede(filme, popZPar) → number[23]`;
  - `montarEntrada(demo, perfil, filme, { semPop = false } = {}) → number[]` (70 ou 68 posições, ordem dos Global Constraints); confere dimensão e `Number.isFinite`.

- [ ] **Step 1: Escrever os testes que falham**, com uma régua sintética (3 filmes, 2 ocupações):
  - demografia em z-score e one-hots;
  - perfil sem o filme do par: com curtidos A e B, `perfilRede(resumo, regua, A)` é igual ao perfil de só B;
  - usuário sem curtidas: perfil = referência, sem NaN;
  - `popZReferencia` bate com `popZ` de uma contagem cujo `popEscalada` é `referencias.popularidadeMedia`;
  - `popZDoPar(f, true)` usa contagem − 1 e `popZDoPar(f, false)` a contagem cheia;
  - `montarEntrada` dá 70 posições; com `semPop`, 68, sem os valores das posições 46 e 69;
  - NaN em `montarEntrada` lança erro.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: entrada da rede (70 posições) com perfil sem o filme do par"`

---

### Task 4: Pares de treino, pares de validação e negativos

**Files:**
- Create: `src/features/pares.js`, `tests/unidade/pares.test.js`

**Interfaces:**
- Consumes: Task 3; `criarAleatorio`; `jsonEstavel` e `node:crypto` para o sha256.
- Produces:
  - `sortearNegativos({ quantidade, excluir: Set, catalogo: number[], candidatos: number[] | null, aleatorio }) → { ids: number[], recorreuAoCatalogo: number }`: filtra os elegíveis **antes** de sortear; esquema candidatos pelo índice no bloco (`j % 4 < 3` → candidatos); candidatos elegíveis vazios → catálogo (conta em `recorreuAoCatalogo`); catálogo elegível vazio → erro;
  - `paresDeTreino({ historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema, semente, semPop }) → { x: Float32Array, y: Float32Array, n, dim, resumo, negativosSorteados: Map<usuario, Set<filmeId>>, sha256 }`;
    - `resumo = { positivos, descartados, observados, sorteados, recorreuAoCatalogo }`;
    - `candidatosPorUsuario.get(u)` = `[...populares, ...vizinhos]` sem repetição (de `artefatos/candidatos-<fase>.json`);
  - `paresDeValidacao({ historico, validacao, negativosSorteadosNoTreino, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema, semente, semPop }) → mesmo formato, sem negativosSorteados`.

Regras: Global Constraints (perfil por tipo de par, exclusões, sementes da tabela). Desconto de popularidade para **todo** filme avaliado no treino da régua (positivos e observados); sorteados e pares de validação sem desconto. `sha256 = sha256 de x e y`.

- [ ] **Step 1: Escrever os testes que falham** com um histórico sintético:
  - usuário com 1 curtido: par positivo descartado (`resumo.descartados`);
  - sorteados = 4 × positivos usáveis, por usuário, e **cada um dos 4 tem perfil idêntico ao do seu positivo** (comparar as fatias 24–46 de `x`);
  - negativo observado tem perfil completo e popularidade com desconto; positivo também tem desconto; sorteado não tem;
  - nenhum sorteado de treino é filme avaliado no treino;
  - nos pares de validação: perfil completo; nenhuma nota escondida altera perfil ou popularidade (comparar com e sem a validação); nenhum sorteado está entre os avaliados no treino ou na validação **nem entre `negativosSorteadosNoTreino` do usuário**; usuário sem positivo escondido não recebe sorteados; usuário sem curtidas (referência) sem NaN;
  - com candidatos esgotados, o sorteio vai ao catálogo e `recorreuAoCatalogo` > 0;
  - com 5 candidatos e quantidade grande, ids se repetem (com reposição);
  - esquema `candidatos`: sorteios de índice 0, 1, 2 (mod 4) estão nos candidatos;
  - mesma semente → mesmo `sha256`; semente 1 e 2 → `sha256` diferentes.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar**, escrevendo direto em `Float32Array` pré-alocado (cerca de 196 mil pares na fase `exp` e 257 mil na final; cerca de 61 mil pares de validação).
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: pares com negativos em blocos por positivo e validação sem repetir o treino"`

---

### Task 5: Rede: criar, treinar com melhores pesos, salvar e carregar

**Files:**
- Create: `src/modelo/rede.js`, `tests/unidade/rede.test.js`

**Interfaces:**
- Consumes: `criarAleatorio`, `embaralhar`; `@tensorflow/tfjs-node`.
- Produces:
  - `ARQUITETURAS = { '128-64-32': [128, 64, 32], '64-32': [64, 32] }`;
  - `criarRede({ arquitetura, dimEntrada, semente }) → tf.LayersModel` compilada;
  - `treinar({ modelo, x, y, dim, semente, validacao = null, perdaValidacao = null, epocas = null, maxEpocas = 50, paciencia = 3, aoFimDaEpoca = null }) → Promise<{ melhorEpoca, epocasTreinadas, atingiuTeto, historico: [{ epoca, perda, perdaValidacao }] }>`:
    - modo **parada automática** quando há `validacao` (`{ x, y }`) ou `perdaValidacao(modelo) → number` (injetável nos testes; dispensa `validacao`);
    - modo **épocas fixas** quando há `epocas` (treino final);
    - `aoFimDaEpoca({ epoca, perda, perdaValidacao, pesos })`, com `pesos` = cópia dos pesos (`Float32Array[]`);
    - épocas contadas a partir de 1;
  - `prever(modelo, x: Float32Array, dim) → Float32Array`, em lotes, sem vazar tensores; NaN gera erro;
  - `salvarModelo(modelo, dir, { regua, metadados })` e `carregarModelo(dir, reguaEmUso) → { modelo, metadados }`; hash diferente → erro `modelo treinado com outra régua: retreine com npm run treinar -- --fase <fase>`.

- [ ] **Step 1: Escrever os testes que falham** (200 linhas × 6 colunas sintéticas):
  - **melhores pesos (spec §10):** `perdaValidacao` injetada devolvendo `[0.5, 0.3, 0.4, 0.45, 0.5]` → `melhorEpoca = 2`, `epocasTreinadas = 5`, pesos finais **idênticos** aos de `aoFimDaEpoca` na época 2;
  - `epocas: 3` treina exatamente 3 épocas; `maxEpocas: 4` com perda sempre caindo → `atingiuTeto = true`;
  - mesma semente → pesos idênticos; sementes diferentes → diferentes;
  - os fluxos de embaralhamento `100_000 · s + e` para s = 1..3 e e = 1..50 têm 150 primeiras permutações distintas;
  - salvar e carregar dá as mesmas previsões; régua de outro hash → erro acima;
  - `tf.memory().numTensors` igual antes e depois de `prever`.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Caminhos com `'file://' + path.resolve(dir)`. Guardar os melhores pesos com `clone` e liberar os anteriores.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: rede densa com sementes, parada automática e restauração dos melhores pesos"`

---

### Task 6: Ranqueador, regra de escolha e diagnósticos

**Files:**
- Create: `src/modelo/ranqueador.js`, `src/avaliacao/escolha.js`, `src/avaliacao/diagnosticos.js`, `tests/unidade/ranqueador.test.js`, `tests/unidade/escolha.test.js`, `tests/unidade/diagnosticos.test.js`
- Modify: `src/candidatos/hibrido.js` (`contribuicaoExclusiva` com `origem`)

**Interfaces:**
- Consumes: Tasks 3 e 5; `erroPadraoPareado`; `unirCandidatos`.
- Produces:
  - `candidatosDe(entrada: { populares, vizinhos }, k, n) → { ids, fonte }` = `unirCandidatos(populares.slice(0, k), vizinhos.slice(0, n))` (ruling R6);
  - `pontuarCandidatos({ modelo, regua, semPop, usuario, curtidos, candidatos: number[], filmesPorId }) → Map<id, score>`: perfil completo, sem desconto; um `prever` por usuário;
  - `top10PorScore(scores: Map) → number[]`, por (score decrescente, id crescente);
  - `projetar(porUsuario: Map<u, { ndcg, precisao, recall }>, metrica) → Map<u, number>`;
  - `mediaEntreSementes(porSemente: Map<u, number>[]) → Map<u, number>`; conjuntos de usuários diferentes → erro;
  - `escolherConfiguracao(configs: [{ nome, porUsuario: Map, porSemente: number[], simplicidade: number[] }]) → escolha` (formato dos Global Constraints): melhor = maior média; c empata com b se `media(b) − media(c) < erroPadraoPareado(diferenças por usuário)`; entre as empatadas, a menor `simplicidade` lexicográfica; `fragil` pelo ruling R10;
  - `auc(scores: Float32Array, rotulos: Float32Array) → number` e `correlacao(a: number[], b: number[]) → number` (Pearson);
  - `contribuicaoExclusiva(acertos, fonte, origem = 'vet')` e `contribuicaoExclusivaAgregada(listas, origem = 'vet')` aceitam `'pop'`.

- [ ] **Step 1: Escrever os testes que falham:** desempate de `top10PorScore` pelo id; `candidatosDe` com prefixos; `mediaEntreSementes`; escolha (empate escolhe a mais simples, diferença maior escolhe a melhor, desempate pelo 2º elemento, `fragil` quando as faixas se sobrepõem); `auc` = 1 para separação perfeita e 0,5 para scores constantes; contribuição exclusiva com `origem: 'pop'`; `pontuarCandidatos` com usuário sem curtidas sem NaN.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS (inclusive os testes antigos de `hibrido`).
- [ ] **Step 5: Commit.** `git commit -m "feat: ranqueador, regra de escolha e diagnósticos"`

---

### Task 7: Candidatos por fase gravados com sha256

**Files:**
- Create: `scripts/08-gerar-candidatos.js`, `src/candidatos/arquivo.js`, `tests/unidade/arquivo-candidatos.test.js`
- Modify: `package.json` (script `gerar-candidatos`)

**Interfaces:**
- Consumes: `criarContexto`, `carregarRegua`, `gerarCandidatos` (`k: 0, n: 100`), `popularesNaoVistos`, `rankingPopularidade`, `historicoDoTreino`.
- Produces:
  - `npm run gerar-candidatos -- --fase exp|final`: para **todo** usuário do treino da fase, `populares` (200 não vistos) e `vizinhos` (100, ou `[]` sem curtidas); grava `artefatos/candidatos-<fase>.json`;
  - `lerCandidatos(caminho, regua) → Map<usuario, { populares, vizinhos }>`: confere sha256 e `hashRegua`; erro acionável `candidatos de outra régua ou alterados: rode npm run gerar-candidatos -- --fase <fase>`.

- [ ] **Step 1: Escrever os testes que falham** de `lerCandidatos`: arquivo íntegro carrega; sha256 alterado e régua diferente geram o erro.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar** o módulo e o script (o banco precisa estar na régua da fase; a busca confere o hash).
- [ ] **Step 4: Rodar `npm test` e `npm run gerar-candidatos -- --fase exp`.** Expected: 943 usuários; populares sempre 200; vizinhos 100, exceto o 685 com `[]`.
- [ ] **Step 5: Commit** (o arquivo em `artefatos/` não vai para o git): `git commit -m "feat: candidatos por fase gravados com sha256"`

---

### Task 8: Script de treino e passo 1 (negativos)

**Files:**
- Create: `scripts/09-treinar.js`
- Modify: `package.json` (script `treinar`), `README.md` (seção do Plano 2)

**Interfaces:**
- Consumes: Tasks 2–5 e 7.
- Produces: `npm run treinar -- --fase exp|final --negativos uniforme|candidatos --arquitetura 128-64-32|64-32 [--sem-pop] [--epocas-de <arquivo>] [--max-epocas <n>] [--saida <pasta>]`.
  - Fase `exp`: para cada semente 1, 2, 3, monta os pares de treino e de validação daquela semente, treina com parada automática e grava o modelo e `treino-<nome>-exp.json` (formatos dos Global Constraints). Calcula na melhor época a `perdaValidacaoMelhor`.
  - Fase `final`: exige `--epocas-de resultados/treino-<nome>-exp.json`; `criarContexto` **sem** `incluirTeste`; sem pares de validação; cada semente treina a sua `melhorEpoca`.
  - `--saida` troca as pastas de `modelos/` e `resultados/` (para fumaça); `--max-epocas` substitui o teto.
  - Acrescenta uma linha a `resultados/diario-treinos.jsonl` (exceto com `--saida`).

- [ ] **Step 1: Implementar o script**, com mensagens acionáveis para régua ausente, candidatos ausentes ou de outra régua e `--epocas-de` ausente na fase final.
- [ ] **Step 2: Fumaça:** `npm run treinar -- --fase exp --negativos uniforme --arquitetura 64-32 --max-epocas 1 --saida artefatos/fumaca`. Expected: roda de ponta a ponta. Apagar `artefatos/fumaca`.
- [ ] **Step 3: Passo 1:**
  - `npm run treinar -- --fase exp --negativos uniforme --arquitetura 128-64-32`
  - `npm run treinar -- --fase exp --negativos candidatos --arquitetura 128-64-32`

  Expected: cerca de 196 mil pares de treino e 61 mil de validação por semente; `sha256Pares` diferente entre sementes; cerca de 4 s por época; nenhum `atingiuTeto` (se houver, registrar e avisar).
- [ ] **Step 4: Commit** do script, `package.json`, README, `treino-*-exp.json` e diário: `git commit -m "feat: script de treino e treinos do passo 1 (negativos)"`

---

### Task 9: Comparação na validação (passos 1 e 2)

**Files:**
- Create: `scripts/10-comparar.js`
- Modify: `package.json` (script `comparar`)

**Interfaces:**
- Consumes: Tasks 6–8, `avaliarSistema`, `relevantesPorUsuario`.
- Produces: `npm run comparar -- --passo 1|2|4 --modelos <nome>,<nome>`.
  - Passos 1 e 2 usam K = 200, N = 100. O passo 4 lê K e N de `resultados/grade-validacao.json` (erro se não existir).
  - Por modelo e semente: `top10PorScore` → `avaliarSistema`; por modelo: médias entre sementes, `porSemente` e diagnósticos (AUC nos pares de validação da semente 1; correlação entre score e `popZ` do filme nos candidatos).
  - Passos 1 e 2: `escolherConfiguracao` com simplicidade `[0]` para `uniforme` / `64-32` e `[1]` para o outro braço. Passo 4: `escolha: null` e, para o controle, diferença média e erro padrão em relação ao modelo.
  - **Trava R9** para cada modelo.
  - Grava `resultados/comparacao-passo<passo>.json`.

- [ ] **Step 1: Implementar o script.**
- [ ] **Step 2: Passo 1:** `npm run comparar -- --passo 1 --modelos uniforme-128-64-32,candidatos-128-64-32`.
- [ ] **Step 3: Passo 2:** `npm run treinar -- --fase exp --negativos <escolhido> --arquitetura 64-32` e `npm run comparar -- --passo 2 --modelos <escolhido>-128-64-32,<escolhido>-64-32`.
- [ ] **Step 4: Commit:** `git commit -m "feat: comparação na validação e passos 1 e 2"`

---

### Task 10: Grade, controle e congelamento (passos 3 e 4)

**Files:**
- Create: `scripts/11-grade.js`, `scripts/12-congelar.js`
- Modify: `package.json` (scripts `grade` e `congelar`)

**Interfaces:**
- Consumes: Tasks 6–9; `grupoMainstream`, `popEscalada`.
- Produces:
  - `npm run grade -- --modelo <escolhido no passo 2> --perdedor-passo1 <nome>`: grade K ∈ {50, 100, 150, 200} × N ∈ {0, 20, 50, 100} com `candidatosDe`, scores calculados uma vez por usuário e semente; `escolherConfiguracao` com simplicidade `[K + N, N]`; a mesma grade, **só descritiva**, com o perdedor do passo 1; grupos mainstream × nicho da validação (escala `popEscalada`, mediana da régua-exp) com NDCG da popularidade e do modelo em cada grupo. Grava `resultados/grade-validacao.json`.
  - `npm run congelar -- --modelo <nome> --controle <nome>`: lê `treino-*-exp.json` e `grade-validacao.json` e grava `resultados/configuracao-final.json`. Recusa se `resultados/avaliacao-final.json` existir (`a avaliação final já foi feita; a configuração não pode mudar depois do teste`).

- [ ] **Step 1: Implementar os dois scripts.**
- [ ] **Step 2: Passo 3:** `npm run grade -- --modelo <escolhido> --perdedor-passo1 <nome>`. Expected: 16 linhas; se N = 0 vencer, é resultado (spec §9.1).
- [ ] **Step 3: Passo 4:** `npm run treinar -- --fase exp --negativos <escolhido> --arquitetura <escolhida> --sem-pop` e `npm run comparar -- --passo 4 --modelos <modelo>,<modelo>-sempop`.
- [ ] **Step 4: Congelar:** `npm run congelar -- --modelo <modelo> --controle <modelo>-sempop`. Conferir que o arquivo tem todos os campos do formato.
- [ ] **Step 5: Commit:** `git commit -m "feat: grade K × N, controle e congelamento da configuração final"`. **Este commit é o registro de que as escolhas foram congeladas antes do teste.**

---

### Task 11: Script da avaliação final (sem rodar)

**Files:**
- Create: `scripts/13-avaliacao-final.js`, `src/avaliacao/experimentos.js`, `tests/unidade/experimentos.test.js`
- Modify: `package.json` (script `avaliacao-final`)

**Interfaces:**
- Consumes: tudo acima; `bootstrapPareado`, `grupoMainstream`, `carregarRegua`, `lerHashCarregado`.
- Produces:
  - `popularesMesmoOrcamento(ranking, vistos, tamanho) → number[]` (Exp. 5: `tamanho` = nº de candidatos únicos do Exp. 4 **daquele usuário**);
  - `todosNaoVistos(catalogo, vistos) → number[]` (Exp. 6);
  - `verificarPreCondicoes({ configuracao, avaliacaoExiste, reguaFinal, hashBanco, candidatosFinal, modelos }) → void`, com uma mensagem acionável para cada uma das 6 falhas: sem `configuracao-final.json`; avaliação já existe; sem `artefatos/regua-final.json` (`rode npm run carregar-filmes -- --fase final`); banco em outra régua; candidatos finais ausentes ou de outra régua; modelo final ausente ou de outra régua;
  - `npm run avaliacao-final`: chama `verificarPreCondicoes` **antes** de `criarContexto({ fase: 'final', incluirTeste: true })`. Nos usuários do `u1.test` com relevantes:
    - os 7 experimentos da spec §9.2, com os candidatos por prefixo (ruling R6) nos Exp. 3, 4, 5 e 7;
    - **bootstrap pareado** (5000, semente 2026) de Exp. 4 − Exp. 1 com a média das sementes, e também por semente, como sensibilidade descritiva;
    - diferenças descritivas dos Exp. 2, 5, 6 e 7 em relação ao Exp. 4, sem intervalo; o Exp. 3 reporta recall da união, orçamento efetivo e contribuição exclusiva das duas fontes;
    - mínimo e máximo por semente; cobertura e popularidade média por semente e na média;
    - mainstream × nicho (escala de `configuracao-final.json`, mediana da régua-final): tamanho dos grupos, usuários sem curtidas fora do corte, métricas por grupo;
    - Exp. 2 exclui usuários sem curtidas e informa quantos; se N = 0 venceu, aplicar a regra da spec §9.2.
  - Grava `resultados/avaliacao-final.json` **uma vez**.

- [ ] **Step 1: Escrever os testes que falham:** `popularesMesmoOrcamento` devolve exatamente `tamanho` não vistos, igual ao nº de candidatos do Exp. 4 do mesmo usuário num caso sintético; `todosNaoVistos`; cada uma das 6 recusas de `verificarPreCondicoes`.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar** o módulo e o script.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS. **Não rodar o script 13.**
- [ ] **Step 5: Commit:** `git commit -m "feat: script da avaliação final com pré-condições do teste único"`

---

### Task 12: Avaliação final no `u1.test` (só com autorização do usuário)

**Files:**
- Create (gerados): `resultados/treino-*-final.json`, `resultados/avaliacao-final.json`
- Modify: `README.md`, `resultados/README.md`

> **PARAR antes do Step 2 e pedir autorização explícita ao usuário.** O `u1.test` só pode ser usado uma vez. Mostrar a `configuracao-final.json` e os números da validação, e esperar o "pode rodar".

- [ ] **Step 1: Resumo para o usuário:** configuração congelada, decisões marcadas como frágeis, números da validação e o que será rodado.
- [ ] **Step 2: Régua-final, banco e candidatos:** `npm run carregar-filmes -- --fase final` e `npm run gerar-candidatos -- --fase final`.
- [ ] **Step 3: Seis retreinos:** `npm run treinar -- --fase final ... --epocas-de resultados/treino-<nome>-exp.json` para o modelo e para o controle.
- [ ] **Step 4: `npm run avaliacao-final`**, uma vez. Se falhar por erro de código **antes** de gravar `avaliacao-final.json`, corrigir e rodar de novo é permitido; registrar no README.
- [ ] **Step 5: Documentar** no README e em `resultados/README.md`: tabela dos 7 experimentos, intervalo da hipótese principal, mainstream × nicho e limitações (spec §15).
- [ ] **Step 6: Commit:** `git commit -m "feat: avaliação final no u1.test"`

---

## Depois deste plano

- **Etapa 10 (opcional):** API e interface (`src/api/` + front), com o modelo da semente 1.
- Itens adiados da revisão de código do Plano 1: `DIR_DADOS` com outro nome no script 02, duplicações entre os scripts 01/03 e 05/07, uso de memória do script 07.
