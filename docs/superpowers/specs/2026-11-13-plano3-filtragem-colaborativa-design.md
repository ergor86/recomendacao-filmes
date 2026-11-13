# Design: Plano 3 — Filtragem Colaborativa no pgvector

- **Data:** 2026-11-13 (versão 4.0)
- **Base:** [spec v3.2](2026-11-07-recomendacao-filmes-design.md). Tudo o que esta spec não muda continua valendo como lá está, por exemplo as métricas (§9.3), a entrada da rede (§6) e o treino (§7). A v3.2 continua sendo a spec da **versão 1** e da avaliação no `u1.test`.
- **Status:** rascunho para revisão do usuário. Ela foi desenhada em conversa, parte por parte, com aprovação em cada parte. Também passou por duas rodadas de revisão adversarial por subagentes, com medições nos dados, e por duas revisões externas.
- **Prazo:** segunda-feira, 2026-11-16. O objetivo é a melhor versão **validada** possível, não necessariamente todas as ideias implementadas.

## 1. Objetivo e pergunta

**Pergunta:** acrescentar filtragem colaborativa (FC) melhora a recomendação em relação à versão 1? E, se melhora, a rede neural ainda acrescenta algo sobre ela?

- **FC item-item:** "filmes curtidos pelas mesmas pessoas que curtiram os seus". Ela entra como fonte de candidatos e como sistema isolado.
- **Arquitetura:** a FC é implementada como **busca vetorial no Postgres + pgvector**. O objetivo da aplicação final é consultar o banco sem carregar o catálogo e suas representações na memória do processo, e o experimento mede essa arquitetura, não um atalho em memória.
- **Separação obrigatória:** este documento separa **a contribuição dos vetores para a qualidade** da **utilidade do pgvector na arquitetura**. Um resultado ruim da primeira não elimina a segunda.
- **A rede neural:** continua no escopo acadêmico e tecnológico do projeto, mas **não é obrigatória** no sistema escolhido (regra da opção A, §8.4). Se ela não acrescentar nada sobre a FC, o resultado é reportado assim: "neste conjunto, nesta arquitetura e neste protocolo, o ranqueador neural não demonstrou contribuição adicional suficiente".
- **Hipótese principal (única confirmatória):** a v2 escolhida na validação supera a v1 em **NDCG@10 no teste-2**. "Supera" significa que o IC 95% da diferença pareada por usuário (bootstrap, §9.4 da v3.2) **exclui zero**.

**Fora do escopo até segunda** (evolução futura, §13):
- novas entradas na rede (nota média, tendência do usuário, escore FC como entrada);
- fatoração de matrizes;
- dados externos (IMDb, TMDB);
- MovieLens 1M;
- divisão por tempo;
- busca de arquitetura.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Teste final | **teste-2**: 20% das notas de cada usuário 1–462 dentro do `u1.base` (§3) |
| `u1.test` | **nunca lido** no Plano 3; seus resultados (v1) ficam intocados |
| Fases | `v2-exp` e `v2-final`, descritas por um objeto de fase; as fases `exp` e `final` continuam funcionando |
| Banco | um schema por fase (`v2_exp`, `v2_final`); `public` fica intocado (v1) |
| FC | vetor do filme = indicadora de curtida (nota ≥ 4) sobre os 943 usuários, normalizada (L2); perfil = soma; busca por cosseno |
| Candidatos | composição com total **exato** K + N (§6) |
| Rede | a mesma da v1: 64→32, 70 entradas, negativos dos candidatos, 3 sementes, parada automática; retreinada por configuração |
| Vetores de conteúdo | continuam no banco, mas ficam fora da grade (§8.2) |
| Escolha | heurística de 1 erro padrão com ordem de simplicidade fixa: FC sozinha → v1 → demais (§8.4) |
| Avaliação final | duas etapas: as previsões são geradas e o hash delas é commitado; só depois o gabarito é lido (§9) |

## 3. Dados, fases e isolamento

### 3.1 Divisões

O `u1.test` contém cerca de 40% das notas de cada usuário 1–462. Por isso, no `u1.base` esses usuários têm só ~60% das próprias notas, e os usuários 463–943 têm 100%.

