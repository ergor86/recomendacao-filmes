# Design: Recomendação de Filmes com Banco Vetorial

- **Data:** 2026-11-07 (versão 3.1: revisões externas da v2 e da v3, validadas com testes nos dados)
- **Versão 3.2 (2026-11-11):** revisão adversarial do Plano 2, com medições nos dados. Muda o perfil dos negativos sorteados (§6, §7.2), os sorteios por semente (§7.2), os negativos da validação (§7.3), a escala do mainstream × nicho (§9.4) e a contagem de usuários de validação (§9.3). As rejeições estão na §16
- **Status:** **congelada**. Qualquer mudança daqui em diante precisa de nova versão e justificativa
- **Ponto de partida:** [docs/contexto-projeto.md](../../contexto-projeto.md)

## 1. Objetivo e critério de sucesso

Sistema de recomendação de filmes em duas etapas sobre o MovieLens 100K:

1. **Geração de candidatos (híbrida):** os K filmes mais populares do treino que o usuário ainda não viu, unidos aos N filmes mais próximos do vetor do usuário no Postgres + pgvector (distância de cosseno).
2. **Ranqueamento:** uma rede neural densa (TensorFlow.js no Node) dá um score a cada candidato, e os 10 maiores formam o top 10.

**Hipótese principal (critério de sucesso):**
- O híbrido com rede (Exp. 4) supera a popularidade (Exp. 1) em **NDCG@10** no `u1.test`.
- "Supera" significa que o intervalo de confiança de 95% da diferença pareada por usuário (seção 9.4) **exclui zero**.

**Métricas complementares:**
- Precision@10 e recall@10 são reportadas e discutidas, mas não exigidas.
- Os Exp. 2, 3, 5, 6 e 7 são **descritivos**: servem para interpretar o resultado, sem afirmações de significância. Isso evita o problema de muitas comparações simultâneas.
- Se a busca vetorial não acrescentar valor, isso é registrado como resultado, não escondido.

**Cobertura dos objetivos do documento de partida:**
- **Objetivos 1 e 3 (usuários com histórico):** cobertos integralmente.
- **Objetivo 2:** coberto **parcialmente**. Os perfis de usuário no banco ficam para depois (seção 15).
- **Objetivo 3 para usuários novos:** o caminho existe, mas **não é medido**, porque todo usuário do `u1.test` tem histórico.

O projeto tem objetivo didático. Quando houver conflito, clareza e justificativa medida valem mais que desempenho máximo.

## 2. Decisões

| Tema | Decisão |
|---|---|
| "Gostou" | nota ≥ 4, fixo (treino e avaliação) |
| Candidatos | K populares **não vistos** ∪ N vizinhos vetoriais (não vistos); K e N escolhidos na validação (seção 9.1) |
| Vetor de busca do filme | gênero (19, normalizado) + época (3 faixas, normalizado) + popularidade (1, escalar); pesos 0,6 / 0,2 / 0,2; **23 dimensões** |
| Popularidade na busca | `log(1 + nºNotas)`, mín/máx da régua, cortada em [0, 1] |
| Popularidade na rede | o mesmo `log(1 + nºNotas)`, **z-score** com média e desvio da régua |
| Idade dos fãs | removida |
| Entrada da rede | features **sem pesos**, sem cosseno e sem fonte do candidato (seção 6) |
| Positivos de treino | **todos** os filmes com nota ≥ 4 do treino, não só os recuperados (seção 16) |
| Negativos | notas 1–3 (observados) + sorteados; comparados: uniforme × dos candidatos |
| Arquiteturas | 128→64→32 (referência) × 64→32 |
| Sementes | **3 sementes** por configuração treinada |
| Validação | usuários 463–943, 40% das notas escondidas, semente fixa |
| Teste | `u1.test` usado **uma única vez**, depois de congelar todas as escolhas por escrito |
| Banco | só vetores de filmes |
| Usuário novo | cadastro: idade, gênero, ocupação, 3 gêneros favoritos |
| Código | um script por etapa + módulos compartilhados |
| Local | `C:\dev\recomendacao-filmes`, fora do OneDrive |

## 3. Dados e divisões

- **Fonte:** o MovieLens 100K é baixado por script do site oficial (`https://files.grouplens.org/datasets/movielens/ml-100k.zip`), que confere o MD5 publicado pela GroupLens. Os arquivos são extraídos em `data/ml-100k/`.
- **Licença:** os dados **não vão para o repositório**, porque a licença proíbe redistribuição. Os testes usam dados sintéticos.
- **Leitura:** o `u.item` é lido em **latin-1**.
- **Citação obrigatória no README:** F. Maxwell Harper and Joseph A. Konstan. 2015. *The MovieLens Datasets: History and Context.* ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872

**Como o `u1` foi formado (verificado nos dados):**
- O `u1.test` contém as primeiras 20.000 linhas do `u.data`, que correspondem só aos usuários **1–462**.
- Cada usuário do teste tem em média cerca de 40% das notas escondidas.
- 456 usuários têm pelo menos um filme relevante.
- A divisão **não é temporal**.

**Divisões:**

| Conjunto | Conteúdo | Uso |
|---|---|---|
| treino-exp | `u1.base` menos as notas escondidas da validação | treino e régua durante os experimentos |
| validação | 40% das notas de cada usuário 463–943 (semente fixa) | todas as escolhas |
| treino-final | `u1.base` inteiro | régua final e modelos finais |
| teste | `u1.test` (usuários 1–462) | avaliação final, uma vez |

