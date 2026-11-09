# Contexto do projeto: Recomendação de Filmes com Banco Vetorial

Documento de partida para as sessões de desenvolvimento. Registra o objetivo, as decisões já tomadas e as que ainda estão em aberto.

## Quem está desenvolvendo

Aluno de pós-graduação (Engenharia de Software com IA Aplicada), iniciante em machine learning. Prefere explicações em português, com o conceito de ML por trás de cada trecho de código, e uma orientação no nível de um profissional sênior: apontar armadilhas, justificar decisões e avançar em etapas pequenas que possam ser verificadas.

## Objetivo

Construir um sistema de recomendação de filmes que:

1. treina uma rede neural para prever se um usuário vai gostar de um filme;
2. guarda os vetores (de filmes e de perfis de usuário) em um **Postgres com a extensão pgvector**;
3. para um usuário novo, monta o vetor dele a partir de características e preferências, busca no banco os vizinhos mais próximos (ex.: os 100 perfis mais parecidos) e roda o `predict` **apenas nesses candidatos** para gerar o top 10.

## Projeto de referência (inspiração)

Exercício do módulo 1 do curso: recomendação de produtos de e-commerce com TensorFlow.js, rodando inteiramente no navegador.

- Pasta: `C:\Users\andre\OneDrive\Documentos\Pós Graduação\Introdução a LLMs , Machine Learning e Deep Learning\engenharia-de-software-com-ia-aplicada\modulo01-fundamentos-de-ia-e-llms-para-programadores\exemplo-01-ecommerce-recomendations-template`
- Arquivo principal de ML: `src/workers/modelTrainingWorker.js`
- O `CLAUDE.md` dessa pasta descreve a arquitetura e o pipeline completo.

O que reaproveitar de lá:

- **Codificação de features:** valores contínuos normalizados com mín/máx; categóricos em one-hot; cada bloco multiplicado por um peso (`WEIGHTS`) que define a importância dele na similaridade.
- **Vetor do usuário:** média dos vetores dos itens que ele curtiu. Para um usuário sem histórico, um vetor com as características demográficas e o resto zerado.
- **Dados de treino:** a entrada é `[...vetorUsuario, ...vetorItem]` e o label é 1/0. A rede é densa (128 → 64 → 32 → 1 sigmoid), com `adam` e `binaryCrossentropy`.
- **Recomendação:** concatenar o usuário com cada candidato, rodar `predict` e ordenar pelo score.

O que o projeto de referência **não** tinha e este precisa ter:

- persistência do modelo e do contexto de codificação;
- banco vetorial para a busca de candidatos;
- amostragem de negativos;
- avaliação com conjunto de teste, métrica e comparação com uma linha de base.

## Dataset: MovieLens 100K

- Fonte oficial: https://grouplens.org/datasets/movielens/100k/
- Local: `data/ml-100k/` (extraído de `ml-100k.zip`).
- Tamanho: 943 usuários, 1.682 filmes, 100.000 notas. Cada usuário tem pelo menos 20 notas.

| Arquivo | Formato | Conteúdo |
|---|---|---|
| `u.data` | separado por TAB: `user_id  item_id  nota  timestamp` | as notas (1 a 5) |
| `u.user` | `id\|idade\|gênero\|ocupação\|cep` | idade de 7 a 73 anos; 21 ocupações (`u.occupation`) |
| `u.item` | `id\|título\|lançamento\|vídeo\|url\|` + 19 colunas 0/1 | os gêneros já vêm em **multi-hot** (lista em `u.genre`, incluindo `unknown`) |
| `u1..u5.base/.test` | mesmo formato do `u.data` | divisões de treino/teste prontas (80/20) |

Pontos de atenção nos dados:

- `u.item` está em **latin-1**, não em UTF-8: 9 títulos têm acentos. Leia com `fs.readFileSync(caminho, 'latin1')`.
- Distribuição das notas: 1 = 6.110, 2 = 11.370, 3 = 27.145, 4 = 34.174, 5 = 21.201. Usando "gostou = nota ≥ 4", cerca de 55% das interações são positivas.
- **Citação obrigatória** em trabalhos publicados: F. Maxwell Harper and Joseph A. Konstan. 2015. *The MovieLens Datasets: History and Context.* ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872

