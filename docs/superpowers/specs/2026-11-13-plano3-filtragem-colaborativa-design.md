# Design: Plano 3 — Filtragem Colaborativa no pgvector

- **Data:** 2026-11-14 (versão 4.2; a v4.0 é de 2026-11-13)
- **Base:** [spec v3.2](2026-11-07-recomendacao-filmes-design.md). Tudo o que esta spec não muda continua valendo como lá está, por exemplo as métricas (§9.3), a entrada da rede (§6) e o treino (§7). A v3.2 continua sendo a spec da **versão 1** e da avaliação no `u1.test`.
- **Status:** rascunho para revisão do usuário. Ela foi desenhada em conversa, parte por parte, com aprovação em cada parte. Também passou por duas rodadas de revisão adversarial por subagentes, com medições nos dados, e por duas revisões externas. A v4.1 incorpora uma terceira revisão externa e as condições do usuário sobre ela, depois de duas rodadas de contestação por subagentes com conferência no código. A v4.2 fecha seis pontos de executabilidade de uma quarta revisão externa, sem mudar o desenho (resumo das mudanças na §15).
- **Prazo:** segunda-feira, 2026-11-16. O objetivo é a melhor versão **validada** possível, não necessariamente todas as ideias implementadas. A simplificação não pode reduzir a capacidade de responder à pergunta principal nem esconder limitações da implementação.

## 1. Objetivo e pergunta

**Pergunta:** acrescentar filtragem colaborativa (FC) melhora a recomendação em relação à versão 1? E, se melhora, a rede neural ainda acrescenta algo sobre ela?

- **FC item-item:** "filmes curtidos pelas mesmas pessoas que curtiram os seus". Ela entra como fonte de candidatos e como sistema isolado.
- **Arquitetura:** a FC é implementada como **busca vetorial no Postgres + pgvector**. O objetivo da aplicação final é consultar o banco sem carregar o catálogo e suas representações na memória do processo, e o experimento mede essa arquitetura, não um atalho em memória.
- **Separação obrigatória:** este documento separa **a contribuição dos vetores para a qualidade** da **utilidade do pgvector na arquitetura**. Um resultado ruim da primeira não elimina a segunda.
- **O sistema avaliado é o implantado:** a lista oficial vem do índice HNSW, com o preenchimento por populares da §6. A diferença para a busca exata é medida à parte (§5.3) e nunca altera a lista oficial.
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
| Isolamento | de API: o contexto das fases v2 não expõe o `u1.base` cru nem as divisões (§3.2) |
| Banco | um schema por fase (`v2_exp`, `v2_final`); `public` fica intocado (v1) |
| FC | vetor do filme = indicadora de curtida (nota ≥ 4) sobre os 943 usuários, normalizada (L2); perfil = soma; busca por cosseno; escore oficial = cosseno arredondado em 6 casas (§4) |
| Candidatos | uma busca HNSW de M = 300 por usuário e fase; composição com total **exato** K + N no código; déficit real e de recuperação separados (§6) |
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

As notas do teste-2 saem **antes** de qualquer cálculo. Há três níveis de acesso:

| Acesso | Quando é permitido |
|---|---|
| Definir a divisão, retirá-la do treino e calcular hashes | sempre; é feito só dentro do módulo do teste-2 |
| Estatísticas **agregadas** do teste-2 (média, mediana e percentis das contagens; nº de usuários avaliáveis `n_t`; hashes) | só no Passo 0 (§3.3) e no congelamento (§9.1) |
| IDs e notas individuais do gabarito, para métricas de desempenho | só na etapa 2 da avaliação final (§9.3) |

- O MDE (§8.3) lê `n_t` e `q` **do arquivo commitado do Passo 0**, nunca dos dados.
- As estatísticas agregadas **não podem alimentar** nenhuma escolha de configuração, hiperparâmetro, sistema, época, semente ou corte.
- Nada mais no Plano 3 usa o teste-2 antes da etapa 2: régua e popularidade; perfis de usuários e vetores colaborativos; candidatos e pares de treino; épocas, sementes, configurações e hiperparâmetros.

**O isolamento é de API, porque o teste-2 sai de dentro do `u1.base`.** Na v1, o `u1.test` era um arquivo separado, que só era aberto com `incluirTeste`. O teste-2 não tem essa proteção física, então ela é feita no código:
- **Módulo próprio:** a divisão mora em `src/dados/teste2.js`, que exporta:
  - `dividirTeste2(base)`, usada **só** pelo contexto;
  - `resumoTeste2(dirDados)`, que devolve **só** hashes e estatísticas agregadas. Nenhuma das duas devolve uma lista por usuário para fora do contexto.
- **Contexto das fases v2:** `criarContexto({ fase: 'v2-exp' | 'v2-final', dirDados, incluirTeste2 = false })` devolve **somente** `{ fase, dataset: { filmes, usuarios, generos, ocupacoes }, treino, alvos, regua }`, sem `base` nem `divisoes`.
  - Em `v2-exp`, `alvos` = validação.
  - Em `v2-final`, `alvos` = teste-2 só com `incluirTeste2: true`, usado **apenas** pela etapa 2. Sem a opção, `alvos = null`.
  - `incluirTeste` numa fase v2 é erro, porque leria o `u1.test`. `incluirTeste2` nas fases `exp`/`final` também é erro.
- **Leitura direta proibida:** só `src/contexto.js`, `src/dados/teste2.js` e o script antigo `scripts/03-eda.js` podem importar `carregarDataset` ou `criarDivisoes`. O `03-eda.js` lê o `u1.test` e **não pode ser executado no Plano 3**.

Verificações:
- **Teste unitário:** nenhuma nota aparece ao mesmo tempo no treino de uma fase e no teste-2. A conferência varre os pares `(usuário, filme)` dos arrays de notas, não o texto do JSON.
- **Teste unitário:** as chaves do objeto devolvido pelo contexto v2 são exatamente as da lista acima.
- **Teste unitário de invariância:** acrescentar ao teste-2 uma nota fictícia não muda a régua, a popularidade nem os vetores FC. Com `incluirTeste2`, o treino e a régua continuam iguais aos de sem a opção.
- **Teste unitário:** a saída de `resumoTeste2` só tem as chaves agregadas permitidas.
- **Teste estático:** só os três arquivos acima importam `carregarDataset` ou `criarDivisoes`.
- **Hash:** o hash do conjunto teste-2 é gravado no registro do Passo 0 e no congelamento. A avaliação final confere os dois.

