# Treino e avaliação (etapas 7–9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treinar a rede que ordena os candidatos, escolher a configuração na validação (spec §9.1), congelar as escolhas e fazer a avaliação final única no `u1.test` (spec §9.2).

**Architecture:** Continua a fundação (Plano 1, já na `main`). A entrada da rede e os pares ficam em `src/features/`, a rede em `src/modelo/` e a regra de escolha em `src/avaliacao/`. Cada etapa experimental é um script em `scripts/` que grava um JSON em `resultados/`. O banco e a busca não mudam.

**Tech Stack:** Node 22, `@tensorflow/tfjs-node` 4.22, `pg`, Postgres 17 + pgvector 0.8.1 no Docker (WSL), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-07-recomendacao-filmes-design.md` (v3.1, congelada). Quem executa lê a spec e o plano. As seções citadas aqui (§6, §7, §9, §10) são as que este plano implementa.

## Global Constraints

- **Raiz:** `C:\dev\recomendacao-filmes`, branch `treino` criada a partir da `main`.
- **Dados:** o MovieLens nunca vai para o git nem para os testes. Os testes usam dados sintéticos criados no próprio teste. `modelos/` e `artefatos/` ficam fora do git; `resultados/` é versionada.
- **Regra do teste único:** só o script 11 lê o `u1.test` para métricas, e só depois de `resultados/configuracao-final.json` existir. Nenhuma task roda o script 11 sem autorização explícita do usuário (Task 10).
- **Entrada da rede (spec §6):** 70 posições = demografia 24 (idade z-score da régua, gênero 2, ocupação 21) + perfil 23 (média dos gêneros curtidos 19, média da época 3, popularidade média z-score) + filme 23 (gêneros 19, época 3, popularidade z-score). Sem os pesos da busca. Controle: 68 posições, sem as duas popularidades.
- **Popularidade do filme num par:** contagem da régua, menos 1 **somente se** a nota do usuário para aquele filme está no treino que gerou a régua; depois `log(1 + n)` e z-score com média e desvio **da régua** (`popZ`).
- **Pares (spec §7.1–7.3):**
  - positivos = todas as notas ≥ 4 do treino, com perfil **sem o filme do par**; usuário com 1 curtido tem o par descartado;
  - negativos observados = notas 1–3 do treino, com perfil completo;
  - sorteados = 4 × positivos usáveis, por usuário, **com reposição**;
  - pares de validação: notas escondidas 4–5 positivas, 1–3 negativas, mais sorteados no mesmo esquema e proporção, com outra semente; nunca sortear filme avaliado no treino-exp ou na validação.
- **Esquemas de negativos:** `uniforme` (catálogo) e `candidatos` (a cada 4 sorteios, os 3 primeiros dos candidatos K = 200 ∪ N = 100 do usuário, o 4º do catálogo).
- **Rede (spec §7.4):** camadas `relu`, saída 1 `sigmoid`, `binaryCrossentropy`, `adam` com learning rate **0,001**, lote **256**, sementes **1, 2, 3**, `model.summary()` impresso a cada treino. Arquiteturas `128-64-32` e `64-32`.
- **Parada e melhores pesos:** paciência **3** sobre a perda nos pares de validação; os pesos da melhor época são **restaurados** no fim. No treino final, cada semente treina exatamente a melhor época dela na validação.
- **Artefatos:** `modelos/<nome>-<fase>-s<semente>/` com `model.json`, `weights.bin`, `regua.json` e `metadados.json` (arquitetura, negativos, semente, épocas, hash da régua, data, métricas).
- **Métricas:** as de `src/avaliacao/metricas.js`. Nos sistemas com rede, o valor de cada usuário é a **média das 3 sementes** (não é ensemble); mínimo e máximo por semente vão à parte.
- **Determinismo:** todo sorteio usa `criarAleatorio`; scores são ordenados por (score decrescente, id crescente).
- **Falhar alto** com mensagem acionável: dimensão errada, NaN na entrada ou no score, hash de régua do modelo diferente da régua em uso, artefato ausente, script rodado fora de ordem.

### Decisões tomadas onde a spec é omissa (rulings do plano)

| # | Decisão | Por quê |
|---|---|---|
| P1 | Máximo de **50 épocas** por treino com parada automática. | A spec fixa a paciência, mas não um teto. 50 é folga larga para ~200 mil pares e evita treino infinito. |
| P2 | Os negativos sorteados são gerados **uma vez por fase** (semente 42 no treino, 43 nos pares de validação) e **compartilhados** pelas 3 sementes da rede. | A spec diz que a semente da rede controla pesos iniciais e embaralhamento. Assim a variação entre sementes mede só o treino. |
| P3 | A popularidade **do perfil** usa a contagem da régua **sem desconto**, em todas as fases. Só a popularidade **do filme do par** tem desconto. | A spec define o desconto para o filme do par. O perfil é igual no treino, na validação e na inferência, então não cria diferença entre as fases. |
| P4 | A popularidade de referência (usuário sem curtidas) em z-score é derivada de `referencias.popularidadeMedia` invertendo o mín/máx: `popZ = (min + p·(max − min) − media) / desvio`. | É exata (a média é linear e não há corte nas contagens do treino) e evita mudar a régua, o que mudaria o hash e exigiria recarregar o banco. |
| P5 | O embaralhamento é feito pelo nosso código (`embaralhar` com `criarAleatorio(semente + época)`), com `fit` de 1 época e `shuffle: false`. Os pesos iniciais usam `glorotUniform({ seed: 1000 · semente + índice da camada })`. | O `shuffle` interno do TF.js usa `Math.random`. Medido em 2026-11-11: com essa receita, dois treinos dão pesos idênticos. |
| P6 | Na grade (passo 3), os candidatos de cada (K, N) são **prefixos** de uma única consulta com K = 200 e N = 100, como no script 07. | Mesma nuance de HNSW já documentada no script 07; evita 16 consultas por usuário. |
| P7 | 478 usuários de validação com relevantes (a spec previa 480). | Já registrado no Plano 1: as contagens são calculadas pelo código. |

## Review Focus

1. **Vazamento das notas escondidas:** uma nota da validação (ou do `u1.test`) nunca entra num perfil, numa contagem ou num desconto de popularidade. Testado nas Tasks 2 e 3.
2. **Rodar de novo dá os mesmos números:** mesmo treino com a mesma semente deve dar pesos idênticos, e os mesmos pares. Testado nas Tasks 3 e 4.
3. **Modelo treinado com uma régua usado com outra** (por exemplo, modelo da fase `exp` com o banco já recarregado na fase `final`) deve gerar erro, nunca scores silenciosos. Testado nas Tasks 4 e 5.
4. **Usuário sem curtidas** (o 685) recebe perfil de referência, sem NaN, tanto nos pares quanto na inferência. Testado nas Tasks 2 e 5.
5. **Avaliação final rodada duas vezes ou antes do congelamento** deve ser recusada com mensagem clara. Testado na Task 9.

---

### Task 1: Teste do caminho de ampliação da busca

**Files:**
- Modify: `tests/unidade/banco-falso.test.js`

**Interfaces:**
- Consumes: `buscarVizinhos` (`src/banco/busca.js`) e o `poolFalso` já definido no arquivo de teste.

Esse caminho (empate no corte → pedir o dobro de linhas → teto de 1000) nunca rodou com dados reais. O teste prova que ele funciona.

- [ ] **Step 1: Escrever os testes**, com um `responder` que devolve linhas conforme o `LIMIT` pedido (`$3`, o último parâmetro). Para ler os parâmetros, o `poolFalso` passa a registrar também `params` em cada consulta.

```js
test('empate no corte: pede o dobro de linhas e devolve os n primeiros por (distância, id)', async () => {
  // 60 filmes com a mesma distância 0,1 e o resto mais longe: com n = 10, o 1º pedido (60) termina no empate
  // ...responder devolve min(LIMIT, 200) linhas: ids 1..60 com 0.1, ids 61..200 com 0.5
  const r = await buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua });
  assert.deepEqual(r.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(limitesPedidos, [60, 120]);
});
test('empate que não cabe em 1000 linhas: erro acionável', async () => {
  // todas as linhas com a mesma distância
  await assert.rejects(buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua }), /não cabe em 1000 linhas; reduza N/);
  assert.deepEqual(limitesPedidos, [60, 120, 240, 480, 960, 1000]);
});
test('menos linhas que n: erro acionável', async () => {
  await assert.rejects(buscarVizinhos(pool, { vetor, excluir: [], n: 10, regua }), /menos que as 10 pedidas/);
});
```

- [ ] **Step 2: Rodar `npm test`.** Expected: PASS (o código já existe; se falhar, é bug real: parar e investigar).
- [ ] **Step 3: Commit.** `git commit -m "test: caminho de ampliação e teto da busca com banco falso"`

---

### Task 2: Entrada da rede

**Files:**
- Create: `src/features/entrada.js`, `tests/unidade/entrada.test.js`

**Interfaces:**
- Consumes: `popZ`, `faixaEpoca` (`src/features/regua.js`); régua com `idade`, `ocupacoes`, `generos`, `logPop`, `logPopZ`, `contagens`, `referencias`.
- Produces:
  - `historicoDoTreino(treino, filmesPorId) → Map<usuario, { notas: Map<filme, nota>, curtidos: filme[] }>`;
  - `demografia(usuario, regua) → number[24]`: `[ (idade − media) / desvio, M, F, ...ocupação one-hot na ordem de regua.ocupacoes ]`. Ocupação desconhecida: erro;
  - `popZReferencia(regua) → number` (ruling P4);
  - `resumoCurtidos(curtidos, regua) → { somaGeneros: number[19], somaEpoca: number[3], somaPop: number, n }` (pop = `popZ` da contagem sem desconto, ruling P3);
  - `perfilRede(resumo, regua, filmeRemovido = null) → number[23]`: média; com `filmeRemovido`, `(soma − filme) / (n − 1)`; com `n = 0` (ou `n − 1 = 0`), os valores de referência (`generosMedia`, `epocaMedia`, `popZReferencia`);
  - `popZDoPar(filmeId, avaliouNoTreinoDaRegua, regua) → number`;
  - `filmeRede(filme, popZPar) → number[23]`: gêneros 0/1, época one-hot (zerada sem ano), popularidade;
  - `montarEntrada(demo, perfil, filme, { semPop = false } = {}) → number[]` com 70 posições, ou 68 removendo as posições 46 (pop do perfil) e 69 (pop do filme). Confere dimensão e `Number.isFinite` de cada valor, com erro acionável.

- [ ] **Step 1: Escrever os testes que falham**, com uma régua sintética (3 filmes, 2 ocupações):
  - demografia: idade em z-score, one-hot de gênero e de ocupação;
  - perfil sem o filme do par: com curtidos A e B, `perfilRede(resumo, regua, A)` é igual ao perfil de só B;
  - perfil de usuário sem curtidas: igual à referência, sem NaN;
  - `popZReferencia` bate com `popZ` de uma contagem cujo `popEscalada` é `referencias.popularidadeMedia`;
  - `popZDoPar(f, true, regua)` usa contagem − 1 e `popZDoPar(f, false, regua)` usa a contagem cheia;
  - `montarEntrada` dá 70 posições e, com `semPop`, 68 sem as duas popularidades;
  - `montarEntrada` com NaN lança erro.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar `src/features/entrada.js`** com comentários no padrão do projeto (finalidade de cada função).
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: entrada da rede (70 posições) com perfil sem o filme do par"`