| Conjunto | Conteúdo | Uso |
|---|---|---|
| **teste-2** | para cada usuário 1–462, das notas dele no `u1.base`: ordenar por filme, embaralhar com `criarAleatorio(20_000_000 + usuario)` e esconder `Math.round(0,2 · n)` | avaliação final do Plano 3, uma vez |
| validação | a mesma da v3.2: 40% das notas dos usuários 463–943, semente 42 + usuário | todas as escolhas |
| treino-v2-exp | `u1.base` − validação − teste-2 | experimentos |
| treino-v2-final | `u1.base` − teste-2 | treino final dos sistemas |

- **Por que 20%:** o histórico do teste-2 fica próximo do da validação, onde o sistema foi ajustado. Medido: média de 56,3 notas, contra 59,2 na validação. Com 40%, seriam 42,3.
- **O custo:** um gabarito menor, com média de 14,1 notas escondidas e 7,9 curtidas por usuário (com a semente da prévia).
- **A semente `20_000_000 + usuario`:** não colide com nenhuma semente do projeto (§12). A prévia usou `7_000_000 + usuario`. A troca é feita antes de qualquer métrica sobre o teste-2 e não depende de resultado nenhum.

### 3.2 Regra de isolamento

As notas do teste-2 saem **antes** de qualquer cálculo. Nada no Plano 3 as usa antes da etapa 2 da avaliação final (§9). Isso inclui:
- régua e popularidade;
- perfis de usuários e vetores colaborativos;
- candidatos e pares de treino;
- épocas, sementes, configurações, hiperparâmetros, o MDE ou qualquer outra decisão.

O isolamento é feito no código:
- a função que monta a fase devolve **só o treino**;
- o gabarito do teste-2 só é devolvido com uma opção explícita (`incluirTeste2: true`), usada **apenas** pela etapa 2;
- é o mesmo padrão que a v1 usou com o `u1.test`.

Verificações:
- **Teste unitário:** nenhuma nota aparece ao mesmo tempo no treino de uma fase e no teste-2.
- **Teste unitário de invariância:** acrescentar ao teste-2 uma nota fictícia não muda a régua, a popularidade nem os vetores FC.
- **Hash:** o hash do conjunto teste-2 é gravado no registro do Passo 0 e no congelamento. A avaliação final confere os dois.

### 3.3 Passo 0: registro antes de qualquer treino

Um script grava `resultados/divisoes-v2.json`, que é commitado antes da grade. O registro é **só descritivo**: tamanhos e contagens, nenhuma métrica de sistema sobre o teste-2. Ele contém, para a validação e para o teste-2:
- notas disponíveis por usuário e notas escondidas por usuário, com média, mediana e percentis 10, 25, 75 e 90;
- curtidas escondidas por usuário, com as mesmas estatísticas, e o nº de usuários sem nenhuma;
- nº de usuários avaliáveis, ou seja, com pelo menos uma curtida escondida;
- os hashes de cada conjunto e dos dois treinos.

### 3.4 Ressalva histórica (texto obrigatório no README)

> O teste-2 é uma **avaliação retrospectiva com isolamento implementado no Plano 3**. Suas avaliações pertenciam ao `u1.base`, que foi usado como treino no Plano 2, inclusive no cálculo de popularidade e no treino do modelo avaliado no `u1.test`. Elas nunca serviram de gabarito para escolhas. No Plano 3, foram excluídas do treino, dos candidatos e dos vetores, mas **não são dados inéditos** para o projeto. Além disso, a direção de pesquisa (tentar FC) foi informada pelos resultados do `u1.test`, que são dos mesmos usuários 1–462. O resultado deve ser lido como uma nova avaliação sob protocolo de isolamento, e não como uma validação externa independente.

Durante o Plano 3, é proibido analisar usuário por usuário o `resultados/avaliacao-final.json` (v1).

## 4. A fonte colaborativa

### 4.1 Definição

