# Recomendação de filmes

MovieLens 100K + Postgres/pgvector + TensorFlow.js. Spec em `docs/superpowers/specs/`.

## Passo a passo

### 1. Docker Engine no WSL2 Ubuntu (uma vez)

Docker Engine no WSL2 Ubuntu; Docker Desktop com backend WSL2 também funciona.

    # uma vez, dentro do Ubuntu/WSL
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    # no PowerShell: wsl --shutdown   (reabra o Ubuntu)

### 2. Clonar o projeto em `C:\dev\recomendacao-filmes`

Projeto no Windows: o Node roda aqui; o WSL2 encaminha a porta 5433 para localhost.

    # PowerShell, na pasta C:\dev
    git clone <url-do-repositório> recomendacao-filmes
    cd recomendacao-filmes

### 3. Criar o `.env`

    cp .env.example .env

Edite `PGPASSWORD` no `.env` antes de subir o banco.

### 4. Subir o banco (dentro do WSL)

O compose lê o `.env` criado no passo 3, por isso este passo vem depois dele.

    # dentro do WSL, na pasta do projeto
    cd /mnt/c/dev/recomendacao-filmes
    docker compose up -d

### 5. Instalar dependências

    npm install            # o postinstall (scripts/preparar-tfjs.js) cuida da tensorflow.dll no Windows

### 6. Baixar os dados

    npm run baixar-dados   # baixa e extrai o MovieLens 100K em data/ml-100k

### 7. Verificar o ambiente e rodar os testes

    npm run ambiente       # verifica TensorFlow.js e banco
    npm test

### 8. Análise exploratória

    npm run eda            # precisa dos dados (passo 6); só imprime no terminal, não grava arquivo

### 9. Carregar os filmes no banco (fase exp)

    npm run carregar-filmes   # precisa do banco (passo 4); grava artefatos/regua-exp.json e carrega public.filmes com a régua da fase exp

Não rode `npm run carregar-filmes -- --fase final` antes dos passos 10 a 12: eles exigem o banco carregado com a fase exp.

### 10. Verificar o HNSW

    npm run verificar-hnsw    # precisa do passo 9; grava resultados/verificacao-hnsw.json

### 11. Linha de base de popularidade

    npm run linha-de-base     # precisa dos dados e do passo 9 (régua); grava resultados/linha-de-base-validacao.json

### 12. Candidatos híbridos (populares + vizinhos)

    npm run candidatos        # precisa do banco carregado com a fase exp (passo 9); grava resultados/candidatos-validacao.json

### 13. Testes de integração

    npm run test:integracao   # precisa do banco; cria e remove os schemas teste_integracao e teste_busca (e teste_busca_vazio), sem tocar em public.filmes

Resultados versionados em `resultados/`: `verificacao-hnsw.json`, `linha-de-base-validacao.json`, `candidatos-validacao.json` e, a partir do Plano 2, os arquivos de treino, comparação, grade, configuração final e `avaliacao-final.json`. O Plano 3 acrescenta os arquivos `*-v2-*.json`, `divisoes-v2.json`, `mde-v2.json`, `configuracao-v2.json` e `avaliacao-v2.json` (ver a seção do Plano 3 abaixo).

### Reprodutibilidade do HNSW

A reprodutibilidade vale por construção do índice: o pgvector sorteia o nível dos nós ao construir o HNSW. Rodar de novo `verificar-hnsw` ou `candidatos` sobre a mesma carga dá resultados idênticos, mas depois de `npm run carregar-filmes` (que reconstrói o índice) os números baseados em HNSW podem mudar levemente. A busca exata e a linha de base não dependem disso.

## Plano 2: treino da rede

### Treinar (`npm run treinar`)

    npm run gerar-candidatos -- --fase exp   # precisa do banco na fase exp; grava artefatos/candidatos-exp.json
    npm run treinar -- --fase exp --negativos uniforme|candidatos --arquitetura 128-64-32|64-32 [--sem-pop]

O script 09 não usa o banco nem lê o `u1.test`. Ele treina as sementes 1, 2 e 3. Para cada uma, grava o modelo em `modelos/<nome>-<fase>-s<semente>/` e atualiza `resultados/treino-<nome>-<fase>.json` (`nome` = `<negativos>-<arquitetura>[-sempop]`). Cada execução acrescenta uma linha em `resultados/diario-treinos.jsonl`. Na primeira execução de um `nome` numa fase, o motivo registrado é `planejado`. Se o diário já tem uma linha com o mesmo `nome` e a mesma fase, a execução é um retreino fora do plano: o script se recusa a começar (antes de montar os pares) sem `--motivo "<texto>"`. Use `--saida <pasta>` para rodar um teste de fumaça sem tocar em `modelos/`, `resultados/` e no diário, e `--max-epocas <n>` para trocar o teto de 50 épocas.