---

### Task 3: Pares de treino, pares de validação e negativos

**Files:**
- Create: `src/features/pares.js`, `tests/unidade/pares.test.js`

**Interfaces:**
- Consumes: Task 2 inteira; `criarAleatorio` (`src/util/aleatorio.js`).
- Produces:
  - `sortearNegativos({ quantidade, excluir: Set<number>, catalogo: number[], candidatos: number[] | null, aleatorio }) → number[]`: com `candidatos = null`, todos do catálogo; senão, no sorteio de índice j, `j % 4 < 3` vem dos candidatos e o resto do catálogo. Sempre com reposição e sem os ids de `excluir`;
  - `paresDeTreino({ historico, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema, semente = 42, semPop }) → { x: Float32Array, y: Float32Array, n, dim, resumo }`, com `resumo = { positivos, descartados, observados, sorteados }`;
  - `paresDeValidacao({ historico, validacao, usuariosPorId, filmesPorId, regua, catalogo, candidatosPorUsuario, esquema, semente = 43, semPop }) → mesmo formato`.

Regras (Global Constraints e spec §7): desconto de popularidade para **todo** filme que o usuário avaliou no treino; nos pares de validação, nenhum desconto; exclusão no sorteio = avaliados no treino (pares de treino) ou no treino + validação (pares de validação). `esquema` é `'uniforme'` ou `'candidatos'`.