Os dados vêm só do treino da fase.
- **Vetor do filme:** `c_j ∈ {0,1}^943`, com `c_j[u] = 1` se o usuário u curtiu o filme j no treino (nota ≥ 4). O vetor usado é `v_j = c_j / ‖c_j‖`.
- **Similaridade entre filmes:** `sim(i, j) = v_i · v_j`, ou seja, o cosseno.
- **Perfil FC do usuário:** `p = Σ_{i curtido no treino} v_i`.
- **Escore de um filme não visto j:** `escore(j) = Σ_i sim(i, j) = p · v_j`. A igualdade é exata, por linearidade (medida: diferença máxima de 8,9 × 10⁻¹⁵).
- **Ordem:** como todos os `v_j` são unitários, ordenar por `p · v_j` dá a mesma ordem que ordenar pelo cosseno entre `p/‖p‖` e `v_j`. Por isso a busca usa `vector_cosine_ops`, e não produto interno. Isso reaproveita a busca atual e evita o problema conhecido do HNSW com produto interno sobre bases não normalizadas.

### 4.2 Regras explícitas

- **Filme sem nenhuma curtida no treino:** não tem vetor e fica fora **só da busca colaborativa**.
  - Ele continua no catálogo e disponível para os populares, para a busca por conteúdo e para usuários novos.
  - Se receber curtidas, entra no índice no próximo recálculo dos vetores.
  - Motivo técnico: o pgvector não aceita vetor nulo no cosseno.
- **Usuário sem curtidas no treino:** não tem perfil FC. A busca colaborativa devolve uma lista vazia, e as listas são completadas com populares (§6).
- **Usuário novo** (cadastro com filmes marcados): o perfil é a soma dos vetores dos filmes marcados e funciona na hora. Isso não é medido no Plano 3.
- **Escore aceito:** só escore > 0. Filmes sem nenhum fã em comum ficam de fora.
- **Já vistos:** excluídos, com o mesmo filtro da busca atual.
- **Desempate:** o escore é arredondado em 6 casas decimais (`escore = round(1 − distância, 6)`), e o empate se resolve pelo id crescente. Sem isso, ruídos de float32 mudariam a ordem entre a busca aproximada e a exata. Escores são razões de inteiros e empatam com frequência.
- **Viés de popularidade:** a normalização não o elimina. O Plano 3 começa simples. Uma correção só seria investigada se os resultados pedissem, e ela teria de ser ajustada na validação.

## 5. Banco

### 5.1 Um schema por fase

- **Schemas:** `v2_exp` e `v2_final`, usando `criarPool({ searchPath })`, que já existe.
- **Tabelas de cada schema:**
  - `filmes`: os vetores de conteúdo, como hoje, com a régua da fase;
  - `filmes_fc`: `(id int primary key, embedding vector(943))`, com índice HNSW `vector_cosine_ops`;
  - `metadados`: o hash da régua e o hash do treino da fase.
- **Gravação dos hashes:** os dois são gravados por último, na mesma transação da carga, como na v3.2 (§4.3).
- **Conferência:** toda busca confere os dois hashes, dentro da mesma transação de leitura (`REPEATABLE READ`), e para com erro se eles não baterem com os do código.
- **`public`:** fica intocado. A v1 e seus resultados continuam reproduzíveis.
- **Tamanho:** cerca de 6,3 MB de dados e 7 MB de índice por fase. O índice é criado em cerca de 0,5 s (medido com dados sintéticos).

### 5.2 Busca colaborativa

- **Consulta:** `p/‖p‖`, ordenada por `embedding <=> consulta`.
- **Filtros:** exclui os já vistos e aceita só escore > 0.
- **Parâmetros:** os mesmos da busca atual: `hnsw.iterative_scan = strict_order` e ef_search = N + 50, com mínimo de 40.
- **Ordenação final:** é feita no código, com o escore arredondado e o desempate por id.

### 5.3 Fidelidade (relatório separado do ganho de qualidade)

São três versões da mesma busca:
- **HNSW no banco:** a versão **oficial**, que o sistema usa;
- **busca exata no banco:** um controle, sem índice;
- **cálculo exato em memória, em float64:** a referência.

Para N ∈ {50, 100, 150}, mede-se, entre o HNSW e a referência:
1. a sobreposição média dos N vizinhos, por usuário;
2. a fração de usuários com exatamente a mesma lista de candidatos;
3. o recall dos relevantes em cada versão, pareado por usuário;
4. o NDCG@10 final com a mesma rede, por bootstrap pareado, se a v2 tiver rede.

Além disso, a busca exata no banco tem de ser igual à referência em memória. Isso valida o sinal do operador e a equivalência matemática.

**Na validação:** sempre, em `resultados/fidelidade-fc-v2-exp.json`.