### 3.3 Passo 0: registro antes de qualquer treino

Um script grava `resultados/divisoes-v2.json`, que é commitado antes da grade. O registro é **só descritivo**: tamanhos e contagens agregadas, nenhuma métrica de sistema sobre o teste-2 e nenhuma lista por usuário. Os números do teste-2 vêm de `resumoTeste2`. Ele contém, para a validação e para o teste-2:
- notas disponíveis por usuário e notas escondidas por usuário, com média, mediana e percentis 10, 25, 75 e 90;
- curtidas escondidas por usuário, com as mesmas estatísticas, e o nº de usuários sem nenhuma;
- nº de usuários avaliáveis, ou seja, com pelo menos uma curtida escondida (`n_t`, no teste-2);
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
- **Soma das similaridades:** `Σ_i sim(i, j) = p · v_j`. A igualdade é exata, por linearidade (medida: diferença máxima de 8,9 × 10⁻¹⁵).
- **Escore oficial:** `escore(j) = round(cos(p/‖p‖, v_j), 6) = round(1 − distância, 6)`. Ele é igual a `p · v_j / ‖p‖`, arredondado. Como todos os `v_j` são unitários, a ordem por escore é a mesma da ordem por `p · v_j`. Por isso a busca usa `vector_cosine_ops`, e não produto interno. Isso reaproveita a busca atual e evita o problema conhecido do HNSW com produto interno sobre bases não normalizadas.
- **A mesma escala em todo lugar:** HNSW, busca exata e referência em memória usam este escore, arredondado do mesmo jeito. Arredondar escalas diferentes daria empates diferentes.

### 4.2 Regras explícitas

- **Filme sem nenhuma curtida no treino:** não tem vetor e fica fora **só da busca colaborativa**.
  - Ele continua no catálogo e disponível para os populares, para a busca por conteúdo e para usuários novos.
  - Se receber curtidas, entra no índice no próximo recálculo dos vetores.
  - Motivo técnico: o pgvector não aceita vetor nulo no cosseno.
- **Usuário sem curtidas no treino:** não tem perfil FC. A busca colaborativa devolve uma lista vazia, e as listas são completadas com populares (§6).
- **Usuário novo** (cadastro com filmes marcados): o perfil é a soma dos vetores dos filmes marcados e funciona na hora. Isso não é medido no Plano 3.
- **Escore aceito:** só escore oficial > 0, **depois do arredondamento**. Filmes sem nenhum fã em comum, ou com escore que arredonda para 0, ficam de fora.
- **Já vistos:** excluídos, com o mesmo filtro da busca atual.
- **Desempate:** pelo escore oficial (arredondado em 6 casas), e o empate se resolve pelo id crescente. Sem isso, ruídos de float32 mudariam a ordem entre a busca aproximada e a exata. Escores são razões de inteiros e empatam com frequência.
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

### 5.2 Busca colaborativa: `buscarColaborativos`

A busca atual (`buscarVizinhos`) não serve para a FC: ela aceita no máximo N = 100 (`src/banco/busca.js:13`), valida 23 dimensões e lança erro quando volta menos linhas que o pedido. A FC precisa de uma função nova, que reaproveita a transação, a conferência de hash e a preparação da busca atual.

`buscarColaborativos(pool, { vetor, excluir, m, hashes, modo })`:
- **Entrada:** `vetor` = `p/‖p‖`, com 943 dimensões; `excluir` = os já vistos; `1 ≤ m ≤ 300`; `modo` = `'hnsw'` (oficial) ou `'exata'` (controle).
- **Como cada modo é garantido:** o mesmo mecanismo da busca atual (`configurarModo`, `src/banco/busca.js`). No modo `'hnsw'`, `SET LOCAL enable_seqscan = off` força o índice. No modo `'exata'`, `SET LOCAL enable_indexscan = off` impede o índice, e a consulta compara com todos os filmes e ordena. O HNSW não oferece bitmap scan, então não há outro caminho pelo índice. A conferência reaproveita a função de plano de execução (EXPLAIN) da busca atual:
  - um teste de integração confirma `Index Scan` no índice de `filmes_fc` no modo `'hnsw'` e `Seq Scan` sem o índice no modo `'exata'`, como o teste atual faz para `filmes`;
  - o relatório de fidelidade grava os dois planos, como `resultados/verificacao-hnsw.json` fez no Plano 2.
- **Consulta:** igual à atual, `ORDER BY embedding <=> consulta`, excluindo só os já vistos. Os populares **não** são excluídos no SQL. A composição (K, N) é feita no código (§6).
- **Parâmetros:** `hnsw.iterative_scan = strict_order` e `ef_search = efSearchPara(pedir)`, com `pedir = m + 50` linhas, dobrando até 1.000 quando há empate no limite (a mesma regra da busca atual, que tem mínimo de 40).
- **Ordenação e corte no código:** por (escore oficial decrescente, id crescente). A lista é cortada no primeiro escore oficial ≤ 0.
- **Empate no limite:** a folga compara o **escore oficial** da posição m com o da última linha devolvida, e não a distância crua. Assim, um filme com o mesmo escore arredondado e id menor não fica de fora.
- **Empate que persiste em 1.000 linhas:** 1.000 é também o teto do `ef_search` no pgvector, então a busca não cresce além disso. Se o empate no limite continuar, a função **não lança erro** (a busca atual lança). Ela devolve as m primeiras pela ordem (escore oficial, id) entre as linhas recebidas e marca `empateNaoResolvido = true`. Isso significa que o top m pode não ser o top m determinístico completo, porque algum filme empatado com id menor pode ter ficado de fora. O nº de usuários com essa marca é registrado no relatório de fidelidade, por fase e modo. Com M = 300 e 1.682 filmes, espera-se zero.
- **Lista completa:** quando volta menos que `pedir` linhas, ou quando o corte por escore ≤ 0 acontece, não há mais elegíveis.
- **Sem erro por lista curta:** a função devolve o que houver, mesmo menos que m. Para a FC, isso revoga a regra da v3.2 (§10) de falhar quando a busca devolve menos de N linhas. O déficit é tratado na §6.

