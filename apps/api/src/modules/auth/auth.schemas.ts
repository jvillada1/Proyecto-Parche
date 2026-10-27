import { z } from 'zod'
import { BUSINESS_TYPES } from '@parche/shared'

const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra')
  .regex(/\d/, 'La contraseña debe incluir al menos un número')

const adminPasswordSchema = z
  .string()
  .min(12, 'La contraseña de administrador debe tener al menos 12 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres')
  .regex(/[a-z]/, 'La contraseña debe incluir al menos una minúscula')
  .regex(/[A-Z]/, 'La contraseña debe incluir al menos una mayúscula')
  .regex(/\d/, 'La contraseña debe incluir al menos un número')
  .regex(/[^A-Za-z0-9]/, 'La contraseña debe incluir al menos un símbolo')

const nameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(80, 'El nombre no puede superar 80 caracteres')

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120, 'El correo no puede superar 120 caracteres')
  .pipe(z.email('Correo electrónico inválido'))

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Correo electrónico inválido')),
  password: z.string().min(1, 'La contraseña es obligatoria'),
})

export const registerManagerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  business: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre del negocio debe tener al menos 2 caracteres')
      .max(80, 'El nombre del negocio no puede superar 80 caracteres'),
    type: z.enum(BUSINESS_TYPES, 'Tipo de negocio inválido'),
  }),
})

export const createAdminSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: adminPasswordSchema,
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'La confirmación de la contraseña es obligatoria'),
  })
  .refine((data) => data.confirmPassword === data.newPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'La nueva contraseña debe ser distinta a la actual',
  })

export type RegisterManagerInput = z.infer<typeof registerManagerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type CreateAdminInput = z.infer<typeof createAdminSchema>