**No teste-2:** na etapa 1 da avaliação final, como descritivo. É o 1º item da lista de cortes (§12).

**Nota para a documentação:** com 1.682 filmes, a busca exata custa o mesmo que o HNSW. O índice está aqui para demonstrar a arquitetura de produção, não por necessidade de velocidade.

## 6. Candidatos: composição exata

- **Lista (K, N):** os K primeiros populares não vistos (ordem da v3.2: contagem decrescente, id crescente), seguidos dos N primeiros colaborativos que **não estão** entre esses K. O total é sempre exatamente K + N.
- **Déficit:** se a FC tiver menos de N filmes elegíveis, a lista é completada com os próximos populares não vistos. O déficit de cada usuário fica registrado. Na prévia, nenhum caso precisou ser completado.
- **FC150:** é a lista (0, 150). Ela é gerada **uma vez**, gravada com hash e compartilhada pelos sistemas S1 e S3:
  - **S1:** ordena pelo escore FC, e os filmes que completaram a lista vêm depois, por popularidade;
  - **S3:** a rede ordena a lista inteira;
  - **o nº de usuários completados** é o mesmo nos dois e fica registrado.
- **Arquivo:** as listas de cada fase vão para `artefatos/candidatos-v2-<fase>.json`, fora do git, com um campo `colab` ao lado de `populares`. O sha256 delas é gravado.
- **Comparabilidade com a v1:** com N = 0, a regra dá exatamente a lista da v1. As células com N > 0 do Plano 2 usavam vetores de conteúdo e não são reaproveitadas.

## 7. Rede e treino

Não há mudança na rede: ela é a mesma da v3.2 (§6, §7).
- **Retreino por configuração:** cada configuração da grade é retreinada, porque os negativos sorteados vêm dos candidatos daquela configuração.
- **Mesmas condições para todas:**
  - os pares vêm só do treino da fase;
  - as sementes são 1, 2 e 3, com as fórmulas de sorteio da v3.2;
  - o teto de épocas e a regra de parada automática são os mesmos;
  - a validação de parada exclui os negativos sorteados no treino da mesma semente.
- **Treino final:** usa as épocas que cada semente escolheu na validação, como no Plano 2.
- **A v1 é retreinada** nas fases `v2-*`, nas mesmas condições: é a configuração (150, 0).

## 8. Experimentos na validação (fase `v2-exp`)

### 8.1 Passo 1: portão da FC como fonte de candidatos (filtro de viabilidade)

- **Aviso:** o portão **já foi visto na prévia**, então não é pré-registrado. O texto do resultado diz isso.
- **O que se mede** (`resultados/portao-fc-v2-exp.json`):
  - o recall dos candidatos com listas de 50, 100, 150 e 200;
  - as composições só pop, só FC, e 25%, 50% e 75% de FC;
  - a contribuição exclusiva sobre P ∪ F (top-150 de cada fonte): relevantes só-pop, só-FC, ambas e nenhuma, agregados e por usuário, reaproveitando `contribuicaoExclusiva`;
  - a fração de usuários com ≥ 1 relevante capturado só pela parte FC de (100, 50).
- **Critério de passagem** (as duas condições):
  - **(a)** com lista de 150, a melhor mistura supera (150, 0) em recall por mais de 1 EP pareado **do recall**;
  - **(b) concentração:**
    1. ordenar os usuários pela quantidade de curtidas escondidas, de forma decrescente, com empate pelo id crescente;
    2. retirar os `floor(0,1 · n)` primeiros;
    3. nos restantes, a diferença média de recall entre (100, 50) e (150, 0) tem de ser > 0.

  O valor de (b) fica registrado. A fração do ganho vinda dos 10% retirados é só descritiva.
- **Se não passar:** a FC sai como fonte de candidatos (S4 e S3 deixam de ser rodados), mas S1 continua nas comparações.
- **O que o portão é:** um filtro de viabilidade, **não uma prova** de superioridade.

### 8.2 Passo 2: sistemas comparados

| Sistema | O que é | Rede |
|---|---|---|
| S0 | popularidade: top 10 populares não vistos | não |
| S1 | **FC sozinha**: top 10 da lista FC150, pelo escore FC | não |
| S2 | **v1**: lista (150, 0) + rede | sim |
| S3 | **FC + rede**: lista FC150 = (0, 150) + rede | sim |
| S4 | **populares + FC + rede**: as demais células da grade | sim |