- [ ] **Step 1: Escrever os testes que falham** com um histórico sintético:
  - usuário com 1 curtido: o par positivo é descartado e conta em `resumo.descartados`;
  - quantidade de sorteados = 4 × positivos usáveis, por usuário;
  - nenhum sorteado está entre os avaliados no treino; nos pares de validação, nem entre os da validação;
  - com 5 candidatos e quantidade grande, ids se repetem (com reposição);
  - esquema `candidatos`: dos sorteios de índice 0, 1, 2 (mod 4), todos estão nos candidatos;
  - negativo observado tem popularidade com desconto; sorteado não tem;
  - nos pares de validação, a nota escondida nunca altera perfil nem popularidade (montar com e sem a validação e comparar o perfil);
  - mesma semente → mesmos `x` e `y` (byte a byte); semente diferente → sorteios diferentes.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Escrever direto em `Float32Array` pré-alocado (a fase `exp` tem perto de 250 mil pares).
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: pares de treino e validação com negativos sorteados com reposição"`

---

### Task 4: Rede: criar, treinar com melhores pesos, salvar e carregar

**Files:**
- Create: `src/modelo/rede.js`, `tests/unidade/rede.test.js`

**Interfaces:**
- Consumes: `criarAleatorio`, `embaralhar`; `@tensorflow/tfjs-node`.
- Produces:
  - `ARQUITETURAS = { '128-64-32': [128, 64, 32], '64-32': [64, 32] }`;
  - `criarRede({ arquitetura, dimEntrada, semente }) → tf.LayersModel` já compilada (ruling P5 para os pesos iniciais);
  - `treinar({ modelo, x, y, dim, semente, validacao = null, epocas = null, maxEpocas = 50, paciencia = 3, perdaValidacao = padrão, aoFimDaEpoca = null }) → Promise<{ melhorEpoca, epocasTreinadas, historico: [{ epoca, perda, perdaValidacao }] }>`:
    - com `validacao` (`{ x, y }`): para quando a perda não melhora por `paciencia` épocas e **restaura** os pesos da melhor época;
    - com `epocas` (treino final): treina exatamente esse número, sem validação;
    - `perdaValidacao(modelo) → number` pode ser injetada nos testes;
  - `prever(modelo, x: Float32Array, dim) → Float32Array`, em lotes, sem vazar tensores (`tf.tidy` / `dispose`); NaN no score gera erro;
  - `salvarModelo(modelo, dir, { regua, metadados })` e `carregarModelo(dir, reguaEmUso) → { modelo, metadados }`. `carregarModelo` lança erro se o hash da régua salva diferir de `reguaEmUso.hash`, com a mensagem `modelo treinado com outra régua: retreine com npm run treinar -- --fase <fase>`.

