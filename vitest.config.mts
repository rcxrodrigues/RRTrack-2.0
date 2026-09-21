import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest compila com esbuild/Rolldown e nunca chama a API do compilador
// TypeScript — por isso funciona com o TS 7, ao contrário do ts-jest.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` lança ao ser importado fora do runtime do Next. No
      // build essa explosão é a barreira que mantém o service_role longe do
      // navegador; no teste, ela só atrapalha.
      'server-only': fileURLToPath(
        new URL('./tests/server-only-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    globals: false,
  },
});