- **Grade:** K ∈ {0, 50, 100, 150} × N ∈ {0, 50, 100, 150}, sem (0, 0). São 15 configurações com rede (inclui S2 e S3), × 3 sementes, com cerca de 35 minutos de computação no total.
- **Vetores de conteúdo:** ficam fora. A v3.2 já mostrou que não ajudaram (N = 0 venceu), e cada comparação a mais aumenta o risco de escolher por acaso.
- **Relatório em dois grupos:**
  - **orçamento fixo de 150:** (150, 0), (100, 50), (50, 100), (0, 150);
  - **orçamento variável:** as demais configurações, que estudam o efeito de aumentar a lista.

  O total de candidatos aparece explícito em cada linha. As comparações a orçamento fixo medem **composição + efeito nos negativos de treino**, e não só composição.
- **Resultados por semente:** registrados individualmente, com mínimo e máximo, além da média.

### 8.3 Passo 3: MDE pré-registrado (antes da grade)

O MDE é o menor ganho detectável, ou seja, uma **capacidade de detecção, não uma previsão** do resultado. Ele é gravado em `resultados/mde-v2.json` e commitado antes da grade.

- **Fórmula:** `MDE = (z_0,975 + z_0,80) · σ_d / √n_t`.
  - `n_t` é o nº de usuários avaliáveis do teste-2, uma contagem descritiva do Passo 0.
  - `σ_d` é o desvio padrão amostral, por usuário, da diferença de NDCG@10 entre os dois sistemas do par.
- **Como estimar `σ_d`:**
  - **onde:** na validação, **com o gabarito subamostrado** para imitar o teste-2;
  - **como subamostrar:** cada relevante escondido de cada usuário é mantido com probabilidade `q = (média de curtidas escondidas no teste-2) / (média na validação)`, calculada com as contagens do Passo 0;
  - **repetições:** 20 vezes, com sementes `30_000_000 + 1000 · r + usuario` para r = 1..20, e `σ_d` é a média das 20;
  - **sem treino nem semente de rede.**
- **Dois pares de referência:**
  - **sistemas bem diferentes:** S0 × S1 (prévia: ~0,029);
  - **sistemas parecidos:** S1 × "FC150 ordenada por escore FC × √contagem" (prévia: ~0,019). Esse par é uma heurística, sem significado próprio.
- **Conferência por simulação:** reamostragem pareada de usuários com deslocamento δ, até 80% dos IC excluírem zero. A prévia mostrou concordância de ±0,001 com a fórmula.
- **Frase obrigatória:** "se o ganho real for da ordem do observado na validação, a capacidade de detecção é provavelmente boa, mas não garantida. A estimativa vem de outro grupo de usuários (validação), e o par v2 × v1 não é nenhum dos dois pares de referência."
- **Depois da grade:** o MDE do par efetivamente escolhido (v2 × v1) é calculado e reportado **só como descritivo**, nunca como justificativa do resultado.

### 8.4 Passo 4: regra de escolha (heurística de 1 erro padrão)

1. Para cada sistema S0–S4, calcula-se o NDCG@10 por usuário na validação.
   - **Sistemas com rede:** o valor do usuário é a média das 3 sementes.
   - **Sistemas sem rede:** o valor vem direto.
2. O melhor sistema b é o de maior média.
3. Para cada sistema c, registra-se a diferença pareada por usuário `NDCG(b) − NDCG(c)`, com:
   - o EP (desvio amostral / √n);
   - o IC 95% por bootstrap pareado (5.000 reamostragens, semente 2026).
4. **Grupo de empate:** os sistemas com diferença < 1 EP. Isso **não declara equivalência**: só diz que a diferença não é grande o bastante, diante da incerteza, para preferir b com clareza.
5. **Ordem de simplicidade fixa** (decisão do usuário, a opção A). Ganha o primeiro da ordem que estiver no grupo de empate:
   1. **S1 (FC sozinha).** É mais simples que a v1 por ter **zero parâmetros treinados por gradiente e nenhuma dependência de semente**. O custo de armazenamento e de busca vetorial é reconhecido.
   2. **S2 (v1).**
   3. **Os demais**, por esta chave lexicográfica: `[usaRede, N, K + N, K]`, todos crescentes. S0 entra aqui, com `usaRede = 0`.
