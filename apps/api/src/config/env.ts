import { z } from 'zod'

// Vacía en el .env cuenta como no definida.
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  APP_TIMEZONE: z.string().default('America/Bogota'),
  NOMINATIM_BASE_URL: z.url().default('https://nominatim.openstreetmap.org'),
  // Política de Nominatim: User-Agent que identifique la app, idealmente con un contacto.
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  CLOUDINARY_FOLDER: z.string().trim().min(1).default('parche'),
  NOMINATIM_USER_AGENT: z.string().trim().min(1).default('Parche/1.0 (desarrollo local)'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data
