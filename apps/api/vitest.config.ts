import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    setupFiles: ['src/tests/setup.ts'],
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/utils/dateRanges.ts'],
      // El filtro "hoy" es la funcionalidad central: no se acepta nada por debajo del 100 %.
      thresholds: { 'src/utils/dateRanges.ts': { 100: true } },
    },
  },
})