### 5.3 Fidelidade (relatório separado do ganho de qualidade)

São três versões da mesma busca:
- **HNSW no banco:** a versão **oficial**, que o sistema usa;
- **busca exata no banco:** um controle, sem índice;
- **referência:** o cálculo exato em memória, em float64, com o escore oficial da §4.1.

As medidas comparam o HNSW com a **referência**. A busca exata no banco tem de ser igual à referência; isso valida o sinal do operador e a equivalência matemática. As medidas 1 e 2 são calculadas sobre a parte FC da lista, **antes do preenchimento** por populares, para que os populares iguais nas duas versões não inflem o resultado.

**Precisão float32 × float64.** O pgvector guarda os vetores em float32, e a referência é em float64. A diferença no escore é da ordem de 10⁻⁷ e pode mudar o escore arredondado de um filme perto de uma fronteira de arredondamento, e com isso a ordem ou a elegibilidade (escore > 0).
- **O escore oficial é o do banco:** `round(1 − distância, 6)`, com a distância calculada pelo pgvector. A referência usa o mesmo arredondamento sobre o cosseno em float64.
- **Conferência busca exata = referência,** com tolerância `τ = 10⁻⁵` sobre os escores em float64 (uma ordem de grandeza acima do erro esperado do float32 num produto de 943 posições). Ela passa se as duas listas forem iguais, ou se toda divergência for de um destes tipos:
  - **troca de ordem** entre dois filmes cujos escores em float64 diferem menos de τ;
  - **entrada ou saída na posição m** de um filme cujo escore em float64 difere menos de τ do escore do filme na posição m da referência;
  - **entrada ou saída no corte de escore > 0** de um filme com escore em float64 menor que τ.

  Essas divergências são **de precisão**: são contadas e reportadas. Qualquer outra divergência é erro e para a execução. (Um critério por distância a uma fronteira de arredondamento não serviria: as fronteiras ficam a cada 10⁻⁶, então todo número está a no máximo 5 · 10⁻⁷ de uma delas.)
- **Separação das causas:** as medidas 1 e 2 são reportadas também entre o HNSW e a busca exata no banco, que usam os mesmos vetores float32. A diferença HNSW × busca exata é o efeito da **aproximação**; a diferença busca exata × referência é o efeito da **precisão**.

1. a sobreposição média dos N vizinhos, por usuário;
2. a fração de usuários com exatamente a mesma lista de candidatos;
3. o recall dos relevantes em cada versão, pareado por usuário;
4. o NDCG@10 do **mesmo ordenador** sobre a lista final HNSW e sobre a lista final da referência, por bootstrap pareado: o escore FC para S1, e as mesmas 3 redes já treinadas, sem retreino, para os sistemas com rede. "Lista final" é a composição efetivamente usada pelo sistema, **com o preenchimento por populares**, aplicado pela mesma regra (§6) nas duas versões, cada uma com o próprio déficit. Assim, a medida 4 representa o que o sistema entrega; as medidas 1 e 2 continuam antes do preenchimento.

**Na validação (completa), em `resultados/fidelidade-fc-v2-exp.json`:**
- as medidas 1–3 para N ∈ {50, 100, 150};
- a medida 4 para **S1** antes da grade (tarefa 4), e para **S3** e a **v2** depois do treino da grade e da escolha (tarefa 6), porque as redes deles só existem a partir daí. A fidelidade é descritiva e não entra na escolha, então a ordem não afeta o protocolo. Se o portão reprovar, a medida 4 vale só para S1 e para a v2. As outras configurações ficam de fora;
- o custo extra é só de inferência da rede sobre as listas da referência; nenhuma rede é retreinada.

**No teste-2 (etapa 1, sem gabarito):**
- as medidas 1 e 2, contra a referência;
- a conferência busca exata = referência;
- a fração de usuários com **top 10 idêntico** (HNSW × referência), em S1 e na v2. Para a v2 com rede, o top 10 da referência usa as mesmas redes, sem retreino;
- **se a v2 escolhida não usar a FC** (N = 0, ou S0), o impacto da aproximação sobre a comparação principal é zero por construção, porque nem a v2 nem a v1 passam pelo HNSW da FC. A fidelidade continua sendo reportada à parte;
- **se a fração for 100%,** o impacto da aproximação sobre a comparação principal também é zero por construção (a v1 não usa a FC). Isso é registrado;
- **se não for 100%,** reporta-se o teto `min(1, (nº de usuários 1–462 com top 10 diferente) / n_t)`, que limita a diferença no NDCG médio, porque cada NDCG está em [0, 1]. A contagem usa todos os usuários 1–462, para não depender de saber quais são avaliáveis; por isso o quociente pode passar de 1, e o `min` o limita. Também se registra a frase obrigatória: "o impacto da aproximação sobre o NDCG no teste-2 não foi medido".
- O top 10 comparado aqui é o da lista final, com preenchimento, como na medida 4.
- Recall e NDCG de fidelidade **não** são calculados no teste-2. Calculá-los exigiria guardar as listas da referência no arquivo de previsões e mais código coberto pela trava da etapa 2, só para uma análise diagnóstica.

**Se a fidelidade no teste-2 for cortada (§12):** o README diz "fidelidade no teste-2 não medida".

**Nota para a documentação:** com 1.682 filmes, a busca exata custa o mesmo que o HNSW. O índice está aqui para demonstrar a arquitetura de produção, não por necessidade de velocidade.

## 6. Candidatos: composição exata

