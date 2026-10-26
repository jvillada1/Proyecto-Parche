import { z } from 'zod'
import { BUSINESS_TYPES } from '@parche/shared'

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Correo electrónico inválido')),
  password: z.string().min(1, 'La contraseña es obligatoria'),
})

export const registerManagerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(80, 'El nombre no puede superar 80 caracteres'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(120, 'El correo no puede superar 120 caracteres')
    .pipe(z.email('Correo electrónico inválido')),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(72, 'La contraseña no puede superar 72 caracteres')
    .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra')
    .regex(/\d/, 'La contraseña debe incluir al menos un número'),
  business: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre del negocio debe tener al menos 2 caracteres')
      .max(80, 'El nombre del negocio no puede superar 80 caracteres'),
    type: z.enum(BUSINESS_TYPES, 'Tipo de negocio inválido'),
  }),
})

export type RegisterManagerInput = z.infer<typeof registerManagerSchema>
export type LoginInput = z.infer<typeof loginSchema>