6. **Fragilidade:** marcada como na v3.2, quando a faixa [mín, máx] das médias por semente do escolhido se sobrepõe à de outro sistema.
7. **Resultado:** o escolhido é a **v2**.
   - **Se a configuração escolhida for exatamente (150, 0) com a mesma rede:** o Plano 3 não introduziu uma nova versão, e **não há comparação confirmatória**. O resultado é reportado assim.
   - **Qualquer outra configuração**, mesmo próxima na validação, segue para a comparação v2 − v1.
8. **Maldição do vencedor:** escolher o melhor entre 17 sistemas (S0, S1 e as 15 configurações com rede) deixa a vantagem da v2 na validação **otimista**. A estimativa sem esse viés é a do teste-2. O "melhor S4" também é escolhido depois de ver os resultados.
9. **Expectativa registrada antes da grade:** pela prévia, a FC sozinha (NDCG 0,369 na validação) está acima da v1 da v3.2 (~0,326, com um treino ligeiramente diferente). O mais provável é que S1 seja a v2.

### 8.5 Contribuições (descritivas)

| Pergunta | Conta | Observação |
|---|---|---|
| A FC ordena melhor que a popularidade? | S1 − S0 | |
| A rede acrescenta algo à FC? | S3 − S1 | Mesma lista FC150, dois ordenadores. A rede de S3 aprendeu com negativos dessa lista. |
| A FC melhora os candidatos da rede, com o mesmo orçamento? | melhor de (100, 50), (50, 100) e (0, 150) − (150, 0) | Composição + efeito no treino. "Melhor" é escolhido depois de ver os resultados. |
| Os populares ajudam junto com a FC? | melhor S4 − S3 | Efeito do híbrido inteiro se os orçamentos diferirem; escolhido depois de ver. |
| A FC melhora o sistema da v1? | melhor S4 − S2 | Idem. |

Todas aparecem com IC, mas **rotuladas como descritivas**. Nenhuma é apresentada como descoberta independente, por causa das comparações múltiplas.

## 9. Congelamento e avaliação final

### 9.1 Congelamento

`resultados/configuracao-v2.json` é commitado **antes** da etapa 1. Ele contém:
- **os sistemas:** a v2 e a v1 (configuração, épocas por semente e `seed_api = 1`), mais as configurações secundárias que serão avaliadas;
- **os hashes:** do teste-2, do treino `v2-final`, da régua `v2-final` e dos vetores FC `v2-final`. Estes são calculados no congelamento, sem ler o gabarito;
- **os resultados anteriores:** o resultado do portão, os dois MDE de referência e o MDE descritivo de v2 × v1;
- **a comparação principal, por extenso:** "NDCG@10(v2) − NDCG@10(v1) por usuário, média das 3 sementes por usuário nos sistemas com rede, bootstrap pareado com 5.000 reamostragens e semente 2026; suportada se o IC 95% exclui zero";
- **as regras de avaliação, como campos escritos:**
  - relevância (nota ≥ 4);
  - exclusão dos usuários sem curtidas escondidas;
  - definições das métricas (v3.2, §9.3);
  - agregação das sementes;
  - corte mainstream × nicho (v3.2, §9.4: mediana do conjunto avaliado, na escala da régua);
- **o código:** o commit (`git rev-parse HEAD`) e o sha256 de cada arquivo de `src/avaliacao/` e do script da etapa 2.

### 9.2 Etapa 1: previsões (sem gabarito)

1. Confere o congelamento: arquivo commitado e árvore de trabalho limpa.
2. Calcula a fase `v2-final` sem o teste-2.
3. Carrega o schema `v2_final`.
4. Retreina as redes necessárias com as épocas congeladas.
5. Gera os candidatos e calcula o top 10 de todos os sistemas avaliados, para todas as sementes e para os usuários 1–462.
6. Mede a fidelidade no teste-2 (descritiva; 1º corte).
7. Grava as previsões em `artefatos/previsoes-v2-final.json`, fora do git, porque são dados derivados do MovieLens.
8. Grava o sha256 delas em `resultados/previsoes-v2-final.sha256.json`, que é **commitado antes da etapa 2**. O histórico do git prova que as recomendações existiam antes da leitura do gabarito.