- **Uma busca por usuário e fase:** `H_M` = a lista de `buscarColaborativos` com M = 300, o maior K + N da grade. Ela é feita uma vez e compartilhada por todas as configurações, inclusive na fase `v2-final`. O top 150 de uma busca HNSW não é necessariamente o prefixo do top 300 de outra busca, com outro ef_search; buscar uma vez só garante que todas as configurações usem a mesma lista FC.
- **Lista (K, N):** `P_K` = os K primeiros populares não vistos (ordem da v3.2: contagem decrescente, id crescente), seguidos dos N primeiros filmes de `H_M` que **não estão** em `P_K`. Como no máximo K filmes de `H_M` podem estar em `P_K`, sobram pelo menos N sempre que houver elegíveis suficientes.
- **Preenchimento:** se faltar, a lista é completada com os próximos populares não vistos que ainda não estão nela. O total é sempre exatamente K + N.
- **Déficit:** para cada usuário e configuração (K, N), com `E` = os elegíveis da referência (filmes com vetor, não vistos, com escore oficial > 0; um usuário sem curtidas tem `E` vazio):
  - `elegK = |E \ P_K|` e `devK = |H_M \ P_K|`;
  - `completados = max(0, N − devK)`: as vagas preenchidas com populares (o número oficial);
  - **déficit real** = `min(completados, max(0, N − elegK))`: faltam filmes elegíveis;
  - **déficit de recuperação** = `completados − déficit real`: havia elegíveis, mas o HNSW não os devolveu.

  Os dois somam exatamente `completados` e nunca ficam negativos. Os casos em que `devK > elegK` (o HNSW devolve um filme cujo escore em float64 arredonda para 0) também são registrados, porque medem a divergência de arredondamento. Um motivo plausível para o déficit de recuperação: filmes curtidos por um único e mesmo usuário têm vetores idênticos, e o HNSW pode deixar nós duplicados inalcançáveis.
- **Relatório do déficit,** para cada fase e configuração: o nº de usuários com cada tipo de déficit (incluindo os sem curtidas), as vagas preenchidas de cada tipo e, em S1, S3 e na v2, quantas posições do top 10 vieram do preenchimento. As contagens não usam o gabarito, então também são feitas no teste-2, na etapa 1. Na prévia, nenhum caso precisou ser completado.
- **FC150:** é a lista (0, 150). Ela é gerada **uma vez**, gravada com hash e compartilhada pelos sistemas S1 e S3:
  - **S1:** ordena pelo escore oficial, e os filmes que completaram a lista vêm depois, por popularidade;
  - **S3:** a rede ordena a lista inteira, e pode subir filmes do preenchimento. Por isso, as posições do top 10 vindas do preenchimento são registradas nos dois, e a comparação S3 − S1 (§8.5) é lida com essa contagem ao lado;
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
- **Composições:** para cada tamanho de lista L ∈ {50, 100, 150, 200} e cada fração p de FC ∈ {0; 0,25; 0,5; 0,75; 1}, a composição é (K, N) com `N = Math.round(p · L)` e `K = L − N`, montada pela regra da §6. O `Math.round` do JavaScript arredonda 0,5 para cima. Com L = 150, isso dá:
  - só pop: (150, 0);
  - 25%: (112, 38);
  - 50%: (75, 75);
  - 75%: (37, 113);
  - só FC: (0, 150).
- **O que se mede** (`resultados/portao-fc-v2-exp.json`):
  - o recall dos candidatos de todas as composições acima;
  - a contribuição exclusiva sobre P ∪ F (top-150 de cada fonte): relevantes só-pop, só-FC, ambas e nenhuma, agregados e por usuário, reaproveitando `contribuicaoExclusiva`;
  - a fração de usuários com ≥ 1 relevante capturado só pela parte FC de (100, 50).
- **Critério de passagem** (as duas condições):
  - **(a)** com lista de 150, a melhor mistura supera (150, 0) em recall por mais de 1 EP pareado **do recall**. "Melhor mistura" é, entre (112, 38), (75, 75) e (37, 113), a de maior recall médio na validação, com empate pelo menor N. Só FC (0, 150) não é mistura e não entra em (a); seu recall é só descritivo;
  - **(b) concentração:**
    1. ordenar os usuários pela quantidade de curtidas escondidas **da validação**, de forma decrescente, com empate pelo id crescente;
    2. retirar os `floor(0,1 · n)` primeiros;
    3. nos restantes, a diferença média de recall entre (100, 50) e (150, 0) tem de ser > 0.

  O valor de (b) fica registrado. A fração do ganho vinda dos 10% retirados é só descritiva.
- **O que o portão é:** um filtro de viabilidade, **não uma prova** de superioridade.

**Os dois cenários,** definidos agora e registrados no resultado do portão antes da grade:

| | Portão aprovado | Portão reprovado |
|---|---|---|
| Sistemas rodados | S0, S1, S2, S3 e S4 (as 15 configurações com rede) | **só S0, S1 e S2** |
| Configurações com rede | as 15 da grade | só (150, 0), a v1. As células com N = 0 e K ≠ 150 também saem: são variações da v1 já estudadas no Plano 2 e não respondem à pergunta sobre a FC |
| Sistemas na escolha (§8.4) | 17 | 3 |
| FC150 e `buscarColaborativos` | usadas por S1 e S3 | usadas só por S1 |
| Fidelidade (§5.3) | medida 4 de S1, S3 e v2 | medida 4 de S1 e v2 |
| Contribuições (§8.5) | todas | só S1 − S0; as demais são registradas como "não rodadas: portão reprovado" |
| Congelamento e etapa final (§9) | só os sistemas rodados | só S0, S1 e S2 |

S1 continua nas comparações nos dois cenários.

### 8.2 Passo 2: sistemas comparados

| Sistema | O que é | Rede |
|---|---|---|
| S0 | popularidade: top 10 populares não vistos | não |
| S1 | **FC sozinha**: top 10 da lista FC150, pelo escore oficial | não |
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
  - `n_t` é o nº de usuários avaliáveis do teste-2, lido do arquivo commitado do Passo 0 (§3.2).
  - `σ_d` é o desvio padrão amostral, por usuário, da diferença de NDCG@10 entre os dois sistemas do par.
