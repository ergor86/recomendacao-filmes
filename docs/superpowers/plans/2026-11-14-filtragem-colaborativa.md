# Plano 3 — Filtragem Colaborativa no pgvector: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a FC item-item no pgvector, escolher a v2 na validação pela regra de 1 EP e compará-la com a v1 uma única vez no teste-2, com isolamento de API, congelamento por git e hash das previsões antes da leitura do gabarito.

**Architecture:** Continua os Planos 1 e 2 (na `main`). O teste-2 mora num módulo próprio e só sai do contexto v2 com `incluirTeste2`. A FC tem uma referência em memória (float64, `src/fc/`) e a versão oficial no banco (`filmes_fc` + HNSW, `src/banco/*-fc.js`). As listas de candidatos (K, N) são compostas no código a partir de uma busca de M = 300 por usuário. Cada passo experimental é um script numerado (14–23) que grava um JSON em `resultados/`; as regras puras ficam em `src/avaliacao/`, para entrar no sha256 do congelamento.

**Tech Stack:** Node 22, `@tensorflow/tfjs-node` 4.22, `pg`, Postgres 17 + pgvector 0.8.1 no Docker, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-13-plano3-filtragem-colaborativa-design.md` (**v4.3**). A v3.2 (`2026-11-07-recomendacao-filmes-design.md`) vale para tudo que a v4.3 não muda. Quem executa lê a spec e o plano; as seções citadas (§n) são da v4.3.

## Global Constraints

- **Raiz e branch:** `C:\dev\recomendacao-filmes`, branch `colaborativa`.
- **Dados:** o MovieLens nunca vai para o git nem para os testes; os testes usam dados sintéticos. `modelos/` e `artefatos/` ficam fora do git; `resultados/` é versionada.
- **`u1.test` nunca é lido no Plano 3.** Nenhum script novo usa `incluirTeste`. `scripts/03-eda.js` lê o `u1.test` e **não pode ser executado**. `u.data` também não é lido.
- **Teste-2:** usuários 1–462; das notas de cada um no `u1.base`, ordenar por filme, embaralhar com `criarAleatorio(20_000_000 + usuario)` e esconder as primeiras `Math.round(0.2 · n)`.
- **Acesso ao teste-2 (§3.2):** fora de `src/dados/teste2.js` e `src/contexto.js`, só agregados (`resumoDivisoesV2`) no Passo 0 e no congelamento; IDs e notas só na etapa 2 (`incluirTeste2: true`). Os agregados nunca alimentam escolhas.
- **Restrições estáticas (§3.2), em `src/` e `scripts/`:** `carregarDataset`/`criarDivisoes` só em `src/contexto.js`, `src/dados/teste2.js` e `scripts/03-eda.js`; `lerAvaliacoes` só em `src/dados/leitura.js` e `src/dados/carregar.js`; `dividirTeste2` só em `src/dados/teste2.js` e `src/contexto.js`; `teste2.js` importado só por `src/contexto.js`, `scripts/14-divisoes-v2.js` e `scripts/21-congelar-v2.js` (os dois scripts, só `resumoDivisoesV2`); `incluirTeste2` só em `src/contexto.js` e `scripts/23-etapa2-v2.js`.
- **FC (§4):** `c_j[u] = 1` se nota ≥ 4 no treino da fase; `v_j = c_j/‖c_j‖`; perfil `p = Σ v_i` dos curtidos; **escore oficial** `round(cos(p/‖p‖, v_j), 6)` = `Math.round(x * 1e6) / 1e6`; aceito só escore oficial > 0, depois do arredondamento; ordem (escore oficial desc, id asc); filme sem curtida fora só da FC; dimensão = nº de usuários (943), posição `u − 1`.
- **Busca FC (§5.2):** `m ≤ 300`; `pedir = m + 50`, dobrando até 1.000; `ef_search = max(pedir, 40)`; `iterative_scan = strict_order`; modo `'hnsw'` = `enable_seqscan = off`, `'exata'` = `enable_indexscan = off`; sem erro por lista curta; `empateNaoResolvido` no teto.
- **Candidatos (§6):** M = 300 por usuário e fase, uma única busca HNSW; lista (K, N) = `P_K` + os N primeiros de `H_M \ P_K`, **na ordem de `H_M`** + preenchimento por populares não vistos, na ordem de popularidade; total exato K + N.
- **FC150 única:** em cada script que avalia S1 e S3, a FC150 de cada usuário é construída uma vez (`listaDaConfiguracao(entrada, 0, 150).ids`) e o mesmo `Map` alimenta S1, o treino de S3 e a pontuação de S3.
- **Precisão (§5.3):** τ = `1e-5` sobre escores em float64.
- **Rede (v3.2 §6–7):** a da v1: arquitetura `64-32`, negativos `candidatos`, 70 entradas (`semPop: false`), sementes 1, 2, 3, lote 256, paciência 3, teto 50; retreinada por configuração.
- **Sementes novas:** teste-2 `20_000_000 + u`; subamostragem do MDE `30_000_000 + 1000 · r + u` (r = 1..20); simulação do MDE `40_000_000 + r`. Bootstrap: 5.000 reamostragens, semente 2026.
- **Grade (§8.2):** K ∈ {0, 50, 100, 150} × N ∈ {0, 50, 100, 150} sem (0, 0). Portão reprovado → só S0, S1 e S2 (§8.1).
- **Determinismo:** todo arquivo com hash usa `jsonEstavel`; toda ordenação desempata por id crescente.
- **Falhar alto** com mensagem acionável (o padrão dos Planos 1 e 2): hash divergente, artefato ausente, script fora de ordem, gabarito pedido fora da etapa 2.
- **Comentários:** cabeçalho em cada arquivo novo e comentário de finalidade em cada função, em português, como nos módulos existentes.
- **Execução real:** as tasks rodam os scripts nos dados reais e commitam os `resultados/`. **A etapa 2 (Task 14) só roda com autorização explícita do usuário.**

### Formatos de arquivo (contratos entre tasks)

```text
resultados/divisoes-v2.json      (Task 2)  { hashes: { teste2, validacao, treinoV2Exp, treinoV2Final },
                                             validacao: Resumo, teste2: Resumo }
  Resumo = { notasDisponiveis: Est, notasEscondidas: Est, curtidasEscondidas: Est, semCurtidas, avaliaveis }
  Est    = { media, mediana, p10, p25, p75, p90 }   (sobre TODOS os usuários do conjunto, inclusive zeros)
resultados/mde-v2.json           (Task 5)  { nt, q, frase, pares: { S0xS1: Par, S1xHeuristica: Par } }
  Par = { sigmaD, sigmaPorRepeticao: [20], nPorRepeticao: [20], mde,
          simulacao: { media, min, max }, icNormalVsBootstrap: [20 × { normal: [lo, hi], bootstrap: [lo, hi] }] }
