import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@parche/shared'], // mete el paquete compartido dentro del build
})