- **Como estimar `σ_d`:**
  - **onde:** na validação, **com o gabarito subamostrado** para imitar o teste-2;
  - **como subamostrar:** cada relevante escondido de cada usuário é mantido com probabilidade `q = (média de curtidas escondidas no teste-2) / (média na validação)`, calculada com as contagens do Passo 0;
  - **repetições:** 20 vezes, com sementes `30_000_000 + 1000 · r + usuario` para r = 1..20;
  - **usuários sem relevante mantido:** em cada repetição, os usuários que ficaram sem nenhum relevante saem do cálculo daquela repetição, como na avaliação. O nº de usuários avaliáveis de cada repetição (`n_r`) é registrado;
  - `σ_d` é a média dos 20 `σ_d,r`;
  - **sem treino nem semente de rede.**
- **Dois pares de referência:**
  - **sistemas bem diferentes:** S0 × S1 (prévia: ~0,029);
  - **sistemas parecidos:** S1 × "FC150 ordenada por escore × √pop" (prévia: ~0,019). Esse par é uma heurística, sem significado próprio. Definição, recuperada do código da prévia:
    - `pop[j]` = nº de notas de qualquer valor do filme j no **treino da fase** `v2-exp` (`regua.contagens`). O gabarito da validação vazaria para a própria métrica, e o teste-2 é proibido;
    - a ordenação é por `escore × √pop[j]` decrescente, com o escore **sem arredondar** e desempate pelo id crescente;
    - os filmes que completaram a FC150 ficam com escore 0 e vão para o fim, por popularidade e depois por id.
- **Conferência por simulação** (só conferência; não decide nada). Para cada subamostragem r = 1..20:
  1. `d_u` são as diferenças do par entre os `n_r` avaliáveis da repetição r;
  2. as diferenças são centradas: `c_u = d_u − média(d)`;
  3. com `criarAleatorio(40_000_000 + r)`, sorteiam-se B = 10.000 amostras de tamanho `n_t`, com reposição. Em cada amostra s, calculam-se a média `m_s` e `ep_s = s_s / √n_t`;
  4. aplicar um ganho δ desloca cada `c_u` para `c_u + δ`. O IC normal de 95% exclui zero pelo lado positivo quando `δ > 1,96 · ep_s − m_s`;
  5. `δ*_r` = quantil 0,80 de `(1,96 · ep_s − m_s)`, ou seja, o menor δ em que 80% dos IC excluem zero.

  O resultado é a média dos `δ*_r`, com mínimo e máximo, comparada ao MDE da fórmula. A simulação usa o IC normal, e não o bootstrap, porque um bootstrap aninhado seria inviável (mais de 10¹⁰ operações) e, para a média de ~430 diferenças, os dois praticamente coincidem. A comparação principal continua usando `bootstrapPareado` (5.000 reamostragens, semente 2026). A prévia mostrou concordância de ±0,001 com a fórmula. Qualquer discrepância é reportada.
- **Frase obrigatória:** "se o ganho real for da ordem do observado na validação **sob a mesma subamostragem**, a capacidade de detecção é provavelmente boa, mas não garantida. A estimativa vem de outro grupo de usuários (validação), e o par v2 × v1 não é nenhum dos dois pares de referência. A subamostragem imita só de forma aproximada as curtidas invisíveis do `u1.test` (§13), e a capacidade real no teste-2 pode ser diferente, inclusive menor."
- **Escala da comparação:** o ganho da validação citado na frase é recalculado com o gabarito subamostrado (as mesmas 20 repetições), porque o ganho com o gabarito completo está em outra escala.
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
   1. **S1 (FC sozinha).** É mais simples que a v1 em **treino e ranqueamento**: tem **zero parâmetros treinados por gradiente e nenhuma dependência de semente**. Não é mais simples em infraestrutura: o custo de armazenamento e de busca vetorial é reconhecido.
   2. **S2 (v1).**
   3. **Os demais**, por esta chave lexicográfica: `[usaRede, N, K + N, K]`, todos crescentes. S0 é o único deles sem rede, com chave `[0, 0, 10, 10]` (K = 10, N = 0), e por isso é sempre o primeiro dos demais.
   - **Na implementação:** a chave de simplicidade é `[0]` para S1, `[1]` para S2 e `[2, usaRede, N, K + N, K]` para os demais. A ordem é totalmente determinística.
6. **Fragilidade:** marcada como na v3.2, quando a faixa [mín, máx] das médias por semente do escolhido se sobrepõe à de outro sistema.
7. **Resultado:** o escolhido é a **v2**.
   - **Se a configuração escolhida for exatamente (150, 0) com a mesma rede:** o Plano 3 não introduziu uma nova versão, e **não há comparação confirmatória**. O resultado é reportado assim.
   - **Qualquer outra configuração**, mesmo próxima na validação, segue para a comparação v2 − v1.
8. **Maldição do vencedor:** escolher o melhor entre 17 sistemas (S0, S1 e as 15 configurações com rede; 3 se o portão reprovar) deixa a vantagem da v2 na validação **otimista**. A estimativa sem esse viés é a do teste-2. O "melhor S4" também é escolhido depois de ver os resultados.
9. **Expectativa registrada antes da grade:** pela prévia, a FC sozinha (NDCG 0,369 na validação) está acima da v1 da v3.2 (~0,326, com um treino ligeiramente diferente). O mais provável é que S1 seja a v2.

### 8.5 Contribuições (descritivas)

| Pergunta | Conta | Observação |
|---|---|---|
| A FC ordena melhor que a popularidade? | S1 − S0 | |
| A rede acrescenta algo à FC? | S3 − S1 | Mesma lista FC150, dois ordenadores. A rede de S3 aprendeu com negativos dessa lista. As posições do top 10 vindas do preenchimento são reportadas ao lado (§6). |
| A FC melhora os candidatos da rede, com o mesmo orçamento? | melhor de (100, 50), (50, 100) e (0, 150) − (150, 0) | Composição + efeito no treino. "Melhor" é escolhido depois de ver os resultados. |
| Os populares ajudam junto com a FC? | melhor S4 − S3 | Efeito do híbrido inteiro se os orçamentos diferirem; escolhido depois de ver. |
| A FC melhora o sistema da v1? | melhor S4 − S2 | Idem. |