**Comparabilidade entre validação e teste (medida, a ser reproduzida na EDA):**

| | Teste (histórico no `u1.base`) | Validação (histórico no treino-exp) |
|---|---|---|
| Notas por usuário (média / mediana) | 70,4 / 40 | 59,2 / 38 |
| Curtidas por usuário (média / mediana) | 39,2 / 24 | 32,5 / 22 |
| Idade média | 33,9 | 34,2 |
| Mulheres | 28,4% | 29,5% |
| Popularidade média dos curtidos | 0,774 | 0,778 |
| P@10 da popularidade | 0,212 | 0,206 |

- As populações são comparáveis.
- A única diferença relevante é cerca de 16% menos histórico na validação, efeito dos 40% escondidos. Ela é registrada como limitação.

**Uso sem divisão:** o `u.item` e o `u.user` são usados inteiros, porque não contêm notas.

## 4. Arquitetura

### 4.1 Fluxo de recomendação

```
usuário (histórico ou cadastro)
  ──► features/   vetor de busca + entrada da rede (lendo a régua)
  ──► candidatos/ K populares não vistos ∪ N vizinhos não vistos (banco/)
  ──► modelo/     predict nos candidatos
  ──► top 10
```

### 4.2 Módulos

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `src/dados/` | ler os arquivos; montar as divisões da seção 3 | — |
| `src/features/` | calcular, salvar e carregar a régua; codificar filmes e usuários; montar pares | `dados/` |
| `src/banco/` | conexão, tabela, carga, busca (seção 8) | `pg` |
| `src/candidatos/` | populares não vistos; união com os vizinhos; orçamento efetivo | `banco/`, `features/` |
| `src/modelo/` | montar, treinar, salvar, carregar, predict | `@tensorflow/tfjs-node` |
| `src/avaliacao/` | métricas, bootstrap, análise por usuário | — (recebe listas) |

**Regra central:** só o `features/` monta vetores, e ele sempre lê uma régua salva.

### 4.3 Duas réguas

- **Régua-exp:** calculada com o treino-exp. Gera os vetores do banco e os pares durante os experimentos.
- **Régua-final:** calculada com o treino-final.
- **Hash no banco:** cada régua tem um hash. O hash da régua carregada é gravado na tabela `metadados` **por último, na mesma transação da carga**. Assim, uma carga interrompida não deixa um hash válido para trás.
- **Conferência:** toda busca confere o hash. Se ele diferir da régua do código, a busca para com erro.

## 5. Vetor de busca (pgvector)

### 5.1 Vetor do filme (23 dimensões)

| Bloco | Posições | Conteúdo | Tratamento | Peso |
|---|---|---|---|---|
| gênero | 19 | multi-hot do `u.item` | normalizado para tamanho 1 | 0,6 |
| época | 3 | one-hot: antes de 1980 / anos 80 / anos 90 | normalizado para tamanho 1 | 0,2 |
| popularidade | 1 | `log(1+n)` com mín/máx da régua, cortado em [0, 1] | **não normalizado** | 0,2 |

- **Dimensão:** a dimensão é lida da régua, nunca fixa no código.
- **Normalização segura:** um bloco zerado continua zerado. Isso acontece com o filme 267, que não tem data.
- **Nenhum vetor de filme fica totalmente zerado:** todo filme tem pelo menos um gênero.
- **Por que 3 faixas:** 8 décadas tiveram recall consistentemente **menor** nos dados (−0,3 a −0,5 ponto percentual na fonte vetorial, cerca de −0,2 na união) e não justificam um experimento (seção 16).

### 5.2 Vetor do usuário com histórico

- **Gênero:** média dos multi-hots dos filmes curtidos, normalizada, × 0,6.
- **Época:** média dos one-hots dos filmes curtidos, normalizada, × 0,2.
- **Popularidade:** média da popularidade dos filmes curtidos, × 0,2.
- **Usuário sem filme curtido** (1 caso nos dados): não tem vetor e recebe **só a fonte de populares**.

### 5.3 Vetor do usuário novo (cadastro)

- **Gênero:** 1/√3 em cada um dos 3 gêneros favoritos, × 0,6.
- **Época:** média dos one-hots de época de todas as curtidas da régua, normalizada, × 0,2.
- **Popularidade:** média da popularidade de todas as curtidas da régua (cerca de 0,754), × 0,2.

O vetor tem a mesma **estrutura e escala** do vetor de um usuário com histórico. Mas época e popularidade são **valores de referência da população**, não preferências conhecidas daquela pessoa. A qualidade da informação é menor.

### 5.4 Pesos e cosseno (texto obrigatório na documentação do código)

**Definição usada na implementação:**

```latex
V = [\,w_g G,\; w_e E,\; w_p P\,], \qquad \cos(u,f) = \frac{V_u \cdot V_f}{\lVert V_u\rVert\,\lVert V_f\rVert}
```

Na fórmula, G e E são os blocos já normalizados (um bloco zerado continua zerado) e P é a popularidade escalada.

**Forma geral expandida, que explica os pesos** (a definição oficial continua sendo a do vetor concatenado):

```latex
\cos(u,f) = \frac{w_g^2\,(G_u\cdot G_f) + w_e^2\,(E_u\cdot E_f) + w_p^2\,P_u P_f}{\sqrt{w_g^2\lVert G_u\rVert^2 + w_e^2\lVert E_u\rVert^2 + w_p^2 P_u^2}\;\sqrt{w_g^2\lVert G_f\rVert^2 + w_e^2\lVert E_f\rVert^2 + w_p^2 P_f^2}}
```

