# Resultados

Os arquivos desta pasta são gerados pelos scripts e versionados, para que os números citados na documentação possam ser conferidos. JSON não aceita comentários, então a explicação de cada campo fica aqui.

Quase todos foram gerados na **fase `exp`** (validação), ou seja, nos usuários 463 a 943 com 40% das notas de cada um escondidas (semente 42). As exceções são `treino-*-final.json` e `avaliacao-final.json`, da **fase `final`**: treino no `u1.base` inteiro e avaliação no teste oficial (`u1.test`), usado **uma única vez**, em 2026-11-12 (seção [`avaliacao-final.json`](#avaliacao-finaljson)).

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
- **Perfil dos negativos observados:** continuam com o perfil completo, enquanto positivos e sorteados usam o perfil sem o filme do positivo. A rede ainda pode usar essa diferença como atalho.

Da revisão final:

- **A fonte vetorial não entrou no sistema escolhido.** N = 0 venceu a grade da validação, e essa decisão foi marcada como **frágil** em `grade-validacao.json`: a faixa [mínimo, máximo] das médias por semente de K = 150, N = 0 se sobrepõe à de outras configurações da grade. Por isso, o resultado mede a rede reordenando os populares, e não o valor da busca vetorial.
- **O Exp. 5 é idêntico ao Exp. 4** porque N = 0, pela regra da spec (§9.2) decidida antes do teste. Neste caso, ele não traz informação nova.
- **`ambas` não é uma contribuição exclusiva:** conta os acertos que as duas fontes trariam. Com N = 0, vale zero.
- **Scores do Exp. 4 calculados num lote maior:** na avaliação final, a rede pontua de uma vez todos os filmes não vistos de cada usuário, para que os Exp. 4, 5 e 6 usem os mesmos scores. Na validação, ela pontuava só os candidatos. A conta é a mesma, mas lotes de tamanhos diferentes podem mudar o último dígito dos números de ponto flutuante e, em casos raros de empate quase exato, a ordem de dois filmes.