Na fase `exp`, o treino para sozinho: depois de 3 épocas sem melhora na perda de validação, ele restaura os pesos da melhor época. Na fase `final`, não há validação, então cada semente treina exatamente a melhor época que teve na `exp`:

    npm run treinar -- --fase final --negativos <...> --arquitetura <...> --epocas-de resultados/treino-<nome>-exp.json

### Por que o treino final usa épocas fixas (e o que isso significa)

O treino final usa o `u1.base` inteiro, sem esconder as notas da validação. Por isso ele tem cerca de 31% mais pares em cada época. Os números abaixo foram medidos com a semente 1 e o esquema uniforme. A contagem de pares é a mesma nos dois esquemas e em todas as sementes, porque o sorteio muda quais filmes entram, mas não quantos.

| Fase | Notas no treino | Pares de treino | Positivos | Sorteados (4 por positivo) | Observados (nota 1–3) | Passos de gradiente por época (lote 256) |
|---|---|---|---|---|---|---|
| `exp` | 61.012 | 195.847 | 33.709 | 134.836 | 27.302 | 766 |
| `final` | 80.000 | 256.555 | 44.139 | 176.556 | 35.860 | 1.003 (+31%) |

Repetir na fase final o mesmo número de épocas da `exp` dá cerca de 31% mais passos de gradiente. Ou seja, a rede final treina um pouco mais do que a rede escolhida na validação. A alternativa seria fixar o número de passos, mas aí a rede veria cada exemplo menos vezes. O plano fixa as épocas e registra `passosDeGradiente` em cada `treino-*.json`, para que a diferença fique visível.

## Avaliação final no `u1.test` (feita uma única vez, em 2026-11-12)

A configuração foi congelada em `resultados/configuracao-final.json` antes de qualquer contato com o teste: negativos dos candidatos, arquitetura 64→32, K = 150 populares e N = 0 vizinhos. O modelo é `candidatos-64-32` e o controle sem popularidade é `candidatos-64-32-sempop`. A sequência rodada foi esta:

    npm run carregar-filmes -- --fase final      # régua-final (hash b994e671…) e recarga do banco
    npm run gerar-candidatos -- --fase final     # 943 usuários; populares 200/200; vizinhos 0/100 (1 usuário sem vizinhos)
    npm run treinar -- --fase final --negativos candidatos --arquitetura 64-32 --epocas-de resultados/treino-candidatos-64-32-exp.json
    npm run treinar -- --fase final --negativos candidatos --arquitetura 64-32 --sem-pop --epocas-de resultados/treino-candidatos-64-32-sempop-exp.json
    npm run avaliacao-final                      # uma vez; grava resultados/avaliacao-final.json e se recusa a sobrescrevê-lo

Cada semente treinou exatamente a melhor época que teve na validação: o modelo treinou 11, 15 e 15 épocas, e o controle 15, 15 e 16. O script 13 rodou uma única vez, sem erro, e não foi preciso rodá-lo de novo. Depois disso, o banco fica carregado com a régua da fase `final`: para voltar a rodar os scripts da fase `exp` (passos 10 a 12), rode antes `npm run carregar-filmes`.

### Resultado principal

São 456 usuários avaliados: os 459 do `u1.test` menos 446, 459 e 460, que não têm nenhum relevante.

| | NDCG@10 |
|---|---|
| Exp. 4: híbrido + rede (média das 3 sementes) | **0,3526** |
| Exp. 1: popularidade | 0,2451 |
| Diferença média por usuário (Exp. 4 − Exp. 1) | **+0,1076** |
| Intervalo de confiança de 95% (bootstrap pareado, 5.000 reamostragens, semente 2026) | [0,0907; 0,1250] |