Na fórmula, ‖G‖² e ‖E‖² valem 1 (bloco normalizado) ou 0 (bloco zerado, como no filme 267).

> O cosseno ignora a escala do vetor inteiro: só as proporções entre os pesos importam (0,6 / 0,2 / 0,2 equivale a 3 / 1 / 1). Cada bloco normalizado contribui com **peso² × (cosseno dentro do bloco)**. A popularidade contribui com **peso² × p_usuário × p_filme** e também entra no denominador. Por isso 0,6 / 0,2 / 0,2 **não** significa 60% / 20% / 20%. Um bloco zerado sai automaticamente do produto e da norma.
>
> **Influência efetiva medida:** 73,6% gênero, 14,4% época e 12,0% popularidade. **Método:** participação de cada bloco no produto escalar V_u · V_f, calculada em cada par (usuário de validação com curtidas, filme relevante escondido) e depois em média simples sobre os 10.418 pares. Outros métodos dão outros números. Entre os 100 vizinhos mais próximos de cada usuário, por exemplo, a popularidade pesa cerca de 6%.

**Consequências documentadas:**
- **Popularidade:** na maioria dos pares, ela age como "mais popular = um pouco mais próximo". Em pares de gosto quase perfeito, ela age como "popularidade parecida com a do usuário".
- **Filmes com vários gêneros:** ficam um pouco menos próximos de quem gosta de um gênero só.

## 6. Entrada da rede (70 posições)

| Parte | Features | Posições |
|---|---|---|
| demografia | idade (z-score da régua), gênero (2), ocupação (21) | 24 |
| perfil do usuário | média dos gêneros curtidos (19), média da época (3), popularidade média (z-score) | 23 |
| filme | gêneros (19), época (3), popularidade (z-score) | 23 |

- **Sem pesos:** os pesos da busca não entram na rede.
- **Perfil nos pares:** o perfil depende do tipo de par.
  - **Positivos:** perfil **sem o filme do par**.
  - **Negativos sorteados (v3.2):** o **mesmo perfil do positivo** ao qual estão vinculados (blocos de 4 por positivo usável, §7.2). Assim positivos e sorteados de um bloco têm perfis idênticos, e a rede não consegue usar "perfil completo" como atalho para "negativo". Medido: o perfil sem o filme do par fica a 0,063 do completo, contra cerca de 0,26 entre usuários diferentes, uma diferença que a rede conseguiria separar.
  - **Negativos observados (notas 1–3):** perfil **completo**. O filme não é curtido, então tirá-lo não muda o perfil. O atalho que resta nesses pares fica registrado como limitação (§15).
  - **Pares de validação e inferência:** perfil **completo** em todos, porque nenhum desses filmes está no treino.
- **Popularidade do filme num par (sequência obrigatória, igual no treino, na validação e na inferência):**
  1. Pegar a contagem de notas do filme na régua em uso.
  2. Subtrair 1 **somente se** a nota do usuário para aquele filme faz parte do treino que gerou essa régua:
     - **régua-exp:** subtrair só se a nota está no treino-exp;
     - **régua-final:** subtrair só se a nota está no `u1.base`;
     - **notas escondidas da validação e notas do `u1.test`:** **nunca** subtrair, porque não participaram da contagem.
  3. Aplicar `log(1 + n)`.
  4. Aplicar o z-score com a média e o desvio **guardados na régua** (calculados sobre os 1.682 filmes). Eles nunca são recalculados por par.

  O vetor de busca (seção 5) usa a contagem da régua sem esse desconto, porque é um vetor por filme.
- **Usuário novo:** perfil vindo do cadastro. Os gêneros são 1/3 em cada favorito, e época e popularidade são médias da população.
- **Usuário com histórico, mas sem nenhum filme curtido:** recebe os mesmos valores de referência da população no perfil (gêneros = média da população), em vez de uma divisão 0/0. Hoje é só o usuário 685, da validação, que já fica fora das métricas por não ter relevantes.
- **Modelo de controle (Exp. 7):** remove as **duas** features de popularidade (a do perfil e a do filme), e a entrada fica com 68 posições.
- **Features excluídas de propósito:** cosseno da busca e fonte do candidato. Com negativos sorteados dos candidatos, elas virariam um sinal falso.

## 7. Treino

### 7.1 Pares e correção de vazamento

- **Positivos:** **todos** os filmes com nota ≥ 4 do treino em uso.
- **Negativos observados:** notas 1–3 do treino em uso.
- **Popularidade sem a nota do usuário:** para **todo** filme que o usuário u avaliou **no treino em uso**, seja positivo ou negativo observado, a popularidade do par usa a contagem menos 1 (sequência da seção 6). Na recomendação, nenhum candidato inclui uma nota de u. Sem esse desconto, os negativos observados pareceriam mais populares, e a rede aprenderia que "popular = não gostou".
- **Escolha consciente: todos os positivos.** A rede aprende a compatibilidade usuário-filme com **todos** os positivos, inclusive filmes que a geração de candidatos não recuperaria. Ela só consegue ordenar o que chega até ela, e essa limitação é medida à parte pelo recall dos candidatos (Exp. 3). A alternativa foi testada e rejeitada (seção 16).
- **Perfil sem o filme do par:** em cada par positivo (u, f), o perfil de u é `(soma − f) / (quantidade − 1)`. Se u tem só 1 filme curtido, o par é **descartado**.
- **Validação:** as notas escondidas nunca entram em perfis nem em contagens.

