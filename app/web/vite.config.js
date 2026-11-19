import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, /api vai para o servidor em http://localhost:3000 com o Origin reescrito (spec §8),
// de modo que a validação de Host e Origin não precisa de exceção.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        headers: { Origin: 'http://localhost:3000' },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/preparar-testes.js'],
    include: ['src/**/*.test.jsx', 'src/**/*.test.js'],
    // menos processos em paralelo: com muitos, a transformação disputa a CPU e o RPC do worker estoura o tempo (60 s) em máquinas ocupadas
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
