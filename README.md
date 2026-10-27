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

## Cuenta de administrador

Las cuentas `admin` no se pueden crear desde la API; se crean por consola con acceso a la base de datos:

```bash
pnpm --filter api admin:create          # pide nombre, correo y contraseña (oculta)
```

Para despliegues o CI, sin interacción (tras `pnpm build`):

```bash
ADMIN_NAME="…" ADMIN_EMAIL="…" ADMIN_PASSWORD="…" pnpm --filter api admin:create:prod
```

La contraseña de administrador exige 12+ caracteres con mayúscula, minúscula, número y símbolo. El
script falla si el correo ya existe: no promueve cuentas existentes a `admin`.
