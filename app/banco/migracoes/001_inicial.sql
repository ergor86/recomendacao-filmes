-- Migracao 1: schema `app` (spec 5.1). Idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.migracao (
  versao int PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.preparacao (
  id int PRIMARY KEY CHECK (id = 1),
  versao_app text NOT NULL,
  hash_regua text NOT NULL,
  hash_treino text NOT NULL,
  hash_vetores_fc text NOT NULL,
  n_filmes int NOT NULL,
  n_fc int NOT NULL,
  concluida_em timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS app.filme (
  id int PRIMARY KEY,
  titulo_original text NOT NULL,
  titulo_exibicao text NOT NULL,
  ano int,
  generos text[] NOT NULL,
  tem_vetor boolean NOT NULL,
  visivel boolean NOT NULL,
  titulo_busca text NOT NULL
);

CREATE TABLE IF NOT EXISTS app.estatistica_historica (
  filme_id int PRIMARY KEY REFERENCES app.filme,
  n_notas int NOT NULL,
  soma_notas int NOT NULL,
  n_aprovacao int NOT NULL
);

CREATE TABLE IF NOT EXISTS app.filme_gemeo (
  filme_id int REFERENCES app.filme,
  gemeo_id int REFERENCES app.filme,
  evidencia text NOT NULL,
  PRIMARY KEY (filme_id, gemeo_id)
);

-- Criada vazia; preenchida so na etapa 2 (spec 11.2).
CREATE TABLE IF NOT EXISTS app.filme_externo (
  filme_id int REFERENCES app.filme,
  fonte text NOT NULL,
  id_externo text NOT NULL,
  metodo text NOT NULL,
  origem_versao text NOT NULL,
  PRIMARY KEY (filme_id, fonte)
);

CREATE TABLE IF NOT EXISTS app.perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 40),
  exemplo boolean NOT NULL DEFAULT false,
  onboarding_concluido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.interacao (
  perfil_id uuid REFERENCES app.perfil ON DELETE CASCADE,
  filme_id int REFERENCES app.filme,
  tipo text NOT NULL CHECK (tipo IN ('gostei', 'quero_assistir', 'nota')),
  nota smallint CHECK ((tipo = 'nota') = (nota IS NOT NULL) AND (nota IS NULL OR nota BETWEEN 1 AND 5)),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil_id, filme_id)
);

INSERT INTO app.migracao (versao) VALUES (1) ON CONFLICT DO NOTHING;
