# Recomendação de filmes

MovieLens 100K + Postgres/pgvector + TensorFlow.js. Spec em `docs/superpowers/specs/`.

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): ~244 ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag NÃO confirmada com `docker pull`)
- Verificação do banco pendente: Docker não instalado

## Uso

    cp .env.example .env
    docker compose up -d
    npm install
    npm run ambiente
    npm test

### Windows: tfjs-node não carrega (ERR_DLOPEN_FAILED)

Se o `npm install` não copiar a `tensorflow.dll` (o script de instalação falha com
`node-pre-gyp` não reconhecido), copie manualmente:

    cp node_modules/@tensorflow/tfjs-node/deps/lib/tensorflow.dll node_modules/@tensorflow/tfjs-node/lib/napi-v8/