### 9.3 Etapa 2: leitura do gabarito

1. **Confere, sem ler o gabarito:**
   - o congelamento e os seus hashes;
   - o hash das previsões, contra o arquivo commitado;
   - os sha256 do código de avaliação, contra os do congelamento;
   - que `resultados/avaliacao-v2.json` ainda não existe.

   Qualquer divergência para tudo, e o gabarito continua sem ser lido.
2. Só então lê o gabarito do teste-2 (`incluirTeste2: true`) e confere o hash dele.
3. Calcula as métricas:
   - **para todos os sistemas:** NDCG, P@10, R@10, cobertura e popularidade média;
   - **nos sistemas com rede:** cada semente separada, além da média;
   - **para todos os sistemas:** o corte mainstream × nicho.
4. Calcula a comparação principal e as secundárias (§8.5).
5. Grava `resultados/avaliacao-v2.json` com `flag: 'wx'`, e o arquivo é commitado em seguida.
   - A trava contra uma segunda execução é só uma proteção de conveniência: um arquivo pode ser apagado.
   - A proteção real é o histórico do git: congelamento → hash das previsões → resultado.

**Sem segunda rodada:** qualquer que seja o resultado, ele é reportado como saiu. Nada é ajustado depois de ver o teste-2.

## 10. Testes (`node:test`, dados sintéticos)

| Área | O que o teste garante |
|---|---|
| Isolamento | nenhuma nota no treino e no teste-2 ao mesmo tempo; invariância da régua, da popularidade e dos vetores FC a uma nota fictícia no teste-2; a fase só devolve o gabarito com `incluirTeste2` |
| FC | `Σ cos = p · v_j`; normalização; filme sem curtidas fora só da FC; usuário sem curtidas → lista FC vazia; arredondamento em 6 casas e desempate por id; só escore > 0 |
| Composição | total exato K + N; déficit completado com populares e registrado; com N = 0 a lista é igual à da v1; S1 e S3 com a mesma FC150 e a mesma regra para completar |
| Escolha | grupo de 1 EP; ordem S1 → S2 → chave `[usaRede, N, K+N, K]`; fragilidade; "v2 = v1" só com configuração idêntica |
| Portão e MDE | critério (b) exato, com empate pelo id; fórmula do MDE; subamostragem com semente |
| Avaliação final | a etapa 2 recusa se o hash das previsões não bater, se o código de avaliação mudou ou se o resultado já existe, **sem ter lido o gabarito** |
| Banco (integração) | busca FC no pgvector num **schema próprio de teste**, nunca em `public` nem em `v2_*`; HNSW igual ao exato num caso pequeno; conferência de hash |
| Não regressão | os 170 testes atuais continuam passando; as fases `exp`/`final` continuam funcionando |

## 11. Documentação

- **README principal:** ganha a seção "Avaliação retrospectiva do Plano 3 (teste-2)", com:
  - a ressalva histórica da §3.4, completa;
  - a comparação principal;
  - as contribuições, rotuladas como descritivas;
  - a fidelidade do pgvector, separada;
  - as limitações da §13.
- **`resultados/README.md`:** explica cada arquivo novo.
- **Resultados antigos:** os do `u1.test` (v1) continuam na seção deles, intocados.

## 12. Sementes, tarefas, calendário e cortes

**Sementes novas** (sem colisão com a v3.2):

| Uso | Fórmula | Faixa |
|---|---|---|
| teste-2 | `20_000_000 + usuario` | 20.000.001–20.000.462 |
| subamostragem do MDE | `30_000_000 + 1000 · r + usuario`, r = 1..20 | 30.001.001–30.020.943 |

As sementes da v3.2 são:
- divisões: 42 + u;
- negativos de treino: 1.000.000 · s + u, até ~3.000.943;
- negativos de validação: 5.000.000 + 1.000.000 · s + u, até ~8.000.943;
- R9: 9.000.000 + u;
- embaralhamento: 100.000 · s + época;
- pesos: 1000 · s + camada;
- bootstrap: 2026.