### 7.2 Negativos sorteados

Proporção: **4 sorteados por positivo usável** (depois de descartar os pares de usuários com só 1 curtido), além dos observados.
- **Forma do sorteio (v3.2):** para cada positivo usável, sorteiam-se **4 negativos vinculados a ele**, **com reposição**, que recebem o perfil desse positivo (§6). A versão 3.1 dizia que o vínculo não tinha efeito; isso só vale para as quantidades, não para o perfil (§16).
- **Sementes dos sorteios (v3.2):** o sorteio de treino **varia com a semente da rede** (1, 2, 3), em espaços de semente separados dos usados nas divisões, porque o resultado mede o procedimento de treino e o sorteio faz parte dele. O modelo escolhido e o controle da mesma semente usam os mesmos negativos.
- **Por que com reposição:** o conjunto de candidatos tem cerca de 280 filmes, e **70 usuários no treino-exp (133 no treino final) precisariam de mais negativos do que isso**. Um usuário precisaria de mais que o catálogo não visto até no sorteio uniforme. Quem tem muitas curtidas repete negativos difíceis, e isso fica documentado.

São comparadas duas formas de sortear:
- **Uniforme:** do catálogo.
- **Dos candidatos:** 3 em cada 4 vêm dos candidatos do usuário na maior configuração da grade (K = 200 populares não vistos ∪ N = 100 vizinhos não vistos, calculados com o vetor completo do usuário no treino). O restante vem do catálogo. A maior configuração contém as menores.
  - No treino final, esses candidatos são **recalculados** com a régua-final e o `u1.base`.

**Regra de exclusão (o que nunca pode ser sorteado):**

| Pares | Excluir |
|---|---|
| treino nos experimentos | filmes avaliados pelo usuário **no treino-exp** |
| treino final | filmes avaliados pelo usuário **no `u1.base`** |
| validação | **todos** os filmes avaliados pelo usuário (treino-exp + validação) |

- **Treino:** consulta só o que o treino conhece. Medido nos dados: excluir também as notas escondidas inflaria o NDCG da validação em 0,009 a 0,014.
- **Falsos negativos:** um filme escondido pode, ocasionalmente, ser sorteado como negativo no treino. Isso é o mesmo que acontece com os filmes do `u1.test` no treino final, então as duas fases ficam coerentes.
- **Pares de validação:** o rótulo nunca pode contradizer uma nota conhecida.
- Toda semente é determinada e registrada: nenhum sorteio usa aleatoriedade sem semente.

### 7.3 Pares de validação e parada automática

- **Pares de validação** (não usar `validationSplit`):
  - notas escondidas 4–5 são **positivos**;
  - notas escondidas 1–3 são **negativos observados** (exemplos, não apenas filmes a excluir);
  - os negativos adicionais seguem o **mesmo esquema** (uniforme ou dos candidatos) e a mesma proporção do treino daquele modelo, com outra semente;
  - nunca é sorteado um filme que o usuário avaliou no treino-exp ou na validação;
  - **(v3.2)** nem um filme sorteado como negativo para aquele usuário **no treino da mesma semente**. Sem isso, no esquema dos candidatos os pares de validação repetiriam pares de treino (um candidato já tinha sido sorteado no treino em 27,7% das vezes, contra 7,7% no uniforme), e a perda de validação premiaria a memorização. Se não sobrar candidato elegível, o sorteio vem do catálogo, e a quantidade é registrada. A regra só consulta o treino, então não contradiz a §16.
- **Parada automática:** sobre o erro nos pares de validação **amostrados**, com paciência de 3. É uma aproximação: o critério de escolha continua sendo o NDCG@10.
- **Melhores pesos:** o `earlyStopping` do TF.js **não** restaura os melhores pesos. Sem cuidado, o modelo seria avaliado 3 épocas depois do melhor ponto. Regras por fase:
  - **Validação:** um *callback* guarda uma cópia dos pesos a cada melhora do erro de validação e **restaura essa cópia ao final do treino**. O NDCG é medido com os pesos restaurados da melhor época.
  - **Treino final:** cada semente treina exatamente o número de épocas da **sua** melhor época registrada na validação, sem parada automática e sem consultar o teste.
  - **API:** usa o modelo final da semente 1, conforme decidido antes do teste.
- **Épocas:** **cada modelo e cada semente**, inclusive o controle, registram a própria melhor época. O treino final usa mais dados (o treino-final) com esse mesmo número de épocas, o que é prática aceita e fica registrado.
- **Comparação entre tipos de negativos:** o erro de validação **não** é comparado entre tipos diferentes, porque as distribuições de negativos diferem. A comparação é feita só pelo NDCG.

### 7.4 Configuração da rede

- Camadas ocultas `relu`, saída de 1 neurônio `sigmoid`, perda `binaryCrossentropy`.
- `adam` com learning rate 0,001 explícito.
- Lote de 256.
- **Sementes:** 3 por configuração (1, 2, 3). A semente controla os pesos iniciais, o embaralhamento e, desde a v3.2, o sorteio dos negativos (§7.2).
- `model.summary()` impresso a cada treino.

### 7.5 Artefatos

```
modelos/<nome>-s<semente>/  model.json · weights.bin · regua.json · metadados.json
```

O `metadados.json` guarda: arquitetura, tipo de negativos, semente, épocas, hash da régua, data e métricas de validação.