Todas aparecem com IC, mas **rotuladas como descritivas**. Nenhuma é apresentada como descoberta independente, por causa das comparações múltiplas.

## 9. Congelamento e avaliação final

### 9.1 Congelamento

`resultados/configuracao-v2.json` é commitado **antes** da etapa 1. Ele contém:
- **os sistemas:** a v2 e a v1 (configuração, épocas por semente e `seed_api = 1`), mais as configurações secundárias que serão avaliadas. Entram **só os sistemas efetivamente rodados** no cenário do portão (§8.1), e o cenário fica registrado;
- **os hashes:** do teste-2, do treino `v2-final`, da régua `v2-final` e dos vetores FC `v2-final`. Estes são calculados no congelamento, sem ler o gabarito (o hash do teste-2 vem de `resumoTeste2`);
- **os resultados anteriores:** o resultado do portão, os dois MDE de referência e o MDE descritivo de v2 × v1;
- **a comparação principal, por extenso:** "NDCG@10(v2) − NDCG@10(v1) por usuário, média das 3 sementes por usuário nos sistemas com rede, bootstrap pareado com 5.000 reamostragens e semente 2026; suportada se o IC 95% exclui zero";
- **as regras de avaliação, como campos escritos:**
  - relevância (nota ≥ 4);
  - exclusão dos usuários sem curtidas escondidas;
  - definições das métricas (v3.2, §9.3);
  - agregação das sementes;
  - corte mainstream × nicho (v3.2, §9.4: mediana do conjunto avaliado, na escala da régua);
- **o código:**
  - `commitCodigo`: o HEAD no momento do congelamento, gravado com a árvore de trabalho limpa (`git status --porcelain` vazio). Um arquivo não pode conter o hash do commit que o inclui, então este é o commit imediatamente anterior ao do congelamento;
  - o sha256 de cada arquivo de `src/avaliacao/` e do script da etapa 2, como segunda trava.

**Conferência do congelamento** (função única, `conferirCongelamento()`, usada pelas etapas 1 e 2):
- a árvore de trabalho está limpa;
- o arquivo de congelamento está versionado (`git ls-files --error-unmatch`) e sem diferença em relação ao HEAD;
- `commitCodigo` é ancestral do HEAD;
- `git diff --quiet <commitCodigo> HEAD -- src scripts package.json package-lock.json` não acusa diferença.

Assim, depois do congelamento, só commits em `resultados/` são aceitos, como o do hash das previsões entre as etapas 1 e 2. Exigir que o HEAD fosse o commit do congelamento quebraria a etapa 2 por causa desse commit.

**Bug encontrado depois do congelamento:**
- **Antes da leitura do gabarito:** corrigir, commitar e congelar de novo. O novo arquivo lista os `desvios` (o `commitCodigo` anterior e o motivo). O script recusa se o sistema escolhido, as épocas ou as configurações mudarem. Se o hash das previsões já estava commitado, a etapa 1 é refeita, e o desvio fica no histórico e no README. Como nada do gabarito foi visto, isso não é uma segunda rodada.
- **Depois da leitura do gabarito:** nada se refaz. O erro vai para o README como desvio pós-gabarito, com o número original; uma correção, se houver, aparece só como descritiva.

### 9.2 Etapa 1: previsões (sem gabarito)

1. Confere o congelamento (`conferirCongelamento()`, §9.1).
2. Calcula a fase `v2-final` sem o teste-2 (`incluirTeste2` desligado).
3. Carrega o schema `v2_final`.
4. Retreina as redes necessárias com as épocas congeladas.
5. Gera os candidatos (§6) e calcula o top 10 de todos os sistemas avaliados, para todas as sementes e para os usuários 1–462.
6. Mede a fidelidade no teste-2 e as contagens de déficit, só com o que dispensa gabarito (§5.3 e §6; descritivo; 1º corte).
7. Grava as previsões em `artefatos/previsoes-v2-final.json`, fora do git, porque são dados derivados do MovieLens.
8. Grava o sha256 delas em `resultados/previsoes-v2-final.sha256.json`, que é **commitado antes da etapa 2**. O histórico do git prova que as recomendações existiam antes da leitura do gabarito.

### 9.3 Etapa 2: leitura do gabarito

1. **Confere, sem ler o gabarito:**
   - o congelamento (`conferirCongelamento()`) e os seus hashes;
   - o hash das previsões, contra o arquivo commitado;
   - os sha256 do código de avaliação, contra os do congelamento;
   - que `resultados/avaliacao-v2.json` ainda não existe.

   Qualquer divergência para tudo, e o gabarito continua sem ser lido.