- [ ] **Step 1: Escrever os testes que falham** (dados sintéticos pequenos, 200 linhas × 6 colunas):
  - **melhores pesos (spec §10):** com `perdaValidacao` injetada devolvendo `[0.5, 0.3, 0.4, 0.45, 0.5]`, o resultado tem `melhorEpoca = 2`, `epocasTreinadas = 5`, e os pesos finais são **idênticos** aos guardados em `aoFimDaEpoca` na época 2, não aos da época 5;
  - `epocas: 3` treina exatamente 3 épocas;
  - duas chamadas com a mesma semente dão pesos idênticos; sementes diferentes, pesos diferentes;
  - salvar e carregar dá as mesmas previsões; carregar com régua de outro hash lança o erro acima;
  - `criarRede` com `64-32` tem 3 camadas densas e saída de 1 neurônio.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Caminhos com `'file://' + path.resolve(dir)`. Guardar os melhores pesos com cópias (`clone`) e liberar as anteriores.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS, sem aviso de tensores vazados (`tf.memory().numTensors` igual antes e depois de `prever`).
- [ ] **Step 5: Commit.** `git commit -m "feat: rede densa com sementes, parada automática e restauração dos melhores pesos"`

---

### Task 5: Ranqueador, média entre sementes e regra de escolha

