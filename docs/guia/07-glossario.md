# 7. Glossário

Termos próprios do projeto e conceitos gerais, em ordem alfabética. Para explicações longas, siga o link.

| Termo | Significado |
|---|---|
| **AUC** | Área sob a curva ROC. Mede o quanto a rede separa positivos de negativos (classificação). Não é o mesmo que ordenar bem: ver [cap. 4, seção 8](04-fundamentos.md#8-amostragem-de-negativos). |
| **Bootstrap pareado** | Reamostragem dos usuários com reposição (5.000 vezes, semente 2026) para estimar o intervalo de confiança da diferença média entre dois sistemas. `src/avaliacao/estatistica.js`. |
| **Candidatos** | Lista de filmes (ex.: 150) que a etapa de recuperação entrega para a ordenação. |
| **Comparação confirmatória** | A única comparação de cada plano definida antes de ver os dados. As demais são **descritivas**. |
| **Congelamento** | Gravar e commitar a configuração escolhida (e, no Plano 3, o hash do código) antes de olhar o teste. `resultados/configuracao-final.json`, `resultados/configuracao-v2.json`. |
| **Cobertura** | Fração dos 1.682 filmes que aparece em pelo menos um top 10. |
| **Curtida** | Nota ≥ 4. Na aplicação: "Gostei" ou nota 4 ou 5. |
| **Déficit** | No Plano 3, vagas da parte FC que não puderam ser preenchidas. **Real**: faltaram filmes elegíveis. **De recuperação**: o HNSW devolveu menos do que a referência. `src/candidatos/composicao.js`. |
| **Diário de treinos** | `resultados/diario-treinos.jsonl`: uma linha por treino. Retreinar fora do plano exige `--motivo`. |
| **Escore oficial** | Cosseno da FC arredondado a 6 casas, para que banco e referência empatem da mesma forma. `escoreOficial` em `src/fc/referencia.js`. |
| **Etapa 1 / Etapa 2** | No Plano 3: gerar as previsões e commitar o hash delas **sem** gabarito (etapa 1); depois, ler o gabarito uma vez e calcular as métricas (etapa 2). |
| **Exp. 1 a 7** | Os sete sistemas avaliados no `u1.test` no Plano 2. Ver [cap. 5](05-experimentos-e-decisoes.md#plano-2-a-rede-neural). |
| **FC** | Filtragem colaborativa. No projeto, **item-item**: filmes parecidos são os que têm os mesmos fãs. Ver [cap. 4, seção 5](04-fundamentos.md#5-filtragem-colaborativa-item-item). |
| **FC150** | Os 150 primeiros filmes da busca colaborativa de um usuário. Usada por S1 e S3. |
| **Fase** | Recorte de dados que define treino e gabarito: `exp`, `final`, `v2-exp`, `v2-final`. Ver [cap. 3](03-pipeline-da-pesquisa.md#antes-de-tudo-as-fases). |
| **Fidelidade** | Quanto a lista do HNSW difere da busca exata e da referência float64. `src/avaliacao/fidelidade.js`. |
| **Gabarito** | Conjunto de filmes escondidos com nota ≥ 4 de cada usuário. É contra ele que as métricas medem. |
| **Gêmeos** | Filmes duplicados no MovieLens (mesmo título, ids diferentes). A aplicação esconde o de maior id. `app/comum/gemeos.js`. |
| **Grade** | Conjunto de combinações testadas. Plano 2: K × N de populares e vizinhos de conteúdo. Plano 3: K × N de populares e FC. |
| **H_M** | Na spec do Plano 3, a lista devolvida por **uma** busca colaborativa de tamanho M = 300. As listas menores são prefixos dela. |
| **HNSW** | Índice de busca aproximada de vizinhos em grafo hierárquico. Ver [cap. 4, seção 4](04-fundamentos.md#4-banco-vetorial-pgvector-e-o-índice-hnsw). |
| **IC 95%** | Intervalo de confiança de 95%. Se o IC da diferença fica todo acima de zero, a diferença é considerada estatisticamente distinguível de zero sob o protocolo do projeto, o que dá suporte à hipótese. Não prova que ela vale fora desse protocolo. |
| **K, N** | K = quantos populares entram nos candidatos; N = quantos vêm da outra fonte (vizinhos de conteúdo no Plano 2, FC no Plano 3). |
| **Linha de base** | Popularidade: os 10 filmes mais avaliados que o usuário não viu. O número a superar. |
| **Mainstream × nicho** | Divisão dos usuários pela mediana da popularidade média dos filmes que curtem. Mostra se um sistema só funciona para quem gosta de populares. |
| **MDE** | *Minimum detectable effect*, o menor ganho que o teste conseguiria detectar com 80% de poder. Pré-registrado no Plano 3 (`resultados/mde-v2.json`). |
| **Motivo** | Na aplicação, a razão do tipo de lista: `personalizado`, `parcial`, `sem_curtidas`, `curtidas_sem_vetor`, `sem_semelhantes`. |
| **NDCG@10** | Métrica principal: acertos no top 10, com peso maior nas primeiras posições, normalizado entre 0 e 1. Ver [cap. 4, seção 9](04-fundamentos.md#9-métricas-de-ranking-precisão-recall-e-ndcg). |
| **Negativos** | Exemplos rotulados 0 no treino. **Sorteados** (4 por positivo, uniforme ou dos candidatos) ou **observados** (notas 1–3). |
| **Ocultos** | Na aplicação, filmes que nunca são recomendados: o 267 ("unknown") e o gêmeo de maior id de cada par. |
| **Perfil** | Pesquisa: resumo do gosto de um usuário (média dos vetores dos curtidos, ou soma dos vetores FC). Aplicação: uma pessoa cadastrada localmente. |
| **pgvector** | Extensão do Postgres para vetores e busca por distância. |
| **Popularidade média** | Média do número de notas no treino dos filmes recomendados. Mede o viés para populares. |
| **Portão** | Filtro de viabilidade do Plano 3: a FC traz recall suficiente como fonte de candidatos? `resultados/portao-fc-v2-exp.json`. |
| **Preenchimento** | Completar uma lista com populares quando uma fonte devolve menos filmes que o necessário. |
| **Recall dos candidatos** | Fração dos relevantes que entrou na lista de candidatos. É o teto do sistema. |
| **Referência (float64)** | Implementação da FC em memória, com precisão dupla, usada para conferir o banco. `src/fc/referencia.js`. |
| **Régua** | Arquivo com todos os parâmetros de codificação (contagens, mín/máx, médias, pesos), calculado só com o treino e protegido por sha256. `src/features/regua.js`. |
| **Regra de 1 erro padrão** | Escolher a configuração mais simples entre as que ficam a menos de 1 erro padrão da melhor. `src/avaliacao/escolha.js`. |
| **Relevante** | Filme escondido que o usuário avaliou com nota ≥ 4. |
| **S0–S4** | Sistemas do Plano 3. **S0**: popularidade. **S1**: FC sozinha (a escolhida, v2). **S2**: 150 populares + rede (v1). **S3**: FC150 + rede. **S4-K-N**: K populares + N da FC + rede. |
| **Schema por fase** | No Plano 3, cada fase tem seu schema no Postgres (`v2_exp`, `v2_final`), com seus vetores e hashes. |
| **Selo** | Registro gravado por último numa carga (hash da régua no banco; `app.preparacao` na aplicação), que prova que a carga terminou e com quais dados. |
| **Semente** | Número que fixa um sorteio pseudoaleatório. As redes têm sementes 1, 2 e 3. |
| **Sem pop (`-sempop`)** | Controle do Plano 2: a rede sem as duas entradas de popularidade (68 em vez de 70). |
| **Teste-2** | 20% das notas dos usuários 1–462, escondidas dentro do `u1.base` e usadas como teste no Plano 3. |
| **`u1.base` / `u1.test`** | Divisão pronta do MovieLens em treino (80.000 notas) e teste (20.000). O `u1.test` foi lido uma vez, no Plano 2 (segundo o registro do autor; o script recusa sobrescrever o resultado). |
| **v1 / v2** | v1 = sistema do Plano 2 (S2). v2 = sistema escolhido no Plano 3 (S1). |
| **Validação** | 40% das notas dos usuários 463–943 escondidas para fazer escolhas. Nunca é o número final. |
| **Vetor de busca** | Pesquisa (Planos 1 e 2): 23 posições (19 gêneros + 3 épocas + 1 popularidade). Plano 3: vetor FC de 943 posições (uma por usuário). |
| **Vigia** | Na aplicação, verificação periódica de que o banco continua igual ao conferido. |

Próximo: [8. Registro completo da pesquisa](08-registro-completo.md).
