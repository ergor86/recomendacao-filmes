# Resultados

Os arquivos desta pasta são gerados pelos scripts e versionados, para que os números citados na documentação possam ser conferidos. JSON não aceita comentários, então a explicação de cada campo fica aqui.

Quase todos foram gerados na **fase `exp`** (validação), ou seja, nos usuários 463 a 943 com 40% das notas de cada um escondidas (semente 42). As exceções são `treino-*-final.json` e `avaliacao-final.json`, da **fase `final`**: treino no `u1.base` inteiro e avaliação no teste oficial (`u1.test`), usado **uma única vez**, em 2026-11-12 (seção [`avaliacao-final.json`](#avaliacao-finaljson)). Os arquivos `*-v2-*.json`, `divisoes-v2.json`, `mde-v2.json`, `configuracao-v2.json` e `avaliacao-v2.json` são do Plano 3, na seção [Plano 3](#plano-3-filtragem-colaborativa-teste-2), no fim deste arquivo.

## Conceitos usados em todos os arquivos

- **Relevante:** um filme escondido que o usuário avaliou com nota ≥ 4. O conjunto de relevantes de cada usuário é o **gabarito**.
- **Usuários avaliados:** só entram nas médias os usuários com pelo menos um relevante escondido (478 na validação). Os usuários 685, 797 e 814 ficam de fora porque não têm nenhum.
- **`hashRegua`:** impressão digital (sha256) da régua usada. Dois arquivos com o mesmo hash foram gerados com os mesmos parâmetros de codificação.
- **`fase`:** `exp` (validação) ou `final` (teste).
- **Médias por usuário:** cada métrica é calculada para cada usuário e depois tirada a média simples. Um usuário com 3 relevantes pesa o mesmo que um com 50.

## `linha-de-base-validacao.json`

**Gerado por:** `npm run linha-de-base` (script 06).

O sistema mais simples que faz sentido: recomendar a cada usuário os 10 filmes mais populares que ele ainda não viu. É o número que a rede neural precisa superar.

| Campo | Valor | O que significa |
|---|---|---|
| `ndcg` | 0,2330 | **NDCG@10**, a métrica principal. Como a precisão, mas um acerto vale mais quanto mais alto estiver na lista (1ª posição vale 1; 10ª vale 0,29). Vai de 0 a 1. |
| `precisao` | 0,2021 | **Precisão@10.** Dos 10 recomendados, a fração que era relevante. Em média, 2 acertos em 10. |
| `recall` | 0,1206 | **Recall@10.** Dos relevantes escondidos, a fração que apareceu no top 10. É baixo porque muitos usuários têm dezenas de relevantes e só há 10 vagas. |
| `cobertura` | 0,0184 | Fração dos 1682 filmes que aparece em alguma lista: só 31 filmes. Esperado, porque todos recebem quase a mesma lista de populares. |
| `popularidadeMediaContagem` | 282,6 | Média do nº de notas no treino dos filmes recomendados. Mede o viés para populares; servirá de comparação para a rede. |
| `nUsuarios` | 478 | Usuários avaliados. |
| `semente` | 42 | Semente das notas escondidas. |

**Leitura:** 0,233 parece pouco, mas é uma linha de base forte. No MovieLens, as pessoas assistem e gostam muito dos mesmos clássicos.

## `candidatos-validacao.json`

**Gerado por:** `npm run candidatos` (script 07).

Mede a primeira etapa do sistema: a lista de candidatos que a rede vai ordenar.

### Recall dos candidatos

A métrica principal deste arquivo. Para cada usuário, é a fração dos relevantes escondidos que entrou na lista de candidatos. A média é feita sobre os usuários.

É o **teto** do sistema: a rede só ordena o que recebe, então um relevante que não entrou nos candidatos nunca será recomendado.

### Campos

| Campo | O que significa |
|---|---|
| `populares.K50` … `K200` | Recall usando só os K populares não vistos. Com K = 100: **0,462**. |
| `vetorial.N20` … `N100` | Recall usando só os N vizinhos mais próximos do perfil do usuário no pgvector. Com N = 100: **0,199**. |
| `grade` | Uma linha para cada combinação de K (50, 100, 150, 200) e N (0, 20, 50, 100). Os campos de cada linha estão abaixo. |
| `grade[].recallUniao` | Recall da união das duas listas, sem repetição. |
| `grade[].orcamentoEfetivo` | Tamanho médio da lista após a união. Fica abaixo de K + N porque alguns vizinhos também são populares e contam uma vez só. |
| `grade[].contribuicaoExclusiva` | Dos acertos da união, a fração que **só** a fonte vetorial trouxe. Soma os acertos de todos os usuários antes de dividir (agregada), em vez de fazer a média das frações por usuário. |
| `nUsuariosComVetor` | Usuários com perfil vetorial (têm pelo menos uma curtida no treino): 478. |
| `exp2` | Experimento 2: recomendar só os 10 vizinhos mais próximos, sem popularidade. NDCG **0,070**, P@10 0,061, R@10 0,032. |
| `definicoes` | As mesmas definições, gravadas dentro do arquivo. |
| `reprodutibilidade` | Ver a seção do HNSW abaixo. |

### A grade K × N

| K \ N | 0 | 20 | 50 | 100 |
|---|---|---|---|---|
| **50** | 0,323 · 50 | 0,364 · 68 | 0,405 · 97 | 0,462 · 144 |
| **100** | 0,462 · 100 | 0,491 · 117 | 0,523 · 144 | **0,567 · 189** |
| **150** | 0,577 · 150 | 0,600 · 165 | 0,622 · 191 | 0,656 · 234 |
| **200** | 0,647 · 200 | 0,665 · 213 | 0,683 · 238 | 0,712 · 279 |

Cada célula mostra o recall da união e o tamanho médio da lista.

### Leitura

- **Vetores sozinhos são fracos.** Como recomendador, ficam em NDCG 0,070, contra 0,233 da popularidade. Gênero e época dizem "que tipo de filme", mas não "se é bom".
- **Na união, os vetores acrescentam recall:** com K = 100, sair de N = 0 para N = 100 leva o recall de 0,462 a 0,567. Com K = 100 e N = 100, 16,5% dos acertos vieram só dos vetores.
- **Com o mesmo tamanho de lista, mais populares rendem mais recall do que vetores.** Por exemplo, K = 150 sem vetores (150 candidatos) dá 0,577, contra 0,523 de K = 100 com N = 50 (144 candidatos). O valor dos vetores para a rede ainda precisa ser medido no Plano 2: eles trazem filmes diferentes, mas não necessariamente mais acertos.

## `verificacao-hnsw.json`

**Gerado por:** `npm run verificar-hnsw` (script 05).

O índice HNSW acha vizinhos rápido, mas de forma aproximada. Este arquivo mede quanto ele concorda com a busca exata, que compara o usuário com todos os filmes.

| Campo | Valor | O que significa |
|---|---|---|
| `fracaoMedia` | 0,9958 / 0,9976 / 0,9982 | Para N = 20 / 50 / 100: dos N vizinhos da busca exata, a fração que o HNSW também devolveu, em média por usuário. Acima de 0,99 é considerado seguro. |
| `nUsuarios` | 480 | Usuários de validação com perfil (pelo menos uma curtida no treino). São 480, e não 478, porque aqui não é preciso ter relevantes escondidos. |
| `parametros.ef_search_piso` | 40 | Piso do ef_search, ou seja, de quantos candidatos o HNSW explora por consulta. **Não** é o valor usado nas buscas; esse está em `efSearchPorN`. |
| `efSearchPorN` | 70 / 100 / 150 | ef_search efetivamente usado para cada N. É N + 50 linhas pedidas, com mínimo de 40. |
| `regraEfSearch` | | A regra acima, por extenso. |
| `parametros.iterative_scan` | strict_order | Se o filtro "já vistos" remover linhas demais, o índice continua buscando, mantendo a ordem por distância. |
| `parametros.max_scan_tuples`, `scan_mem_multiplier` | 20000, 1 | Limites da varredura iterativa (padrões do pgvector 0.8.1). |
| `reprodutibilidade` | | Os números se repetem exatamente enquanto o índice não é reconstruído. |

**Leitura:** o HNSW perde menos de 1 vizinho em 200. Dá para usar o índice rápido sem distorcer os resultados.

**Sobre a reprodutibilidade:** o pgvector sorteia a estrutura do grafo ao construir o índice. Recarregar o banco (`npm run carregar-filmes`) reconstrói o grafo, e os números deste arquivo e de `candidatos-validacao.json` podem mudar na 3ª ou 4ª casa decimal. Rodar os scripts de novo sem recarregar dá exatamente os mesmos números.

## `treino-candidatos-64-32-final.json` e `treino-candidatos-64-32-sempop-final.json`

**Gerados por:** `npm run treinar -- --fase final ... --epocas-de resultados/treino-<nome>-exp.json` (script 09).

Têm os mesmos campos dos arquivos `treino-*-exp.json`, mas vêm do treino final, que usa o `u1.base` inteiro e não tem validação. Por isso `perdaValidacao` e `aucValidacao` ficam vazios (`null`). Cada semente treina um número fixo de épocas: a melhor época que ela teve na validação.

| Modelo | Semente | Épocas | Passos de gradiente | Segundos | AUC no treino |
|---|---|---|---|---|---|
| `candidatos-64-32` | 1 | 11 | 11.033 | 38,5 | 0,782 |
| | 2 | 15 | 15.045 | 51,2 | 0,791 |
| | 3 | 15 | 15.045 | 51,5 | 0,788 |
| `candidatos-64-32-sempop` (controle) | 1 | 15 | 15.045 | 51,2 | 0,740 |
| | 2 | 15 | 15.045 | 51,1 | 0,741 |
| | 3 | 16 | 16.048 | 54,8 | 0,738 |

## `avaliacao-final.json`

**Gerado por:** `npm run avaliacao-final` (script 13), **uma única vez**, em 2026-11-12. O script se recusa a rodar de novo se o arquivo já existe. Ele rodou sem erro na primeira tentativa.

É o único arquivo com números do teste oficial (`u1.test`). Ele usa a configuração congelada em `configuracao-final.json` antes de qualquer contato com o teste: negativos dos candidatos, rede 64→32, **K = 150** populares e **N = 0** vizinhos.

- **Usuários avaliados:** 456. O `u1.test` tem 459 usuários, mas 446, 459 e 460 não têm nenhum relevante e ficam fora de todas as métricas.
- **Sistemas com rede (Exp. 4 a 7):** o valor de cada usuário é a média das 3 sementes, e não um ensemble. O mínimo e o máximo entre as sementes aparecem à parte.
- **`ndcgPorUsuario`:** o NDCG de cada usuário em cada experimento fica gravado. Assim, dá para fazer novas análises sem ler o teste de novo.

### Os 7 experimentos

| # | Experimento | NDCG@10 | P@10 | R@10 | Cobertura | Popularidade média |
|---|---|---|---|---|---|---|
| 1 | Popularidade: os 10 populares não vistos | 0,2451 | 0,2136 | 0,1180 | 0,0303 (51 filmes) | 368,9 |
| 2 | Só vetores: os 10 vizinhos mais próximos | 0,0719 | 0,0643 | 0,0290 | 0,2634 | 93,6 |
| 3 | Híbrido sem rede (mede só os candidatos) | — | — | — | — | — |
| 4 | **Híbrido + rede** (hipótese principal) | **0,3526** | 0,3003 | 0,1583 | 0,0947 | 276,5 |
| 5 | Populares + rede, mesmo orçamento do Exp. 4 | 0,3526 | 0,3003 | 0,1583 | 0,0947 | 276,5 |
| 6 | Rede sobre todos os não vistos | 0,2636 | 0,2173 | 0,1215 | 0,1768 | 199,7 |
| 7 | Híbrido + rede **sem popularidade** nas entradas (controle) | 0,3202 | 0,2709 | 0,1384 | 0,1124 | 246,5 |

A cobertura e a popularidade média seguem as mesmas definições da linha de base. Nos Exp. 4 a 7, elas são a média das 3 sementes. O Exp. 3 é medido no nível dos candidatos, e não no top 10 (ver abaixo).

**Variação entre as sementes** (mínimo e máximo dos valores de cada semente):

| # | NDCG@10 | P@10 | R@10 | Cobertura | Popularidade média |
|---|---|---|---|---|---|
| 4 e 5 | [0,3439; 0,3575] | [0,2932; 0,3088] | [0,1551; 0,1603] | [0,0922; 0,0969] | [274,9; 277,7] |
| 6 | [0,2508; 0,2845] | [0,2039; 0,2401] | [0,1184; 0,1273] | [0,1677; 0,1897] | [186,7; 216,7] |
| 7 | [0,3193; 0,3206] | [0,2706; 0,2715] | [0,1373; 0,1391] | [0,1082; 0,1195] | [243,8; 250,0] |

NDCG@10 de cada semente (1 / 2 / 3): Exp. 4 = 0,3439 / 0,3575 / 0,3566; Exp. 6 = 0,2553 / 0,2845 / 0,2508; Exp. 7 = 0,3206 / 0,3193 / 0,3205.

**Diferenças em relação ao Exp. 4** (média por usuário, só descritivas, sem intervalo de confiança; campo `diferencasDescritivasEmRelacaoAoExp4`):

| Experimento − Exp. 4 | NDCG@10 | P@10 | R@10 |
|---|---|---|---|
| Exp. 2 | −0,2808 | −0,2360 | −0,1293 |
| Exp. 5 | 0 | 0 | 0 |
| Exp. 6 | −0,0891 | −0,0830 | −0,0368 |
| Exp. 7 | −0,0325 | −0,0294 | −0,0199 |

### Leitura em linguagem simples

- **O sistema escolhido (Exp. 4)** tem duas etapas: pega os 150 filmes mais populares que o usuário não viu, e a rede os reordena pelo perfil dele (idade, gêneros e épocas que curte). Os 10 primeiros viram a recomendação.
- **Em média, 3 acertos em 10.** Quem diz isso é a precisão (P@10 = 0,300), não o NDCG. O NDCG (0,353) também premia a posição: um acerto no 1º lugar vale mais que um no 10º. Por isso, ele não se traduz direto em "número de acertos". A popularidade fica em cerca de 2 acertos em 10 (P@10 = 0,214).
- **É uma média, não o que todo usuário recebe.** O número de acertos varia bastante entre usuários: 43 dos 456 (9%) ficam sem nenhum acerto nas 3 sementes. Na popularidade, são 99 sem nenhum acerto (22%).
- **"Acerto" é um filme que o usuário assistiu e avaliou com nota ≥ 4 no `u1.test`.** Um filme recomendado que ele nunca assistiu conta como erro, mesmo que ele fosse gostar. Então "3 em 10" é um piso: mede o que dá para comprovar com os dados.
- **A popularidade dentro da rede ajuda, mas não explica tudo.** Sem ela (Exp. 7), o NDCG cai de 0,353 para 0,320. Mesmo assim, fica bem acima dos 0,245 da popularidade: a rede tira informação do gosto do usuário.
- **A etapa de candidatos importa.** Quando a rede ordena todos os filmes não vistos (Exp. 6), o NDCG cai para 0,264. Uma explicação provável é que filmes pouco vistos sobem ao topo sem que o usuário os tenha assistido, mas o experimento não isola essa causa.
- **Vetores sozinhos (Exp. 2) quase não acertam:** 0,072, perto de sortear 10 filmes entre os 200 populares (0,064 na validação, em `referencia-aleatoria.json`).
- **Teto da rede:** só 57% dos relevantes estão entre os 150 candidatos (Exp. 3). O resto, a rede nunca chega a ver.

### Hipótese principal (campo `hipotesePrincipal`)

A pergunta do projeto é: o híbrido com rede (Exp. 4) supera a popularidade (Exp. 1) em NDCG@10?

Para cada usuário, calcula-se a diferença NDCG(Exp. 4) − NDCG(Exp. 1). O **bootstrap pareado** sorteia 5.000 vezes, com reposição, uma amostra de 456 usuários (semente 2026) e calcula a média das diferenças de cada amostra. O intervalo de 95% vai do percentil 2,5 ao percentil 97,5 dessas médias. A hipótese é suportada se o intervalo inteiro fica acima de zero.

| Campo | Valor |
|---|---|
| `media` | **+0,1076** |
| `ic95` | **[0,0907; 0,1250]** |
| `suportada` | **sim** |
| `nUsuarios` | 456 |

**Sensibilidade por semente** (`porSementeDescritivo`): é o mesmo cálculo, mas com o NDCG de uma semente só no lugar da média das 3. É só descritivo.

| Semente | Diferença média | IC 95% | Exclui zero? |
|---|---|---|---|
| 1 | +0,0988 | [0,0805; 0,1173] | sim |
| 2 | +0,1124 | [0,0934; 0,1316] | sim |
| 3 | +0,1115 | [0,0935; 0,1296] | sim |

### Exp. 2 e Exp. 3: os candidatos

- **Exp. 2 (só vetores):** avaliado nos 456 usuários. Nenhum foi excluído por falta de curtidas. O recall dos 100 primeiros vizinhos é **0,1718**.
- **Exp. 3 (híbrido sem rede):** com K = 150 e N = 0, a lista de candidatos são os 150 populares não vistos.

| Campo | Valor | O que significa |
|---|---|---|
| `recallDaUniao` | **0,5699** | Fração média dos relevantes que entrou nos candidatos. É o teto de recall do Exp. 4. |
| `orcamentoEfetivo` | 150,0 | Tamanho médio da lista de candidatos. |
| `contribuicaoExclusiva.vet` | 0 | Fração dos acertos trazidos só pelos vetores. É zero **por construção**, porque N = 0. |
| `contribuicaoExclusiva.pop` | 1 | Fração dos acertos trazidos só pelos populares. |
| `contribuicaoExclusiva.ambas` | 0 | Fração dos acertos que as duas fontes trariam. **Não** é uma contribuição exclusiva: é a sobreposição das fontes. |
| `contribuicaoExclusiva.acertos` | 6.218 | Total de relevantes dentro das listas de candidatos, somando todos os usuários. |

No top 10 do Exp. 4 (`contribuicaoExclusivaNoTop10`), todos os acertos vieram dos populares nas 3 sementes (1.337, 1.408 e 1.363 acertos).

### Por que o Exp. 5 é igual ao Exp. 4

Com N = 0, os candidatos do Exp. 4 são exatamente os 150 populares não vistos. O Exp. 5 (populares + rede com o mesmo orçamento) recebe a mesma lista. O script confirmou que as listas de candidatos e os top 10 são idênticos nas 3 sementes (`candidatosIdenticosAoExp4` e `top10IdenticoAoExp4` = `true`). A spec (§9.2) decidiu antes do teste que, nesse caso, o Exp. 5 é reportado como idêntico ao Exp. 4 (`regraNZero`).

### Mainstream × nicho (campo `mainstreamNicho`)

Os usuários são divididos pela popularidade média dos filmes que curtiram no treino (média de `popEscalada`, entre 0 e 1). O corte é a mediana dos 456 usuários avaliados, **0,7882**. Ficaram 228 usuários no grupo mainstream (na mediana ou acima) e 228 no nicho. Todos os usuários avaliados tinham curtidas. Os grupos são relativos a este conjunto: "nicho" quer dizer "mais de nicho que os outros usuários do teste".

| Experimento | NDCG mainstream | NDCG nicho | P@10 mainstream | P@10 nicho | R@10 mainstream | R@10 nicho |
|---|---|---|---|---|---|---|
| 1 popularidade | 0,2414 | 0,2487 | 0,1969 | 0,2303 | 0,1414 | 0,0947 |
| 2 só vetores | 0,0578 | 0,0859 | 0,0526 | 0,0759 | 0,0335 | 0,0245 |
| 4 híbrido + rede | 0,3177 | 0,3876 | 0,2626 | 0,3380 | 0,1803 | 0,1364 |
| 5 (igual ao 4) | 0,3177 | 0,3876 | 0,2626 | 0,3380 | 0,1803 | 0,1364 |
| 6 rede sobre todos | 0,2795 | 0,2476 | 0,2250 | 0,2096 | 0,1561 | 0,0869 |
| 7 controle sem popularidade | 0,2820 | 0,3583 | 0,2306 | 0,3113 | 0,1525 | 0,1244 |

Recall dos candidatos do Exp. 3: **0,6396** no grupo mainstream e **0,5002** no nicho.

A spec tinha uma hipótese descritiva: "a fonte vetorial ajuda mais os usuários de nicho". Ela **não pôde ser medida** no sistema escolhido, porque com N = 0 a fonte vetorial ficou fora dos candidatos. O único número dos vetores por grupo é o do Exp. 2, que recomenda só por vetores.

### Limitações

Da spec (§15):

- **Divisão aleatória, não temporal:** a popularidade pode incluir notas posteriores ao momento da recomendação.
- **Coleta do MovieLens:** favorece filmes populares.
- **Histórico da validação:** cerca de 16% menor que o do teste.
- **Usuário novo não medido:** a rede nunca treinou com perfis vindos de cadastro, e todo usuário do `u1.test` tem histórico.
- **Falsos negativos:** os negativos sorteados (principalmente os dos candidatos) podem incluir filmes de que o usuário gostaria. No treino final, os usuários do teste têm um pouco mais de falsos negativos nos candidatos (29,6%) que os de validação (27,7%), então a validação subestima levemente esse efeito.
- **Parada automática aproximada:** usa o erro em pares amostrados, não o NDCG. As épocas do treino final vêm da validação, e cada época final tem cerca de 31% mais passos de gradiente (ver o README principal).
- **Só 3 sementes:** a variação entre sementes é estimada com poucas repetições.
- **Perfil dos negativos observados:** continuam com o perfil completo, enquanto positivos e sorteados usam o perfil sem o filme do positivo. A rede ainda pode usar essa diferença como atalho. No Plano 3, isso vale também para S2, S3 e S4.

Da revisão final:

- **A fonte vetorial não entrou no sistema escolhido.** N = 0 venceu a grade da validação, e essa decisão foi marcada como **frágil** em `grade-validacao.json`: a faixa [mínimo, máximo] das médias por semente de K = 150, N = 0 se sobrepõe à de outras configurações da grade. Por isso, o resultado mede a rede reordenando os populares, e não o valor da busca vetorial.
- **O Exp. 5 é idêntico ao Exp. 4** porque N = 0, pela regra da spec (§9.2) decidida antes do teste. Neste caso, ele não traz informação nova.
- **`ambas` não é uma contribuição exclusiva:** conta os acertos que as duas fontes trariam. Com N = 0, vale zero.
- **Scores do Exp. 4 calculados num lote maior:** na avaliação final, a rede pontua de uma vez todos os filmes não vistos de cada usuário, para que os Exp. 4, 5 e 6 usem os mesmos scores. Na validação, ela pontuava só os candidatos. A conta é a mesma, mas lotes de tamanhos diferentes podem mudar o último dígito dos números de ponto flutuante e, em casos raros de empate quase exato, a ordem de dois filmes.

## Plano 3: filtragem colaborativa (teste-2)

Os arquivos abaixo vêm do Plano 3 (spec em `docs/superpowers/specs/2026-11-13-plano3-filtragem-colaborativa-design.md`, v4.3). As fases são `v2-exp` (validação: usuários 463 a 943, com 40% das notas de cada um escondidas) e `v2-final` (treino no `u1.base` sem as notas escondidas dos usuários 1–462). O **teste-2** são os usuários 1 a 462, com 20% das notas escondidas. O `u1.test` e o `u.data` não foram lidos. O resultado da v1 no `u1.test` continua na seção [`avaliacao-final.json`](#avaliacao-finaljson), intocado.

Convenção dos sistemas: `S0` popularidade; `S1` FC sozinha (lista FC150, sem rede); `S2` = (150, 0) com rede (a v1); `S3` = (0, 150) com rede; `S4-<K>-<N>` as demais células da grade (K populares e N da FC, com rede). Nos sistemas com rede, o valor de cada usuário é a média das sementes 1, 2 e 3.

**Usuários avaliados no teste-2:** o teste-2 tem 462 usuários (1–462), mas só 445 entram nas métricas. Os outros 17 não têm nenhuma curtida escondida (nenhuma nota ≥ 4 escondida) e ficam fora de todas as médias; a lista está em `avaliacao-v2.json`, campo `usuarios.semRelevantes`.

### `divisoes-v2.json`

**Gerado por:** `npm run divisoes-v2` (script 14), no Passo 0, antes de qualquer treino. Só agregados do teste-2, nunca ids nem notas.

| Campo | O que significa |
|---|---|
| `hashes` | sha256 das divisões: `teste2`, `validacao`, `treinoV2Exp` e `treinoV2Final`. O congelamento confere os mesmos hashes. |
| `validacao`, `teste2` | Resumo de cada conjunto: `notasDisponiveis`, `notasEscondidas` e `curtidasEscondidas` (média, mediana, p10, p25, p75, p90, **sobre todos os usuários do conjunto, inclusive os sem curtidas**), `semCurtidas` e `avaliaveis`. |

Teste-2: `avaliaveis` 445 e `semCurtidas` 17 (462 usuários); curtidas escondidas com média 7,78 e mediana 5. Validação: `avaliaveis` 478 e `semCurtidas` 3; média 21,68 e mediana 15.

### `mde-v2.json`

**Gerado por:** `npm run mde-v2` (script 15), antes da grade.

O MDE é o menor ganho detectável (poder de 80%, IC de 95%): uma **capacidade de detecção, não uma previsão**. O `σ_d` é estimado na validação com o gabarito subamostrado para imitar o teste-2 (`q` = 0,3590, a razão entre as curtidas escondidas dos dois conjuntos; 20 repetições), com `nt` = 445.

| Par | `sigmaD` | `mde` | Simulação (média; mín–máx) |
|---|---|---|---|
| `S0xS1` (sistemas bem diferentes) | 0,1770 | 0,0235 | 0,0233; 0,0208–0,0254 |
| `S1xHeuristica` (S1 contra a FC150 ordenada por escore × √pop) | 0,1245 | 0,0165 | 0,0167; 0,0151–0,0193 |

Cada par também traz `sigmaPorRepeticao`, `nPorRepeticao` e, por repetição, o IC normal e o IC do bootstrap (`icNormalVsBootstrap`). O arquivo guarda a `frase` obrigatória: a estimativa vem de outro grupo de usuários, o par v2 × v1 não é nenhum dos dois, e a capacidade real no teste-2 pode ser diferente, inclusive menor. O MDE do par efetivamente escolhido (S1 × S2) é só descritivo e está em `grade-v2-exp.json` e em `configuracao-v2.json` (0,0215).

### `portao-fc-v2-exp.json`

**Gerado por:** `npm run portao-v2` (script 18).

O portão da FC como fonte de candidatos: um **filtro de viabilidade, não uma prova**. Foi visto na prévia e não é pré-registrado (`aviso`). Usa a FC do HNSW (`fonteFC`: `hnsw`).

| Campo | Valor | O que significa |
|---|---|---|
| `cenario` | `aprovado` | Aprovado: rodam S0 a S4 (as 15 configurações com rede). Reprovado: só S0, S1 e S2. |
| `composicoes` | | Recall médio dos candidatos para cada lista de 50, 100, 150 e 200 e cada fração de FC (0, 25, 50, 75 e 100%). Com 150: (150, 0) 0,5815; (37, 113) 0,6990; (0, 150) 0,6946. |
| `criterioA` | passa | Com 150, a melhor mistura supera (150, 0) por mais de 1 erro padrão: diferença 0,1175, erro padrão 0,0083. |
| `criterioB` | passa | Concentração: tirando os 10% de usuários com mais curtidas escondidas (47), a diferença média de recall de (100, 50) sobre (150, 0) ainda é positiva (0,1084). |
| `melhorMistura` | `37-113` | A mistura de maior recall entre as de 25, 50 e 75%. |
| `contribuicaoPuF` | | Relevantes capturados só pelos populares, só pela FC, pelas duas e por nenhuma (agregado: 659, 1.704, 5.212 e 2.855). |

### `deficit-v2-exp.json` e `deficit-v2-final.json`

**Gerados por:** `npm run candidatos-v2` (script 17) para o primeiro, que cobre a validação (943 usuários, fase `v2-exp`), e pela etapa 1 (`npm run etapa1-v2`, script 22) para o segundo, que cobre os usuários 1–462 do teste-2 (fase `v2-final`), sem gabarito.

Quando a FC devolve menos que os N candidatos pedidos, a lista é completada (**preenchimento**) com os próximos populares não vistos. Para cada configuração (K-N):

| Campo | O que significa |
|---|---|
| `usuariosDeficitReal` / `vagasReal` | Usuários (e vagas) em que faltaram filmes elegíveis na FC. |
| `usuariosDeficitRecuperacao` / `vagasRecuperacao` | Havia elegíveis, mas o HNSW não os devolveu. |
| `usuariosDevKMaiorQueElegK` | Casos em que o HNSW devolve filme cujo escore em float64 arredonda para 0. |
| `usuariosEmpateNaoResolvido` | Empates no teto da busca que não se resolveram. |
| `usuariosSemCurtidas` | Usuários com `nElegiveis` = 0 (sem curtidas ou sem filmes elegíveis). |
| `posicoesPreenchimento` | Quantas posições do top 10 de S1, S3 e da v2 vieram do preenchimento. Existe em `deficit-v2-final.json` e em `grade-v2-exp.json`, mas **não** em `deficit-v2-exp.json`. |

Validação: o único déficit é o de 1 usuário sem curtidas (déficit real); o de recuperação é 0 em todas as configurações. Teste-2: tudo zero, inclusive as posições do top 10 vindas do preenchimento.

### `fidelidade-fc-v2-exp.json` e `fidelidade-fc-v2-final.json`

**Gerados por:** `npm run fidelidade-v2` (script 19) para o `exp` e pela etapa 1 (`npm run etapa1-v2`, script 22) para o `final`. A fidelidade é **separada do ganho de qualidade** e **não entra na escolha** do sistema. Compara o HNSW (a lista oficial) com a busca exata no banco e com a **referência** em float64 em memória. A busca exata tem de igualar a referência, com tolerância τ = 10⁻⁵ (`precisao`).

| Campo | O que significa |
|---|---|
| `medidas12` | Para N = 50, 100 e 150, sobre a parte FC da lista (antes do preenchimento): sobreposição média e fração de usuários com lista idêntica, em `hnswXreferencia`, `hnswXexata` (efeito da aproximação) e `exataXreferencia` (efeito da precisão). |
| `medida3` (só `exp`) | Recall do HNSW e da referência, pareado por usuário. |
| `medida4` (só `exp`) | NDCG@10 do mesmo ordenador sobre a lista final (com preenchimento) do HNSW e da referência. S1: diferença 0. S3 (3 redes sem retreino): +0,00004, IC [0; 0,0001]. |
| `top10Identicos` (só `final`) | Usuários com top 10 idêntico (HNSW × referência), em S1 e na v2. |
| `impacto` (só `final`) | Impacto da aproximação sobre a comparação principal: **zero por construção**, porque o top 10 é idêntico em 462 de 462 usuários e a v1 não usa a FC. |
| `naoCalculados` (só `final`) | Recall e NDCG de fidelidade não são calculados no teste-2. |

Validação (942 usuários com perfil): listas FC idênticas HNSW × referência em 99,7%, 99,4% e 98,9% (N = 50, 100 e 150). Teste-2 (462 usuários com perfil): 100%, 100% e 99,8% (HNSW × referência) e 100% em HNSW × exata; 1 divergência de precisão aceita. A fidelidade de S3 e S4-50-150 no teste-2 não foi medida (só S1, a v2).

### `grade-v2-exp.json`

**Gerado por:** `npm run grade-v2` (script 20).

A validação: os 17 sistemas (S0, S1, S2, S3 e as 13 células S4), `otimista: true`. O NDCG da escolhida, o ganho dela sobre a v1 e as épocas de parada vêm da mesma validação e **não são estimativas imparciais** (`notaOtimista`).

| Campo | O que significa |
|---|---|
| `sistemas` | Para cada sistema: NDCG@10, P@10, R@10, cobertura e popularidade, por semente e agregados, e o histórico do treino. Na validação: S1 0,3721; S3 0,3145; S4-50-150 0,3164; S2 0,3113; S0 0,2316. |
| `configuracoes` | A grade, com `grupo` (`fixo`: orçamento de 150; `variavel`) e `totalCandidatos`. |
| `escolha` | A regra de 1 erro padrão com ordem de simplicidade fixa (S1, depois S2, depois os demais). Resultado: `escolhida` = `S1` (a v2), `fragil` = `false`. S1 também é o melhor e o único sistema no grupo de empate. |
| `epocasPorSistema` | Épocas de parada de cada semente, que o treino final reaproveita. |
| `contribuicoes` | As comparações da §8.5, todas `descritiva`, com IC; "melhor S4" e o melhor de orçamento fixo trazem `escolhidoDepoisDeVer: true`. Na validação: S1 − S0 +0,1405; S3 − S1 −0,0576; melhor S4 − S3 +0,0019; melhor S4 − S2 +0,0051; melhor de orçamento fixo − S2 +0,0033. |
| `mdeDescritivo`, `ganhoSobSubamostragem` | MDE de S1 × S2 sob a subamostragem (0,0215) e o ganho da validação recalculado nela (0,0320). Só descritivo. |
| `posicoesPreenchimento`, `sha256Candidatos`, `sha256FC150` | Posições do preenchimento e hashes das listas. |

### `configuracao-v2.json`

**Gerado por:** `npm run congelar-v2` (script 21), commit `e95b744`. É o **congelamento**, commitado antes da etapa 1.

| Campo | O que significa |
|---|---|
| `v2`, `v1` | `S1` e `S2`. |
| `sistemas`, `sistemasRodados` | Os sistemas avaliados no teste-2 (com as épocas de S2, S3 e S4-50-150 por semente) e os 17 rodados na grade. |
| `melhores` | O "melhor S4" (`S4-50-150`) e o melhor de orçamento fixo com FC (`S3`), ambos com `escolhidosDepoisDeVer: true`. |
| `rede` | Arquitetura 64-32, 70 entradas, negativos dos candidatos, lote 256, paciência 3, teto de 50 épocas, sementes 1, 2 e 3 (rede treinada com `@tensorflow/tfjs-node`). |
| `comparacaoPrincipal` | A comparação confirmatória, por extenso. |
| `regrasAvaliacao` | Relevância, exclusão de usuários, métricas, agregação das sementes e corte mainstream × nicho, escritos antes do gabarito. |
| `ressalva` | O texto da §3.4 da spec. |
| `hashes` | `regua`, `teste2`, `treino` e `vetoresFC` da fase `v2-final`. |
| `portao`, `mde`, `mdeDescritivo` | Os resultados anteriores, copiados. |
| `sha256Grade`, `sha256Codigo`, `commitCodigo` | Travas: hash da grade, hash de cada arquivo de `src/avaliacao/` e do script da etapa 2, e o commit do código (`c048537`). |
| `desvios` | **Vazio**: nenhum desvio depois do congelamento. |

### `previsoes-v2-final.sha256.json`

**Gerado por:** `npm run etapa1-v2` (script 22), commit `65318c4`, **antes** da leitura do gabarito.

Guarda o hash (`sha256`) das previsões do teste-2 (o top 10 de cada sistema, por semente, em `artefatos/previsoes-v2-final.json`, fora do git), o do congelamento (`sha256Configuracao`) e o da lista FC150 (`sha256FC150`). A etapa 2 confere os três antes de ler o gabarito. A etapa 1 não usa o gabarito.

### `avaliacao-v2.json`

**Gerado por:** `npm run etapa2-v2` (script 23), **uma única vez**, commit `86112a6`. Gravado com a flag `wx`: o script se recusa a rodar de novo. É o único arquivo com métricas contra o gabarito do teste-2.

- **Usuários avaliados:** 445 de 462 (ver acima). `usuarios.semRelevantes` lista os 17 que ficaram de fora.
- **Ressalva:** o campo `ressalva` traz o texto da §3.4, que vale para todo o resultado (está no [README principal](../README.md#comparação-principal-única-hipótese-confirmatória-e-ressalva), ao lado da comparação principal).
- **Rótulos:** só `comparacaoPrincipal` é `confirmatoria: true`. Tudo em `secundarias` é `rotulo: "descritiva"`, e as três últimas trazem `escolhidoDepoisDeVer: true`. `notaSecundarias` registra que nenhuma é descoberta independente.

| Campo | O que significa |
|---|---|
| `comparacaoPrincipal` | S1 (v2) − S2 (v1): média **+0,0294**, IC 95% **[0,0136; 0,0458]**, `suportada` = `true`, 445 usuários, 5.000 reamostragens, semente 2026. A `nota` lembra que ela mede o sistema completo e que só S3 − S1 isola o ordenador. |
| `secundarias` | S1 − S0 (+0,0600), S3 − S1 (−0,0234), melhor S4 − S2 (+0,0060), melhor S4 − S3 (−0,00002) e melhor de orçamento fixo − S2 (+0,0060), cada uma com IC e erro padrão. |
| `sistemas` | Para S0, S1, S2, S3 e S4-50-150: NDCG@10, P@10, R@10, cobertura, popularidade média, `ndcgPorUsuario` e, nos com rede, `porSemente` e `minMax`. NDCG@10: 0,0962; 0,1562; 0,1268; 0,1328; 0,1327. A cobertura dos sistemas com rede é a média das coberturas por semente, não a cobertura da união das listas. |
| `mainstreamNicho` | Mediana 0,7871; 223 mainstream e 222 nicho; métricas por grupo e por sistema. Descritivo. |
| `sha256Previsoes`, `sha256Configuracao`, `sha256FC150` | Os hashes conferidos na etapa 2. |
| `cenario`, `commitCodigo`, `regrasAvaliacao` | Cenário do portão, commit do código congelado e as regras copiadas do congelamento. |

**Limites de leitura:** o teste-2 é uma avaliação retrospectiva (ver a ressalva), vale para um conjunto (MovieLens 100K), uma arquitetura e um protocolo, e o gabarito é incompleto (cerca de 28 notas por usuário no `u1.test` aparecem como "não vistas" e não podem ser medidas). Os números absolutos não são comparáveis aos da validação nem aos do `u1.test`. Os números da validação da escolhida são otimistas.