**Files:**
- Create: `src/modelo/ranqueador.js`, `src/avaliacao/escolha.js`, `tests/unidade/ranqueador.test.js`, `tests/unidade/escolha.test.js`

**Interfaces:**
- Consumes: Task 2 (`demografia`, `resumoCurtidos`, `perfilRede`, `popZDoPar`, `filmeRede`, `montarEntrada`), Task 4 (`prever`), `erroPadraoPareado`.
- Produces:
  - `pontuarCandidatos({ modelo, regua, semPop, usuario, curtidos, candidatos: number[], filmesPorId }) → Map<id, score>`: perfil completo; candidatos nunca têm desconto (não foram vistos);
  - `top10PorScore(scores: Map) → number[]`, ordenado por (score decrescente, id crescente);
  - `mediaEntreSementes(porSemente: Map<usuario, number>[]) → Map<usuario, number>`; erro se os conjuntos de usuários diferirem;
  - `escolherConfiguracao(configs: [{ nome, porUsuario: Map, simplicidade: number[] }]) → { escolhida, melhor, tabela: [{ nome, media, diferenca, erroPadrao, empata }] }`: melhor = maior média; c empata com b se `media(b) − media(c) < erroPadraoPareado(diferenças por usuário)`; entre as empatadas (inclui b), escolhe a menor `simplicidade` em ordem lexicográfica.

- [ ] **Step 1: Escrever os testes que falham:**
  - `top10PorScore` desempata pelo id;
  - `mediaEntreSementes` faz a média por usuário;
  - escolha: com b melhor por menos de 1 erro padrão e c mais simples, escolhe c; com diferença maior que 1 erro padrão, escolhe b; empate de simplicidade desempata pelo segundo elemento (K + N, depois N);
  - `pontuarCandidatos` com usuário sem curtidas não gera NaN (modelo minúsculo criado no teste).
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar.** `pontuarCandidatos` monta uma matriz por usuário e chama `prever` uma vez.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: ranqueador, média entre sementes e regra de escolha da validação"`

---

### Task 6: Script de treino e passo 1 (negativos)

**Files:**
- Create: `scripts/08-treinar.js`
- Modify: `package.json` (script `treinar`), `README.md` (seção do Plano 2)

**Interfaces:**
- Consumes: `criarContexto`, `carregarRegua`, `gerarCandidatos`, `rankingPopularidade`, Tasks 2–4.
- Produces: `npm run treinar -- --fase exp|final --negativos uniforme|candidatos --arquitetura 128-64-32|64-32 [--sem-pop] [--epocas-de <arquivo>]`.
  - Nome do modelo: `<negativos>-<arquitetura>[-sempop]`.
  - Fase `exp`: monta pares de treino e de validação, treina as sementes 1, 2 e 3 e grava `modelos/<nome>-exp-s<s>/` e `resultados/treino-<nome>-exp.json` com o resumo dos pares e, por semente, histórico, melhor época, épocas treinadas e tempo.
  - Fase `final`: exige `--epocas-de resultados/treino-<nome>-exp.json` e treina cada semente com a melhor época dela, sem pares de validação. Grava `modelos/<nome>-final-s<s>/` e `resultados/treino-<nome>-final.json`.
  - Esquema `candidatos`: candidatos K = 200 ∪ N = 100 de **todo usuário do treino**, calculados com o vetor completo dele (o banco precisa estar na régua da fase, conferida pelo hash).

- [ ] **Step 1: Implementar o script**, com cabeçalho no padrão dos scripts 01–07 e mensagens acionáveis para: régua ausente, banco em outra fase e `--epocas-de` ausente na fase final.
- [ ] **Step 2: Rodada curta de fumaça:** `npm run treinar -- --fase exp --negativos uniforme --arquitetura 64-32` com uma opção interna `--max-epocas 1`, só para conferir que roda de ponta a ponta. Apagar os artefatos da fumaça.
- [ ] **Step 3: Rodar o passo 1:**
  - `npm run treinar -- --fase exp --negativos uniforme --arquitetura 128-64-32`
  - `npm run treinar -- --fase exp --negativos candidatos --arquitetura 128-64-32`

  Expected: cada semente para antes de 50 épocas e registra a melhor época; perto de 250 mil pares de treino; nenhum erro de NaN.
