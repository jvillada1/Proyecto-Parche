import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/tests/integration-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