2. Só então lê o gabarito do teste-2 (`incluirTeste2: true`) e confere o hash dele.
3. Calcula as métricas, só a partir das previsões gravadas (sem busca no banco nem inferência da rede):
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
| Isolamento | nenhuma nota no treino e no teste-2 ao mesmo tempo (varrendo pares, não texto); chaves do contexto v2 exatamente as da lista branca; invariância da régua, da popularidade e dos vetores FC a uma nota fictícia no teste-2; treino e régua iguais com e sem `incluirTeste2`; a fase só devolve o gabarito com `incluirTeste2`; `incluirTeste` numa fase v2 é erro; `resumoTeste2` só devolve chaves agregadas; só os arquivos permitidos importam `carregarDataset`/`criarDivisoes` |
| FC | `Σ cos = p · v_j`; normalização; escore oficial = cosseno arredondado, igual nas três versões; filme sem curtidas fora só da FC; usuário sem curtidas → lista FC vazia; arredondamento em 6 casas e desempate por id; filtro escore > 0 **depois** do arredondamento (um escore que arredonda para 0 fica de fora) |
| Busca FC | `buscarColaborativos` aceita m até 300, não lança erro com lista curta, corta no primeiro escore ≤ 0, resolve empate no limite pelo escore arredondado e, com empate persistente em 1.000 linhas, devolve a lista com `empateNaoResolvido = true`; conferência exata = referência aceita só as divergências de precisão (troca, posição m e corte em zero com diferença em float64 < τ = 10⁻⁵) e recusa as demais |
| Banco: modos | EXPLAIN mostra `Index Scan` no índice de `filmes_fc` no modo `'hnsw'` e `Seq Scan` no modo `'exata'` (integração) |
| Portão | composições com `N = Math.round(p · L)`; "melhor mistura" só entre as três misturas, com empate pelo menor N; portão reprovado → só S0, S1 e S2 seguem para a escolha e o congelamento |
| Composição | total exato K + N; uma busca M = 300 compartilhada; déficit real e de recuperação somam os completados e nunca ficam negativos; usuário sem curtidas → déficit real = N; caso `devK > elegK` registrado; com N = 0 a lista é igual à da v1; S1 e S3 com a mesma FC150 e a mesma regra para completar |
| Escolha | grupo de 1 EP; ordem S1 → S2 → chave `[usaRede, N, K+N, K]`, com S0 = `[0, 0, 10, 10]`; fragilidade; "v2 = v1" só com configuração idêntica |
| Portão e MDE | critério (b) exato, com empate pelo id; fórmula do MDE; subamostragem com semente; usuário zerado sai da repetição e `n_r` é gravado; heurística com `pop[j]` da fase e escore sem arredondar; simulação reprodutível com a mesma semente e `δ*` menor quando `σ` é menor |
| Avaliação final | `conferirCongelamento()` recusa árvore suja e código alterado depois do congelamento, e aceita um commit só em `resultados/`; a etapa 2 recusa se o hash das previsões não bater, se o código de avaliação mudou ou se o resultado já existe, **sem ter lido o gabarito** |
| Banco (integração) | busca FC no pgvector num **schema próprio de teste**, nunca em `public` nem em `v2_*`; HNSW igual ao exato num caso pequeno; conferência de hash |
| Não regressão | os 170 testes atuais continuam passando; as fases `exp`/`final` continuam funcionando |

## 11. Documentação

- **README principal:** ganha a seção "Avaliação retrospectiva do Plano 3 (teste-2)", com:
  - a ressalva histórica da §3.4, completa;
  - a comparação principal;
  - as contribuições, rotuladas como descritivas;
  - a fidelidade do pgvector, separada, com as contagens de déficit real e de recuperação;
  - a declaração de que o sistema avaliado inclui a aproximação do HNSW e o preenchimento por populares (§1);
  - se for o caso, "o impacto da aproximação sobre o NDCG no teste-2 não foi medido" ou "fidelidade no teste-2 não medida" (§5.3);
  - os desvios do congelamento, se houver (§9.1);
  - as limitações da §13.
- **`resultados/README.md`:** explica cada arquivo novo (`divisoes-v2.json`, `mde-v2.json`, `portao-fc-v2-exp.json`, `fidelidade-fc-v2-exp.json`, `configuracao-v2.json`, `previsoes-v2-final.sha256.json`, `avaliacao-v2.json`).
- **Resultados antigos:** os do `u1.test` (v1) continuam na seção deles, intocados.

## 12. Sementes, tarefas, calendário e cortes

**Sementes novas** (sem colisão com a v3.2):

| Uso | Fórmula | Faixa |
|---|---|---|
| teste-2 | `20_000_000 + usuario` | 20.000.001–20.000.462 |
| subamostragem do MDE | `30_000_000 + 1000 · r + usuario`, r = 1..20 | 30.001.001–30.020.943 |
| simulação do MDE | `40_000_000 + r`, r = 1..20 | 40.000.001–40.000.020 |

As sementes da v3.2 são:
- divisões: 42 + u;
- negativos de treino: 1.000.000 · s + u, até ~3.000.943;
- negativos de validação: 5.000.000 + 1.000.000 · s + u, até ~8.000.943;
- R9: 9.000.000 + u;
- embaralhamento: 100.000 · s + época;
- pesos: 1000 · s + camada;
- bootstrap: 2026.

**Tarefas** (detalhadas no plano):
1. fases como descritor, contexto v2 isolado (`teste2.js`, lista branca), divisão do teste-2 e registro do Passo 0;
2. FC em memória (referência), portão e MDE pré-registrado (com a simulação);
3. banco: schema por fase, `filmes_fc`, carga e `buscarColaborativos`;
4. fidelidade na validação (medidas 1–3 e medida 4 de S1);
5. candidatos com composição exata e relatório de déficit, gravados com hash;
6. grade, escolha e medida 4 de fidelidade de S3 e da v2;
7. congelamento (`conferirCongelamento()`);
8. etapa 1;
9. etapa 2;
10. documentação.

**Calendário:**

| Dia | O que |
|---|---|
| Sexta (13) | spec |
| Sábado (14) | revisão da spec (v4.1) e plano |
| Domingo | tarefas 1–7 |
| Segunda | tarefas 8–10 |

O calendário original previa as tarefas 1–6 no sábado. O atraso é anterior à v4.1, e os cortes abaixo absorvem o que faltar.

**Cortes** (decididos agora; qualquer corte da grade acontece **antes** de ela rodar, nesta ordem):
1. fidelidade no teste-2 (§5.3); se cortada, o README declara "fidelidade no teste-2 não medida";
2. grade de orçamento variável. **Só se aplica com o portão aprovado:** mantém S0, S1, S2, S3 e as 4 configurações de orçamento fixo. Com o portão reprovado, a grade já se reduz a S0, S1 e S2 (§8.1), e este corte não tem efeito;
3. corte mainstream × nicho.

**Nunca se cortam:** as 3 sementes, o pareamento, o MDE pré-registrado, o protocolo do teste-2, o isolamento de API (§3.2) e as contagens de déficit (§6).

## 13. Limitações (registradas no README)