- [ ] **Step 4: Commit** do script, do `package.json`, do README e de `resultados/treino-*-exp.json`: `git commit -m "feat: script de treino e treinos do passo 1 (negativos)"`

---

### Task 7: Comparação na validação (passos 1, 2 e 4)

**Files:**
- Create: `scripts/09-comparar.js`
- Modify: `package.json` (script `comparar`)

**Interfaces:**
- Consumes: Task 5, Task 6 (modelos em `modelos/`), `avaliarSistema`, `gerarCandidatos`.
- Produces: `npm run comparar -- --passo 1|2|4 --modelos <nome>,<nome>`.
  - Para cada modelo e semente: híbrido com K = 200, N = 100 na validação; top 10 por `top10PorScore`; `avaliarSistema` por semente.
  - Por modelo: NDCG, P e R@10 por usuário com a média das 3 sementes, mais mínimo e máximo das sementes.
  - Passos 1 e 2: `escolherConfiguracao` com simplicidade `[0]` para `uniforme` / `64-32` e `[1]` para o outro braço.
  - Passo 4 (controle): só descritivo, com a diferença média e o erro padrão em relação ao modelo escolhido; sem regra de escolha.
  - Grava `resultados/comparacao-passo<passo>.json`.

- [ ] **Step 1: Implementar o script.**
- [ ] **Step 2: Passo 1:** `npm run comparar -- --passo 1 --modelos uniforme-128-64-32,candidatos-128-64-32`.
  Expected: NDCG@10 dos dois braços entre 0,10 e 0,50. **Abaixo de 0,10** (menos da metade da popularidade) ou **acima de 0,50** é sinal de bug ou vazamento: parar e investigar antes de continuar.
- [ ] **Step 3: Passo 2:** treinar `npm run treinar -- --fase exp --negativos <escolhido> --arquitetura 64-32` e rodar `npm run comparar -- --passo 2 --modelos <escolhido>-128-64-32,<escolhido>-64-32`.
- [ ] **Step 4: Passo 4:** treinar o controle `npm run treinar -- --fase exp --negativos <escolhido> --arquitetura <escolhida> --sem-pop` e rodar `npm run comparar -- --passo 4 --modelos <escolhido>-<escolhida>,<escolhido>-<escolhida>-sempop`.
- [ ] **Step 5: Commit** do script e dos resultados: `git commit -m "feat: comparação na validação e passos 1, 2 e 4"`

---

### Task 8: Grade K × N e congelamento (passo 3)

**Files:**
- Create: `scripts/10-grade-e-congelar.js`
- Modify: `package.json` (script `grade`)

**Interfaces:**
- Consumes: Tasks 5 e 7; `unirCandidatos`, `popularesNaoVistos`.
- Produces: `npm run grade -- --modelo <nome escolhido no passo 2> --controle <nome do controle>`.
  - Grade K ∈ {50, 100, 150, 200} × N ∈ {0, 20, 50, 100}, candidatos por prefixo (ruling P6), scores calculados uma vez por usuário e semente.
  - `escolherConfiguracao` com simplicidade `[K + N, N]`.
  - Grava `resultados/grade-validacao.json` e **`resultados/configuracao-final.json`** com: negativos, arquitetura, K, N, nome do modelo e do controle, melhor época por semente de cada um (lidas de `treino-*-exp.json`), `seed_api: 1`, hash da régua-exp e data.
  - Recusa rodar se `resultados/avaliacao-final.json` já existir (`a avaliação final já foi feita; a configuração não pode mudar depois do teste`).

- [ ] **Step 1: Implementar o script.**
- [ ] **Step 2: Rodar.** Expected: 16 linhas na grade. Se N = 0 vencer, isso é resultado (spec §9.1) e fica registrado.
- [ ] **Step 3: Conferir** que `configuracao-final.json` tem todos os campos acima e que nenhum arquivo do `u1.test` foi lido (o script não importa nada do teste).
- [ ] **Step 4: Commit:** `git commit -m "feat: grade K × N e congelamento da configuração final"`. **O commit do `configuracao-final.json` é o registro de que as escolhas foram congeladas antes do teste.**

---

### Task 9: Script da avaliação final (sem rodar)