## 8. Banco (Postgres + pgvector)

- **Infraestrutura:** `docker-compose.yml` com `pgvector/pgvector` numa **tag exata** (série 0.8 com Postgres 17), registrada na etapa 1.
  - Volume nomeado.
  - Porta `5433:5432`.
  - `.env` e `.env.example`.
  - Requisito: Docker Desktop com WSL2.
- **Tabela e carga:** feitas numa única transação, com a dimensão lida da régua:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
DROP TABLE IF EXISTS filmes;
CREATE TABLE filmes (id integer PRIMARY KEY, titulo text NOT NULL, ano integer, embedding vector(<dim>) NOT NULL);
-- inserção de todos os filmes
CREATE INDEX filmes_embedding_idx ON filmes USING hnsw (embedding vector_cosine_ops);
CREATE TABLE IF NOT EXISTS metadados (chave text PRIMARY KEY, valor text);
INSERT INTO metadados VALUES ('hash_regua', $hash) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;  -- por último
COMMIT;
```

- **Busca:** um único cliente (`pool.connect()`), dentro de uma transação:

```sql
BEGIN;
SELECT set_config('hnsw.ef_search', $1, true);      -- SET não aceita parâmetro; ≥ N
SET LOCAL hnsw.iterative_scan = strict_order;
SELECT id, embedding <=> $2::vector AS distancia
FROM filmes WHERE id <> ALL($3::int[])
ORDER BY embedding <=> $2::vector LIMIT $4;
COMMIT;   -- client.release() em finally
```

- **Regras:**
  - vetores enviados com `JSON.stringify`;
  - N ≤ 100, o máximo da grade;
  - o resultado precisa ter o número pedido de linhas, ou o código para com erro. Sem alternativa silenciosa: na prática isso nunca acontece (sobram pelo menos 997 filmes elegíveis e o limite de varredura é 20.000), e uma alternativa silenciosa mudaria os candidatos sem aviso.
- **Parâmetros registrados nos resultados:** `hnsw.ef_search`, `hnsw.iterative_scan`, `hnsw.max_scan_tuples` e `hnsw.scan_mem_multiplier`.
- **Desempate reprodutível (feito no código, não no SQL):** empates são frequentes. 715 filmes têm vetor idêntico a outro, e há empate exatamente no corte de N para 57 a 146 usuários. Acrescentar `, id` ao `ORDER BY` faria o pgvector **abandonar o índice HNSW**. Procedimento:
  1. A consulta pede **N + 50** linhas.
  2. O código reordena por (distância, id).
  3. O código verifica se o empate do limite está **inteiro** dentro do que foi recebido, isto é, se a distância da N-ésima linha é **menor** que a da última linha recebida.
  4. Se não estiver, repete a consulta pedindo o dobro de linhas (até 1.000). Se ainda assim não estiver, para com erro.
  5. Fica com as N primeiras.
  - **Limitação:** o desempate pelo id garante determinismo **dentro do conjunto que o índice devolveu**. Ele não transforma o HNSW numa busca exata. A diferença em relação à busca exata é medida pela verificação do HNSW.
- **Verificação do HNSW:** os dois braços usam **a mesma consulta e os mesmos filtros**.
  - **Braço HNSW:** `SET LOCAL enable_seqscan = off`.
  - **Braço exato:** `SET LOCAL enable_indexscan = off`.
  - Antes de medir, o `EXPLAIN` confirma "Index Scan" num braço e "Seq Scan" no outro.
  - **Métrica:** a proporção dos vizinhos exatos que o índice recuperou, em média sobre os usuários de validação.
  - **Resultado esperado:** perda próxima de zero. É uma verificação.

## 9. Experimentos

### 9.1 Validação: uma variável por vez

| Passo | Variável | Fixo | Critério | Treinos |
|---|---|---|---|---|
| 1 | negativos: uniforme × dos candidatos | arquitetura 128→64→32 | NDCG@10 do híbrido com K = 200, N = 100 | 2 × 3 sementes |
| 2 | arquitetura: 128→64→32 × 64→32 | negativos do passo 1 | NDCG@10, mesma configuração | 1 × 3 (o braço 128→64→32 reaproveita o passo 1) |
| 3 | K ∈ {50, 100, 150, 200} × N ∈ {0, 20, 50, 100} | modelos do passo 2, **congelados** | NDCG@10 do híbrido + rede | 0 |
| 4 | controle: rede sem as features de popularidade (68 entradas) | o resto escolhido | comparação descritiva com o passo 3 | 1 × 3 |

- **Por que o NDCG do sistema completo no passo 3:** o recall dos candidatos favorece sempre N = 0 (verificado). Se N = 0 vencer pelo NDCG, isso é resultado.
- **NDCG por usuário:** é a **média das 3 sementes**.
- **Regra de escolha (operacional):**
  1. Calcular o NDCG@10 médio de cada configuração. A melhor é a de maior média.
  2. Uma configuração c **empata** com a melhor b se `NDCG(b) − NDCG(c) < 1 erro padrão da diferença pareada por usuário entre b e c`. A diferença de cada usuário usa a média das 3 sementes, e SE = desvio padrão amostral (n − 1) dessas diferenças / √nº de usuários. É um **critério operacional de seleção**, não um teste de equivalência: não afirma que as configurações têm o mesmo desempenho.
  3. Entre as empatadas (incluindo b), escolher a **mais simples**:
     - negativos: uniforme;
     - arquitetura: 64→32;
     - grade: o menor K + N e, persistindo o empate, o menor N.
- **Congelar:** as escolhas vão para `resultados/configuracao-final.json` **antes** de qualquer contato com o `u1.test`.

### 9.2 Avaliação final no `u1.test`

**Sequência:**
1. Régua-final.
2. Recarga do banco.
3. Retreino com o treino-final, com as épocas registradas por modelo: modelo escolhido × 3 sementes e controle × 3 sementes.
4. Avaliação, uma única vez.

| # | Experimento | Nível medido |
|---|---|---|
| 1 | Popularidade: top 10 populares não vistos | top 10 |
| 2 | Só vetores, ordem por distância (sem o usuário sem curtidas, contagem informada) | top 10 + recall dos candidatos |
| 3 | Híbrido sem rede | candidatos: recall da união + contribuição exclusiva de cada fonte |
| 4 | **Híbrido + rede** (hipótese principal) | top 10 |
| 5 | Populares + rede, com o **mesmo número efetivo de candidatos únicos do Exp. 4, usuário a usuário** (depois da união, da deduplicação e da exclusão dos vistos) | top 10 |
| 6 | Rede sem filtro de candidatos (todos os filmes não vistos) | top 10 |
| 7 | Híbrido + rede **sem features de popularidade no ranqueador** (a popularidade continua na geração de candidatos) | top 10 |

- **Sementes:** são **repetições experimentais**, sem ensemble. O resultado do teste mede o **procedimento de treino** (média das 3 sementes por usuário, com mínimo e máximo por semente reportados à parte). O modelo usado na API é o da **semente 1**, declarado em `configuracao-final.json` (`seed_api = 1`) antes do teste.
- **Se N = 0 vencer na grade** (decidido antes): o Exp. 2 usa N = 100 para o recall dos candidatos e os 10 primeiros vizinhos para o top 10; a contribuição exclusiva é reportada como zero por construção; o Exp. 5 é reportado como idêntico ao Exp. 4.
- **Contribuição exclusiva:** a fração dos acertos do Exp. 4 vindos de filmes trazidos **só** pela fonte vetorial.
- **Exp. 6 não é um teto:** a rede foi treinada com negativos dos candidatos e pode ir pior no catálogo inteiro.
- **Orçamento efetivo:** é reportado junto, por exemplo cerca de 144 candidatos para K = 100, N = 50 e cerca de 278 para K = 200, N = 100.

### 9.3 Métricas

- **Relevância binária:** nota ≥ 4 no conjunto avaliado vale 1; qualquer outro filme vale 0.
- **Exclusão:** os já vistos no treino saem das recomendações.
- **Definições** (para o top 10 de um usuário com o conjunto de relevantes R):
  - precision@10 = acertos / **10** (sempre 10);
  - recall@10 = acertos / |R|;
  - NDCG@10 = DCG / IDCG, com **ganho binário**, DCG = Σ rel_i / log₂(i + 1) nas posições 1..10, e IDCG calculado sobre min(|R|, 10) acertos nas primeiras posições.
  - Todo usuário tem pelo menos 50 candidatos (K ≥ 50 populares não vistos), então o top 10 sempre tem 10 filmes (verificado).
- **Ordenação reprodutível:** popularidade por (contagem decrescente, id crescente); scores da rede e distâncias por (valor, id crescente). Entre os 200 mais populares só há cerca de 106 contagens distintas, e sem desempate o K-ésimo filme mudaria entre execuções para 181 a 358 usuários.
- **Usuários sem relevantes:** ficam fora de **todas** as métricas, inclusive a precision. As contagens são calculadas pelo código, nunca fixadas. Valores medidos: 478 na validação (685, 797 e 814 não têm relevantes; v3.2) e 456 no teste (446, 459 e 460 não têm relevantes).
- **Métricas:** NDCG@10 (principal), precision@10 e recall@10.
  - **Nos experimentos com rede:** o valor de cada usuário é a média das 3 sementes.
  - **Variação entre sementes:** reportada à parte (mínimo e máximo).
- **Diversidade (só medida):**
  - **Cobertura:** nº de filmes distintos em algum top 10, dividido por **1.682**.
  - **Popularidade média do top 10.**

### 9.4 Análise estatística e por usuário

- **Unidade de análise:** o **usuário**. Para cada usuário, calcula-se a diferença da métrica entre dois sistemas, usando a média das 3 sementes quando há rede. Usuários × sementes **nunca** são tratados como observações independentes.
- **Intervalo de confiança:** *bootstrap* pareado percentil de 95%, com **5.000** reamostragens dos usuários e semente fixa (registrada em `resultados/`).
- **Mainstream × nicho:**
  - **Classificação:** pela popularidade média dos filmes curtidos, calculada **só com o treino** de cada usuário.
  - **Escala (v3.2):** média de `popEscalada` (log, mín/máx da régua do conjunto, [0, 1]) dos filmes curtidos, a mesma da EDA. Fixada por escrito em `configuracao-final.json` antes do teste e calculada também na validação. Medido: trocar a escala muda 54 dos 478 usuários de grupo.
  - **Corte:** a **mediana de cada conjunto avaliado**, na escala da régua desse conjunto, calculada entre os usuários que entram nas métricas. A mediana da validação não é congelada para o teste, porque as réguas têm escalas diferentes. Quem cair exatamente na mediana vai para "mainstream".
  - **Interpretação:** os grupos são **relativos a cada conjunto**: usuários mais mainstream ou mais de nicho **que os seus pares naquele conjunto**. Não são categorias com um limiar absoluto igual na validação e no teste.
  - **Usuários sem curtidas:** ficam fora do corte, e a contagem é informada.
  - **Reportado:** o tamanho de cada grupo e os resultados de cada grupo separadamente.
  - **Hipótese descritiva:** a fonte vetorial ajuda mais os usuários de nicho.
- **Registro:** os resultados vão para `resultados/`, um JSON por experimento.

## 10. Testes e tratamento de erros

**Testes (`node:test`):** cobrem as partes em que um erro não geraria nenhum aviso por conta própria. O teste é o que transforma esse erro silencioso numa falha visível.

- **Codificação:** gêneros, normalização dos blocos, popularidade cortada em [0, 1], normalização segura de um bloco zerado e z-score da rede com os parâmetros da régua.
- **Usuário novo:** 1/√3 nos gêneros.
- **Régua:** salvar e carregar produz vetores idênticos. O hash muda quando a régua muda.
- **Vazamento:**
  - perfil sem o filme do par nos positivos, o mesmo perfil do positivo nos 4 sorteados vinculados a ele e perfil completo nos negativos observados e nos pares de validação (v3.2);
  - popularidade descontada para **todo** filme avaliado pelo usuário;
  - par descartado quando o usuário tem só 1 curtido.
- **Popularidade nos pares:** subtrai 1 só quando a nota está no treino da régua. Nada é subtraído para notas da validação ou do teste.
- **Negativos:** as regras de exclusão da seção 7.2, mais a da §7.3 v3.2 (nos pares de validação, nada sorteado para o usuário no treino da mesma semente); sorteio com reposição e quantidade = 4 × positivos usáveis.
- **Desempates:** a busca com empate no corte de N devolve sempre os mesmos ids. A popularidade é ordenada por (contagem, id).
- **Melhores pesos:** num treino sintético em que o erro de validação piora depois de uma época conhecida, os pesos restaurados são **idênticos** aos guardados nessa época, e não aos da última.
- **Desempate na busca:** quando o empate do limite não cabe nas N + 50 linhas, a consulta é ampliada; se ainda não couber, o código para com erro.
- **Perfil sem curtidas:** usa valores de referência e nunca gera NaN.
- **Candidatos:** K conta só populares não vistos. O Exp. 5 recebe o mesmo nº efetivo de candidatos do Exp. 4 para cada usuário.
- **Divisão:** validação e teste sem usuários em comum.
- **Métricas:** precision, recall e NDCG feitos à mão. A média por usuário é calculada sobre as sementes.
- **Vetores válidos:** nenhum NaN, e nenhum vetor de busca de usuário zerado.
- **Leitura:** latin-1 com um arquivo sintético.
- **Banco** (integração): ordem esperada, exatamente N linhas e erro quando o hash diverge.

**Erros:** falhar alto, com uma mensagem que diz o que fazer, quando:
- as dimensões não batem;
- a busca devolve menos de N linhas;
- o hash da régua diverge;
- a régua não existe;
- o banco não responde;
- aparece NaN.

## 11. Diferenças em relação ao projeto de referência

| Aspecto | Referência (e-commerce) | Este projeto |
|---|---|---|
| Vetor do usuário | média dos itens, incluindo a idade média dos compradores | blocos normalizados, sem idade; idade real só na rede |
| Pesos | multiplicam as features da rede | só na busca |
| Entrada da rede | `[usuário, item]` | demografia + perfil + filme |
| Negativos | todos os não comprados | observados + sorteados (uniforme × candidatos) |
| Learning rate | 0,01 | 0,001, explícito |
| Persistência | nenhuma | modelo + régua + metadados |
| Candidatos | todos os itens | híbridos (populares não vistos ∪ pgvector) |

## 12. Ambiente, repositório e reprodutibilidade

- **Local:** `C:\dev\recomendacao-filmes`.
- **Repositório:** o `.gitignore` é criado antes do `git init`. Ficam de fora: `data/`, `*.zip`, `.env`, `node_modules/`, `modelos/` e `*.log`. A pasta `resultados/` vai para o repositório.
- **Versões fixas:** tag exata da imagem, `package-lock.json` (que fixa a versão do `tfjs-node`), e a versão do Node em `.nvmrc` e `engines`.
- **Teste do `tfjs-node` na etapa 1:** `tf.backend()` e um `fit` pequeno.
  - Se falhar, plano B: TF.js puro em JS, com um *save handler* próprio, ou o Node no Docker.
  - Caminhos: `'file://' + path.resolve(...)`.
- **Sementes:** em todos os sorteios, nos pesos iniciais, no embaralhamento e no bootstrap.
- **README:** passo a passo e a citação do MovieLens.

## 13. Custo computacional estimado

- **Validação:** 12 treinos (passo 1: 6; passo 2: 3; passo 4: 3).
- **Final:** 6 treinos (modelo escolhido × 3; controle × 3).
- **Tempo:** na CPU, com cerca de 200 mil pares e parada automática, a expectativa é de algumas horas no total. A etapa 1 mede o tempo real de um treino.

## 14. Roteiro

| Etapa | Entrega | Como verificar |
|---|---|---|
| 1. Ambiente | `C:\dev`, git, Docker, `baixar-dados` com MD5, teste e tempo do tfjs-node | versão do pgvector; `fit` pequeno roda |
| 2. EDA | estatísticas + a tabela de comparabilidade da seção 3 | números próximos aos da seção 3 |
| 3. Divisões e régua | divisões; régua-exp; codificação; testes | testes passam |
| 4. Banco | carga transacional com hash; busca; verificação do HNSW | N linhas; perda ≈ 0 |
| 5. Linha de base e métricas | popularidade; NDCG/P/R@10; cobertura; bootstrap | P@10 da popularidade ≈ 0,21 na validação |
| 6. Candidatos | populares não vistos, vetores, união, orçamento efetivo | recall por fonte; contribuição exclusiva |
| 7. Treino | pares com vazamento corrigido; passos 1 e 2 da seção 9.1 | curvas de erro; NDCG@10 por semente |
| 8. Grade, controle e congelamento | passo 3; passo 4 na configuração escolhida; `configuracao-final.json` | arquivo gravado antes do teste |
| 9. Avaliação final | régua-final, recarga, 6 retreinos, os 7 experimentos, bootstrap, análise por grupo | tabela final + intervalos |
| 10. (Opcional) API e interface | `src/api/` + front | cadastro → top 10 |

## 15. Limitações e melhorias futuras

**Limitações:**
- **Divisão aleatória, não temporal:** a popularidade pode incluir notas posteriores ao momento da recomendação.
- **Coleta do MovieLens:** favorece filmes populares.
- **Histórico da validação:** cerca de 16% menor que o do teste.
- **Usuário novo não medido:** a rede nunca treinou com perfis vindos de cadastro.
- **Falsos negativos:** os negativos sorteados (principalmente os dos candidatos) podem incluir filmes de que o usuário gostaria.
- **Parada automática aproximada:** usa o erro em pares amostrados, não o NDCG.
- **Só 3 sementes:** a variação entre sementes é estimada com poucas repetições.
- **Perfil dos negativos observados (v3.2):** continuam com o perfil completo, enquanto positivos e sorteados usam o perfil sem o filme do positivo. A rede ainda pode usar essa diferença como atalho nos cerca de 27 mil pares observados.
- **Falsos negativos concentrados:** no treino final, os usuários do teste têm um pouco mais de falsos negativos nos candidatos (29,6%) que os de validação (27,7%), então a validação subestima levemente esse efeito.

**Melhorias futuras:**
- **Vetores aprendidos (duas torres)** como fonte vetorial, comparados com os feitos à mão.
- Perfis de usuário no banco e recuperação por usuários parecidos.
- Simulação de usuário novo; cadastro avaliando filmes.
- MMR; IPS; divisão temporal; validação cruzada com `u2`–`u5`.
- Nota média bayesiana; limite de "gostou" relativo à média do usuário.

## 16. Decisões rejeitadas, com evidência

| Proposta | Decisão | Evidência (medida na validação) |
|---|---|---|
| Treinar a rede só com positivos recuperados pela geração de candidatos | rejeitada | perde 30% dos positivos, sobretudo de nicho (usuários de nicho perdem 38,5%; 3 perdem todos). Cobertura do top 10 cai de 211 para 130 filmes. NDCG entre −0,006 e 0. Recomendações mais populares. Os rótulos do MovieLens existem independentemente da busca, então o argumento de "exposição" não se aplica |
| Escolher a época (3 faixas × 8 décadas) pelo NDCG do sistema completo | substituída por 3 faixas fixas | 3 faixas vence em recall de forma consistente (z ≈ −4 a favor), por ≤ 0,5 ponto percentual. Escolher pelo NDCG custaria réguas, cargas e treinos extras para uma diferença dessa ordem |
| Excluir dos negativos de treino os filmes da validação | rejeitada | consulta informação escondida e infla o NDCG da validação em 0,009 a 0,014 |
| Popularidade no vetor com normalização própria (1 posição) | rejeitada | um bloco de 1 posição normalizado vira constante 1 e perde a informação |
| Fixar a versão do `tfjs-node` à parte | desnecessária | o `package-lock.json` já fixa |
| Ensemble das 3 sementes no sistema final | rejeitada | seria um 8º sistema, sem validação. As sementes são repetições experimentais, e a API usa a semente 1, declarada antes do teste |
| Congelar a mediana mainstream × nicho da validação para o teste | rejeitada | as réguas têm escalas diferentes. Congelar mudaria 15 usuários de grupo sem ganho para uma hipótese relativa |
| Negativos sem reposição | rejeitada | inviável: 70 usuários (133 no treino final) precisariam de mais negativos do que os ~280 candidatos |
| Recorrer à busca exata quando o HNSW devolve menos de N | rejeitada | nunca acontece na prática (≥ 997 elegíveis), e uma alternativa silenciosa mudaria os candidatos e contaminaria a verificação do HNSW |
| Desempate pelo id dentro do SQL | rejeitada | faz o pgvector abandonar o índice HNSW. O desempate é feito no código |
| Negativos sorteados iguais para as 3 sementes da rede (v3.2) | substituída | o sorteio faz parte do procedimento medido; com um sorteio só, o passo 1 (que compara esquemas de sorteio) dependeria da sorte de um único sorteio |
| Perfil completo também nos negativos sorteados (v3.1) | substituída na v3.2 | cria um atalho: o perfil sem o filme do par fica a 0,063 do completo, contra 0,26 entre usuários, e a rede aprenderia "perfil completo = negativo" e um sinal invertido no gênero do filme |
| Treino final com a mediana das melhores épocas das 3 sementes (v3.2) | rejeitada por ora | seria menos ruidoso, mas a regra de cada semente com a própria época já está decidida e não há medição mostrando ganho; fica como melhoria futura |
