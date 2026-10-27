import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/create-admin.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@parche/shared'],
})