artefatos/candidatos-v2-<fase>.json (Task 7) { fase, hashRegua, hashTreino, M: 300, sha256, porUsuario }
  porUsuario[u] = { colab: number[] (H_M, ≤ 300, na ordem da busca), populares: number[] (600 primeiros não vistos),
                    nElegiveis, elegiveisEntrePopulares: number[] (E ∩ 150 primeiros populares),
                    empateNaoResolvido: boolean }
resultados/portao-fc-v2-exp.json (Task 8)  { fonteFC: 'hnsw', cenario: 'aprovado'|'reprovado', composicoes, criterioA, criterioB, ... }
resultados/grade-v2-exp.json     (Task 11) { cenario, sistemas, escolha: { escolhida, melhor, fragil, tabela },
                                             epocasPorSistema, sha256FC150, contribuicoes, mdeDescritivo, otimista: true }
resultados/configuracao-v2.json  (Task 12) §9.1, inclusive sha256Grade, ressalva, commitCodigo
artefatos/previsoes-v2-final.json (Task 13) { sistemas: { <nome>: { porSemente: { <s>: { <u>: number[10] } } } } }
resultados/previsoes-v2-final.sha256.json (Task 13) { sha256, sha256Configuracao, sha256FC150 }
resultados/avaliacao-v2.json     (Task 14) gravado com flag 'wx', com o campo ressalva
```

Nomes de sistema: `S0`, `S1`, `S2` (= 150-0), `S3` (= 0-150) e `S4-<k>-<n>` para as demais células. Sistemas sem rede guardam as previsões sob a semente `0`.

## Review Focus

1. **Usuário sem curtidas no treino** (perfil FC nulo): S1 e S3 têm de devolver 10 filmes (todos de preenchimento), com déficit real = N, sem exceção. Teste na Task 4.
2. **Usuário 1–462 com poucas notas** (`Math.round(0.2 · n) = 0` para n ≤ 2): não entra no teste-2 e continua inteiro no treino; o contexto não pode quebrar. Teste na Task 1.
3. **Filmes com vetores idênticos** (curtidos por um único e mesmo usuário) empatados na posição m: a busca tem de incluir o de menor id, antes do de id maior. Teste de integração na Task 6.
4. **Etapa 2 executada de novo, previsões ou congelamento alterados:** recusar **antes** de ler o gabarito. Teste na Task 14.
5. **Usuário da validação que perde todos os relevantes na subamostragem do MDE:** sai daquela repetição, e `n_r` registra isso. Teste na Task 5.

---

### Task 1: Teste-2 e contexto v2 isolado

**Files:**
- Create: `src/dados/teste2.js`
- Modify: `src/contexto.js`
- Test: `tests/unidade/teste2.test.js`, `tests/unidade/contexto.test.js` (acrescentar), `tests/unidade/isolamento-estatico.test.js`

**Interfaces:**
- Produces:
  - `dividirTeste2(base: Avaliacao[]) → { teste2: Avaliacao[], semTeste2: Avaliacao[] }` (`Avaliacao = { usuario, filme, nota, timestamp }`, a forma de `lerAvaliacoes`)
  - `hashAvaliacoes(avaliacoes) → string` (sha256 hex de `jsonEstavel` dos triplos `[usuario, filme, nota]` ordenados por usuário e filme)
  - `criarContexto({ fase: 'v2-exp'|'v2-final', dirDados, incluirTeste2 = false }) → { fase, dataset: { filmes, usuarios, generos, ocupacoes }, treino, alvos, regua }`
    - `v2-exp`: `treino` = `criarDivisoes({ base: semTeste2, teste: null }, { semente: 42 }).treinoExp`; `alvos` = a validação.
    - `v2-final`: `treino` = `semTeste2`; `alvos` = teste-2 com `incluirTeste2`, senão `null`.
    - `regua` = `calcularRegua({ ..., fase })` sobre o `treino`.
  - Fases `exp`/`final`: comportamento atual inalterado.

- [ ] **Step 1: Write the failing tests** (`tests/unidade/teste2.test.js`, base sintética com usuários 1, 2, 462, 463 e 500)
  - `dividirTeste2`: usuário 1 com 10 notas → 2 no teste-2; usuário 2 com 2 notas → 0 (`Math.round(0.4) = 0`); usuários ≥ 463 → nenhum; `teste2 ∪ semTeste2` = base e interseção vazia (por pares `${u}:${f}`); duas chamadas dão o mesmo resultado.
  - A escolha do usuário 1 bate com `embaralhar(ordenadasPorFilme, criarAleatorio(20_000_001)).slice(0, 2)`.
  - `hashAvaliacoes` não depende da ordem de entrada e muda se uma nota mudar.
- [ ] **Step 2: Add contexto tests** (`tests/unidade/contexto.test.js`, mesma pasta sintética)
  - `Object.keys(ctx).sort()` = `['alvos', 'dataset', 'fase', 'regua', 'treino']`; `Object.keys(ctx.dataset).sort()` = `['filmes', 'generos', 'ocupacoes', 'usuarios']`.
  - `v2-final` sem a opção → `alvos === null`; com `incluirTeste2: true` → `alvos` = teste-2, e `treino`/`regua.hash` iguais aos de sem a opção.
  - Nenhum par do teste-2 em `treino` de `v2-exp` nem de `v2-final`.
  - A validação de `v2-exp` é igual (por pares) à de `criarContexto({ fase: 'exp' }).alvos`.
  - Invariância: trocar a nota de um par do teste-2 no arquivo sintético não muda `regua.hash` de `v2-exp` nem de `v2-final`.
  - Erros: `{ fase: 'v2-exp', incluirTeste: true }`, `{ fase: 'exp', incluirTeste2: true }` e `{ fase: 'v2-exp', incluirTeste2: true }` lançam erro.
- [ ] **Step 3: Write the static test** (`tests/unidade/isolamento-estatico.test.js`): varre o texto de `src/**/*.js` e `scripts/*.js` e confere **todas** as restrições estáticas das Global Constraints. Para os dois scripts que importam `teste2.js`, a linha de import só pode conter `resumoDivisoesV2`. Os scripts 14, 21 e 23 ainda não existem nesta task; o teste confere "arquivos que usam X ⊆ conjunto permitido", então passa agora e protege depois.
- [ ] **Step 4: Run** `npm test` → os novos testes FALHAM (módulo e fases inexistentes).
- [ ] **Step 5: Implement** `src/dados/teste2.js` (constantes `FRACAO_TESTE2 = 0.2`, `SEMENTE_TESTE2 = 20_000_000`, usuários 1–462; mesmo algoritmo de `criarDivisoes`) e as fases v2 em `src/contexto.js`. `carregarDataset` é chamado sempre sem `incluirTeste` nas fases v2.
- [ ] **Step 6: Run** `npm test` → PASS, inclusive os 170 testes atuais.
- [ ] **Step 7: Commit** `feat: teste-2 e contexto v2 com isolamento de API`

### Task 2: Passo 0 — registro das divisões

**Files:**
- Modify: `src/dados/teste2.js`
- Create: `scripts/14-divisoes-v2.js`; `package.json` (`"divisoes-v2"`)
- Test: `tests/unidade/teste2.test.js`

**Interfaces:**
- Consumes: `dividirTeste2`, `hashAvaliacoes` (Task 1).
- Produces: `resumoDivisoesV2(dirDados) → { hashes, validacao: Resumo, teste2: Resumo }` (formato no topo). Percentil pelo posto mais próximo: `ordenados[Math.ceil(p · n) − 1]`. "Disponíveis" = notas do usuário no treino da fase final correspondente (`semTeste2` para o teste-2; `treinoExp` para a validação). As estatísticas incluem **todos** os usuários do conjunto (1–462 no teste-2; 463–943 na validação), inclusive os com zero escondidas. `avaliaveis` = usuários com ≥ 1 curtida escondida.

- [ ] **Step 1: Write the failing test:** com a base sintética, `resumoDivisoesV2` devolve exatamente as chaves do formato (lista branca recursiva); `JSON.stringify(resultado)` não contém nenhum array com mais de 4 elementos (nenhuma lista por usuário); `teste2.avaliaveis` confere com uma contagem manual; `Est` de `[1,2,3,4,5,6,7,8,9,10]` = `{ media: 5.5, mediana: 5.5, p10: 1, p25: 3, p75: 8, p90: 9 }`; com um usuário 1–462 de 2 notas (0 escondidas), `teste2.curtidasEscondidas.media` inclui o zero no denominador.
- [ ] **Step 2: Run** `node --test tests/unidade/teste2.test.js` → FAIL.
- [ ] **Step 3: Implement** `resumoDivisoesV2` e o script, que grava `resultados/divisoes-v2.json` com `jsonEstavel` e recusa sobrescrever se o arquivo já estiver commitado com outros hashes.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run divisoes-v2` → grava o arquivo. Conferir que `teste2.notasEscondidas.media` fica perto de 14,1 (§3.1; a semente nova e a inclusão dos zeros podem mudar um pouco os números).
- [ ] **Step 5: Commit** `feat: Passo 0 do Plano 3 (divisoes-v2.json)` com `resultados/divisoes-v2.json`.

### Task 3: FC em memória (referência float64)

**Files:**
- Create: `src/fc/referencia.js`
- Test: `tests/unidade/fc-referencia.test.js`

**Interfaces:**
- Produces:
  - `construirFC(treino, nUsuarios) → { nUsuarios, fasPorFilme: Map<filme, number[]>, curtidosPorUsuario: Map<u, number[]> }`
  - `vetorFilme(fc, filme) → number[] | null` (dimensão `nUsuarios`; `1/√|fãs|` nas posições `u − 1`; `null` sem curtidas)
  - `perfilFC(fc, curtidos: number[]) → Float64Array | null`
  - `escoreOficial(x: number) → number` = `Math.round(x * 1e6) / 1e6`
  - `rankingReferencia(fc, perfil, vistos: Set, m) → Array<{ id, escore, escore64 }>`: só escore oficial > 0, ordem (escore desc, id asc), no máximo m itens; `escore64` = cosseno sem arredondar.
  - `elegiveisReferencia(fc, perfil, vistos) → Set<id>` (escore oficial > 0)
  - `hashVetoresFC(fc) → string` (sha256 de `jsonEstavel` de `fasPorFilme` ordenado)

- [ ] **Step 1: Write the failing tests** (catálogo sintético de 5 usuários × 6 filmes)
  - `Σ_i cos(v_i, v_j)` = `perfil · v_j` (diferença < 1e-12) e `escore64` = `perfil · v_j / ‖perfil‖` (a escala, não só a ordem).
  - Filme sem curtidas → `vetorFilme = null` e ausente do ranking; usuário sem curtidas → `perfilFC = null`.
  - Já vistos excluídos; dois filmes com o mesmo escore oficial saem em ordem de id; `rankingReferencia(..., m = 2)` devolve 2 itens.
  - Fronteira do arredondamento: `escoreOficial(5e-7) === 1e-6`, `escoreOficial(4.999999e-7) === 0`, `escoreOficial(2.5e-6) === 3e-6` (meio para cima, sem arredondamento bancário); um item com `escore64 = 4e-7` (num `fc` montado à mão) fica fora do ranking.
- [ ] **Step 2: Run** `node --test tests/unidade/fc-referencia.test.js` → FAIL.
- [ ] **Step 3: Implement.** O escore de j é `Σ_{u ∈ fãs(j)} p[u−1] / √|fãs(j)| / ‖p‖`, iterando a lista esparsa de fãs (sem matrizes densas 1682 × 943).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: FC item-item em memória (referência float64)`

### Task 4: Composição dos candidatos e déficit

**Files:**
- Create: `src/candidatos/composicao.js`
- Test: `tests/unidade/composicao.test.js`

**Interfaces:**
- Produces: `comporLista({ populares: number[], colab: number[], k, n, nElegiveis, elegiveisEntrePopulares: number[] }) → { ids: number[], fonte: Map<id, 'pop'|'fc'|'preenchimento'>, completados, deficitReal, deficitRecuperacao, devKMaiorQueElegK }`
  - `populares` = populares não vistos, em ordem; `P_K = populares.slice(0, k)`; `colab` = `H_M`.
  - `ids` = `P_K`, depois os n primeiros de `colab` fora de `P_K` **na ordem de `colab`**, depois o preenchimento pelos próximos de `populares` ainda fora da lista, na ordem de `populares` (se acabarem, erro). Não reaproveitar `unirCandidatos`.
  - `devK = |colab \ P_K|`; `elegK = nElegiveis − |elegiveisEntrePopulares ∩ P_K|`.
  - `completados = max(0, n − devK)`; `deficitReal = min(completados, max(0, n − elegK))`; `deficitRecuperacao = completados − deficitReal`; `devKMaiorQueElegK = devK > elegK`.

- [ ] **Step 1: Write the failing tests**
  - Ordem exata: `colab = [9, 3, 7]`, `populares = [3, 1, 2, 4, 5, 6]`, (0, 5) → `ids` deepEqual `[9, 3, 7, 1, 2]`.
  - (2, 3) com `colab = [1, 2, 9, 8, 7]` e `populares = [1, 2, 3, ...]` → `ids` deepEqual `[1, 2, 9, 8, 7]`.
  - `ids.length === k + n` em todos os casos; sem repetição.
  - `n = 0` → `ids` = `populares.slice(0, k)` (igual à v1).
  - Usuário sem curtidas (`colab = []`, `nElegiveis = 0`) com (0, 150) → 150 de preenchimento, `deficitReal = 150`, `deficitRecuperacao = 0`.
  - `colab` com 1 item, `nElegiveis = 3`, n = 3 → `completados = 2`, `deficitReal = 0`, `deficitRecuperacao = 2`.
  - `nElegiveis = 1`, `colab` com 2 → `devKMaiorQueElegK = true`, sem números negativos.
  - Propriedade: `deficitReal + deficitRecuperacao === completados` em 200 casos aleatórios (`criarAleatorio(1)`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: composição exata K+N com déficit real e de recuperação`

### Task 5: MDE pré-registrado

**Files:**
- Create: `src/avaliacao/mde.js`, `scripts/15-mde-v2.js`; `package.json` (`"mde-v2"`)
- Test: `tests/unidade/mde.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `ndcgEm10`, `relevantesPorUsuario`, `bootstrapPareado`, `regua.contagens`.
- Produces:
  - `subamostrarRelevantes(relevantes: Map<u, Set>, q, r) → Map<u, Set>`: para cada usuário, `criarAleatorio(30_000_000 + 1000 · r + u)`; percorre os relevantes em id crescente e mantém se `aleatorio() < q`; usuários sem nenhum mantido saem do mapa.
  - `desvioAmostral(valores) → number` (divide por n − 1).
  - `mdeFormula(sigma, nt) → number` = `(1.959963985 + 0.841621234) · sigma / √nt`.
  - `simularDeltaEstrela(difs: number[], nt, r, B = 10_000) → number`: centra `c = d − média(d)`; com `criarAleatorio(40_000_000 + r)` sorteia B amostras de tamanho `nt` com reposição; para cada uma, `1.96 · ep_s − m_s` com `ep_s = s_s / √nt`; devolve o quantil 0,80 (índice `Math.ceil(0.8 · B) − 1` da lista ordenada).
  - `icNormal(difs) → [lo, hi]` = `média ± 1.96 · desvioAmostral / √n`.
  - `top10Heuristica(fc150: number[], escore64: Map<id, number>, pop: Record<id, number>) → number[]`: ordem por `escore64 · √pop[j]` desc, id asc; quem não tem escore (preenchimento) fica com 0 e vai para o fim, por pop desc e id asc.
- O script lê `nt` e as médias de curtidas escondidas **de `resultados/divisoes-v2.json`** (recusa se o arquivo não estiver commitado); `q = teste2.curtidasEscondidas.media / validacao.curtidasEscondidas.media`; pares S0 × S1 e S1 × heurística, com a FC150 da referência em memória (o MDE é uma estimativa de capacidade, não decide nada); 20 repetições; grava `resultados/mde-v2.json` com `sigmaPorRepeticao`, `nPorRepeticao`, `mde`, a simulação (média, mín., máx.), `icNormalVsBootstrap` por repetição e a frase obrigatória da §8.3, incluindo "a simulação aproxima, não reproduz, o teste final".

- [ ] **Step 1: Write the failing tests:** um usuário com 1 relevante e um `r` em que o sorteio dá ≥ q sai do mapa; mesma chamada → mesmo resultado; `mdeFormula(0.029, 400)` ≈ `0.004061` (±1e-6); `simularDeltaEstrela` reprodutível e menor quando as diferenças têm metade do desvio; para `difs` normais com σ = 0,03 e `nt = 400`, `δ*` fica a ±0,0005 de `mdeFormula(0.03, 400)`; `icNormal([1, 2, 3])` = `[2 − 1.96/√3, 2 + 1.96/√3]`; `top10Heuristica` com escores iguais desempata por pop.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npm run mde-v2` → grava o arquivo. Conferência: σ de S0 × S1 ≈ 0,029 e de S1 × heurística ≈ 0,019 (prévia; diferenças pequenas são esperadas).
- [ ] **Step 5: Commit** `feat: MDE pré-registrado (mde-v2.json)` com o resultado. **Este commit tem de vir antes de qualquer treino da grade.**

### Task 6: Banco — `filmes_fc` e `buscarColaborativos`

**Files:**
- Create: `src/banco/carga-fc.js`, `src/banco/busca-fc.js`, `scripts/16-carregar-v2.js`; `package.json` (`"carregar-v2"`)
- Modify: `src/banco/busca.js` (exportar `prepararTransacao`)
- Test: `tests/integracao/busca-fc.test.js` (schema `teste_busca_fc`), `tests/unidade/busca-fc.test.js` (lógica de corte com banco falso, no padrão de `banco-falso.test.js`)

**Interfaces:**
- Consumes: `vetorFilme`, `hashVetoresFC`, `escoreOficial` (Task 3); `carregarFilmes`, `citar`, `criarPool`.
- Produces:
  - `carregarFilmesFC(pool, { vetores: Map<id, number[]>, dim, hashRegua, hashTreino }) → void`: numa transação, recria `filmes_fc (id int primary key, embedding vector(dim) not null)`, cria `filmes_fc_embedding_idx` (hnsw, `vector_cosine_ops`) e grava por último `hash_regua` e `hash_treino` em `metadados`.
  - `lerHashesFC(executor) → { esquema, hashRegua, hashTreino }`.
  - `buscarColaborativos(pool, { vetor, excluir, m, hashes: { regua, treino }, modo = 'hnsw' }) → { lista: Array<{ id, escore }>, empateNaoResolvido, linhasPedidas }`
    - `REPEATABLE READ`; confere os dois hashes na mesma transação.
    - SQL: `SELECT id, embedding <=> $1::vector AS distancia FROM filmes_fc WHERE id <> ALL($2::int[]) ORDER BY embedding <=> $1::vector LIMIT $3`.
    - `escore = escoreOficial(1 − distancia)`; ordena por (escore desc, id asc); corta no primeiro escore ≤ 0.
    - Completa quando volta menos que `pedir` ou quando houve corte por escore ≤ 0; senão, se `escore[m−1] > escore[última]`, completa; senão dobra `pedir` até 1.000; no teto, devolve as m primeiras com `empateNaoResolvido = true`.
  - `planoDaBuscaFC(pool, modo) → string` (EXPLAIN da consulta acima).
- Script: `npm run carregar-v2 -- --fase v2-exp|v2-final` cria o schema `v2_exp`/`v2_final`, carrega `filmes` (vetores de conteúdo, régua da fase) com `carregarFilmes`, depois `filmes_fc`, e grava `artefatos/regua-v2-<exp|final>.json`.

- [ ] **Step 1: Write the failing integration tests** (vetores sintéticos de dimensão 8)
  - Dois filmes com vetores idênticos, ids 7 e 3, empatados na posição m → a lista contém o 3, e `indexOf(3) < indexOf(7)` quando os dois entram.
  - Catálogo de 30 filmes com escores distintos: `lista` deepEqual a ordenação independente, em JS, por (`escoreOficial(cos)` desc, id asc); cada `escore` devolvido difere de `escoreOficial(cos calculado em JS)` em no máximo 1e-6; HNSW = exata.
  - `m` maior que os elegíveis → devolve menos, sem erro. Um filme ortogonal à consulta (escore 0) nunca aparece.
  - Dobra com SQL real: 500 filmes, dos quais 400 idênticos à consulta (ids embaralhados) e 100 com escore menor; excluir 50 dos idênticos; `m = 300`. Modo `'exata'`: `linhasPedidas === 700`, `empateNaoResolvido === false` e `lista` = os 300 menores ids dos 350 idênticos não excluídos, em ordem crescente. Modo `'hnsw'`: sem erro, nenhum excluído na lista e `length ≤ 300`.
  - `planoDaBuscaFC(pool, 'hnsw')` contém `Index Scan` e `filmes_fc_embedding_idx`; no modo `'exata'`, contém `Seq Scan` e não contém o índice.
  - Hash de treino diferente → erro antes da consulta.
  - `public.filmes` e os schemas `v2_*` intocados (contagem antes e depois, como em `busca.test.js`).
- [ ] **Step 2: Write the failing unit test** (banco falso): respostas com empate na posição m até 1.000 linhas → `empateNaoResolvido = true` e `linhasPedidas = 1000`; `m = 301` → erro.
- [ ] **Step 3: Run** `npm run test:integracao` e `npm test` → FAIL.
- [ ] **Step 4: Implement** as funções e o script.
- [ ] **Step 5: Run** os dois → PASS; `npm run carregar-v2 -- --fase v2-exp` → carga sem erro.
- [ ] **Step 6: Commit** `feat: filmes_fc no pgvector e buscarColaborativos`

### Task 7: Candidatos v2 a partir do HNSW

**Files:**
- Create: `src/candidatos/v2.js`, `scripts/17-candidatos-v2.js`; `package.json` (`"candidatos-v2"`)
- Test: `tests/unidade/candidatos-v2.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 6; `rankingPopularidade`, `popularesNaoVistos`, `vistosPorUsuario`, `jsonEstavel`.
- Produces:
  - `gerarCandidatosV2({ buscar, fc, treino, contagens, usuarios: number[], M = 300 }) → Promise<porUsuario>` (formato no topo). `buscar(vetor, excluir, m) → { lista, empateNaoResolvido }` é injetado: no script, `buscarColaborativos` no modo `'hnsw'`; nos testes, uma função em memória.
  - `montarArquivoCandidatosV2(fase, hashRegua, hashTreino, porUsuario)` e `lerCandidatosV2(caminho, { hashRegua, hashTreino }) → Map<u, entrada>` (confere sha256 e hashes, como `lerCandidatos`).
  - `listaDaConfiguracao(entrada, k, n) → resultado de comporLista`.
  - `fc150DeTodos(candidatos: Map<u, entrada>) → Map<u, number[]>` = `listaDaConfiguracao(e, 0, 150).ids` por usuário, e `sha256FC150(map) → string` (`jsonEstavel` do objeto `{ u: ids }`).
  - `relatorioDeficit(porUsuario, configuracoes) → { [k-n]: { usuariosDeficitReal, usuariosDeficitRecuperacao, usuariosSemCurtidas, vagasReal, vagasRecuperacao, usuariosDevKMaiorQueElegK, usuariosEmpateNaoResolvido } }`.
- O script roda para `--fase v2-exp` (todos os usuários do treino) e grava `artefatos/candidatos-v2-v2-exp.json` e `resultados/deficit-v2-exp.json`.

- [ ] **Step 1: Write the failing tests:** um `buscar` falso que devolve ids `[9, 3, 7]` gera `colab` deepEqual `[9, 3, 7]` (a ordem é preservada, também depois de gravar e ler o arquivo); `lerCandidatosV2` recusa sha256 alterado e hash de treino diferente; `populares` tem 600 itens e nenhum visto; usuário sem curtidas → `colab = []` e `nElegiveis = 0`; `relatorioDeficit` soma corretamente num caso montado à mão; `sha256FC150` muda se a ordem de uma lista mudar.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npm run candidatos-v2 -- --fase v2-exp`.
- [ ] **Step 5: Commit** `feat: candidatos v2 (M = 300) e relatório de déficit` com `resultados/deficit-v2-exp.json`.

### Task 8: Portão da FC (sobre o HNSW)

**Files:**
- Create: `src/avaliacao/portao.js`, `scripts/18-portao-v2.js`; `package.json` (`"portao-v2"`)
- Test: `tests/unidade/portao.test.js`

**Interfaces:**
- Consumes: `criarContexto` v2-exp (Task 1), `lerCandidatosV2`, `listaDaConfiguracao` (Task 7), `recallDosCandidatos`, `erroPadraoPareado`, `contribuicaoExclusiva`, `relevantesPorUsuario`.
- Produces:
  - `composicoesPortao(L) → Array<{ p, k, n }>` com p ∈ [0, 0.25, 0.5, 0.75, 1], `n = Math.round(p · L)`, `k = L − n`.
  - `avaliarPortao({ recallPorComposicao: Map<'k-n', Map<u, number>>, curtidasEscondidas: Map<u, number> }) → { melhorMistura, criterioA: { diferenca, erroPadrao, passa }, criterioB: { nRetirados, valor, passa }, passa, cenario }`
    - (a): melhor entre `112-38`, `75-75`, `37-113` por recall médio, empate pelo menor n; passa se `média(melhor − 150-0) > erroPadraoPareado`.
    - (b): ordenar por curtidas escondidas **da validação** desc e id asc, retirar `Math.floor(0.1 · n)`, passa se `média(recall(100-50) − recall(150-0)) > 0` nos restantes.
    - `cenario` = `'aprovado'` se (a) e (b), senão `'reprovado'`.
- O portão usa o `H_M` do **HNSW**, lido de `artefatos/candidatos-v2-v2-exp.json` (§8.1); o JSON registra `fonteFC: 'hnsw'`.

- [ ] **Step 1: Write the failing tests:** `composicoesPortao(150)` = p, k, n de `[0,150,0], [0.25,112,38], [0.5,75,75], [0.75,37,113], [1,0,150]`; `composicoesPortao(50)` dá n = 0, 13, 25, 38, 50; (b) com 20 usuários retira 2; (a) em empate escolhe o menor n; `cenario` reprovado quando só (a) passa.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** a função e o script: para L ∈ {50, 100, 150, 200} e todas as composições, o recall por usuário (relevantes da validação); a contribuição exclusiva sobre P ∪ F (top-150 de cada fonte); a fração de usuários com ≥ 1 relevante só na parte FC de (100, 50); grava `resultados/portao-fc-v2-exp.json` com o aviso "portão já visto na prévia; não pré-registrado".
- [ ] **Step 4: Run** `npm test` → PASS; `npm run portao-v2` → grava o arquivo.
- [ ] **Step 5: Commit** `feat: portão da FC (portao-fc-v2-exp.json)` com o resultado.

### Task 9: Fidelidade na validação

**Files:**
- Create: `src/avaliacao/fidelidade.js`, `scripts/19-fidelidade-v2.js`; `package.json` (`"fidelidade-v2"`)
- Test: `tests/unidade/fidelidade.test.js`

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 7; `bootstrapPareado`, `ndcgEm10`, `recallDosCandidatos`, `pontuarCandidatos`, `top10PorScore`, `carregarModelo`.
- Produces:
  - `sobreposicao(a, b, n) → number`: `|a_n ∩ b_n| / max(|a_n|, |b_n|)`, e 1 se as duas forem vazias (`x_n = x.slice(0, n)`).
  - `listasIdenticas(a, b, n) → boolean`.
  - `conferirPrecisao({ exata: number[], referencia: number[], escore64: Map<id, number>, escoreM: number, tau = 1e-5 }) → { ok, divergenciasPrecisao, erros: string[] }` com as três regras da §5.3 (troca com |Δescore64| < τ; entrada/saída na posição m com |escore64 − escoreM| < τ; corte em zero com escore64 < τ).
  - `tetoImpacto(nDiferentes, nt) → number` = `Math.min(1, nDiferentes / nt)`.
  - `top10Identicos(a: Map<u, number[]>, b: Map<u, number[]>) → { iguais, diferentes }` (mesmos usuários nos dois mapas, senão erro).
- O script (`--fase v2-exp`) faz, para N ∈ {50, 100, 150}: as medidas 1 e 2 (HNSW × referência e HNSW × busca exata, antes do preenchimento), a medida 3, a conferência exata = referência (para com erro se `ok = false`), os planos EXPLAIN, os usuários com `empateNaoResolvido` e a medida 4 de **S1** (top 10 da lista final (0, 150), com preenchimento, nas duas versões; bootstrap pareado). Com `--medida4 S3,v2` (rodado na Task 11), acrescenta S3 e a v2 com as redes já treinadas. Grava `resultados/fidelidade-fc-v2-exp.json`.

- [ ] **Step 1: Write the failing tests:** `sobreposicao([1,2,3],[1,2,4],3)` = 2/3; vazias = 1; `conferirPrecisao` aceita uma troca entre escores 0,5 e 0,500004, recusa uma troca entre 0,5 e 0,51, aceita a saída no corte de um filme com escore64 = 3e-6 e recusa uma com 0,2; `tetoImpacto(470, 430) = 1`; `tetoImpacto(43, 430) = 0.1`; `top10Identicos` com 3 usuários, 1 diferente → `{ iguais: 2, diferentes: 1 }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `npm run fidelidade-v2 -- --fase v2-exp`.
- [ ] **Step 5: Commit** `feat: fidelidade da FC na validação` com o resultado.

### Task 10: Treino por configuração

**Files:**
- Create: `src/treino/configuracao.js`
- Test: `tests/unidade/treino-configuracao.test.js`

**Interfaces:**
- Consumes: `historicoDoTreino`, `paresDeTreino`, `paresDeValidacao`, `criarRede`, `treinar`, `salvarModelo` (existentes).
- Produces: `treinarConfiguracao({ ctx, candidatosPorUsuario: Map<u, number[]>, nome, fase, epocasPorSemente = null, dirModelos = 'modelos', maxEpocas = 50 }) → Promise<{ nome, sementes: Array<{ semente, melhorEpoca, epocasTreinadas, atingiuTeto, sha256Pares }> }>`
  - `fase` ∈ {`v2-exp`, `v2-final`}; em `v2-exp`, parada automática (paciência 3) com pares de validação de `ctx.alvos`; em `v2-final`, `epocasPorSemente` obrigatório e nenhum par de validação.
  - Arquitetura `64-32`, esquema `candidatos`, `semPop: false`, sementes 1, 2, 3, salvando em `modelos/<nome>-<fase>-s<semente>/` (o mesmo laço do `scripts/09-treinar.js`, que fica intocado para manter a v1 reproduzível).
- Nome das configurações: `v2-<k>-<n>`.

- [ ] **Step 1: Write the failing test** (catálogo sintético mínimo, como em `rede.test.js`, `maxEpocas = 2`): devolve 3 sementes; em `v2-final` sem `epocasPorSemente` lança erro; duas execuções dão o mesmo `sha256Pares`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: treino da rede por configuração (v2)`

### Task 11: Grade e escolha

**Files:**
- Create: `src/avaliacao/sistemas-v2.js`, `scripts/20-grade-v2.js`; `package.json` (`"grade-v2"`)
- Test: `tests/unidade/sistemas-v2.test.js`

**Interfaces:**
- Consumes: Tasks 5, 7, 8, 9, 10; `escolherConfiguracao`, `mediaEntreSementes`, `projetar`, `avaliarSistema`, `pontuarCandidatos`, `top10PorScore`, `bootstrapPareado`, `subamostrarRelevantes`.
- Produces:
  - `configuracoesDaGrade(cenario, { cortarOrcamentoVariavel = false }) → Array<{ k, n }>`: aprovado → as 15 células; com o corte → (150, 0), (100, 50), (50, 100), (0, 150); reprovado → só (150, 0).
  - `nomeSistema({ k, n }) → 'S2'|'S3'|'S4-k-n'`.
  - `simplicidadeV2(sistema) → number[]`: S1 → `[0]`; S2 → `[1]`; S0 → `[2, 0, 0, 10, 10]`; os demais → `[2, 1, n, k + n, k]`.
  - `top10S1(fc150: number[]) → number[]` = `fc150.slice(0, 10)`; `top10S0(populares) → populares.slice(0, 10)`.
- O script:
  - lê `cenario` do portão e recusa rodar se `mde-v2.json` ou `divisoes-v2.json` não estiverem commitados;
  - constrói `fc150 = fc150DeTodos(candidatos)` uma vez e usa o mesmo `Map` em S1, no `candidatosPorUsuario` do treino de S3 e na pontuação de S3; antes de avaliar, confere por usuário que `fc150.get(u).length === 150` e que os top 10 de S1 e de S3 estão contidos em `fc150.get(u)`; grava `sha256FC150`;
  - treina cada configuração com `treinarConfiguracao` (fase `v2-exp`), avalia S0, S1 e as configurações nos usuários com relevantes da validação;
  - escolhe com `escolherConfiguracao` (entrada: `{ nome, porUsuario: média das sementes, porSemente: [médias por semente] ou [média] sem rede, simplicidade }`); marca "v2 = v1" só se a escolhida for `S2`;
  - calcula as contribuições da §8.5 (bootstrap, rotuladas descritivas, "não rodadas: portão reprovado" quando for o caso), as posições do top 10 vindas do preenchimento em S1, S3 e na v2, e o MDE descritivo de v2 × v1 e o ganho sob a mesma subamostragem (20 repetições da Task 5), com `otimista: true` e a frase "escolha e parada usam a validação; não é estimativa imparcial";
  - grava `resultados/grade-v2-exp.json` com `epocasPorSistema` (melhor época por semente de cada sistema com rede). Em seguida roda `npm run fidelidade-v2 -- --fase v2-exp --medida4 S3,v2`.

- [ ] **Step 1: Write the failing tests:** `configuracoesDaGrade('aprovado')` tem 15 itens e não contém (0, 0); `('reprovado')` = `[{ k: 150, n: 0 }]`; com o corte, 4 itens; ordem das chaves: num caso em que todos empatam, `escolherConfiguracao` escolhe S1; sem S1, S2; sem S1 e S2, S0; depois `S4-50-0` antes de S3; `nomeSistema({ k: 150, n: 0 }) = 'S2'`; `top10S1([9, 3, 7, 1, 2, 4, 5, 6, 8, 10, 11])` = os 10 primeiros, na mesma ordem.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Run** `npm run grade-v2` (cerca de 35 min; com o portão reprovado, poucos minutos). Se o prazo exigir, `--cortar-orcamento-variavel` é decidido **antes** de rodar (§12).
- [ ] **Step 6: Commit** `feat: grade e escolha da v2 (grade-v2-exp.json)` com os resultados e a fidelidade atualizada.

### Task 12: Congelamento

**Files:**
- Create: `src/congelamento/git.js`, `scripts/21-congelar-v2.js`; `package.json` (`"congelar-v2"`)
- Test: `tests/unidade/congelamento.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 11; `resumoDivisoesV2` (para o hash do teste-2).
- Produces:
  - `executarGit(args) → string` (`execFileSync('git', args)`, saída sem espaços nas pontas).
  - `commitAtualLimpo({ git = executarGit }) → string`: erro se `status --porcelain` não for vazio; devolve `rev-parse HEAD`.
  - `conferirCongelamento({ arquivo = 'resultados/configuracao-v2.json', commitCodigo, git = executarGit }) → void`: árvore limpa; `ls-files --error-unmatch <arquivo>`; `diff --quiet HEAD -- <arquivo>`; `merge-base --is-ancestor <commitCodigo> HEAD`; `diff --quiet <commitCodigo> HEAD -- src scripts package.json package-lock.json`; `log --format=%H <commitCodigo>..HEAD -- <arquivo>` com **exatamente uma** linha. Cada falha lança um erro com a causa.
  - `sha256Arquivos(caminhos) → Record<caminho, sha256>`.
  - `montarCongelamento({ grade, portao, mde, resumo, hashes, commitCodigo, sha256Codigo, sha256Grade }) → objeto`: a v2, as épocas e os sistemas vêm **só** de `grade` (escolhida, `epocasPorSistema`, cenário); erro se `grade.escolha.escolhida` não estiver entre os sistemas rodados.
- O script grava `resultados/configuracao-v2.json` com os campos da §9.1: sistemas do cenário rodado; v2, v1, secundárias = S0, S1, S2, S3 se rodado, melhor de orçamento fixo e melhor S4; épocas; `seed_api = 1`; hashes do teste-2, do treino, da régua e dos vetores FC `v2-final`; `sha256Grade`; portão; os dois MDE; MDE descritivo; a comparação principal por extenso; as regras de avaliação; a ressalva da §3.4; `commitCodigo`; sha256 de `src/avaliacao/*.js` e de `scripts/23-etapa2-v2.js`. Recusa se `resultados/avaliacao-v2.json` existir. `--desvio "<motivo>"` permite recongelar: exige sistema escolhido, épocas e configurações iguais aos do arquivo anterior e acrescenta `{ commitCodigoAnterior, motivo, data }` a `desvios`.

- [ ] **Step 1: Write the failing tests** com um `git` falso (função que responde por argumentos): árvore suja → erro; código alterado depois do congelamento → erro; só um commit em `resultados/` que não toca o congelamento → aceita; **dois commits** tocando o congelamento depois de `commitCodigo` → erro; `commitCodigo` não ancestral → erro; `montarCongelamento` com uma grade cuja escolhida não está nos sistemas → erro, e com a grade válida a v2 é a escolhida da grade; `--desvio` com outra configuração escolhida → erro.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5 (depois de as Tasks 13 e 14 estarem implementadas e commitadas): Commit** todo o código pendente (`feat: congelamento por git`). Rodar `npm run carregar-v2 -- --fase v2-final`, depois `npm run congelar-v2` com a árvore limpa.
- [ ] **Step 6: Commit** só o arquivo: `chore: congela a configuração da v2` com `resultados/configuracao-v2.json`.

### Task 13: Etapa 1 — previsões sem gabarito

**Files:**
- Create: `scripts/22-etapa1-v2.js`; `package.json` (`"etapa1-v2"`)
- Test: o fluxo usa só funções já testadas nas Tasks 1–12; a verificação é a execução sintética do Step 2.

**Interfaces:**
- Consumes: `conferirCongelamento` (Task 12), `criarContexto` v2-final sem `incluirTeste2`, `gerarCandidatosV2`, `listaDaConfiguracao`, `fc150DeTodos`, `sha256FC150`, `treinarConfiguracao` com `epocasPorSemente`, `sobreposicao`, `listasIdenticas`, `conferirPrecisao`, `tetoImpacto`, `top10Identicos`, `relatorioDeficit`, `buscarColaborativos` (modos `'hnsw'` e `'exata'`), `rankingReferencia`.
- Produces: `artefatos/previsoes-v2-final.json` (formato no topo), `resultados/previsoes-v2-final.sha256.json` (`{ sha256, sha256Configuracao, sha256FC150 }`), `resultados/fidelidade-fc-v2-final.json`, `resultados/deficit-v2-final.json`.

- [ ] **Step 1: Implement** o script na ordem da §9.2: (1) `conferirCongelamento`; (2) contexto `v2-final` e conferência dos hashes de treino, régua e vetores FC contra o congelamento; (3) confere os hashes do schema `v2_final`; (4) retreina as redes dos sistemas congelados; (5) top 10 de todos os sistemas, sementes e usuários 1–462, com a FC150 única e as mesmas asserções de contenção da Task 11; (6) fidelidade no teste-2 sem gabarito: medidas 1 e 2 contra a referência e contra a busca exata, conferência exata = referência, fração de top 10 idêntico (HNSW × referência) em S1 e na v2 (para a v2 com rede, as mesmas redes sobre a lista da referência), teto `min(1, ·)` com `nt` do Passo 0 e a frase obrigatória; "zero por construção" se a v2 não usar a FC; contagens de déficit; (7) grava as previsões com `jsonEstavel`; (8) grava `sha256`, `sha256Configuracao` e `sha256FC150`.
- [ ] **Step 2: Verify** com `--dir-dados <pasta sintética>` e `--saida <pasta temporária>` (as duas opções existem só para essa verificação; sem elas, o script usa os dados reais e `resultados/`): o script termina, o arquivo de previsões tem 10 ids distintos por usuário, sistema e semente, e os três sha256 gravados conferem.
- [ ] **Step 3: Run** `npm test` → PASS. **Commit** `feat: etapa 1 da avaliação final` **antes** do congelamento: `scripts/` entra na trava do `git diff` (§9.1). Se o script mudar depois do congelamento, recongelar com `--desvio`.
- [ ] **Step 4 (depois da Task 12, Steps 5–6): Run** `npm run etapa1-v2` → grava os arquivos.
- [ ] **Step 5: Commit** `chore: previsões da v2 e hash antes do gabarito` com `resultados/previsoes-v2-final.sha256.json`, `fidelidade-fc-v2-final.json` e `deficit-v2-final.json`.

### Task 14: Etapa 2 — leitura do gabarito

**Files:**
- Create: `src/avaliacao/etapa2.js`, `scripts/23-etapa2-v2.js`; `package.json` (`"etapa2-v2"`)
- Test: `tests/unidade/etapa2.test.js`

**Interfaces:**
- Consumes: `conferirCongelamento`, `sha256Arquivos` (Task 12); `avaliarSistema`, `relevantesPorUsuario`, `projetar`, `mediaEntreSementes`, `bootstrapPareado`, `grupoMainstream`, `valoresMainstream`, `metricasPorGrupo`.
- Produces:
  - `verificarAntesDoGabarito({ congelamento, gravado: { sha256, sha256Configuracao }, sha256PrevisoesAtual, sha256ConfiguracaoAtual, sha256CodigoAtual, avaliacaoExiste }) → string[]` (lista de problemas; vazia = pode ler).
  - `avaliarPrevisoes({ previsoes, relevantes, contagens, congelamento, regua, treino, filmes }) → objeto do resultado`: métricas de todos os sistemas (NDCG, P@10, R@10, cobertura, popularidade média), por semente e média nos sistemas com rede, mainstream × nicho, a comparação principal (bootstrap 5.000, semente 2026, `suportada = ic95[0] > 0`, ou "sem comparação confirmatória" se v2 = v1), as secundárias da §8.5 rotuladas descritivas, e `ressalva` copiada do congelamento.
  - `executarEtapa2({ verificar: () => string[], lerGabarito: () => Avaliacao[], avaliar: (gabarito) => objeto, gravar: (objeto) => void }) → Promise<objeto>`: chama `verificar`; se houver problema, rejeita **sem** chamar `lerGabarito`; senão, `lerGabarito` → `avaliar` → `gravar`.
- O script só injeta as dependências: `verificar` com `conferirCongelamento` e `verificarAntesDoGabarito`; `lerGabarito = () => criarContexto({ fase: 'v2-final', dirDados, incluirTeste2: true }).alvos` (com a conferência do hash do teste-2); `avaliar` com `avaliarPrevisoes` sobre as previsões gravadas (não importa `src/banco/` nem `src/modelo/`); `gravar` com `flag: 'wx'` em `resultados/avaliacao-v2.json`.

- [ ] **Step 1: Write the failing tests:**
  - `verificarAntesDoGabarito` devolve um problema para cada caso: hash das previsões diferente, sha256 do congelamento diferente do gravado, código de avaliação alterado, `avaliacaoExiste = true`.
  - `executarEtapa2` com `verificar` devolvendo `['x']` rejeita, e um espião `lerGabarito` tem 0 chamadas; sem problemas, a ordem registrada é `['verificar', 'lerGabarito', 'avaliar', 'gravar']`.
  - `avaliarPrevisoes` com previsões sintéticas dá NDCG = 1 para um usuário com o relevante na posição 1; `suportada = false` quando o IC contém zero; o resultado tem `ressalva` igual à do congelamento.
  - Teste estático: `scripts/23-etapa2-v2.js` e `src/avaliacao/etapa2.js` não importam `src/banco` nem `src/modelo`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS. Commit (`feat: etapa 2 da avaliação final`) **antes** do congelamento (Task 12, Step 5).
- [ ] **Step 5: PARAR e pedir autorização explícita ao usuário** para rodar `npm run etapa2-v2`. Só com o "sim" dele: rodar e fazer commit de `resultados/avaliacao-v2.json` (`chore: resultado da avaliação final da v2`). Qualquer que seja o resultado, ele é reportado como saiu.

### Task 15: Documentação

**Files:**
- Modify: `README.md`, `resultados/README.md`

- [ ] **Step 1:** No README, a seção "Avaliação retrospectiva do Plano 3 (teste-2)", com os itens da §11: a ressalva da §3.4 (texto completo) **logo ao lado da comparação principal**; a comparação principal descrita como ganho do sistema completo (§8.5); o aviso de que os números da validação da escolhida são otimistas; as contribuições rotuladas descritivas; a fidelidade e o déficit à parte; a declaração de que o sistema avaliado inclui o HNSW e o preenchimento; as frases de fidelidade não medida, quando couberem; os desvios do congelamento; e as limitações da §13, inclusive o texto do `u1.test` e a dos vetores binários.
- [ ] **Step 2:** Em `resultados/README.md`, uma entrada para cada arquivo novo: `divisoes-v2.json`, `mde-v2.json`, `deficit-v2-*.json`, `portao-fc-v2-exp.json`, `fidelidade-fc-v2-*.json`, `grade-v2-exp.json`, `configuracao-v2.json`, `previsoes-v2-final.sha256.json`, `avaliacao-v2.json`.
- [ ] **Step 3:** Conferir que os números citados no README batem com os JSON (leitura lado a lado) e que os resultados da v1 continuam intocados (`git diff main -- resultados/avaliacao-final.json` vazio).
- [ ] **Step 4: Commit** `docs: resultados do Plano 3`

## Ordem de execução e calendário

| Quando | Tasks |
|---|---|
| Domingo | 1–10 (código, testes e execuções na validação), 11 (grade, ~35 min de computação), 13 e 14 implementadas e testadas com dados sintéticos |
| Domingo à noite / segunda | 12 (congelamento), 13 (etapa 1), 14 Step 5 (com autorização), 15 |

Os commits do Passo 0 (Task 2) e do MDE (Task 5) têm de vir antes do primeiro treino da grade (Task 11). O portão (Task 8) roda depois da carga do banco (Task 6) e dos candidatos HNSW (Task 7), e antes da grade. As Tasks 13 e 14 são implementadas antes do congelamento, porque `scripts/` entra na trava do `git diff` (§9.1). Cortes, se o prazo exigir, na ordem da §12: fidelidade no teste-2 (Task 13, Step 1, item 6), orçamento variável (Task 11, decidido antes de rodar), mainstream × nicho (Task 14).