**Files:**
- Create: `scripts/11-avaliacao-final.js`, `src/avaliacao/experimentos.js`, `tests/unidade/experimentos.test.js`
- Modify: `package.json` (script `avaliacao-final`)

**Interfaces:**
- Consumes: tudo acima; `bootstrapPareado`, `grupoMainstream`, `contribuicaoExclusiva`.
- Produces:
  - `popularesMesmoOrcamento(ranking, vistos, tamanho) → number[]` (Exp. 5: o mesmo nº efetivo de candidatos únicos do Exp. 4, usuário a usuário);
  - `todosNaoVistos(catalogo, vistos) → number[]` (Exp. 6);
  - `verificarPreCondicoes({ configuracao, avaliacaoExiste, hashBanco, reguaFinal, modelos }) → void`: erro acionável se faltar `configuracao-final.json`, se a avaliação já existir, se o banco não estiver na régua-final, ou se algum modelo final faltar ou tiver outro hash;
  - `npm run avaliacao-final`: fase `final`; os 7 experimentos da spec §9.2 nos usuários do `u1.test` com relevantes; bootstrap pareado (5000, semente fixa) de **Exp. 4 − Exp. 1** (hipótese principal); diferenças descritivas dos demais em relação ao Exp. 4, sem intervalo; mínimo e máximo por semente; cobertura e popularidade média; contribuição exclusiva das duas fontes; mainstream × nicho com a mediana da régua-final. Grava `resultados/avaliacao-final.json` **uma vez**.
  - Exp. 2 exclui usuários sem curtidas e informa quantos. Se N = 0 tiver vencido na grade, aplicar a regra decidida antes (spec §9.2): Exp. 2 com N = 100 para o recall e os 10 primeiros vizinhos para o top 10, contribuição exclusiva zero por construção, Exp. 5 reportado como idêntico ao Exp. 4.

- [ ] **Step 1: Escrever os testes que falham:** `popularesMesmoOrcamento` devolve exatamente `tamanho` não vistos; `todosNaoVistos` exclui os vistos; `verificarPreCondicoes` recusa cada um dos quatro casos com a mensagem certa.
- [ ] **Step 2: Rodar `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implementar** o módulo e o script. O script chama `verificarPreCondicoes` **antes** de ler o `u1.test`.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Conferir as recusas sem tocar no teste:** com o banco ainda na fase `exp`, `npm run avaliacao-final` deve recusar por régua do banco. Expected: mensagem pedindo `npm run carregar-filmes -- --fase final`.
- [ ] **Step 6: Commit:** `git commit -m "feat: script da avaliação final com pré-condições do teste único"`

---

### Task 10: Avaliação final no `u1.test` (só com autorização do usuário)

**Files:**
- Create (gerados): `resultados/treino-*-final.json`, `resultados/avaliacao-final.json`
- Modify: `README.md`, `resultados/README.md`

> **PARAR antes do Step 2 e pedir autorização explícita ao usuário.** O `u1.test` só pode ser usado uma vez. Mostrar a `configuracao-final.json` e esperar o "pode rodar".

- [ ] **Step 1: Resumo para o usuário:** configuração congelada, números da validação e o que será rodado.
- [ ] **Step 2: Régua-final e banco:** `npm run carregar-filmes -- --fase final`.
- [ ] **Step 3: Seis retreinos:** `npm run treinar -- --fase final ... --epocas-de resultados/treino-<nome>-exp.json` para o modelo escolhido e para o controle.
- [ ] **Step 4: `npm run avaliacao-final`.** Rodar uma vez. Se falhar no meio por erro de código, corrigir e rodar de novo é permitido **só se** `avaliacao-final.json` não chegou a ser gravado; registrar o ocorrido no README.
- [ ] **Step 5: Documentar** no README e em `resultados/README.md`: tabela dos 7 experimentos, intervalo da hipótese principal, mainstream × nicho e limitações (spec §15).
- [ ] **Step 6: Commit:** `git commit -m "feat: avaliação final no u1.test"`

---

## Depois deste plano

- **Etapa 10 (opcional):** API e interface (`src/api/` + front), com o modelo da semente 1.
- Itens adiados da revisão de código do Plano 1: `DIR_DADOS` com outro nome no script 02, duplicações entre os scripts 01/03 e 05/07, uso de memória do script 07.