**Tarefas** (detalhadas no plano):
1. fases como descritor, divisão do teste-2 e registro do Passo 0;
2. FC em memória, portão e MDE pré-registrado;
3. banco: schema por fase, `filmes_fc`, carga e busca FC;
4. fidelidade na validação;
5. candidatos com composição exata, gravados com hash;
6. grade e escolha;
7. congelamento;
8. etapa 1;
9. etapa 2;
10. documentação.

**Calendário:**

| Dia | O que |
|---|---|
| Sexta (13) | spec, plano e início |
| Sábado | tarefas 1–6 |
| Domingo | tarefas 7–9 |
| Segunda | tarefa 10 e folga |

**Cortes** (decididos agora; qualquer corte da grade acontece **antes** de ela rodar, nesta ordem):
1. fidelidade no teste-2;
2. grade de orçamento variável, mantendo S0, S1, S2, S3 e as 4 configurações de orçamento fixo;
3. corte mainstream × nicho.

**Nunca se cortam:** as 3 sementes, o pareamento, o MDE pré-registrado e o protocolo do teste-2.

## 13. Limitações (registradas no README)

- **Teste-2 retrospectivo:** ver a §3.4.
- **Notas invisíveis do `u1.test`:** cada usuário do teste-2 tem, em média, ~28 notas no `u1.test` que o sistema vê como "não vistas".
  - Esses filmes podem ser recomendados e contam como erro.
  - O efeito não pode ser corrigido sem ler o `u1.test`.
  - É provável que ele penalize mais o sistema que acerta mais, ou seja, joga contra a v2.
  - Os níveis absolutos não são comparáveis aos da validação nem aos do `u1.test`; a comparação pareada continua válida.
- **Histórico do teste-2:** um pouco menor e com mais usuários pequenos que a validação (mediana de 32 notas, contra 38; p10 de 10, contra 14).
- **Gabarito menor:** ~8 curtidas por usuário, o que dá menos poder estatístico. Ver o MDE (§8.3).
- **Validação reutilizada pela 3ª vez:** as escolhas ficam otimistas, e o teste-2 é a proteção.
- **Dimensão do vetor FC = nº de usuários (943):** cabe no limite do HNSW (2.000), mas não escala para milhares ou milhões de usuários. A evolução arquitetural é usar vetores de dimensão fixa (por exemplo, fatoração de matrizes). Um usuário novo funciona na hora, mas só entra nos vetores dos filmes no próximo recálculo.
- **Viés de popularidade na FC:** não corrigido (§4.2).
- **Índice HNSW num catálogo pequeno:** é demonstrativo (§5.3).
- **Herdadas da v3.2 (§15):** divisão não temporal, viés de coleta, usuário novo não medido, falsos negativos, parada aproximada e só 3 sementes.

## 14. Decisões rejeitadas, com evidência

| Alternativa | Por que foi rejeitada |
|---|---|
| `u2`–`u5.test` | as notas estavam no `u1.base` e parte delas foi gabarito da validação que escolheu K, a arquitetura e os negativos |
| `ua`/`ub` | contêm 10 notas de cada usuário, inclusive do `u1.test` |
| Segunda leitura do `u1.test` | quebra a promessa de uso único, e os resultados já foram vistos |
| Validação cruzada em 5 dobras nos usuários 1–462 | para isolar as 5 dobras, todas as notas desses usuários sairiam do treino das escolhas: de 54,5 mil para ~28 mil notas, com metade dos usuários, justamente o que alimenta a FC |
| MovieLens 1M | é o único teste virgem, mas os formatos de demografia e ocupação são outros; está fora do prazo, não é pior |
| Teste-2 com 40% | o histórico cairia para ~42 notas, 29% abaixo do da validação. O poder estatístico perdido com 20% é tratado pelo MDE |
| Produto interno (`vector_ip_ops`) | dá a mesma ordem que o cosseno com filmes unitários; o cosseno reaproveita a busca atual |
| Novas entradas na rede (D1) | o escore FC como entrada exige um cálculo deixando de fora a curtida do próprio par no treino, um caminho em memória diferente do serviço do banco; não cabe no prazo |
| Vetores de conteúdo na grade | a v3.2 mostrou que não ajudaram, e mais comparações aumentam o risco de escolher por acaso |
| Critério "não concentrado" vago | substituído pelo critério (b) objetivo da §8.1 |
