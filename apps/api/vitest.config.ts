import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    setupFiles: ['src/tests/setup.ts'],
    hookTimeout: 60_000,
  },
})