## Arquitetura proposta: recomendação em duas etapas

```
Usuário (idade, gênero, ocupação, gêneros favoritos, filmes que curtiu)
   │
   ▼
[1] RECUPERAÇÃO ─ Postgres + pgvector
   │  ORDER BY embedding <=> $vetorUsuario LIMIT 100   (distância de cosseno, índice HNSW)
   │  → perfis/filmes mais próximos → candidatos (~200–500 filmes)
   ▼
[2] RANQUEAMENTO ─ rede neural (tfjs-node), predict só nos candidatos
   ▼
Top 10
```

Começar recuperando **filmes** próximos ao vetor do usuário, que é a opção mais simples. Depois, adicionar a recuperação por **perfis de usuários** próximos (filtragem colaborativa baseada em usuários) e comparar as duas pela métrica.

### Mapeamento das features (e-commerce → filmes)

| E-commerce | Filmes |
|---|---|
| categoria (one-hot) | gêneros (multi-hot, 19 posições) |
| cor (one-hot) | década de lançamento (one-hot) |
| preço normalizado | popularidade (nº de notas) ou nota média, normalizada |
| idade média do comprador | idade média de quem deu nota ≥ 4 |
| "comprou" = 1 | nota ≥ 4 = 1 |

Características do usuário disponíveis para o vetor de usuário novo: idade, gênero, ocupação.

## Stack

- **Node.js** com `@tensorflow/tfjs-node`: mesma linguagem e mesma API do projeto de referência.
- **Postgres + pgvector** via Docker (imagem `pgvector/pgvector`), cliente `pg`.
- Python fica para depois. Trocar de linguagem agora significaria aprender duas coisas ao mesmo tempo.

## Armadilhas que já sabemos que existem

1. **Desbalanceamento:** 943 × 1.682 ≈ 1,6 milhão de pares, quase todos sem interação. Não rotular tudo o que não foi visto como 0. Usar **amostragem de negativos** (3 a 5 negativos sorteados para cada positivo).
2. **O contexto de codificação precisa ser salvo** (mín/máx, mapas de índice, pesos) junto com o modelo (`model.save()` + `context.json`). Se for recalculado de forma diferente na hora da recomendação, as posições do vetor mudam de significado e o modelo erra sem gerar nenhum erro.
3. **A dimensão de `vector(N)` no pgvector é fixa.** Mudar as features exige recriar a coluna e reinserir os vetores.
4. **Avaliação:** treinar em `u1.base` e avaliar em `u1.test` com **precision@10** (e recall@10). Sempre comparar com a **linha de base por popularidade**. Acurácia alta sozinha não quer dizer nada com dados desbalanceados.
5. **TF.js ignora em silêncio opções com nome errado** (`inputshape`, `optimazier`…). Isso já causou bugs no projeto de referência.
6. **Usuário novo sem histórico:** definir quais perguntas do cadastro (ex.: idade + 3 gêneros favoritos) geram o vetor inicial.

## Roteiro (cada etapa precisa funcionar e ser medida antes da próxima)

1. **Ambiente:** projeto Node, Docker com pgvector, conexão testada.
2. **Análise exploratória (EDA):** distribuição das notas, gêneros, notas por usuário e por filme, filmes com poucas notas.
3. **Codificação e carga:** gerar os vetores dos filmes e gravar no Postgres.
4. **Linha de base:** recomendação por popularidade e o script de avaliação com precision@10.
5. **Recuperação:** busca por vizinhos no pgvector com índice HNSW.
6. **Treino:** script separado, com amostragem de negativos; salvar o modelo e o contexto.
7. **Ranqueamento:** recuperação → predict → top 10, comparado com a linha de base.
8. **(Opcional)** API e interface, reaproveitando o front do projeto de referência.

## Decisões em aberto

- Limite de "gostou": nota ≥ 4, ou ≥ 3,5 relativo à média do próprio usuário?
- Usar popularidade ou nota média como feature contínua do filme (ou as duas)?
- Pesos de cada bloco de features.
- Guardar no banco só os vetores de filmes, ou também os perfis de usuário?
- Quantos vizinhos/candidatos recuperar (100? 200?) e qual o impacto disso na métrica.