- **Teste-2 retrospectivo:** ver a §3.4.
- **Notas invisíveis do `u1.test`:** cada usuário do teste-2 tem, em média, ~28 notas no `u1.test` que o sistema vê como "não vistas".
  - Curtidas entre elas, se recomendadas, contam como não relevantes.
  - Isso não pode ser medido nem corrigido sem ler o `u1.test`, o que é proibido no Plano 3 (ler o `u.data` também o revelaria).
  - **Não se pode garantir o efeito disso sobre a diferença v2 − v1, nem a direção dele.**
  - Só se a divisão do `u1.test` fosse aleatória dentro de cada usuário, o efeito esperado seria atenuar as diferenças e reduzir o poder. Essa hipótese não é verificável: o `mku.sh` documentado com o MovieLens monta o `u1.test` com as 20.000 primeiras linhas do `u.data`, o que não explica a concentração observada nos usuários 1–462. E, mesmo com divisão aleatória, o sinal da diferença média só estaria garantido sem heterogeneidade entre usuários.
  - O resultado vale para o NDCG medido contra o gabarito observado do teste-2, que é incompleto. Os níveis absolutos não são comparáveis aos da validação nem aos do `u1.test`.
- **Histórico do teste-2:** um pouco menor e com mais usuários pequenos que a validação (mediana de 32 notas, contra 38; p10 de 10, contra 14).
- **Gabarito menor:** ~8 curtidas por usuário, o que dá menos poder estatístico. Ver o MDE (§8.3), que não modela exatamente as notas invisíveis do `u1.test`.
- **Validação reutilizada pela 3ª vez:** as escolhas ficam otimistas, e o teste-2 é a proteção.
- **Sistema avaliado com aproximação:** a lista oficial é a do HNSW, com preenchimento por populares. A fidelidade e o déficit são reportados à parte (§5.3, §6). No teste-2, o impacto da aproximação sobre o NDCG só é limitado por um teto, não medido.
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
| Função de resumo com contagens por usuário | expõe mais do que o Passo 0 e o MDE precisam; o resumo devolve só agregados (§3.2) |
| Recall e NDCG de fidelidade no teste-2, na etapa 2 | exigiria guardar as listas da referência e as previsões extras da rede no arquivo congelado, e mais código sob a trava da etapa 2, para uma análise diagnóstica; no teste-2 ficam as medidas sem gabarito e o teto (§5.3) |
| Excluir os K populares no SQL, ou uma busca por configuração | geraria uma consulta por (usuário, K), e listas HNSW de tamanhos diferentes não são prefixos umas das outras; uma busca M = 300 compartilhada é mais simples e consistente (§6) |
| Abortar quando o HNSW devolve menos que a referência | a avaliação final poderia ficar bloqueada por uma limitação que é parte do sistema implantado; a lista é preenchida e o déficit de recuperação é reportado (§6) |
| Exigir HEAD = commit do congelamento nas etapas | o commit do hash das previsões, entre as etapas 1 e 2, muda o HEAD; a conferência por `git diff` do código é equivalente e não quebra (§9.1) |
| Afirmar que as notas invisíveis do `u1.test` jogam contra a v2, ou que preservam o sinal | as duas afirmações dependem de hipóteses não verificáveis; a redação é conservadora (§13) |
| Bootstrap aninhado na simulação do MDE | mais de 10¹⁰ operações; o IC normal praticamente coincide para a média de ~430 diferenças (§8.3) |

## 15. Mudanças

### v4.1 → v4.2 (executabilidade; desenho inalterado)

1. **Portão (§8.1, §8.4, §9.1, §12):** tabela com os dois cenários; com o portão reprovado, só S0, S1 e S2 seguem, inclusive no congelamento; o corte 2 só se aplica com o portão aprovado.
2. **Teto do HNSW (§5.3):** `min(1, ·)`; impacto zero por construção se a v2 não usar a FC.
3. **Modos da busca e precisão (§5.2, §5.3):** EXPLAIN em teste de integração; regra para divergências float32 × float64, com tolerância τ = 10⁻⁵ entre escores em float64; medidas 1–2 também HNSW × busca exata, para separar aproximação de precisão.
4. **Empate em 1.000 linhas (§5.2):** sem erro; marca `empateNaoResolvido` e registra.
5. **Medida 4 (§5.3):** sobre a lista final, com preenchimento pela mesma regra nas duas versões.
6. **Composições do portão (§8.1):** `N = Math.round(p · L)`; "melhor mistura" entre (112, 38), (75, 75) e (37, 113), com empate pelo menor N.

### v4.0 → v4.1

1. **Acesso ao teste-2 (§3.2, §3.3):** três níveis de acesso; agregados só no Passo 0 e no congelamento, sem alimentar escolhas; o MDE lê o arquivo commitado.
2. **Isolamento de API (§3.2):** contexto v2 com lista branca, sem `base` nem `divisoes`; módulo `teste2.js`; `03-eda.js` proibido no Plano 3.
3. **Escore oficial (§4.1, §4.2):** cosseno arredondado em 6 casas, na mesma escala em todo lugar; filtro escore > 0 depois do arredondamento.
4. **`buscarColaborativos` (§5.2):** função nova, m até 300, sem erro com lista curta, empate no limite pelo escore arredondado.
5. **Fidelidade (§5.3):** completa na validação, incluindo S1; no teste-2, só medidas sem gabarito, mais top 10 idêntico e teto; medidas antes do preenchimento.
6. **Candidatos (§6):** uma busca M = 300 por usuário e fase; déficit real e de recuperação definidos e reportados.
7. **MDE (§8.3):** definição de `pop[j]`; usuários sem relevante saem da repetição e `n_r` é registrado; parâmetros da simulação; frase obrigatória na mesma escala e com a ressalva do `u1.test`.
8. **Escolha (§8.4):** chave completa do S0 e simplicidade da FC limitada a treino e ranqueamento.
9. **Congelamento (§9.1–§9.3):** `commitCodigo` com árvore limpa, `conferirCongelamento()` por `git diff`, regra para bug depois do congelamento.
10. **Limitações (§13):** redação conservadora sobre o `u1.test`; aproximação do HNSW no sistema avaliado.
