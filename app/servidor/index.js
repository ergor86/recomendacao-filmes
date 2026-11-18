// Ponto de entrada do servidor (spec 4.1 e 4.3). Escuta sempre em 0.0.0.0:3000 dentro do contêiner;
// APP_PORTA é a porta PUBLICADA, que o navegador manda no Host (spec 6.1).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirApp } from './app.js';
import { criarCiclo } from './ciclo.js';

const PORTA_INTERNA = 3000;
const env = process.env;
const porta = Number(env.APP_PORTA ?? 3000);
const dirEstado = env.APP_DIR_ESTADO ?? '/var/app/estado';
const dirWeb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

// só a mensagem: nunca objetos de erro inteiros (podem trazer a configuração da conexão)
const log = (m) => console.error(`[servidor] ${m}`);

const ciclo = criarCiclo({
  dirEstado,
  pg: { host: env.PGHOST ?? 'db', port: Number(env.PGPORT ?? 5432), database: env.PGDATABASE ?? 'recomendacao_app' },
  intervalos: {
    vigiaSegundos: Number(env.APP_VIGIA_SEGUNDOS ?? 60),
    conteudoACada: Number(env.APP_VIGIA_CONTEUDO_A_CADA ?? 10),
  },
  log,
});
const app = construirApp({ ciclo, porta, dirWeb });

await app.listen({ host: '0.0.0.0', port: PORTA_INTERNA });
console.log(`servidor ouvindo em 0.0.0.0:${PORTA_INTERNA}; abra http://localhost:${porta}`);
ciclo.iniciar().catch((e) => log(`início do ciclo: ${e.message}`));

let encerrando = false;
async function encerrar() {
  if (encerrando) return;
  encerrando = true;
  await app.close().catch(() => {});
  await ciclo.parar().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