O intervalo não inclui o zero, então **a hipótese principal é suportada**: no `u1.test`, os populares reordenados pela rede (Exp. 4) superaram a popularidade em NDCG@10. A tabela dos 7 experimentos, a análise mainstream × nicho e as limitações estão em [`resultados/README.md`](resultados/README.md#avaliacao-finaljson).

**Atenção:** a busca vetorial **não** entrou no sistema escolhido. Na grade da validação, N = 0 (nenhum vizinho) teve o maior NDCG, e o sistema avaliado usa só os 150 populares. O sistema avaliado usa só os 150 populares reordenados pela rede; o valor da busca vetorial não foi medido neste sistema (detalhes em `resultados/README.md`).

## Plano 3: filtragem colaborativa e avaliação retrospectiva (teste-2)

Pergunta: acrescentar filtragem colaborativa (FC) melhora a recomendação em relação à versão 1 (v1)? E, se melhora, a rede neural ainda acrescenta algo sobre ela? Spec: `docs/superpowers/specs/2026-11-13-plano3-filtragem-colaborativa-design.md` (v4.3). A FC item-item ("filmes curtidos pelas mesmas pessoas que curtiram os seus") é uma **busca vetorial no Postgres + pgvector** (índice HNSW, vetores de dimensão 943), não um cálculo em memória.

**Sistemas comparados.** S0: popularidade. **S1: FC sozinha** (top 10 dos 150 candidatos da FC, pelo escore oficial; sem rede e sem parâmetros treinados). S2: a v1 (150 populares + rede). S3: os 150 candidatos da FC + rede. S4-50-150: 50 populares + 150 da FC + rede (a melhor célula mista da validação).

Scripts do Plano 3, na ordem: `npm run divisoes-v2`, `mde-v2`, `carregar-v2`, `candidatos-v2`, `portao-v2`, `fidelidade-v2`, `grade-v2`, `congelar-v2`, `etapa1-v2`, `etapa2-v2`. Os arquivos gerados estão explicados em [`resultados/README.md`](resultados/README.md#plano-3-filtragem-colaborativa-teste-2).

### Protocolo

1. **Passo 0, antes de qualquer treino:** divisões e MDE (menor ganho detectável) registrados e commitados.
2. **Validação (fase `v2-exp`):** portão da FC como fonte de candidatos, fidelidade do HNSW e grade de 15 configurações com rede (K populares × N da FC, K e N em {0, 50, 100, 150}, sem (0, 0)). Com S0 e S1, são 17 sistemas. Regra de escolha: heurística de 1 erro padrão, com ordem de simplicidade fixa.
3. **Congelamento** (`e95b744`): `configuracao-v2.json` fixa o sistema, as épocas, as regras de avaliação e o sha256 do código. O campo `desvios` está **vazio**: nada mudou depois de ver a grade.
4. **Etapa 1** (`65318c4`): previsões do teste-2 gravadas e com hash commitado **antes** do gabarito.
5. **Etapa 2** (`86112a6`): o gabarito do teste-2 foi lido **uma única vez**, com autorização explícita do usuário. O script grava o resultado com a flag `wx` e se recusa a rodar de novo.

O `u1.test` e o `u.data` nunca foram lidos no Plano 3.

### Quem é o teste-2

O teste-2 são os usuários 1 a 462 do `u1.base`, com 20% das notas de cada um escondidas. São **462 usuários, mas só 445 são avaliados**: 17 ficaram fora de todas as métricas porque não têm nenhuma curtida escondida (nenhuma nota ≥ 4 escondida). Os ids dos 17 estão em `avaliacao-v2.json` (`usuarios.semRelevantes`). Por usuário do conjunto (contando os sem curtidas), o teste-2 tem em média 7,78 curtidas escondidas (mediana 5), contra 21,68 (mediana 15) na validação. Por isso o poder estatístico é menor, e os níveis absolutos de NDCG não são comparáveis aos da validação nem aos do `u1.test`.

## Avaliação retrospectiva do Plano 3 (teste-2)

### Comparação principal (única hipótese confirmatória) e ressalva

A hipótese principal, definida antes da grade, é uma só: a v2 escolhida na validação supera a v1 em NDCG@10 no teste-2. "Supera" quer dizer que o IC 95% da diferença pareada por usuário (bootstrap, 5.000 reamostragens, semente 2026) exclui zero. Nos sistemas com rede, o valor de cada usuário é a média das 3 sementes.

A validação escolheu **S1 (FC sozinha) como v2**. A v1 é S2.

| | NDCG@10 (445 usuários avaliados) |
|---|---|
| v2 = S1 (FC sozinha) | **0,1562** |
| v1 = S2 (150 populares + rede, média das 3 sementes) | 0,1268 |
| Diferença média por usuário (S1 − S2) | **+0,0294** |
| IC 95% (bootstrap pareado) | [0,0136; 0,0458] |
| `suportada` | sim |

O IC exclui zero, então a hipótese principal é **suportada, sob a ressalva abaixo**.

> O teste-2 é uma **avaliação retrospectiva com isolamento implementado no Plano 3**. Suas avaliações pertenciam ao `u1.base`, que foi usado como treino no Plano 2, inclusive no cálculo de popularidade e no treino do modelo avaliado no `u1.test`. Elas nunca serviram de gabarito para escolhas. No Plano 3, foram excluídas do treino, dos candidatos e dos vetores, mas **não são dados inéditos** para o projeto. Além disso, a direção de pesquisa (tentar FC) foi informada pelos resultados do `u1.test`, que são dos mesmos usuários 1–462. O resultado deve ser lido como uma nova avaliação sob protocolo de isolamento, e não como uma validação externa independente.

**O que a comparação mede.** É o ganho do **sistema completo**: candidatos, negativos de treino, ordenador, HNSW e preenchimento mudam ao mesmo tempo. Ela não atribui o ganho a nenhum componente. Só a comparação S3 − S1 (abaixo) isola o ordenador.

**Aviso sobre a validação.** O NDCG de S1 na validação (0,3721, contra 0,3113 de S2) é **otimista**: a mesma validação escolheu o sistema entre 17 e parou o treino das redes. Esses números, e o ganho da escolhida ali (+0,0608), não são estimativas imparciais; a estimativa sem esse viés é a do teste-2. O ganho no teste-2 (+0,0294) é menor que o da validação, e os níveis absolutos também são menores, o que é compatível com a escolha otimista, com um gabarito menor e com usuários de menos curtidas.

**Poder.** O MDE de v2 × v1 (só descritivo, calculado depois da grade, sob subamostragem da validação) é 0,0215, e o ganho observado é 0,0294. Os MDE pré-registrados foram 0,0235 (S0 × S1) e 0,0165 (S1 × uma heurística de FC). A simulação aproxima, não reproduz, o teste: usa outros usuários, outro par de sistemas e outro método de IC. A capacidade real pode ser diferente, inclusive menor.

### Comparações descritivas

As comparações abaixo **não são confirmatórias**. Aparecem com IC 95%, mas todas são rotuladas `descritiva` no JSON, e nenhuma é uma descoberta independente (comparações múltiplas). Nas três últimas, o sistema "melhor" foi escolhido na validação, depois de ver os resultados (`escolhidoDepoisDeVer: true`).

| Pergunta | Conta | Diferença de NDCG@10 | IC 95% |
|---|---|---|---|
| A FC ordena melhor que a popularidade? | S1 − S0 | +0,0600 | [0,0414; 0,0786] |
| A rede acrescenta algo à FC (mesma lista FC150)? | S3 − S1 | −0,0234 | [−0,0401; −0,0072] |
| A FC melhora os candidatos da rede, com o mesmo orçamento? | melhor de (100, 50), (50, 100), (0, 150) − S2 (o melhor foi S3) | +0,0060 | [−0,0012; 0,0133] |
| Os populares ajudam junto com a FC? | melhor S4 (S4-50-150) − S3 | −0,00002 | [−0,0062; 0,0059] |
| A FC melhora o sistema da v1? | melhor S4 (S4-50-150) − S2 | +0,0060 | [−0,0016; 0,0136] |

Leitura: a FC sozinha ordena melhor que a popularidade. A rede, sobre a mesma lista FC150, ficou **abaixo** da FC sozinha. As combinações com populares e com rede não se distinguem de S2 nem de S3 pelo IC.

NDCG@10, P@10, R@10, cobertura e popularidade média (445 usuários; nos sistemas com rede, média das sementes; entre colchetes, mínimo e máximo do NDCG entre as sementes):

| Sistema | NDCG@10 | P@10 | R@10 | Cobertura | Popularidade média |
|---|---|---|---|---|---|
| S0 popularidade | 0,0962 | 0,0652 | 0,1053 | 0,0220 | 347,3 |
| **S1 FC sozinha (v2)** | **0,1562** | 0,0975 | 0,1708 | 0,1231 | 247,6 |
| S2 v1 | 0,1268 [0,1234; 0,1299] | 0,0867 | 0,1344 | 0,1209 | 254,3 |
| S3 FC + rede | 0,1328 [0,1313; 0,1339] | 0,0903 | 0,1385 | 0,2253 | 232,6 |
| S4-50-150 | 0,1327 [0,1315; 0,1347] | 0,0894 | 0,1399 | 0,1887 | 240,5 |

Mainstream × nicho (descritivo): os usuários são divididos na mediana da popularidade média dos filmes que curtiram no treino (0,7871), em 223 mainstream e 222 nicho. NDCG@10, mainstream / nicho: S0 0,0981 / 0,0942; S1 0,1597 / 0,1526; S2 0,1327 / 0,1208; S3 0,1347 / 0,1308; S4-50-150 0,1332 / 0,1323. A FC sozinha (S1) fica à frente nos dois grupos.

### As redes neurais: implementadas, treinadas e avaliadas com TensorFlow.js

O trabalho pertence a uma unidade de Deep Learning e Sistemas de Recomendação, e a rede é parte central dele. Todas as redes foram implementadas, treinadas e avaliadas com **TensorFlow.js** (`@tensorflow/tfjs-node`, em `src/modelo/rede.js`): rede densa com camadas ocultas de 64 e 32 neurônios, 70 entradas, negativos tirados dos candidatos, lote de 256, parada antecipada com paciência de 3, teto de 50 épocas e sementes 1, 2 e 3. Os parâmetros estão em `configuracao-v2.json` (`rede`).

A rede **não ficou de fora por ausência**: ela é a v1 (S2), o ponto de comparação da hipótese principal, e entra nos sistemas S3 e S4. Na validação, foram treinadas 15 configurações com 3 sementes cada. As três que seguem para o teste-2 (S2, S3 e S4-50-150) usam as épocas escolhidas na validação (S2: 11, 16 e 11; S3: 11, 9 e 15; S4-50-150: 12, 9 e 11, por semente). O resultado negativo é um **achado medido**: neste conjunto, nesta arquitetura e neste protocolo, o ranqueador neural não demonstrou contribuição adicional suficiente sobre a FC. Na comparação descritiva, S3 ficou 0,0234 abaixo de S1.

### Fidelidade do pgvector e preenchimento (à parte do ganho de qualidade)

**O sistema avaliado é o implantado:** a lista oficial vem do **índice HNSW**, completada por **preenchimento com populares** quando faltam candidatos (§6 da spec). A diferença para a busca exata é medida à parte e nunca altera a lista oficial.

- **Teste-2 (usuários 1 a 462, sem gabarito):** o top 10 do HNSW é **idêntico** ao da referência exata em float64 em 462 de 462 usuários na v2 (S1). Por isso, o impacto da aproximação sobre a comparação principal é **zero por construção** (a v1 não usa a FC). A busca exata no banco bate com a referência (conferência aprovada), com 1 divergência de precisão float32 × float64, dentro da tolerância τ = 10⁻⁵ (1 usuário).
- **Déficit e preenchimento no teste-2:** nenhum usuário teve déficit real nem de recuperação, e nenhuma posição do top 10 de S1 e de S3 veio do preenchimento (0 posições). Não houve empate sem resolução no HNSW.
- **Validação (943 usuários, 942 com perfil):** a fração de usuários com a mesma lista FC no HNSW e na referência foi de 99,7% (N = 50), 99,4% (N = 100) e 98,9% (N = 150). O NDCG de S1 é idêntico nas duas versões, e o de S3 difere em +0,00004 (IC [0; 0,0001]). O único déficit é o de 1 usuário sem curtidas (déficit real); o déficit de recuperação é 0.
- **Fidelidade não medida:** recall e NDCG de fidelidade **não** são calculados no teste-2 (§5.3 da spec). A fidelidade no teste-2 só foi medida para S1 (a v2). Para S3 e S4-50-150, **a fidelidade no teste-2 não foi medida**, e o impacto da aproximação sobre o NDCG dessas duas comparações descritivas não foi medido.

O índice HNSW sobre 1.682 filmes é demonstrativo: a busca exata custa o mesmo que ele. Ele está aqui para mostrar a arquitetura de produção, não por necessidade de velocidade.

### Portão da FC como fonte de candidatos

Com lista de 150, o recall médio dos candidatos na validação foi 0,5815 para só populares (150, 0), 0,6990 para a melhor mistura (37, 113) e 0,6946 para só FC (0, 150). O portão passou nos dois critérios (`aprovado`). Foi um filtro de viabilidade e **já tinha sido visto na prévia**, então não é pré-registrado.

### Desvios do congelamento

Nenhum (`desvios` está vazio em `configuracao-v2.json`). Código congelado no commit `c048537`; congelamento `e95b744`; previsões e hash `65318c4`; resultado `86112a6`.

### Metodologia de desenvolvimento assistido por IA

Esta é uma **prática adotada neste projeto, não um padrão acadêmico formalmente estabelecido**.

- A spec e o plano foram escritos com um assistente de IA.
- As revisões externas das versões da spec e do plano foram validadas por subagentes instruídos a **contestar**, e não a confirmar.
- A execução foi por tarefa: um subagente implementador e um subagente revisor independente para cada uma, com rodadas de correção.
- O protocolo é travado por git: congelamento do código e da configuração, hash das previsões antes do gabarito e leitura única do gabarito.
- Houve supervisão humana em todos os pontos de decisão: aprovação da spec e do plano, revisão da grade antes do congelamento e autorização explícita para ler o gabarito.

As revisões por IA **não substituem a revisão humana nem a replicação independente**.

### Limitações do Plano 3

- **Teste-2 retrospectivo:** ver a ressalva ao lado da comparação principal.
- **Um conjunto, uma arquitetura, um protocolo:** o resultado vale para o MovieLens 100K, para a rede densa 64-32 com estas entradas e para este protocolo. Ele não se generaliza a outros conjuntos, outras arquiteturas, outros protocolos nem a catálogos maiores sem nova medição.
- **Notas invisíveis do `u1.test`:** cada usuário do teste-2 tem, em média, cerca de 28 notas no `u1.test` que o sistema vê como "não vistas".
  - Curtidas entre elas, se recomendadas, contam como não relevantes.
  - Isso não pode ser medido nem corrigido sem ler o `u1.test`, o que é proibido no Plano 3 (ler o `u.data` também o revelaria).
  - **Não se pode garantir o efeito disso sobre a diferença v2 − v1, nem a direção dele.** Só se a divisão do `u1.test` fosse aleatória dentro de cada usuário, o efeito esperado seria atenuar as diferenças e reduzir o poder. Essa hipótese não é verificável: o `mku.sh` documentado com o MovieLens monta o `u1.test` com as 20.000 primeiras linhas do `u.data`, o que não explica a concentração observada nos usuários 1–462. E, mesmo com divisão aleatória, o sinal da diferença média só estaria garantido sem heterogeneidade entre usuários.
  - O resultado vale para o NDCG medido contra o gabarito observado do teste-2, que é incompleto. Os níveis absolutos não são comparáveis aos da validação nem aos do `u1.test`.
- **Histórico do teste-2:** um pouco menor e com mais usuários pequenos que a validação (mediana de 32 notas, contra 38; p10 de 10, contra 14).
- **Gabarito menor:** cerca de 8 curtidas escondidas por usuário do conjunto, contra cerca de 22 na validação, o que dá menos poder estatístico.
- **Validação reutilizada pela 3ª vez:** as escolhas ficam otimistas, e o teste-2 é a proteção.
- **Sistema avaliado com aproximação:** a lista oficial é a do HNSW, com preenchimento por populares. A fidelidade e o déficit são reportados à parte.
- **Dimensão do vetor FC = nº de usuários (943):** cabe no limite do HNSW (2.000), mas não escala para milhares ou milhões de usuários. A evolução é usar vetores de dimensão fixa (por exemplo, fatoração de matrizes). Um usuário novo funciona na hora, mas só entra nos vetores dos filmes no próximo recálculo.
- **Viés de popularidade na FC:** não corrigido.
- **Vetores FC binários (nota ≥ 4):** descartam a intensidade da nota e não distinguem nota baixa de ausência de nota. Alternativas, como centrar as notas por usuário, ficaram fora do prazo.
- **Índice HNSW num catálogo pequeno:** é demonstrativo.
- **Isolamento do teste-2 conferido só em imports diretos:** o teste estático de isolamento confere só os imports diretos. `etapa1.js` e `etapa2.js` não importam `src/banco` nem `src/modelo` diretamente, mas há um import transitivo (`fidelidade.js` → `experimentos.js` → TensorFlow.js); banco e rede entram por funções injetadas.
- **Herdadas do Plano 2:** divisão não temporal, viés de coleta, usuário novo não medido, falsos negativos, parada aproximada e só 3 sementes.
- **Sem replicação independente:** as revisões por IA não a substituem.

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): na ordem de centenas de ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag confirmada com `docker pull`; digest `sha256:3e8b3adf...b700b21`)
- pgvector `extversion` medido: 0.8.1 (Postgres 17, via Docker no WSL2)

## Dados e citação

Os dados do MovieLens 100K não ficam no repositório. Citação:

F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872
