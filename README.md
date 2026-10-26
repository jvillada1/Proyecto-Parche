# Parche

Monorepo con pnpm workspaces.

## Estructura

| Ruta              | Descripción                                      |
| ----------------- | ------------------------------------------------ |
| `apps/api`        | API REST (Express, Mongoose, Zod)                |
| `apps/web`        | Cliente web (React, Vite, Tailwind, React Query) |
| `packages/shared` | Tipos, constantes y esquemas Zod compartidos     |

## Requisitos

- Node.js 20+
- pnpm
- Docker (para MongoDB local)

## Inicio rápido

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # ajusta los valores
pnpm db:up                               # levanta MongoDB
pnpm dev                                 # api + web en paralelo
```

## Scripts

| Comando                        | Descripción                      |
| ------------------------------ | -------------------------------- |
| `pnpm dev`                     | Inicia api y web en modo dev     |
| `pnpm build`                   | Compila todos los paquetes       |
| `pnpm typecheck`               | Verifica tipos en todo el repo   |
| `pnpm lint` / `pnpm lint:fix`  | Ejecuta ESLint (con/sin arreglo) |
| `pnpm format` / `format:check` | Formatea / verifica con Prettier |
| `pnpm db:up` / `pnpm db:down`  | Levanta / detiene MongoDB        |
